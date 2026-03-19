import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import type { MarketComp } from "@/lib/validations";

// GET /api/comps — list market comps, optional filters: city, min_units, max_units
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const city = req.nextUrl.searchParams.get("city");
    const redis = getRedis();

    let ids: string[];
    if (city) {
      ids = await redis.zrange(`comps:by_market:${city.toLowerCase()}`, 0, -1, { rev: true });
    } else {
      ids = await redis.zrange("comps:all", 0, -1, { rev: true });
    }

    if (ids.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`comp:${id}`);
    }
    const results = await pipeline.exec<(MarketComp | null)[]>();
    let comps = results.filter((r): r is MarketComp => r !== null);

    // Client-side filtering for units range
    const minUnits = req.nextUrl.searchParams.get("min_units");
    const maxUnits = req.nextUrl.searchParams.get("max_units");
    if (minUnits) {
      const min = parseInt(minUnits);
      if (!isNaN(min)) comps = comps.filter((c) => c.units >= min);
    }
    if (maxUnits) {
      const max = parseInt(maxUnits);
      if (!isNaN(max)) comps = comps.filter((c) => c.units <= max);
    }

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
    const body = await req.json();

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
    await addToIndex(`comps:by_market:${body.city.toLowerCase()}`, id, saleTimestamp);

    return NextResponse.json(comp, { status: 201 });
  } catch (err) {
    console.error("POST /api/comps error:", err);
    return NextResponse.json({ error: "Failed to create comp" }, { status: 500 });
  }
}
