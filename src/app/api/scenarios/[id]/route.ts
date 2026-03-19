import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { calculateUnderwriting, type ScenarioInputs } from "@/lib/underwriting";
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
      depreciation: (scenario as Record<string, unknown>).depreciation_assumptions || undefined,
    } as unknown as ScenarioInputs;

    const result = calculateUnderwriting(inputs);

    return NextResponse.json({
      scenario,
      underwriting: {
        monthly: result.monthly,
        annual: result.annual,
        metrics: result.metrics,
        sensitivity: result.sensitivity,
        warnings: result.warnings,
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
    const body = await req.json();
    const redis = getRedis();

    const existing = await redis.get<Scenario>(`scenario:${id}`);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    // Merge updates
    const updated: Scenario = {
      ...existing,
      name: body.name ?? existing.name,
      type: body.type ?? existing.type,
      is_active: body.is_active ?? existing.is_active,
      purchase_assumptions: body.purchase_assumptions ?? existing.purchase_assumptions,
      financing_assumptions: body.financing_assumptions ?? existing.financing_assumptions,
      revenue_assumptions: body.revenue_assumptions ?? existing.revenue_assumptions,
      expense_assumptions: body.expense_assumptions ?? existing.expense_assumptions,
      capex_assumptions: body.capex_assumptions ?? existing.capex_assumptions,
      exit_assumptions: body.exit_assumptions ?? existing.exit_assumptions,
      depreciation_assumptions: body.depreciation_assumptions ?? (existing as Record<string, unknown>).depreciation_assumptions ?? {},
      version: existing.version + 1,
      updated_at: now,
    };

    // Recalculate
    const inputs = {
      purchase: updated.purchase_assumptions,
      financing: updated.financing_assumptions,
      revenue: updated.revenue_assumptions,
      expenses: updated.expense_assumptions,
      capex: updated.capex_assumptions,
      exit: updated.exit_assumptions,
    } as unknown as ScenarioInputs;

    const result = calculateUnderwriting(inputs);

    updated.monthly_pro_forma = result.monthly;
    updated.calculated_metrics = {
      irr: result.metrics.irr ?? undefined,
      cash_on_cash: result.metrics.average_cash_on_cash,
      dscr: result.metrics.year1_dscr,
      equity_multiple: result.metrics.equity_multiple,
      going_in_cap: result.metrics.going_in_cap,
      stabilized_cap: result.metrics.stabilized_cap,
    };

    // Save version snapshot
    await redis.set(
      `scenario_version:${id}:${existing.version}`,
      JSON.stringify(existing)
    );

    await redis.set(`scenario:${id}`, JSON.stringify(updated));

    await logActivity({
      deal_id: existing.deal_id,
      action: "scenario_updated",
      entity_type: "scenario",
      entity_id: id,
      details: { name: updated.name, version: updated.version },
      user_id: session.user.id,
    });

    return NextResponse.json({
      scenario: updated,
      underwriting: {
        monthly: result.monthly,
        annual: result.annual,
        metrics: result.metrics,
        sensitivity: result.sensitivity,
        warnings: result.warnings,
      },
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
