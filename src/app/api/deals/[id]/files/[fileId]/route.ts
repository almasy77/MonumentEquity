import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { deleteBlobUrl } from "@/lib/blob-helpers";
import type { Deal } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string; fileId: string }> };

// Remove a persisted deal file: drop the record from the deal and best-effort
// delete the underlying Blob.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  // Destructive delete of a source document + its blob — admin-only, matching
  // DELETE /api/deals/[id] (a VA can upload/view files but not delete them).
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id, fileId } = await ctx.params;
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const target = (deal.files || []).find((f) => f.id === fileId);
    if (!target) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    deal.files = (deal.files || []).filter((f) => f.id !== fileId);
    deal.updated_at = new Date().toISOString();
    await redis.set(`deal:${id}`, JSON.stringify(deal));

    await deleteBlobUrl(target.url);

    await logActivity({
      deal_id: id,
      action: "file_deleted",
      entity_type: "deal",
      entity_id: id,
      details: { name: target.name, kind: target.kind },
      user_id: session.user.id,
    });

    return NextResponse.json({ ok: true, files: deal.files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete file";
    console.error("DELETE /api/deals/[id]/files/[fileId] error:", message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
