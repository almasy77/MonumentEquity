import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { Deal } from "@/lib/validations";

// GET /api/deals — list all active deals
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const redis = getRedis();
    const ids = await redis.zrange("deals:active", 0, -1, { rev: true });
    if (ids.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`deal:${id}`);
    }
    const results = await pipeline.exec<(Deal | null)[]>();
    const deals = results.filter((r): r is Deal => r !== null);

    return NextResponse.json(deals);
  } catch (err) {
    console.error("GET /api/deals error:", err);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
}

// POST /api/deals — create a new deal
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.address || !body.city || !body.state || !body.units || !body.asking_price || !body.source) {
      return NextResponse.json(
        { error: "address, city, state, units, asking_price, and source are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const deal: Deal = {
      id,
      user_id: session.user.id,
      stage: body.stage || "lead",
      status: "active",
      address: body.address,
      city: body.city,
      state: body.state,
      zip: body.zip || undefined,
      county: body.county || undefined,
      units: body.units,
      year_built: body.year_built || undefined,
      property_type: body.property_type || undefined,
      square_footage: body.square_footage || undefined,
      asking_price: body.asking_price,
      bid_price: body.bid_price || undefined,
      source: body.source,
      source_url: body.source_url || undefined,
      market_notes: body.market_notes || undefined,
      contact_ids: body.contact_ids || [],
      created_by: session.user.id,
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };

    const redis = getRedis();
    await redis.set(`deal:${id}`, JSON.stringify(deal));
    await addToIndex("deals:active", id, Date.now());
    await addToIndex(`deals:by_stage:${deal.stage}`, id, Date.now());

    await logActivity({
      deal_id: id,
      action: "deal_created",
      entity_type: "deal",
      entity_id: id,
      details: { address: deal.address, units: deal.units, asking_price: deal.asking_price },
      user_id: session.user.id,
    });

    return NextResponse.json(deal, { status: 201 });
  } catch (err) {
    console.error("POST /api/deals error:", err);
    return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
  }
}
