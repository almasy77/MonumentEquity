import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex, scanKeys } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { calculateUnderwriting, type ScenarioInputs } from "@/lib/underwriting";
import {
  ENGINE_VERSION,
  ENGINE_CHANGE_REASONS,
  stampMetrics,
  metricsFromResult,
  metricsDiffer,
  type StoredMetrics,
} from "@/lib/engine-version";
import { applyScenarioUpdate, underwritingPayload } from "@/lib/scenario-service";
import type { Scenario } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/scenarios/[id] — get scenario with full underwriting result
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await ctx.params;
    const redis = getRedis();
    const scenario = await redis.get<Scenario>(`scenario:${id}`);
    if (!scenario) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Recalculate to get full result (monthly, annual, sensitivity, warnings)
    const inputs = {
      purchase: scenario.purchase_assumptions,
      financing: scenario.financing_assumptions,
      revenue: scenario.revenue_assumptions,
      expenses: scenario.expense_assumptions,
      capex: scenario.capex_assumptions,
      exit: scenario.exit_assumptions,
      tax: scenario.tax_assumptions,
      depreciation: (scenario as Record<string, unknown>).depreciation_assumptions || undefined,
    } as unknown as ScenarioInputs;

    const result = calculateUnderwriting(inputs);

    // Lazy recompute + version stamp (P3-7). The response is always fresh, but the
    // STORED calculated_metrics blob (used by lists, cards and exports) can be from
    // an older engine. When this scenario's engine_version lags, re-stamp it: if the
    // fresh metrics differ from the stored ones, capture the prior values + reason
    // into previous_metrics so the UI can surface the change. Persist is best-effort
    // and never blocks the read.
    let resultsChanged: { previous: StoredMetrics; current: StoredMetrics; reason: string } | undefined;
    const sc = scenario as unknown as Record<string, unknown>;
    if ((sc.engine_version as number | undefined) !== ENGINE_VERSION) {
      const fresh = metricsFromResult(result);
      const stored = sc.calculated_metrics as StoredMetrics | undefined;
      if (metricsDiffer(stored, fresh) && stored) {
        const reason = ENGINE_CHANGE_REASONS[ENGINE_VERSION] ?? "Engine updated";
        sc.previous_metrics = {
          ...stored,
          engine_version: sc.engine_version as number | undefined,
          reason,
          changed_at: new Date().toISOString(),
        };
        resultsChanged = { previous: stored, current: fresh, reason };
      }
      stampMetrics(scenario, result);
      try {
        await redis.set(`scenario:${id}`, JSON.stringify(scenario));
      } catch (e) {
        console.error("P3-7 lazy re-stamp persist failed:", e);
      }
    }

    return NextResponse.json({
      scenario,
      results_changed: resultsChanged,
      underwriting: {
        monthly: result.monthly,
        annual: result.annual,
        metrics: result.metrics,
        sensitivity: result.sensitivity,
        warnings: result.warnings,
        tax: result.tax, // after-tax layer (present only when tax_assumptions set)
      },
    });
  } catch (err) {
    console.error("GET /api/scenarios/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch scenario" }, { status: 500 });
  }
}

// PUT /api/scenarios/[id] — update scenario assumptions and recalculate
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const bodyOrError = await safeJson(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const body = bodyOrError;
    const redis = getRedis();

    const existing = await redis.get<Scenario>(`scenario:${id}`);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { scenario, result } = await applyScenarioUpdate(
      existing,
      body,
      session.user.id,
      "web"
    );

    return NextResponse.json({
      scenario,
      underwriting: underwritingPayload(result),
    });
  } catch (err) {
    console.error("PUT /api/scenarios/[id] error:", err);
    return NextResponse.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}

// DELETE /api/scenarios/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const redis = getRedis();

    const scenario = await redis.get<Scenario>(`scenario:${id}`);
    if (!scenario) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await redis.del(`scenario:${id}`);
    await removeFromIndex(`scenarios:by_deal:${scenario.deal_id}`, id);

    // Purge this scenario's version snapshots (scenario_version:${id}:${n}),
    // which live outside any index and would otherwise orphan forever.
    const versionKeys = await scanKeys(`scenario_version:${id}:*`);
    if (versionKeys.length > 0) await redis.del(...versionKeys);

    await logActivity({
      deal_id: scenario.deal_id,
      action: "scenario_deleted",
      entity_type: "scenario",
      entity_id: id,
      details: { name: scenario.name },
      user_id: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/scenarios/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete scenario" }, { status: 500 });
  }
}
