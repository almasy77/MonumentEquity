import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, scanKeys } from "@/lib/db";
import type { Deal } from "@/lib/validations";

// GET /api/deals/inactive — list dead/passed (archived) deals.
//
// Dead/passed deals are removed from every index (deals:active, deals:by_stage:*)
// when they're killed, so they can't be enumerated by an index read. We SCAN the
// deal:* keyspace and filter by status — this reaches every archived deal,
// including ones killed before any inactive index existed.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const redis = getRedis();
    const keys = await scanKeys("deal:*");
    if (keys.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = await pipeline.exec<(Deal | null)[]>();

    const deals = results
      .filter((d): d is Deal => d !== null && (d.status === "dead" || d.status === "passed"))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

    return NextResponse.json(deals);
  } catch (err) {
    console.error("GET /api/deals/inactive error:", err);
    return NextResponse.json({ error: "Failed to fetch archived deals" }, { status: 500 });
  }
}
