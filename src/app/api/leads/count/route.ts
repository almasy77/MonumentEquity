import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";

// GET /api/leads/count — number of pending listings awaiting review.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const count = await getRedis().zcard("pending_listings:queue");
    return NextResponse.json({ count });
  } catch (err) {
    console.error("GET /api/leads/count error:", err);
    return NextResponse.json({ count: 0 });
  }
}
