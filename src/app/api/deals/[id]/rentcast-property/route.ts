import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { fetchPropertyRecord, mapPropertyToDealFields, rentcastConfigured, RentCastError, type RentCastDealFields } from "@/lib/rentcast";
import type { Deal } from "@/lib/validations";

/**
 * RentCast property-records lookup for a deal (GET /properties). Returns candidate deal
 * fields (units, sqft, year built, lot size, property type, latest tax assessment, last
 * sale) to pre-fill the Property Details card. Cached in Redis; refresh=1 forces a fresh
 * call (non-viewer only). The client applies fields individually via the deal PUT.
 */
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

interface CachedProperty { fields: RentCastDealFields; address: string; fetched_at: string }
const cacheKey = (id: string) => `rentcast:property:${id}`;

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
      const cached = await redis.get<CachedProperty>(cacheKey(id));
      if (cached) return NextResponse.json({ configured: true, cached: true, ...cached });
    }

    if (!rentcastConfigured()) {
      return NextResponse.json({ configured: false, message: "Set RENTCAST_API_KEY to enable property-record lookups." });
    }
    if (session.user.role === "viewer") {
      return NextResponse.json({ error: "Read-only access (a fresh RentCast fetch costs an API credit)" }, { status: 403 });
    }

    const d = deal as unknown as { address?: string; city?: string; state?: string; zip?: string };
    const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
    if (!addr) return NextResponse.json({ error: "Deal has no address to look up" }, { status: 400 });

    const rec = await fetchPropertyRecord(addr);
    if (!rec) return NextResponse.json({ configured: true, cached: false, fields: {}, address: addr, fetched_at: new Date().toISOString(), not_found: true });

    const payload: CachedProperty = { fields: mapPropertyToDealFields(rec), address: addr, fetched_at: new Date().toISOString() };
    try { await redis.set(cacheKey(id), JSON.stringify(payload)); } catch { /* non-fatal */ }
    return NextResponse.json({ configured: true, cached: false, ...payload });
  } catch (err) {
    if (err instanceof RentCastError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 401 ? 400 : 502 });
    }
    console.error("GET /api/deals/[id]/rentcast-property error:", err);
    return NextResponse.json({ error: "Failed to fetch property record" }, { status: 500 });
  }
}
