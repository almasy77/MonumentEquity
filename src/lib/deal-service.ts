/**
 * Deal create / field-update / status logic shared by the web API routes and the
 * MCP connector. Auth, role and ownership checks stay with the callers.
 */
import { getRedis, addToIndex, removeFromIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ChangeSource } from "@/lib/scenario-service";
import type { Deal } from "@/lib/validations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

/**
 * Create and index a new active deal owned by `userId`. The caller has already
 * validated the required fields (address, city, state, units, asking_price, source).
 */
export async function createDealRecord(
  body: Body,
  userId: string,
  via: ChangeSource = "web"
): Promise<Deal> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const deal: Deal = {
    id,
    user_id: userId,
    stage: body.stage || "lead",
    status: "active",
    address: body.address,
    city: body.city,
    state: body.state,
    zip: body.zip || undefined,
    county: body.county || undefined,
    units: body.units,
    year_built: body.year_built || undefined,
    property_type: body.property_type || undefined,
    square_footage: body.square_footage || undefined,
    asking_price: body.asking_price,
    bid_price: body.bid_price || undefined,
    source: body.source,
    source_url: body.source_url || undefined,
    photos: body.photos || undefined,
    market_notes: body.market_notes || undefined,
    contact_ids: body.contact_ids || [],
    created_by: userId,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
    updated_by: userId,
    updated_via: via,
  };

  const redis = getRedis();
  await redis.set(`deal:${id}`, JSON.stringify(deal));
  await addToIndex("deals:active", id, Date.now());
  await addToIndex(`deals:by_stage:${deal.stage}`, id, Date.now());

  await logActivity({
    deal_id: id,
    action: "deal_created",
    entity_type: "deal",
    entity_id: id,
    details: { address: deal.address, units: deal.units, asking_price: deal.asking_price },
    user_id: userId,
    actor: via,
  });

  return deal;
}

/**
 * Keep the deals:active / deals:by_stage:* indexes consistent with a status change.
 * Dead/passed deals leave every index; reactivation re-adds them. Extracted from
 * PUT /api/deals/[id] so the connector's pass/reactivate maintain them identically.
 */
export async function syncStatusIndexes(
  existing: Deal,
  newStatus: Deal["status"],
  stageOverride?: Deal["stage"]
): Promise<void> {
  const id = existing.id;
  if (newStatus === "dead" || newStatus === "passed") {
    await removeFromIndex("deals:active", id);
    await removeFromIndex(`deals:by_stage:${existing.stage}`, id);
  } else if (existing.status !== "active" && newStatus === "active") {
    await addToIndex("deals:active", id, Date.now());
    const stage = stageOverride || existing.stage;
    await addToIndex(`deals:by_stage:${stage}`, id, Date.now());
  }
}

/** Connector-side status change: pass (with a real reason) or reactivate. */
export async function changeDealStatus(
  existing: Deal,
  change: { status: "passed"; reason: string } | { status: "active" },
  userId: string,
  via: ChangeSource
): Promise<Deal> {
  const now = new Date().toISOString();
  await syncStatusIndexes(existing, change.status);

  // Reactivating drops the old pass/kill reason: it described a state the deal is no
  // longer in, and left behind it makes an active deal look dead or passed to anything
  // that reads the raw record. The reason is not lost: the status_changed activity row
  // written when the deal was passed/killed still carries it.
  const { pass_reason: _pass, kill_reason: _kill, ...rest } = existing;
  void _pass;
  void _kill;
  const updated: Deal = {
    ...(change.status === "active" ? rest : existing),
    status: change.status,
    ...(change.status === "passed" ? { pass_reason: change.reason } : {}),
    updated_at: now,
    last_activity_at: now,
    updated_by: userId,
    updated_via: via,
  } as Deal;
  await getRedis().set(`deal:${existing.id}`, JSON.stringify(updated));

  await logActivity({
    deal_id: existing.id,
    action: "status_changed",
    entity_type: "deal",
    entity_id: existing.id,
    details: {
      old_status: existing.status,
      new_status: change.status,
      reason: change.status === "passed" ? change.reason : undefined,
    },
    user_id: userId,
    actor: via,
  });

  return updated;
}

/** Stale status-reason fields on a deal that is currently active (left by an earlier pass/kill + reactivate). */
export function staleStatusReasons(deal: Deal): ("pass_reason" | "kill_reason")[] {
  if (deal.status !== "active") return [];
  return (["pass_reason", "kill_reason"] as const).filter((k) => deal[k] !== undefined && deal[k] !== null);
}

/**
 * Remove stale pass/kill reasons from an ACTIVE deal without touching its status or
 * indexes. Used by reactivate_deal on a deal that is already active but was reactivated
 * before reactivation cleared these fields.
 */
export async function clearStaleStatusReasons(
  existing: Deal,
  userId: string,
  via: ChangeSource
): Promise<{ deal: Deal; cleared: string[] }> {
  const cleared = staleStatusReasons(existing);
  if (cleared.length === 0) return { deal: existing, cleared };
  const now = new Date().toISOString();
  const next: Record<string, unknown> = { ...existing };
  for (const k of cleared) delete next[k];
  const updated = {
    ...next,
    updated_at: now,
    last_activity_at: now,
    updated_by: userId,
    updated_via: via,
  } as unknown as Deal;
  await getRedis().set(`deal:${existing.id}`, JSON.stringify(updated));
  await logActivity({
    deal_id: existing.id,
    action: "deal_updated",
    entity_type: "deal",
    entity_id: existing.id,
    details: { fields: cleared, note: "Cleared stale status reason(s) on an active deal" },
    user_id: userId,
    actor: via,
  });
  return { deal: updated, cleared };
}

/** Merge validated field edits into a deal and log which fields changed. */
export async function applyDealFieldUpdate(
  existing: Deal,
  patch: Body,
  userId: string,
  via: ChangeSource
): Promise<{ deal: Deal; changed: string[] }> {
  const now = new Date().toISOString();
  const merged: Record<string, unknown> = { ...existing };
  const changed: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const before = (existing as Record<string, unknown>)[k];
    if (JSON.stringify(before) === JSON.stringify(v ?? undefined)) continue;
    changed.push(k);
    if (v === null || v === undefined) delete merged[k]; // null clears an optional field
    else merged[k] = v;
  }

  const updated = {
    ...merged,
    updated_at: now,
    last_activity_at: now,
    updated_by: userId,
    updated_via: via,
  } as unknown as Deal;
  await getRedis().set(`deal:${existing.id}`, JSON.stringify(updated));

  if (changed.length > 0) {
    await logActivity({
      deal_id: existing.id,
      action: "deal_updated",
      entity_type: "deal",
      entity_id: existing.id,
      details: { fields: changed },
      user_id: userId,
      actor: via,
    });
  }

  return { deal: updated, changed };
}
