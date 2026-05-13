import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex, removeFromIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import type { Deal, PendingListing } from "@/lib/validations";

/**
 * POST /api/leads/[id]/approve — promote a pending listing to a deal.
 * Body may override extracted fields the user edited before approving.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  const { id } = await params;
  const redis = getRedis();

  const pending = await redis.get<PendingListing>(`pending_listing:${id}`);
  if (!pending) {
    return NextResponse.json({ error: "Pending listing not found" }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return NextResponse.json({ error: `Listing already ${pending.status}` }, { status: 409 });
  }

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const overrides = (bodyOrError ?? {}) as Partial<Deal>;

  const e = pending.extracted;
  const now = new Date().toISOString();
  const dealId = crypto.randomUUID();

  // Required deal fields — fall back through overrides → extracted → sensible defaults.
  const address = overrides.address || e.address || `Email Lead: ${pending.subject}`;
  const city = overrides.city || e.city || "Unknown";
  const state = overrides.state || e.state || "NC";
  const units = overrides.units ?? e.units ?? 1;
  const asking_price = overrides.asking_price ?? e.asking_price ?? 0;

  const deal: Deal = {
    id: dealId,
    user_id: session.user.id,
    stage: overrides.stage || "lead",
    status: "active",
    address,
    city,
    state,
    zip: overrides.zip ?? e.zip,
    units,
    year_built: overrides.year_built ?? e.year_built,
    property_type: overrides.property_type ?? e.property_type,
    square_footage: overrides.square_footage ?? e.square_footage,
    asking_price,
    source: overrides.source || "Broker",
    photos: e.photo_url ? [e.photo_url] : undefined,
    market_notes: [
      overrides.market_notes ?? e.market_notes,
      `\n--- Imported from email ---`,
      `From: ${pending.from_name || pending.from}`,
      `Subject: ${pending.subject}`,
      `Date: ${pending.received_at}`,
    ]
      .filter(Boolean)
      .join("\n"),
    contact_ids: [],
    created_by: session.user.id,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };

  await redis.set(`deal:${dealId}`, JSON.stringify(deal));
  await addToIndex("deals:active", dealId, Date.now());
  await addToIndex(`deals:by_stage:${deal.stage}`, dealId, Date.now());

  const updatedPending: PendingListing = {
    ...pending,
    status: "approved",
    approved_deal_id: dealId,
    updated_at: now,
  };
  await redis.set(`pending_listing:${id}`, JSON.stringify(updatedPending));
  await removeFromIndex("pending_listings:queue", id);

  await logActivity({
    deal_id: dealId,
    action: "deal_created_from_email",
    entity_type: "deal",
    entity_id: dealId,
    details: {
      email_from: pending.from,
      email_subject: pending.subject,
      pending_listing_id: id,
    },
    user_id: session.user.id,
  });

  return NextResponse.json({ deal_id: dealId }, { status: 201 });
}
