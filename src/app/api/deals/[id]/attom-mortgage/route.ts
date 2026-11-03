import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { attomConfigured, fetchMortgageRecord, AttomError, type AttomMortgageResult } from "@/lib/attom";
import type { Deal } from "@/lib/validations";

/**
 * ATTOM deed / mortgage lookup for a deal (GET /property/detailmortgage). Returns the
 * recorded loan(s) on the property plus an ESTIMATED current outstanding balance
 * (amortized from the original loan — ATTOM does not publish a live payoff). Cached in
 * Redis; refresh=1 forces a fresh call (non-viewer only). This is the SELLER's existing
 * debt (owner position), not the buyer's acquisition financing.
 */
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

type CachedMortgage = AttomMortgageResult;
const cacheKey = (id: string) => `attom:mortgage:${id}`;

export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await ctx.params;
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    if (!refresh) {
      const cached = await redis.get<CachedMortgage>(cacheKey(id));
      if (cached) return NextResponse.json({ configured: true, cached: true, ...cached });
    }

    if (!attomConfigured()) {
      return NextResponse.json({ configured: false, message: "Set ATTOM_API_KEY to enable deed / mortgage lookups." });
    }
    if (session.user.role === "viewer") {
      return NextResponse.json({ error: "Read-only access (a fresh ATTOM fetch costs an API credit)" }, { status: 403 });
    }

    const d = deal as unknown as { address?: string; city?: string; state?: string; zip?: string };
    const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
    if (!addr) return NextResponse.json({ error: "Deal has no address to look up" }, { status: 400 });

    const result = await fetchMortgageRecord(addr);
    if (!result) {
      return NextResponse.json({ configured: true, cached: false, address: addr, loans: [], fetchedAt: new Date().toISOString(), not_found: true });
    }

    try { await redis.set(cacheKey(id), JSON.stringify(result)); } catch { /* non-fatal */ }
    return NextResponse.json({ configured: true, cached: false, ...result });
  } catch (err) {
    if (err instanceof AttomError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 401 ? 400 : 502 });
    }
    console.error("GET /api/deals/[id]/attom-mortgage error:", err);
    return NextResponse.json({ error: "Failed to fetch mortgage record" }, { status: 500 });
  }
}
