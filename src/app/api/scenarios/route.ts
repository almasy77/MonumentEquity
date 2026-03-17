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
      { asking_price: deal.asking_price, units: deal.units },
      defaults
    );

    // Merge any provided overrides
    const inputs: ScenarioInputs = {
      purchase: { ...defaultInputs.purchase, ...body.purchase_assumptions },
      financing: { ...defaultInputs.financing, ...body.financing_assumptions },
      revenue: { ...defaultInputs.revenue, ...body.revenue_assumptions },
      expenses: { ...defaultInputs.expenses, ...body.expense_assumptions },
      capex: {
        ...defaultInputs.capex,
        ...body.capex_assumptions,
        projects: body.capex_assumptions?.projects ?? defaultInputs.capex.projects,
      },
      exit: { ...defaultInputs.exit, ...body.exit_assumptions },
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
