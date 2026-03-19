import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { ShareLink } from "@/lib/validations";

// POST /api/share — generate a share link
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can create share links" }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body.deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const redis = getRedis();

    // Verify deal exists
    const deal = await redis.get(`deal:${body.deal_id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const now = new Date();
    const expiresDays = body.expires_days || 30;
    const expiresAt = new Date(now.getTime() + expiresDays * 86400000);
    const ttlSeconds = expiresDays * 86400;

    const shareLink: ShareLink = {
      token,
      deal_id: body.deal_id,
      scenario_ids: body.scenario_ids || undefined,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    };

    // Set with TTL so Redis auto-deletes expired share links
    await redis.set(`share:${token}`, JSON.stringify(shareLink), { ex: ttlSeconds });
    // Index by deal for listing
    await redis.zadd(`shares:by_deal:${body.deal_id}`, {
      score: Date.now(),
      member: token,
    });

    return NextResponse.json({
      token,
      url: `/share/${token}`,
      expires_at: shareLink.expires_at,
    }, { status: 201 });
  } catch (err) {
    console.error("POST /api/share error:", err);
    return NextResponse.json({ error: "Failed to create share link" }, { status: 500 });
  }
}
