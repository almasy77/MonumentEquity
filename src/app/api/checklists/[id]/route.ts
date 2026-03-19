import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { ChecklistInstance } from "@/lib/checklist-templates";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/checklists/[id] — update checklist items (toggle completion, add notes)
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json();
  const redis = getRedis();

  const existing = await redis.get<ChecklistInstance>(`checklist:${id}`);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update specific items
  if (body.items && Array.isArray(body.items)) {
    existing.items = body.items;
  } else if (body.item_id) {
    // Toggle a single item
    const item = existing.items.find((i) => i.id === body.item_id);
    if (item) {
      item.completed = body.completed ?? !item.completed;
      item.completed_at = item.completed ? new Date().toISOString() : undefined;
      if (body.notes !== undefined) item.notes = body.notes;
    }
  }

  existing.updated_at = new Date().toISOString();
  await redis.set(`checklist:${id}`, JSON.stringify(existing));

  return NextResponse.json(existing);
}
