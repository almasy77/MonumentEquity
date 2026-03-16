import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getActivitiesForDeal } from "@/lib/activity";

// GET /api/activities?deal_id=xxx
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dealId = req.nextUrl.searchParams.get("deal_id");
  if (!dealId) {
    return NextResponse.json({ error: "deal_id required" }, { status: 400 });
  }

  const activities = await getActivitiesForDeal(dealId);
  return NextResponse.json(activities);
}
