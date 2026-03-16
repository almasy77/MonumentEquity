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
  if (minUnits) comps = comps.filter((c) => c.units >= parseInt(minUnits));
  if (maxUnits) comps = comps.filter((c) => c.units <= parseInt(maxUnits));

  return NextResponse.json(comps);
}

// POST /api/comps — create a market comp
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
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
}
