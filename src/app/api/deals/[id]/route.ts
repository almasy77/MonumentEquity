import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex, removeFromIndex, getFromIndex, scanKeys } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "@/lib/constants";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { extractImageFromUrl } from "@/lib/ai-extract";
import { deleteBlobUrl } from "@/lib/blob-helpers";
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

    // Mass-assignment hardening. The update below spreads `body` onto the deal, so
    // guard the untrusted input: (1) drop server-controlled/immutable keys so they
    // can't be overwritten, and (2) type-check the fields the underwriting engine
    // and exports consume, rejecting malformed types (e.g. asking_price: "abc")
    // before they reach a calculation. (Deliberately a targeted guard, not a full
    // schema strip — that would risk dropping legitimate editor fields.)
    for (const k of ["id", "user_id", "created_by", "created_at", "updated_at", "last_activity_at"]) {
      delete (body as Record<string, unknown>)[k];
    }
    const isNum = (v: unknown) => typeof v === "number" && isFinite(v);
    if (body.asking_price !== undefined && !(isNum(body.asking_price) && body.asking_price > 0)) {
      return NextResponse.json({ error: "asking_price must be a positive number" }, { status: 400 });
    }
    if (body.units !== undefined && !(isNum(body.units) && body.units > 0)) {
      return NextResponse.json({ error: "units must be a positive number" }, { status: 400 });
    }
    for (const k of ["bid_price", "current_noi", "square_footage", "year_built"] as const) {
      if (body[k] !== undefined && body[k] !== null && !isNum(body[k])) {
        return NextResponse.json({ error: `${k} must be a number` }, { status: 400 });
      }
    }
    for (const k of ["photos", "files", "rent_roll", "contact_ids", "amenities"] as const) {
      if (body[k] !== undefined && body[k] !== null && !Array.isArray(body[k])) {
        return NextResponse.json({ error: `${k} must be an array` }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const oldStage = existing.stage;
    const newStage = body.stage as DealStage | undefined;

    // Reject an out-of-enum status: index maintenance below only recognizes
    // active/dead/passed, so any other value would persist on the record while
    // silently desyncing the indexes.
    if (body.status !== undefined && !["active", "dead", "passed"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

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

    // Handle stage change. Only maintain the by_stage pipeline index for ACTIVE
    // deals — a dead/passed deal must never be (re)inserted into a stage index,
    // or it resurfaces in the pipeline. (Reactivation re-adds it below.)
    if (
      newStage &&
      newStage !== oldStage &&
      DEAL_STAGES.includes(newStage) &&
      existing.status === "active"
    ) {
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

    // Delete the deal's Blob attachments (source files + photos) so they don't
    // orphan in Blob storage after the deal record is gone. Best-effort.
    const blobUrls = [
      ...(deal.files ?? []).map((f) => f.url),
      ...(deal.photos ?? []),
    ].filter((u): u is string => typeof u === "string" && u.length > 0);
    await Promise.allSettled(blobUrls.map((u) => deleteBlobUrl(u)));

    // Cascade delete: scenarios (+ their version snapshots), tasks, checklists.
    const scenarioIds = await getFromIndex(`scenarios:by_deal:${id}`);
    for (const sid of scenarioIds) {
      await redis.del(`scenario:${sid}`);
      // Each edited scenario accumulates scenario_version:${sid}:${n} snapshots
      // that live outside any index — SCAN and purge them so they don't orphan.
      const versionKeys = await scanKeys(`scenario_version:${sid}:*`);
      if (versionKeys.length > 0) await redis.del(...versionKeys);
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
