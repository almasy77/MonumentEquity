import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex, removeFromIndex, getFromIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { extractImageFromUrl } from "@/lib/ai-extract";
import type { Deal } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/deals/[id]
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(deal);
  } catch (err) {
    console.error("GET /api/deals/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch deal" }, { status: 500 });
  }
}

// PUT /api/deals/[id]
export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const redis = getRedis();
    const existing = await redis.get<Deal>(`deal:${id}`);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const bodyOrError = await safeJson(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const body = bodyOrError;
    const now = new Date().toISOString();
    const oldStage = existing.stage;
    const newStage = body.stage as DealStage | undefined;

    // Viewers cannot edit deals
    if (session.user.role === "viewer") {
      return NextResponse.json({ error: "Read-only access" }, { status: 403 });
    }

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

    // Auto-extract photo when source_url is set/changed and no photos exist
    const newSourceUrl = body.source_url as string | undefined;
    const sourceUrlChanged = newSourceUrl && newSourceUrl !== existing.source_url;
    const noPhotos = !body.photos && (!existing.photos || existing.photos.length === 0);
    if (sourceUrlChanged && noPhotos) {
      try {
        const imageUrl = await extractImageFromUrl(newSourceUrl);
        if (imageUrl) body.photos = [imageUrl];
      } catch {
        // Non-critical — continue without photo
      }
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
  } catch (err) {
    console.error("PUT /api/deals/[id] error:", err);
    return NextResponse.json({ error: "Failed to update deal" }, { status: 500 });
  }
}

// DELETE /api/deals/[id]
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await redis.del(`deal:${id}`);
    await removeFromIndex("deals:active", id);
    await removeFromIndex(`deals:by_stage:${deal.stage}`, id);

    // Cascade delete: scenarios, tasks, checklists for this deal
    const scenarioIds = await getFromIndex(`scenarios:by_deal:${id}`);
    for (const sid of scenarioIds) {
      await redis.del(`scenario:${sid}`);
    }
    if (scenarioIds.length > 0) await redis.del(`scenarios:by_deal:${id}`);

    const taskIds = await getFromIndex(`tasks:by_deal:${id}`);
    for (const tid of taskIds) {
      await redis.del(`task:${tid}`);
      await removeFromIndex("tasks:all", tid);
    }
    if (taskIds.length > 0) await redis.del(`tasks:by_deal:${id}`);

    const checklistIds = await getFromIndex(`checklists:by_deal:${id}`);
    for (const cid of checklistIds) {
      await redis.del(`checklist:${cid}`);
    }
    if (checklistIds.length > 0) await redis.del(`checklists:by_deal:${id}`);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/deals/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete deal" }, { status: 500 });
  }
}
