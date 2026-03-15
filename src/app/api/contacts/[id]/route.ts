import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, removeFromIndex, addToIndex } from "@/lib/db";
import type { Contact } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/contacts/[id]
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const redis = getRedis();
  const contact = await redis.get<Contact>(`contact:${id}`);
  if (!contact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(contact);
}

// PUT /api/contacts/[id]
export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const redis = getRedis();
  const existing = await redis.get<Contact>(`contact:${id}`);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const now = new Date().toISOString();

  // Handle type change (update index)
  if (body.type && body.type !== existing.type) {
    await removeFromIndex(`contacts:by_type:${existing.type}`, id);
    await addToIndex(`contacts:by_type:${body.type}`, id, Date.now());
  }

  const updated: Contact = {
    ...existing,
    ...body,
    id,
    created_at: existing.created_at,
    updated_at: now,
  };

  await redis.set(`contact:${id}`, JSON.stringify(updated));
  return NextResponse.json(updated);
}

// DELETE /api/contacts/[id]
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const redis = getRedis();
  const contact = await redis.get<Contact>(`contact:${id}`);
  if (!contact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await redis.del(`contact:${id}`);
  await removeFromIndex("contacts:all", id);
  await removeFromIndex(`contacts:by_type:${contact.type}`, id);

  return NextResponse.json({ success: true });
}
