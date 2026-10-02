import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { safeJson, isErrorResponse, compMarketKey, compMatchReason, compMatchRank } from "@/lib/api-helpers";
import type { MarketComp } from "@/lib/validations";

// GET /api/comps — list market comps.
//   Filters: city, min_units, max_units.
//   Widening (P3-11): widen=1 with a city (and optional state/zip) returns comps beyond
//   the exact city — exact city, then a shared 3-digit ZIP prefix, then the same state —
//   each tagged with `match_reason` so a far comp can be weighted accordingly.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = req.nextUrl.searchParams;
    const city = params.get("city");
    const widen = params.get("widen") === "1" || params.get("widen") === "true";
    const state = params.get("state") || undefined;
    const zip = params.get("zip") || undefined;
    const redis = getRedis();

    // Unit-range filter, applied in both paths.
    const minUnitsRaw = params.get("min_units");
    const maxUnitsRaw = params.get("max_units");
    const min = minUnitsRaw ? parseInt(minUnitsRaw, 10) : NaN;
    const max = maxUnitsRaw ? parseInt(maxUnitsRaw, 10) : NaN;
    const inUnitRange = (c: MarketComp) =>
      (isNaN(min) || c.units >= min) && (isNaN(max) || c.units <= max);

    // ── Widened search: scan all comps, classify against the subject location ──
    if (city && widen) {
      const allIds = await redis.zrange<string[]>("comps:all", 0, -1, { rev: true });
      if (allIds.length === 0) return NextResponse.json([]);
      const pipeline = redis.pipeline();
      for (const id of allIds) pipeline.get(`comp:${id}`);
      const results = await pipeline.exec<(MarketComp | null)[]>();
      const subject = { city, state, zip };
      const matched = results
        .filter((c): c is MarketComp => c !== null && inUnitRange(c))
        .map((c) => ({ c, reason: compMatchReason(c, subject) }))
        .filter((x): x is { c: MarketComp; reason: NonNullable<typeof x.reason> } => x.reason !== null)
        // Closest tier first (city, then zip3, then state); within a tier, newest sale first.
        .sort((a, b) =>
          compMatchRank(a.reason) - compMatchRank(b.reason) ||
          new Date(b.c.sale_date).getTime() - new Date(a.c.sale_date).getTime(),
        )
        .map((x) => ({ ...x.c, match_reason: x.reason }));
      return NextResponse.json(matched);
    }

    // ── Exact-city (or all) search — prior behavior, flat array, no match_reason ──
    const ids = city
      ? await redis.zrange<string[]>(compMarketKey(city), 0, -1, { rev: true })
      : await redis.zrange<string[]>("comps:all", 0, -1, { rev: true });
    if (ids.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.get(`comp:${id}`);
    const results = await pipeline.exec<(MarketComp | null)[]>();
    const comps = results.filter((r): r is MarketComp => r !== null).filter(inUnitRange);

    return NextResponse.json(comps);
  } catch (err) {
    console.error("GET /api/comps error:", err);
    return NextResponse.json({ error: "Failed to fetch comps" }, { status: 500 });
  }
}

// POST /api/comps — create a market comp
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const bodyOrError = await safeJson(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const body = bodyOrError;

    if (!body.address || !body.city || !body.state || !body.units || !body.sale_price || !body.sale_date) {
      return NextResponse.json(
        { error: "address, city, state, units, sale_price, and sale_date are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const pricePerUnit = body.units > 0 ? body.sale_price / body.units : 0;

    const comp: MarketComp = {
      id,
      address: body.address,
      city: body.city,
      state: body.state,
      zip: body.zip || undefined,
      units: body.units,
      sale_price: body.sale_price,
      sale_date: body.sale_date,
      price_per_unit: pricePerUnit,
      cap_rate: body.cap_rate || undefined,
      year_built: body.year_built || undefined,
      property_type: body.property_type || undefined,
      source: body.source || undefined,
      notes: body.notes || undefined,
      created_at: now,
    };

    const redis = getRedis();
    const saleTimestamp = new Date(body.sale_date).getTime() || Date.now();

    await redis.set(`comp:${id}`, JSON.stringify(comp));
    await addToIndex("comps:all", id, saleTimestamp);
    await addToIndex(compMarketKey(body.city), id, saleTimestamp);

    return NextResponse.json(comp, { status: 201 });
  } catch (err) {
    console.error("POST /api/comps error:", err);
    return NextResponse.json({ error: "Failed to create comp" }, { status: 500 });
  }
}
