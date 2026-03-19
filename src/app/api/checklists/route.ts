import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { createChecklistFromTemplate, type ChecklistInstance } from "@/lib/checklist-templates";

// GET /api/checklists?deal_id=xxx — list checklists for a deal
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dealId = req.nextUrl.searchParams.get("deal_id");
  if (!dealId) {
    return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
  }

  const redis = getRedis();
  const ids = await redis.zrange(`checklists:by_deal:${dealId}`, 0, -1);
  if (ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`checklist:${id}`);
  }
  const results = await pipeline.exec<(ChecklistInstance | null)[]>();
  return NextResponse.json(results.filter((r): r is ChecklistInstance => r !== null));
}

// POST /api/checklists — create a checklist from template
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  const body = await req.json();

  if (!body.deal_id || !body.type) {
    return NextResponse.json(
      { error: "deal_id and type (screening|diligence|closing|onboarding) are required" },
      { status: 400 }
    );
  }

  if (!["screening", "diligence", "closing", "onboarding"].includes(body.type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const checklist: ChecklistInstance = {
    id,
    deal_id: body.deal_id,
    type: body.type,
    items: createChecklistFromTemplate(body.type),
    created_at: now,
    updated_at: now,
  };

  const redis = getRedis();
  await redis.set(`checklist:${id}`, JSON.stringify(checklist));
  await addToIndex(`checklists:by_deal:${body.deal_id}`, id, Date.now());

  return NextResponse.json(checklist, { status: 201 });
}
