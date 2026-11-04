import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { createDealRecord } from "@/lib/deal-service";
import type { Deal } from "@/lib/validations";

// GET /api/deals — list all active deals (with optional pagination)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const redis = getRedis();
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 100, 500);
    const offset = Number(req.nextUrl.searchParams.get("offset")) || 0;
    const ids = await redis.zrange("deals:active", offset, offset + limit - 1, { rev: true });
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
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const bodyOrError = await safeJson(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const body = bodyOrError;

    if (!body.address || !body.city || !body.state || !body.units || !body.asking_price || !body.source) {
      return NextResponse.json(
        { error: "address, city, state, units, asking_price, and source are required" },
        { status: 400 }
      );
    }

    const deal = await createDealRecord(body, session.user.id, "web");

    return NextResponse.json(deal, { status: 201 });
  } catch (err) {
    console.error("POST /api/deals error:", err);
    return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
  }
}
