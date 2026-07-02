import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { fetchBlobFile, persistDealFile, guessContentType } from "@/lib/blob-helpers";
import { DEAL_FILE_KINDS, type Deal, type DealFile } from "@/lib/validations";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

// Manually attach a document (PDF / CSV / XLSX / image) to a deal. Accepts a
// direct file (< 4MB) or a Vercel Blob url + fileName for larger uploads, mirroring
// the OM / rent-roll / T12 import routes.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  let blobCleanup: (() => Promise<void>) | null = null;

  try {
    const { id } = await ctx.params;
    const redis = getRedis();
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const blobUrl = formData.get("blobUrl") as string | null;
    const blobFileName = formData.get("fileName") as string | null;
    const kindRaw = (formData.get("kind") as string | null) ?? "other";
    const kind: DealFile["kind"] = (DEAL_FILE_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as DealFile["kind"])
      : "other";

    // Restrict to the document/image types the app handles — the client accept=
    // filter is bypassable via a direct API call, so enforce it server-side and
    // keep arbitrary (e.g. .html/.svg) files off public blob URLs.
    const ALLOWED = /\.(pdf|csv|xlsx|xls|png|jpe?g)$/i;
    const okName = (n: string | null): n is string => !!n && ALLOWED.test(n);

    let buffer: ArrayBuffer;
    let fileName: string;

    if (blobUrl) {
      if (!blobFileName) {
        return NextResponse.json({ error: "fileName is required with blobUrl" }, { status: 400 });
      }
      if (!okName(blobFileName)) {
        return NextResponse.json({ error: "Unsupported file type. Use PDF, CSV, XLSX, or an image." }, { status: 400 });
      }
      const blob = await fetchBlobFile(blobUrl); // validates host + enforces the 25MB cap
      buffer = blob.buffer;
      blobCleanup = blob.cleanup;
      fileName = blobFileName;
    } else {
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      if (!okName(file.name)) {
        return NextResponse.json({ error: "Unsupported file type. Use PDF, CSV, XLSX, or an image." }, { status: 400 });
      }
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large. Maximum 25MB." }, { status: 400 });
      }
      buffer = await file.arrayBuffer();
      fileName = file.name;
    }

    const dealFile = await persistDealFile(buffer, fileName, kind, guessContentType(fileName), session.user.id);
    if (blobCleanup) await blobCleanup();

    deal.files = [...(deal.files || []), dealFile];
    deal.updated_at = new Date().toISOString();
    await redis.set(`deal:${id}`, JSON.stringify(deal));

    await logActivity({
      deal_id: id,
      action: "file_uploaded",
      entity_type: "deal",
      entity_id: id,
      details: { name: dealFile.name, kind: dealFile.kind },
      user_id: session.user.id,
    });

    return NextResponse.json({ file: dealFile, files: deal.files }, { status: 201 });
  } catch (err) {
    if (blobCleanup) await blobCleanup().catch(() => {});
    const message = err instanceof Error ? err.message : "Failed to upload file";
    console.error("POST /api/deals/[id]/files error:", message, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
