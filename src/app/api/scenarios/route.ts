import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { calculateUnderwriting, buildDefaultInputs, type ScenarioInputs } from "@/lib/underwriting";
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
    return NextResponse.json(results.filter((r): r is Scenario => r !== null));
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

  try {
    const body = await req.json();

    if (!body.deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    // Fetch deal for defaults
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${body.deal_id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Fetch user's default assumptions
    const user = await redis.get<{ default_assumptions?: Record<string, number> }>(
      `user:${session.user.id}`
    );
    const defaults = user?.default_assumptions ?? {};

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    // Build default inputs from deal data + user defaults
    const defaultInputs = buildDefaultInputs(
      {
        asking_price: deal.asking_price,
        units: deal.units,
        loi_amount: deal.loi_amount,
        bid_price: deal.bid_price,
        earnest_money: deal.earnest_money,
        ltv: deal.ltv,
        interest_rate: deal.interest_rate,
        loan_term_years: deal.loan_term_years,
        amortization_years: deal.amortization_years,
        io_period_months: deal.io_period_months,
        origination_fee_rate: deal.origination_fee_rate,
        transaction_costs: deal.transaction_costs,
        rent_roll: deal.rent_roll,
        current_occupancy: deal.current_occupancy,
        current_noi: deal.current_noi,
        current_annual_taxes: deal.current_annual_taxes,
        current_annual_insurance: deal.current_annual_insurance,
        t12: deal.t12,
        buy_box_scores: deal.buy_box_scores,
      },
      defaults
    );

    // Apply scenario-type-specific growth rate presets
    const scenarioType = body.type || "base";
    const typePresets: Record<string, { rent_growth_rate?: number; tax_escalation_rate?: number; vacancy_rate?: number; exit_cap_rate?: number }> = {
      upside: { rent_growth_rate: 0.05, tax_escalation_rate: 0.015, vacancy_rate: 0.05, exit_cap_rate: 0.06 },
      downside: { rent_growth_rate: 0.01, tax_escalation_rate: 0.03, vacancy_rate: 0.10, exit_cap_rate: 0.08 },
      value_add: { rent_growth_rate: 0.04, tax_escalation_rate: 0.02, vacancy_rate: 0.08 },
    };
    const preset = typePresets[scenarioType] || {};

    // Merge any provided overrides (explicit overrides > type presets > defaults)
    const inputs: ScenarioInputs = {
      purchase: { ...defaultInputs.purchase, ...body.purchase_assumptions },
      financing: { ...defaultInputs.financing, ...body.financing_assumptions },
      revenue: {
        ...defaultInputs.revenue,
        ...(preset.rent_growth_rate !== undefined ? { rent_growth_rate: preset.rent_growth_rate } : {}),
        ...(preset.vacancy_rate !== undefined ? { vacancy_rate: preset.vacancy_rate } : {}),
        ...body.revenue_assumptions,
      },
      expenses: {
        ...defaultInputs.expenses,
        ...(preset.tax_escalation_rate !== undefined ? { tax_escalation_rate: preset.tax_escalation_rate } : {}),
        ...body.expense_assumptions,
      },
      capex: {
        ...defaultInputs.capex,
        ...body.capex_assumptions,
        projects: body.capex_assumptions?.projects ?? defaultInputs.capex.projects,
      },
      exit: {
        ...defaultInputs.exit,
        ...(preset.exit_cap_rate !== undefined ? { exit_cap_rate: preset.exit_cap_rate } : {}),
        ...body.exit_assumptions,
      },
    };

    // Run calculations
    const result = calculateUnderwriting(inputs);

    const scenario: Scenario = {
      id,
      deal_id: body.deal_id,
      name: body.name || "Base Case",
      type: body.type || "base",
      version: 1,
      is_active: true,
      purchase_assumptions: inputs.purchase as unknown as Record<string, unknown>,
      financing_assumptions: inputs.financing as unknown as Record<string, unknown>,
      revenue_assumptions: inputs.revenue as unknown as Record<string, unknown>,
      expense_assumptions: inputs.expenses as unknown as Record<string, unknown>,
      capex_assumptions: {
        ...inputs.capex,
        projects: inputs.capex.projects,
      },
      exit_assumptions: inputs.exit as unknown as Record<string, unknown>,
      monthly_pro_forma: result.monthly,
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
    };

    await redis.set(`scenario:${id}`, JSON.stringify(scenario));
    await addToIndex(`scenarios:by_deal:${body.deal_id}`, id, Date.now());

    await logActivity({
      deal_id: body.deal_id,
      action: "scenario_created",
      entity_type: "scenario",
      entity_id: id,
      details: { name: scenario.name, type: scenario.type },
      user_id: session.user.id,
    });

    // Return scenario + full underwriting result
    return NextResponse.json(
      {
        scenario,
        underwriting: {
          monthly: result.monthly,
          annual: result.annual,
          metrics: result.metrics,
          sensitivity: result.sensitivity,
          warnings: result.warnings,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/scenarios error:", err);
    return NextResponse.json({ error: "Failed to create scenario" }, { status: 500 });
  }
}
