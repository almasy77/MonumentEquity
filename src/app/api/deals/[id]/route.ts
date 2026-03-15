import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex, removeFromIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import type { Deal } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/deals/[id]
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const redis = getRedis();
  const deal = await redis.get<Deal>(`deal:${id}`);
  if (!deal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(deal);
}

// PUT /api/deals/[id]
export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const redis = getRedis();
  const existing = await redis.get<Deal>(`deal:${id}`);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const now = new Date().toISOString();
  const oldStage = existing.stage;
  const newStage = body.stage as DealStage | undefined;

  // VA cannot change stages or status
  if (session.user.role === "va") {
    if (newStage && newStage !== oldStage) {
      return NextResponse.json({ error: "VAs cannot change deal stages" }, { status: 403 });
    }
    if (body.status && body.status !== existing.status) {
      return NextResponse.json({ error: "VAs cannot change deal status" }, { status: 403 });
    }
  }

  // Handle stage change
  if (newStage && newStage !== oldStage && DEAL_STAGES.includes(newStage)) {
    await removeFromIndex(`deals:by_stage:${oldStage}`, id);
    await addToIndex(`deals:by_stage:${newStage}`, id, Date.now());

    await logActivity({
      deal_id: id,
      action: "stage_changed",
      entity_type: "deal",
      entity_id: id,
      details: {
        old_stage: oldStage,
        new_stage: newStage,
        old_stage_label: STAGE_LABELS[oldStage],
        new_stage_label: STAGE_LABELS[newStage],
      },
      user_id: session.user.id,
    });
  }

  // Handle status change (dead/passed)
  if (body.status && body.status !== existing.status) {
    if (body.status === "dead" || body.status === "passed") {
      await removeFromIndex("deals:active", id);
      await removeFromIndex(`deals:by_stage:${existing.stage}`, id);
    } else if (existing.status !== "active" && body.status === "active") {
      await addToIndex("deals:active", id, Date.now());
      const stage = body.stage || existing.stage;
      await addToIndex(`deals:by_stage:${stage}`, id, Date.now());
    }

    await logActivity({
      deal_id: id,
      action: "status_changed",
      entity_type: "deal",
      entity_id: id,
      details: {
        old_status: existing.status,
        new_status: body.status,
        reason: body.kill_reason || body.pass_reason,
      },
      user_id: session.user.id,
    });
  }

  const updated: Deal = {
    ...existing,
    ...body,
    id, // ensure id can't be overwritten
    user_id: existing.user_id,
    created_by: existing.created_by,
    created_at: existing.created_at,
    updated_at: now,
    last_activity_at: now,
  };

  await redis.set(`deal:${id}`, JSON.stringify(updated));

  return NextResponse.json(updated);
}

// DELETE /api/deals/[id]
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const redis = getRedis();
  const deal = await redis.get<Deal>(`deal:${id}`);
  if (!deal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await redis.del(`deal:${id}`);
  await removeFromIndex("deals:active", id);
  await removeFromIndex(`deals:by_stage:${deal.stage}`, id);

  return NextResponse.json({ success: true });
}
