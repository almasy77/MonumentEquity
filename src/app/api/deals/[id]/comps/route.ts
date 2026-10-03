import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import type { Deal, MarketComp } from "@/lib/validations";

/**
 * Manually linked (pinned) market comps for a deal. Stored as a Redis SET of comp ids
 * under `deal:${id}:comps`. Pinned comps show on the deal's Comps card regardless of the
 * city/ZIP/state widening, so a comp the user judges comparable (even one town or state
 * over) is always included and clearly marked.
 */
type RouteContext = { params: Promise<{ id: string }> };

const setKey = (dealId: string) => `deal:${dealId}:comps`;

// GET — the deal's pinned market comps (resolved objects; stale ids are pruned).
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await ctx.params;
    const redis = getRedis();
    const ids = await redis.smembers(setKey(id));
    if (ids.length === 0) return NextResponse.json([]);

    const pipe = redis.pipeline();
    for (const cid of ids) pipe.get(`comp:${cid}`);
    const results = await pipe.exec<(MarketComp | null)[]>();

    const comps: MarketComp[] = [];
    const stale: string[] = [];
    results.forEach((c, i) => {
      if (c) comps.push(c);
      else stale.push(ids[i]);
    });
    // Prune ids whose comp was deleted so the set doesn't accumulate dangling links.
    if (stale.length > 0) {
      try { await redis.srem(setKey(id), ...stale); } catch { /* non-fatal */ }
    }
    return NextResponse.json(comps);
  } catch (err) {
    console.error("GET /api/deals/[id]/comps error:", err);
    return NextResponse.json({ error: "Failed to fetch pinned comps" }, { status: 500 });
  }
}

// POST { comp_id } — pin a market comp to this deal.
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
    const bodyOrError = await safeJson<{ comp_id?: string }>(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const compId = bodyOrError.comp_id;
    if (!compId) {
      return NextResponse.json({ error: "comp_id is required" }, { status: 400 });
    }

    const redis = getRedis();
    const [deal, comp] = await Promise.all([
      redis.get<Deal>(`deal:${id}`),
      redis.get<MarketComp>(`comp:${compId}`),
    ]);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    if (!comp) return NextResponse.json({ error: "Comp not found" }, { status: 404 });

    await redis.sadd(setKey(id), compId);
    return NextResponse.json({ pinned: true, comp_id: compId }, { status: 201 });
  } catch (err) {
    console.error("POST /api/deals/[id]/comps error:", err);
    return NextResponse.json({ error: "Failed to pin comp" }, { status: 500 });
  }
}

// DELETE ?comp_id=... — unpin a market comp from this deal.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }
  try {
    const { id } = await ctx.params;
    const compId = req.nextUrl.searchParams.get("comp_id");
    if (!compId) {
      return NextResponse.json({ error: "comp_id is required" }, { status: 400 });
    }
    await getRedis().srem(setKey(id), compId);
    return NextResponse.json({ pinned: false, comp_id: compId });
  } catch (err) {
    console.error("DELETE /api/deals/[id]/comps error:", err);
    return NextResponse.json({ error: "Failed to unpin comp" }, { status: 500 });
  }
}
