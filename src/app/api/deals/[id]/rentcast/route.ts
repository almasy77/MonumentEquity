import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { fetchRentEstimate, rentcastConfigured, toRentCastPropertyType, RentCastError, type RentCastRentEstimate } from "@/lib/rentcast";
import type { Deal } from "@/lib/validations";

/**
 * RentCast long-term rent estimate + comps for a deal.
 *
 * GET /api/deals/[id]/rentcast?bedrooms=2&refresh=1
 * Results are cached per (deal, bedrooms) in Redis so repeated views don't burn the
 * RentCast quota; pass refresh=1 to force a fresh call (costs one API credit). A fresh
 * call requires a non-viewer role; cached reads are available to any signed-in user.
 */
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

interface CachedRent {
  estimate: RentCastRentEstimate;
  bedrooms: number | null;
  address: string;
  fetched_at: string;
}

const cacheKey = (id: string, bedrooms: number | null) => `rentcast:rent:${id}:${bedrooms ?? "any"}`;

export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await ctx.params;
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const bedroomsRaw = req.nextUrl.searchParams.get("bedrooms");
    const bedrooms = bedroomsRaw != null && bedroomsRaw !== "" ? parseInt(bedroomsRaw, 10) : null;
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    const key = cacheKey(id, Number.isNaN(bedrooms as number) ? null : bedrooms);

    // Serve cache unless an explicit refresh is requested.
    if (!refresh) {
      const cached = await redis.get<CachedRent>(key);
      if (cached) return NextResponse.json({ configured: true, cached: true, ...cached });
    }

    if (!rentcastConfigured()) {
      return NextResponse.json({ configured: false, message: "Set RENTCAST_API_KEY to enable rent estimates." });
    }
    if (session.user.role === "viewer") {
      return NextResponse.json({ error: "Read-only access (a fresh RentCast fetch costs an API credit)" }, { status: 403 });
    }

    const d = deal as unknown as { address?: string; city?: string; state?: string; zip?: string; property_type?: string; square_footage?: number };
    const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
    if (!addr) return NextResponse.json({ error: "Deal has no address to look up" }, { status: 400 });

    const estimate = await fetchRentEstimate({
      address: addr,
      propertyType: toRentCastPropertyType(d.property_type) ?? "Apartment",
      bedrooms: bedrooms != null && !Number.isNaN(bedrooms) ? bedrooms : undefined,
      squareFootage: d.square_footage,
      compCount: 15,
    });

    const payload: CachedRent = {
      estimate,
      bedrooms: bedrooms != null && !Number.isNaN(bedrooms) ? bedrooms : null,
      address: addr,
      fetched_at: new Date().toISOString(),
    };
    try { await redis.set(key, JSON.stringify(payload)); } catch { /* non-fatal cache write */ }

    return NextResponse.json({ configured: true, cached: false, ...payload });
  } catch (err) {
    if (err instanceof RentCastError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 401 ? 400 : 502 });
    }
    console.error("GET /api/deals/[id]/rentcast error:", err);
    return NextResponse.json({ error: "Failed to fetch rent estimate" }, { status: 500 });
  }
}
