import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import type { RentComp } from "@/lib/validations";

// GET /api/rent-comps — list rent comps, optional filter: submarket, city
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const submarket = req.nextUrl.searchParams.get("submarket");
    const redis = getRedis();

    let ids: string[];
    if (submarket) {
      ids = await redis.zrange(`rent_comps:by_submarket:${submarket.toLowerCase()}`, 0, -1, { rev: true });
    } else {
      ids = await redis.zrange("rent_comps:all", 0, -1, { rev: true });
    }

    if (ids.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`rent_comp:${id}`);
    }
    const results = await pipeline.exec<(RentComp | null)[]>();
    return NextResponse.json(results.filter((r): r is RentComp => r !== null));
  } catch (err) {
    console.error("GET /api/rent-comps error:", err);
    return NextResponse.json({ error: "Failed to fetch rent comps" }, { status: 500 });
  }
}

// POST /api/rent-comps — create a rent comp
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.address || !body.city || !body.rent || !body.date_observed) {
      return NextResponse.json(
        { error: "address, city, rent, and date_observed are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const rentPerSqft = body.square_footage > 0 ? body.rent / body.square_footage : undefined;

    const comp: RentComp = {
      id,
      property_name: body.property_name || undefined,
      address: body.address,
      city: body.city,
      submarket: body.submarket || undefined,
      unit_type: body.unit_type || undefined,
      bedrooms: body.bedrooms || undefined,
      bathrooms: body.bathrooms || undefined,
      square_footage: body.square_footage || undefined,
      rent: body.rent,
      rent_per_sqft: rentPerSqft,
      amenities: body.amenities || undefined,
      date_observed: body.date_observed,
      source: body.source || undefined,
      notes: body.notes || undefined,
      created_at: now,
    };

    const redis = getRedis();
    const observedTimestamp = new Date(body.date_observed).getTime() || Date.now();

    await redis.set(`rent_comp:${id}`, JSON.stringify(comp));
    await addToIndex("rent_comps:all", id, observedTimestamp);
    if (body.submarket) {
      await addToIndex(`rent_comps:by_submarket:${body.submarket.toLowerCase()}`, id, observedTimestamp);
    }

    return NextResponse.json(comp, { status: 201 });
  } catch (err) {
    console.error("POST /api/rent-comps error:", err);
    return NextResponse.json({ error: "Failed to create rent comp" }, { status: 500 });
  }
}
