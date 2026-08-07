import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { put } from "@vercel/blob";
import type { Deal } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
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
    const deal = await redis.get<Deal>(`deal:${id}`);
    if (!deal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    // Only accept images, and cap the size — this route previously read the whole
    // body into memory unbounded and stored arbitrary bytes labeled image/jpeg.
    const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image files are allowed" }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Image too large. Maximum 10MB." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const blob = await put(`deal-photos/${id}-${Date.now()}.${ext}`, bytes, {
      access: "public",
      contentType: file.type, // the validated real type, not a hardcoded label
    });

    deal.photos = [blob.url];
    deal.updated_at = new Date().toISOString();
    await redis.set(`deal:${id}`, JSON.stringify(deal));

    return NextResponse.json({ photo_url: blob.url });
  } catch (err) {
    console.error("Upload photo error:", err);
    return NextResponse.json({ error: "Failed to upload photo" }, { status: 500 });
  }
}
