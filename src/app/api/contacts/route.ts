import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import type { Contact } from "@/lib/validations";

// Helper: build display name from structured fields
function buildDisplayName(body: Record<string, unknown>): string {
  const first = (body.first_name as string) || "";
  const last = (body.last_name as string) || "";
  return `${first} ${last}`.trim() || "Unnamed";
}

// GET /api/contacts
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const type = req.nextUrl.searchParams.get("type");
    const redis = getRedis();

    let ids: string[];
    if (type) {
      ids = await redis.zrange(`contacts:by_type:${type}`, 0, -1, { rev: true });
    } else {
      ids = await redis.zrange("contacts:all", 0, -1, { rev: true });
    }

    if (ids.length === 0) return NextResponse.json([]);

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`contact:${id}`);
    }
    const results = await pipeline.exec<(Contact | null)[]>();

    // Migrate legacy contacts on read: if they have "name" but no "first_name"
    const contacts = results.filter((r): r is Contact => r !== null).map((c) => {
      if (!c.first_name && (c as Record<string, unknown>).name) {
        const legacyName = (c as Record<string, unknown>).name as string;
        const parts = legacyName.split(" ");
        c.first_name = parts[0] || legacyName;
        c.last_name = parts.slice(1).join(" ") || undefined;
      }
      if (!c.phones) c.phones = [];
      if (!c.tags) c.tags = [];
      // Migrate single phone to phones array
      if (c.phone && c.phones.length === 0) {
        c.phones = [{ number: c.phone, label: "mobile" }];
      }
      return c;
    });

    return NextResponse.json(contacts);
  } catch (err) {
    console.error("GET /api/contacts error:", err);
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 });
  }
}

// POST /api/contacts
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const body = await req.json();

    if (!body.type) {
      return NextResponse.json({ error: "type is required" }, { status: 400 });
    }
    if (!body.first_name && !body.name) {
      return NextResponse.json({ error: "first_name or name is required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    // Support both legacy "name" field and new first/last fields
    let firstName = body.first_name || "";
    let lastName = body.last_name || "";
    if (!firstName && body.name) {
      const parts = (body.name as string).split(" ");
      firstName = parts[0];
      lastName = parts.slice(1).join(" ");
    }

    const contact: Contact = {
      id,
      first_name: firstName,
      last_name: lastName || undefined,
      nickname: body.nickname || undefined,
      name: buildDisplayName({ first_name: firstName, last_name: lastName }),
      company: body.company || undefined,
      title: body.title || undefined,
      type: body.type,
      tags: body.tags || [],
      email: body.email || undefined,
      phone: body.phones?.[0]?.number || body.phone || undefined,
      phones: body.phones || (body.phone ? [{ number: body.phone, label: "mobile" }] : []),
      website: body.website || undefined,
      linkedin_url: body.linkedin_url || undefined,
      address_city: body.address_city || undefined,
      address_state: body.address_state || undefined,
      last_contacted_at: body.last_contacted_at || undefined,
      notes: body.notes || undefined,
      deal_ids: body.deal_ids || [],
      created_at: now,
      updated_at: now,
    };

    const redis = getRedis();
    await redis.set(`contact:${id}`, JSON.stringify(contact));
    await addToIndex("contacts:all", id, Date.now());
    await addToIndex(`contacts:by_type:${contact.type}`, id, Date.now());

    return NextResponse.json(contact, { status: 201 });
  } catch (err) {
    console.error("POST /api/contacts error:", err);
    return NextResponse.json({ error: "Failed to create contact" }, { status: 500 });
  }
}
