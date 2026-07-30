import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { Deal, Scenario } from "@/lib/validations";
import { buildPricingOnePager } from "@/lib/pricing-onepager";

type RouteContext = { params: Promise<{ dealId: string }> };

// GET /api/export/[dealId]/pricing-onepager?scenario_id=xxx
// Seller-facing HTML one-pager: how the offer was triangulated. Deliberately
// excludes internal metrics (IRR, after-tax, the buyer's-max reverse-solve).
export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const scenarioId = req.nextUrl.searchParams.get("scenario_id");
  const redis = getRedis();

  const deal = await redis.get<Deal>(`deal:${dealId}`);
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  let scenario: Scenario | null = null;
  if (scenarioId) scenario = await redis.get<Scenario>(`scenario:${scenarioId}`);
  if (!scenario) return NextResponse.json({ error: "Scenario not found" }, { status: 404 });

  const html = buildPricingOnePager(deal, scenario);
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
