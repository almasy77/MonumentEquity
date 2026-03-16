import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEntity, setEntity } from "@/lib/db";
import type { User } from "@/lib/validations";

// GET /api/profile — return current user profile
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getEntity<User>(`user:${session.user.id}`);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    notification_prefs: user.notification_prefs ?? {},
    default_assumptions: user.default_assumptions ?? {},
    created_at: user.created_at,
    updated_at: user.updated_at,
  });
}

// PUT /api/profile — update user fields (notification_prefs, name, etc.)
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const user = await getEntity<User>(`user:${session.user.id}`);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Merge notification preferences
  if (body.notification_prefs && typeof body.notification_prefs === "object") {
    user.notification_prefs = {
      ...user.notification_prefs,
      ...body.notification_prefs,
    };
  }

  // Merge name if provided
  if (body.name && typeof body.name === "string" && body.name.trim().length > 0) {
    user.name = body.name.trim();
  }

  // Merge default assumptions if provided
  if (body.default_assumptions && typeof body.default_assumptions === "object") {
    user.default_assumptions = {
      ...user.default_assumptions,
      ...body.default_assumptions,
    };
  }

  user.updated_at = now;
  await setEntity(`user:${session.user.id}`, user);

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    notification_prefs: user.notification_prefs ?? {},
    default_assumptions: user.default_assumptions ?? {},
    updated_at: user.updated_at,
  });
}
