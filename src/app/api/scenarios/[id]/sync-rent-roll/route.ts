import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { calculateUnderwriting, buildUnitMixFromRentRoll, type ScenarioInputs } from "@/lib/underwriting";
import type { Scenario, Deal } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
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
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const deal = await redis.get<Deal>(`deal:${scenario.deal_id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    if (!deal.rent_roll || deal.rent_roll.length === 0) {
      return NextResponse.json(
        { error: "No rent roll data on this deal. Import an OM with rent roll first." },
        { status: 422 }
      );
    }

    const unitMix = buildUnitMixFromRentRoll(deal.rent_roll, deal.units);

    const now = new Date().toISOString();
    const updated: Scenario = {
      ...scenario,
      revenue_assumptions: {
        ...scenario.revenue_assumptions,
        unit_mix: unitMix,
      },
      version: scenario.version + 1,
      updated_at: now,
    };

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

    await redis.set(
      `scenario_version:${id}:${scenario.version}`,
      JSON.stringify(scenario)
    );
    await redis.set(`scenario:${id}`, JSON.stringify(updated));

    await logActivity({
      deal_id: scenario.deal_id,
      action: "scenario_synced_rent_roll",
      entity_type: "scenario",
      entity_id: id,
      details: {
        name: updated.name,
        version: updated.version,
        unit_types: unitMix.length,
        total_units: unitMix.reduce((s, u) => s + u.count, 0),
      },
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
    console.error("POST /api/scenarios/[id]/sync-rent-roll error:", err);
    return NextResponse.json({ error: "Failed to sync rent roll" }, { status: 500 });
  }
}
