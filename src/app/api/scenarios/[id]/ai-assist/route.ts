import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { calculateUnderwriting, type ScenarioInputs } from "@/lib/underwriting";
import { logActivity } from "@/lib/activity";
import { applyAssumptionEdits, type EditOp } from "@/lib/assumption-edits";
import type { Scenario } from "@/lib/validations";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const SYSTEM_PROMPT = `You are an AI assistant for a real estate underwriting tool. The user gives you their current scenario assumptions (JSON) and a natural-language instruction. Determine the minimal set of edits and return them by calling the "edit_assumptions" tool — do NOT restate the whole object.

Each operation sets a value at a dot-path into the assumptions object. Use "[*]" to set a field on EVERY element of an array (e.g. every unit-mix row), or "[0]" for a specific index. Paths must start with one of these sections:
- purchase_assumptions: { purchase_price, closing_cost_rate, capex_reserve }
- financing_assumptions: { ltv, interest_rate, loan_term_years, amortization_years, io_period_months, origination_fee_rate }
- revenue_assumptions: { unit_mix: [{ type, count, current_rent, market_rent, renovated_rent_premium }], other_income_monthly, vacancy_rate, bad_debt_rate, concessions_rate, rent_growth_rate }
- expense_assumptions: { opex_inputs: { ... {value, mode} }, turnover_rate, turnover_cost_per_unit, insurance_per_unit, utilities_per_unit, property_tax_total, management_fee_rate, expense_escalation_rate, tax_escalation_rate }
- capex_assumptions: { per_unit_cost, units_to_renovate, renovation_start_month, renovation_end_month, projects: [{ name, cost, start_month, duration_months }] }
- exit_assumptions: { exit_cap_rate, hold_period_years, selling_cost_rate }

Field mappings (value conventions: rates are decimals — 5% = 0.05; dollars are raw numbers, no $ or commas):
- "reno premium" / "renovation premium" → revenue_assumptions.unit_mix[*].renovated_rent_premium
- "current rent" → revenue_assumptions.unit_mix[*].current_rent   "market rent" → revenue_assumptions.unit_mix[*].market_rent
- "vacancy" → revenue_assumptions.vacancy_rate    "rent growth" → revenue_assumptions.rent_growth_rate
- "purchase price" / "offer" → purchase_assumptions.purchase_price
- "cap rate" / "exit cap" → exit_assumptions.exit_cap_rate    "hold period" → exit_assumptions.hold_period_years
- "interest rate" → financing_assumptions.interest_rate    "LTV" → financing_assumptions.ltv    "IO" / "interest-only" → financing_assumptions.io_period_months
- "other income" → revenue_assumptions.other_income_monthly
- "turnover rate" → expense_assumptions.turnover_rate    "turnover cost" → expense_assumptions.turnover_cost_per_unit
- "expense growth" → expense_assumptions.expense_escalation_rate
- "renovation cost" / "capex per unit" → capex_assumptions.per_unit_cost

"all" / "every" / "default" applied to a unit-mix field → use [*] to hit every row (e.g. "set all reno premiums to 0" → path revenue_assumptions.unit_mix[*].renovated_rent_premium, value 0). If the instruction is ambiguous, make your best judgment and apply the change.`;

const EDIT_TOOL: Anthropic.Tool = {
  name: "edit_assumptions",
  description:
    "Apply a list of edits to the scenario assumptions. Return ONLY the fields that change — never the whole object. Use [*] on an array segment to set a field across every element (e.g. all unit-mix rows).",
  input_schema: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        description: "The minimal set of edits to apply.",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Dot-path into the assumptions, e.g. 'revenue_assumptions.unit_mix[*].renovated_rent_premium' or 'exit_assumptions.exit_cap_rate'.",
            },
            value: { description: "The value to set (number, string, or boolean)." },
          },
          required: ["path", "value"],
        },
      },
    },
    required: ["operations"],
  },
};

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
    // Ask for a small list of edit OPERATIONS via a forced tool call — not a full
    // rewrite of the assumptions. This keeps the model's output tiny and fast
    // (previously it echoed the entire object, incl. every unit-mix row, which for
    // large rent rolls exceeded the 60s function limit and returned a 504 timeout).
    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [EDIT_TOOL],
      tool_choice: { type: "tool", name: "edit_assumptions" },
      messages: [
        {
          role: "user",
          content: `Current assumptions:\n${JSON.stringify(currentAssumptions, null, 2)}\n\nInstruction: ${instruction}`,
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json({ error: "No response from AI. Try rephrasing your instruction." }, { status: 500 });
    }
    const ops = (toolUse.input as { operations?: EditOp[] })?.operations;
    if (!Array.isArray(ops) || ops.length === 0) {
      return NextResponse.json({ error: "The assistant couldn't identify a change to make. Try rephrasing your instruction." }, { status: 422 });
    }
    if (ops.length > 200) {
      return NextResponse.json({ error: "That instruction implies too many changes at once. Try a narrower instruction." }, { status: 422 });
    }

    // Apply the edits to a deep clone so the stored scenario is never mutated in place.
    const edited = structuredClone(currentAssumptions) as unknown as Record<string, unknown>;
    const applied = applyAssumptionEdits(edited, ops);
    if (applied === 0) {
      return NextResponse.json({ error: "The assistant's changes didn't match any assumption. Try rephrasing your instruction." }, { status: 422 });
    }

    const now = new Date().toISOString();
    const ed = edited as Record<string, unknown>;
    const updatedScenario: Scenario = {
      ...scenario,
      purchase_assumptions: ed.purchase_assumptions as Scenario["purchase_assumptions"],
      financing_assumptions: ed.financing_assumptions as Scenario["financing_assumptions"],
      revenue_assumptions: ed.revenue_assumptions as Scenario["revenue_assumptions"],
      expense_assumptions: ed.expense_assumptions as Scenario["expense_assumptions"],
      capex_assumptions: ed.capex_assumptions as Scenario["capex_assumptions"],
      exit_assumptions: ed.exit_assumptions as Scenario["exit_assumptions"],
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
      tax: updatedScenario.tax_assumptions,
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
    // Generic message — don't reflect raw Anthropic-SDK/Redis exception text to the client.
    return NextResponse.json({ error: "The assistant failed to process that instruction. Please try again." }, { status: 500 });
  }
}
