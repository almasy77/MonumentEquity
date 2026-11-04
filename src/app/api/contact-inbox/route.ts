import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { PendingContact } from "@/lib/validations";

// GET /api/contact-inbox — pending contacts awaiting confirmation, newest first.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const redis = getRedis();
    const ids = await redis.zrange<string[]>("pending_contacts:queue", 0, 199, { rev: true });
    if (!ids || ids.length === 0) return NextResponse.json({ pending: [] });
    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.get<PendingContact>(`pending_contact:${id}`);
    const rows = (await pipeline.exec<(PendingContact | null)[]>()) ?? [];
    const pending = rows.filter((x): x is PendingContact => !!x && x.status === "pending");
    return NextResponse.json({ pending });
  } catch (err) {
    console.error("GET /api/contact-inbox error:", err);
    return NextResponse.json({ pending: [] });
  }
}
