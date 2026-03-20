import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
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
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can modify settings" }, { status: 403 });
  }

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const body = bodyOrError;
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

  // Handle email change
  if (body.email && typeof body.email === "string") {
    const newEmail = body.email.trim().toLowerCase();
    const oldEmail = (user.email as string).toLowerCase();
    if (newEmail !== oldEmail) {
      // Validate email format
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
      }
      // Check if email is already taken
      const existingId = await redis.get<string>(`user:email:${newEmail}`);
      if (existingId && existingId !== session.user.id) {
        return NextResponse.json({ error: "Email already in use" }, { status: 400 });
      }
      // Update email index: remove old, add new
      await redis.del(`user:email:${oldEmail}`);
      await redis.set(`user:email:${newEmail}`, session.user.id);
      user.email = newEmail;
    }
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
