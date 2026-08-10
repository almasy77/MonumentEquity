import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { calculateUnderwriting } from "@/lib/underwriting";
import type { ScenarioInputs } from "@/lib/underwriting";
import { fillSdaTemplate } from "@/lib/sda-template-fill";
import { buildSdaWrites, orderScenariosForSda, type SdaScenarioColumnInput } from "@/lib/sda-fill-mapping";
import type { Deal, Scenario } from "@/lib/validations";

type RouteContext = { params: Promise<{ dealId: string }> };

function scenarioToInputs(scenario: Scenario): ScenarioInputs {
  return {
    purchase: scenario.purchase_assumptions,
    financing: scenario.financing_assumptions,
    revenue: scenario.revenue_assumptions,
    expenses: scenario.expense_assumptions,
    capex: scenario.capex_assumptions,
    exit: scenario.exit_assumptions,
    tax: scenario.tax_assumptions,
    depreciation: (scenario as Record<string, unknown>).depreciation_assumptions || undefined,
  } as unknown as ScenarioInputs;
}

async function loadTemplate(): Promise<Buffer> {
  // Bundled alongside the source; next.config.ts traces it into the serverless fn.
  return readFile(path.join(process.cwd(), "src/lib/sda/sda-template.xlsx"));
}

// GET /api/export/[dealId]/sda?scenario_id=xxx
// Produces an exact copy of the SDA template with up to 4 of the deal's scenarios
// populated side-by-side. `scenario_id` (optional) selects which scenario drives the
// detailed sheets; otherwise the base scenario is used.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can export deals" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const requestedScenarioId = req.nextUrl.searchParams.get("scenario_id");

  try {
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${dealId}`);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    // Load all of the deal's scenarios, keep the active ones, order them to match
    // the SDA's column headers, and take the first four.
    const scenarioIds = await redis.zrange<string[]>(`scenarios:by_deal:${dealId}`, 0, -1, { rev: true });
    const scenarios = (
      await Promise.all(scenarioIds.map((id) => redis.get<Scenario>(`scenario:${id}`)))
    ).filter((s): s is Scenario => !!s && s.is_active !== false);

    if (scenarios.length === 0) {
      return NextResponse.json({ error: "This deal has no scenarios to export" }, { status: 400 });
    }

    const ordered = orderScenariosForSda(scenarios).slice(0, 4);

    const columns: SdaScenarioColumnInput[] = ordered.map((s) => {
      const inputs = scenarioToInputs(s);
      return {
        name: s.name,
        type: s.type,
        inputs,
        result: calculateUnderwriting(inputs),
        units: deal.units,
      };
    });

    // Active scenario (drives the detailed P&L/Returns/Exit): the requested one if
    // it's among the columns, else the base scenario, else the first column.
    let activeIndex = ordered.findIndex((s) => s.id === requestedScenarioId);
    if (activeIndex < 0) activeIndex = ordered.findIndex((s) => s.type === "base");
    if (activeIndex < 0) activeIndex = 0;

    const writes = buildSdaWrites(columns, activeIndex);
    const template = await loadTemplate();
    const buffer = await fillSdaTemplate(template, writes);

    const safeName = deal.address.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
    const filename = `${safeName}_SDA_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("GET /api/export/[dealId]/sda error:", err);
    return NextResponse.json({ error: "Failed to generate SDA export" }, { status: 500 });
  }
}
