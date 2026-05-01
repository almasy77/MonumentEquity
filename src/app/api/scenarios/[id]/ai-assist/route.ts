import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { calculateUnderwriting, type ScenarioInputs } from "@/lib/underwriting";
import { logActivity } from "@/lib/activity";
import type { Scenario } from "@/lib/validations";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const SYSTEM_PROMPT = `You are an AI assistant for a real estate underwriting tool. The user will give you their current scenario assumptions (JSON) and a natural language instruction. Your job is to modify the assumptions according to their instruction and return the updated JSON.

Rules:
- Return ONLY valid JSON — no markdown fences, no commentary, no explanation
- Return the COMPLETE assumptions object with all sections, not just changed fields
- Preserve all fields you don't need to change
- The assumptions object has these top-level sections:
  - purchase_assumptions: { purchase_price, closing_cost_rate, capex_reserve, ... }
  - financing_assumptions: { ltv, interest_rate, loan_term_years, amortization_years, io_period_months, origination_fee_rate, ... }
  - revenue_assumptions: { unit_mix: [{ type, count, current_rent, market_rent, renovated_rent_premium }], other_income_monthly, vacancy_rate, bad_debt_rate, concessions_rate, rent_growth_rate }
  - expense_assumptions: { opex_inputs: { management_fees, payroll, property_tax, insurance, utilities, repairs_maintenance, admin_legal_marketing, contract_services, reserves: { value, mode } }, expense_escalation_rate, tax_escalation_rate, ... }
  - capex_assumptions: { per_unit_cost, units_to_renovate, renovation_start_month, renovation_duration_months, projects: [{ name, cost, start_month, duration_months }] }
  - exit_assumptions: { exit_cap_rate, hold_period_months, selling_costs_rate }

Common field mappings:
- "reno premium" or "renovation premium" → unit_mix[].renovated_rent_premium
- "current rent" → unit_mix[].current_rent
- "market rent" → unit_mix[].market_rent
- "vacancy" → vacancy_rate (decimal, e.g. 0.07 = 7%)
- "purchase price" or "offer" → purchase_price
- "cap rate" → exit_cap_rate (decimal)
- "hold period" → hold_period_months
- "interest rate" → interest_rate (decimal)
- "LTV" → ltv (decimal)
- "other income" → other_income_monthly
- "rent growth" → rent_growth_rate (decimal)
- "expense growth" → expense_escalation_rate (decimal)
- "capex" or "renovation cost" → per_unit_cost or projects
- Rates/percentages should be decimals (5% = 0.05)
- Dollar amounts should be raw numbers (no $ or commas)

If the instruction is ambiguous, make your best judgment and apply the change.`;

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const { instruction } = await req.json();

    if (!instruction || typeof instruction !== "string" || instruction.trim().length === 0) {
      return NextResponse.json({ error: "Instruction is required" }, { status: 400 });
    }
    if (instruction.length > 2000) {
      return NextResponse.json({ error: "Instruction too long (max 2000 characters)" }, { status: 400 });
    }

    const redis = getRedis();
    const scenario = await redis.get<Scenario>(`scenario:${id}`);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const currentAssumptions = {
      purchase_assumptions: scenario.purchase_assumptions,
      financing_assumptions: scenario.financing_assumptions,
      revenue_assumptions: scenario.revenue_assumptions,
      expense_assumptions: scenario.expense_assumptions,
      capex_assumptions: scenario.capex_assumptions,
      exit_assumptions: scenario.exit_assumptions,
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI not configured" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Current assumptions:\n${JSON.stringify(currentAssumptions, null, 2)}\n\nInstruction: ${instruction}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json({ error: "No response from AI" }, { status: 500 });
    }

    let json = block.text.trim();
    const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();

    let updated: Record<string, unknown>;
    try {
      updated = JSON.parse(json);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON. Try rephrasing your instruction." }, { status: 422 });
    }

    if (typeof updated !== "object" || updated === null || Array.isArray(updated)) {
      return NextResponse.json({ error: "AI returned unexpected format. Try rephrasing your instruction." }, { status: 422 });
    }

    const now = new Date().toISOString();
    const ai = updated as Record<string, Record<string, unknown>>;
    const updatedScenario: Scenario = {
      ...scenario,
      ...(ai.purchase_assumptions && { purchase_assumptions: ai.purchase_assumptions as Scenario["purchase_assumptions"] }),
      ...(ai.financing_assumptions && { financing_assumptions: ai.financing_assumptions as Scenario["financing_assumptions"] }),
      ...(ai.revenue_assumptions && { revenue_assumptions: ai.revenue_assumptions as Scenario["revenue_assumptions"] }),
      ...(ai.expense_assumptions && { expense_assumptions: ai.expense_assumptions as Scenario["expense_assumptions"] }),
      ...(ai.capex_assumptions && { capex_assumptions: ai.capex_assumptions as Scenario["capex_assumptions"] }),
      ...(ai.exit_assumptions && { exit_assumptions: ai.exit_assumptions as Scenario["exit_assumptions"] }),
      version: (scenario.version ?? 0) + 1,
      updated_at: now,
    };

    const inputs = {
      purchase: updatedScenario.purchase_assumptions,
      financing: updatedScenario.financing_assumptions,
      revenue: updatedScenario.revenue_assumptions,
      expenses: updatedScenario.expense_assumptions,
      capex: updatedScenario.capex_assumptions,
      exit: updatedScenario.exit_assumptions,
    } as unknown as ScenarioInputs;

    let result;
    try {
      result = calculateUnderwriting(inputs);
    } catch {
      return NextResponse.json(
        { error: "AI produced invalid assumptions that could not be calculated. Try rephrasing your instruction." },
        { status: 422 },
      );
    }

    updatedScenario.monthly_pro_forma = result.monthly;
    updatedScenario.calculated_metrics = {
      irr: result.metrics.irr ?? undefined,
      cash_on_cash: result.metrics.average_cash_on_cash,
      dscr: result.metrics.year1_dscr,
      equity_multiple: result.metrics.equity_multiple,
      going_in_cap: result.metrics.going_in_cap,
      stabilized_cap: result.metrics.stabilized_cap,
    };

    await redis.set(`scenario_version:${id}:${scenario.version}`, JSON.stringify(scenario));
    await redis.set(`scenario:${id}`, JSON.stringify(updatedScenario));

    await logActivity({
      deal_id: scenario.deal_id,
      action: "ai_assist",
      entity_type: "scenario",
      entity_id: id,
      details: { instruction, name: updatedScenario.name },
      user_id: session.user.id,
    });

    return NextResponse.json({
      scenario: updatedScenario,
      underwriting: {
        monthly: result.monthly,
        annual: result.annual,
        metrics: result.metrics,
        sensitivity: result.sensitivity,
        warnings: result.warnings,
      },
    });
  } catch (err) {
    console.error("POST /api/scenarios/[id]/ai-assist error:", err);
    const message = err instanceof Error ? err.message : "AI assistant failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
