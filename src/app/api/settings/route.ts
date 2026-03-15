import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";

// GET /api/settings — get user's default assumptions
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  const user = await redis.get<{ default_assumptions?: Record<string, number> }>(
    `user:${session.user.id}`
  );

  return NextResponse.json({
    default_assumptions: user?.default_assumptions ?? {},
  });
}

// PUT /api/settings — update user's default assumptions (admin only)
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "va") {
    return NextResponse.json({ error: "VAs cannot modify settings" }, { status: 403 });
  }

  const body = await req.json();
  const redis = getRedis();

  const user = await redis.get<Record<string, unknown>>(`user:${session.user.id}`);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updated = {
    ...user,
    default_assumptions: body.default_assumptions ?? user.default_assumptions,
    updated_at: new Date().toISOString(),
  };

  await redis.set(`user:${session.user.id}`, JSON.stringify(updated));

  return NextResponse.json({
    default_assumptions: updated.default_assumptions ?? {},
  });
}
