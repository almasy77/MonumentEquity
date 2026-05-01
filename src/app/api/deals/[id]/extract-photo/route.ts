import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { extractImageFromUrl } from "@/lib/ai-extract";
import type { Deal } from "@/lib/validations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, context: RouteContext) {
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

    if (!deal.source_url) {
      return NextResponse.json({ error: "No listing URL set on this deal" }, { status: 400 });
    }

    const imageUrl = await extractImageFromUrl(deal.source_url);
    if (!imageUrl) {
      return NextResponse.json({ error: "Could not extract an image from the listing" }, { status: 422 });
    }

    deal.photos = [imageUrl];
    deal.updated_at = new Date().toISOString();
    await redis.set(`deal:${id}`, JSON.stringify(deal));

    return NextResponse.json({ photo_url: imageUrl });
  } catch (err) {
    console.error("Extract photo error:", err);
    return NextResponse.json({ error: "Failed to extract photo" }, { status: 500 });
  }
}
