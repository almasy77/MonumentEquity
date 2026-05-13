import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex } from "@/lib/db";
import type { PendingListing } from "@/lib/validations";

// POST /api/leads/[id]/reject — mark a pending listing as rejected and remove from queue.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  const { id } = await params;
  const redis = getRedis();

  const pending = await redis.get<PendingListing>(`pending_listing:${id}`);
  if (!pending) {
    return NextResponse.json({ error: "Pending listing not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json({ error: `Listing already ${pending.status}` }, { status: 409 });
  }

  const updated: PendingListing = {
    ...pending,
    status: "rejected",
    updated_at: new Date().toISOString(),
  };
  await redis.set(`pending_listing:${id}`, JSON.stringify(updated));
  await removeFromIndex("pending_listings:queue", id);

  return NextResponse.json({ status: "rejected" });
}
