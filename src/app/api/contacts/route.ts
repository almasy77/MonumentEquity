import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import type { Contact } from "@/lib/validations";

// GET /api/contacts
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  return NextResponse.json(results.filter((r): r is Contact => r !== null));
}

// POST /api/contacts
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const contact: Contact = {
    id,
    name: body.name,
    company: body.company || undefined,
    type: body.type,
    email: body.email || undefined,
    phone: body.phone || undefined,
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
}
