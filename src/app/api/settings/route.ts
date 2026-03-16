import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import bcrypt from "bcryptjs";

// GET /api/settings — get user's settings
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  const user = await redis.get<Record<string, unknown>>(
    `user:${session.user.id}`
  );

  return NextResponse.json({
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "",
    default_assumptions: user?.default_assumptions ?? {},
  });
}

// PUT /api/settings — update user settings (admin only)
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

  const now = new Date().toISOString();

  // Handle password change
  if (body.current_password && body.new_password) {
    const passwordHash = user.password_hash as string;
    const valid = await bcrypt.compare(body.current_password, passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    if (body.new_password.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }
    user.password_hash = await bcrypt.hash(body.new_password, 12);
  }

  // Handle profile updates
  if (body.name && typeof body.name === "string" && body.name.trim().length > 0) {
    user.name = body.name.trim();
  }

  // Handle default assumptions
  if (body.default_assumptions) {
    user.default_assumptions = body.default_assumptions;
  }

  user.updated_at = now;
  await redis.set(`user:${session.user.id}`, JSON.stringify(user));

  return NextResponse.json({
    name: user.name,
    email: user.email,
    role: user.role,
    default_assumptions: user.default_assumptions ?? {},
    ...(body.new_password ? { password_changed: true } : {}),
  });
}
