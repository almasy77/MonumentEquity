import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, generateId } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import bcrypt from "bcryptjs";

// GET /api/team — list all team members (admin only)
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const redis = getRedis();
  const memberIds = await redis.smembers("team:members");
  if (!memberIds || memberIds.length === 0) {
    return NextResponse.json([]);
  }

  const members = [];
  for (const id of memberIds) {
    if (id === session.user.id) continue; // exclude self
    const user = await redis.get<Record<string, unknown>>(`user:${id}`);
    if (user) {
      members.push({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      });
    }
  }

  return NextResponse.json(members);
}

// POST /api/team — invite a read-only viewer (admin only)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const body = bodyOrError;
  const { email, name } = body as { email?: string; name?: string };

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const redis = getRedis();

  // Check if email already exists
  const existingId = await redis.get<string>(`user:email:${cleanEmail}`);
  if (existingId) {
    return NextResponse.json({ error: "A user with this email already exists" }, { status: 400 });
  }

  const id = generateId();
  const now = new Date().toISOString();
  // Generate a temporary password — viewer will need to reset
  const tempPassword = crypto.randomUUID().slice(0, 12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const user = {
    id,
    email: cleanEmail,
    name: name.trim(),
    password_hash: passwordHash,
    role: "viewer",
    created_at: now,
    updated_at: now,
  };

  await redis.set(`user:${id}`, JSON.stringify(user));
  await redis.set(`user:email:${cleanEmail}`, id);
  await redis.sadd("team:members", id);
  // Also add admin to the set if not there
  await redis.sadd("team:members", session.user.id);

  return NextResponse.json({
    id,
    email: cleanEmail,
    name: name.trim(),
    role: "viewer",
    temp_password: tempPassword,
    created_at: now,
  });
}

// DELETE /api/team — remove a team member (admin only)
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const memberId = searchParams.get("id");
  if (!memberId) {
    return NextResponse.json({ error: "Member ID required" }, { status: 400 });
  }

  // Don't allow deleting yourself
  if (memberId === session.user.id) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  const redis = getRedis();
  const user = await redis.get<Record<string, unknown>>(`user:${memberId}`);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userEmail = (user.email as string).toLowerCase();
  await redis.del(`user:${memberId}`);
  await redis.del(`user:email:${userEmail}`);
  await redis.srem("team:members", memberId);

  // Invalidate any pending password reset tokens for this user
  // Scan for reset tokens (they have a TTL so they'll expire naturally,
  // but we remove known ones for safety)
  const resetTokenKey = `user:reset_pending:${memberId}`;
  const pendingToken = await redis.get<string>(resetTokenKey);
  if (pendingToken) {
    await redis.del(`reset:${pendingToken}`);
    await redis.del(resetTokenKey);
  }

  return NextResponse.json({ success: true });
}
