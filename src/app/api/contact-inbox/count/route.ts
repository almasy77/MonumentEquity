import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";

// GET /api/contact-inbox/count — number of pending contacts awaiting confirmation.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const count = await getRedis().zcard("pending_contacts:queue");
    return NextResponse.json({ count });
  } catch (err) {
    console.error("GET /api/contact-inbox/count error:", err);
    return NextResponse.json({ count: 0 });
  }
}
