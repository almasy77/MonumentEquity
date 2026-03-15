import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { generateExcelWorkbook } from "@/lib/excel-export";
import { calculateUnderwriting } from "@/lib/underwriting";
import type { ScenarioInputs } from "@/lib/underwriting";
import type { Deal, Scenario } from "@/lib/validations";

type RouteContext = { params: Promise<{ dealId: string }> };

// GET /api/export/[dealId]?scenario_id=xxx — download Excel workbook
export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const scenarioId = req.nextUrl.searchParams.get("scenario_id");

  if (!scenarioId) {
    return NextResponse.json({ error: "scenario_id is required" }, { status: 400 });
  }

  const redis = getRedis();

  const [deal, scenario] = await Promise.all([
    redis.get<Deal>(`deal:${dealId}`),
    redis.get<Scenario>(`scenario:${scenarioId}`),
  ]);

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }
  if (scenario.deal_id !== dealId) {
    return NextResponse.json({ error: "Scenario does not belong to this deal" }, { status: 400 });
  }

  // Reconstruct inputs and recalculate
  const inputs = {
    purchase: scenario.purchase_assumptions,
    financing: scenario.financing_assumptions,
    revenue: scenario.revenue_assumptions,
    expenses: scenario.expense_assumptions,
    capex: scenario.capex_assumptions,
    exit: scenario.exit_assumptions,
  } as unknown as ScenarioInputs;

  const result = calculateUnderwriting(inputs);

  // Generate Excel
  const buffer = await generateExcelWorkbook(deal, scenario.name, inputs, result);

  // Build filename
  const safeName = deal.address.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
  const safeScenario = scenario.name.replace(/[^a-zA-Z0-9]/g, "_");
  const filename = `${safeName}_${safeScenario}_${new Date().toISOString().split("T")[0]}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
