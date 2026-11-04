import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { calculateUnderwriting, type ScenarioInputs } from "@/lib/underwriting";
import { stampMetrics } from "@/lib/engine-version";
import {
  SCENARIO_TYPE_PRESETS,
  createScenarioFromDefaults,
  underwritingPayload,
} from "@/lib/scenario-service";
import type { Scenario, Deal } from "@/lib/validations";

// GET /api/scenarios?deal_id=xxx — list scenarios for a deal
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dealId = req.nextUrl.searchParams.get("deal_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const redis = getRedis();
    const ids = await redis.zrange(`scenarios:by_deal:${dealId}`, 0, -1, { rev: true });
    if (ids.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`scenario:${id}`);
    }
    const results = await pipeline.exec<(Scenario | null)[]>();
    // P3-16: the list response does not need the per-scenario monthly pro forma
    // (nothing in the list view reads it, and a populated one is large). Strip it by
    // default; callers that need it pass ?include=monthly.
    const includeMonthly = req.nextUrl.searchParams.get("include") === "monthly";
    const scenarios = results
      .filter((r): r is Scenario => r !== null)
      .map((s) => (includeMonthly ? s : { ...s, monthly_pro_forma: [] }));
    return NextResponse.json(scenarios);
  } catch (err) {
    console.error("GET /api/scenarios error:", err);
    return NextResponse.json({ error: "Failed to fetch scenarios" }, { status: 500 });
  }
}

// POST /api/scenarios — create a new scenario
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const bodyOrError = await safeJson(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const body = bodyOrError;

    if (!body.deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const redis = getRedis();

    // Clone from existing scenario
    if (body.clone_from) {
      const source = await redis.get<Scenario>(`scenario:${body.clone_from}`);
      if (!source) {
        return NextResponse.json({ error: "Source scenario not found" }, { status: 404 });
      }

      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const cloneName = body.name || `${source.name} (Copy)`;
      const clonedType = body.type || source.type;

      // When a clone is RETYPED to a preset type (e.g. a Renovation seeded from
      // Base), apply that type's growth-rate preset on top of the copied
      // assumptions — otherwise the "Renovation" would be byte-identical to Base
      // until hand-edited, differing from the non-clone create path. Only applied
      // on an actual retype, and only for fields the preset defines.
      const clonePreset = clonedType !== source.type ? (SCENARIO_TYPE_PRESETS[clonedType] || {}) : {};
      const clonedRevenue = {
        ...source.revenue_assumptions,
        ...(clonePreset.rent_growth_rate !== undefined ? { rent_growth_rate: clonePreset.rent_growth_rate } : {}),
        ...(clonePreset.vacancy_rate !== undefined ? { vacancy_rate: clonePreset.vacancy_rate } : {}),
      };
      const clonedExpenses = {
        ...source.expense_assumptions,
        ...(clonePreset.tax_escalation_rate !== undefined ? { tax_escalation_rate: clonePreset.tax_escalation_rate } : {}),
      };
      const clonedExit = {
        ...source.exit_assumptions,
        ...(clonePreset.exit_cap_rate !== undefined ? { exit_cap_rate: clonePreset.exit_cap_rate } : {}),
      };

      const inputs = {
        purchase: source.purchase_assumptions,
        financing: source.financing_assumptions,
        revenue: clonedRevenue,
        expenses: clonedExpenses,
        capex: source.capex_assumptions,
        exit: clonedExit,
      tax: source.tax_assumptions,
        depreciation: (source as Record<string, unknown>).depreciation_assumptions || undefined,
      } as unknown as ScenarioInputs;

      const result = calculateUnderwriting(inputs);

      const cloned: Scenario = {
        ...source,
        id,
        name: cloneName,
        // A clone can retype the copy (e.g. seed a Base Case FROM the Current
        // scenario) — otherwise it inherits the source's type.
        type: clonedType,
        revenue_assumptions: clonedRevenue,
        expense_assumptions: clonedExpenses,
        exit_assumptions: clonedExit,
        version: 1,
        is_active: true,
        monthly_pro_forma: [], // storage: recomputed on read, never persisted
        calculated_metrics: {
          irr: result.metrics.irr ?? undefined,
          cash_on_cash: result.metrics.average_cash_on_cash,
          dscr: result.metrics.year1_dscr,
          equity_multiple: result.metrics.equity_multiple,
          going_in_cap: result.metrics.going_in_cap,
          stabilized_cap: result.metrics.stabilized_cap,
        },
        created_at: now,
        updated_at: now,
        updated_by: session.user.id,
        updated_via: "web",
      };
      stampMetrics(cloned, result); // P3-7: engine_version + metrics_calculated_at

      await redis.set(`scenario:${id}`, JSON.stringify(cloned));
      await addToIndex(`scenarios:by_deal:${source.deal_id}`, id, Date.now());

      await logActivity({
        deal_id: source.deal_id,
        action: "scenario_created",
        entity_type: "scenario",
        entity_id: id,
        details: { name: cloned.name, type: cloned.type, cloned_from: source.name },
        user_id: session.user.id,
      });

      return NextResponse.json(
        {
          scenario: cloned,
          underwriting: {
            monthly: result.monthly,
            annual: result.annual,
            metrics: result.metrics,
            sensitivity: result.sensitivity,
            warnings: result.warnings,
            tax: result.tax, // after-tax layer (present only when tax_assumptions set)
          },
        },
        { status: 201 }
      );
    }

    // Fetch deal for defaults
    const deal = await redis.get<Deal>(`deal:${body.deal_id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const { scenario, result } = await createScenarioFromDefaults(
      deal,
      body,
      session.user.id,
      "web"
    );

    // Return scenario + full underwriting result
    return NextResponse.json(
      { scenario, underwriting: underwritingPayload(result) },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/scenarios error:", err);
    return NextResponse.json({ error: "Failed to create scenario" }, { status: 500 });
  }
}
