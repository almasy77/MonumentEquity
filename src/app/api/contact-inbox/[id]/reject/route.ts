import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex } from "@/lib/db";
import { clearPendingContactEmail } from "@/lib/crm-email";
import type { PendingContact } from "@/lib/validations";

// POST /api/contact-inbox/[id]/reject — dismiss a pending contact (no contact created).
// The email log is left intact for audit.
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

  const pending = await redis.get<PendingContact>(`pending_contact:${id}`);
  if (!pending) {
    return NextResponse.json({ error: "Pending contact not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json({ error: `Already ${pending.status}` }, { status: 409 });
  }

  const updated: PendingContact = { ...pending, status: "rejected", updated_at: new Date().toISOString() };
  await redis.set(`pending_contact:${id}`, JSON.stringify(updated));
  await removeFromIndex("pending_contacts:queue", id);
  await clearPendingContactEmail(pending.email);

  return NextResponse.json({ status: "rejected" });
}
