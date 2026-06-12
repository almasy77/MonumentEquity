import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { calculateUnderwriting } from "@/lib/underwriting";
import type { ScenarioInputs } from "@/lib/underwriting";
import { buildSidecar } from "@/lib/sidecar";
import type { Deal, Scenario } from "@/lib/validations";

type RouteContext = { params: Promise<{ dealId: string }> };

// GET /api/export/[dealId]/sidecar?scenario_id=xxx — the JSON sidecar that
// accompanies the xlsx (fix-spec Phase 3.5): inputs, tax vectors, key
// outputs, reconciliation checks, metadata.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can export deals" }, { status: 403 });
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
  if (!deal || !scenario || scenario.deal_id !== dealId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
  const sidecar = buildSidecar(deal, scenario.name, inputs, result);

  const safeName = deal.address.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
  return new NextResponse(JSON.stringify(sidecar, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${safeName}_${scenario.name.replace(/[^a-zA-Z0-9]/g, "_")}_sidecar.json"`,
    },
  });
}
