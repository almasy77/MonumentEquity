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

  try {
    const { id } = await context.params;
    const redis = getRedis();
    const contact = await redis.get<Contact>(`contact:${id}`);
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(contact);
  } catch (err) {
    console.error("GET /api/contacts/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch contact" }, { status: 500 });
  }
}

// PUT /api/contacts/[id]
export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
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

    // Build display name from structured fields
    const firstName = body.first_name ?? existing.first_name;
    const lastName = body.last_name ?? existing.last_name;
    const displayName = `${firstName || ""} ${lastName || ""}`.trim();

    const updated: Contact = {
      ...existing,
      ...body,
      id,
      name: displayName,
      phone: body.phones?.[0]?.number || body.phone || existing.phone,
      created_at: existing.created_at,
      updated_at: now,
    };

    await redis.set(`contact:${id}`, JSON.stringify(updated));
    return NextResponse.json(updated);
  } catch (err) {
    console.error("PUT /api/contacts/[id] error:", err);
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 });
  }
}

// DELETE /api/contacts/[id]
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
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
  } catch (err) {
    console.error("DELETE /api/contacts/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete contact" }, { status: 500 });
  }
}
