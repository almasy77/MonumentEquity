import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { revokeApiToken, type TokenStore } from "@/lib/api-tokens";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/tokens/[id] — revoke (the record is kept, marked revoked_at)
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { id } = await context.params;
  const rec = await revokeApiToken(getRedis() as unknown as TokenStore, id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rec);
}
