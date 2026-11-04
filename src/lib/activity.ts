import { getRedis, addToIndex } from "./db";

export interface ActivityEntry {
  id: string;
  deal_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown>;
  user_id: string;
  /**
   * Where the change came from: "web" (a signed-in user in the app UI) or
   * "connector" (Claude, via the MCP server, acting as that user). Rows written
   * before this field existed have no actor and were made through the web UI.
   */
  actor?: "web" | "connector";
  timestamp: string;
}

export async function logActivity(
  entry: Omit<ActivityEntry, "id" | "timestamp">
): Promise<void> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const activity: ActivityEntry = { ...entry, actor: entry.actor ?? "web", id, timestamp };

  const redis = getRedis();
  await redis.set(`activity:${id}`, JSON.stringify(activity));
  await addToIndex(`activities:by_deal:${entry.deal_id}`, id, Date.now());
  await addToIndex("activities:all", id, Date.now());
}

export async function getActivitiesForDeal(
  dealId: string,
  limit: number = 20,
  offset: number = 0
): Promise<ActivityEntry[]> {
  const redis = getRedis();
  const ids = await redis.zrange(
    `activities:by_deal:${dealId}`,
    offset,
    offset + limit - 1,
    { rev: true }
  );
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`activity:${id}`);
  }
  const results = await pipeline.exec<(ActivityEntry | null)[]>();
  return results.filter((r): r is ActivityEntry => r !== null);
}

export async function getRecentActivities(
  limit: number = 15
): Promise<ActivityEntry[]> {
  const redis = getRedis();
  const ids = await redis.zrange("activities:all", 0, limit - 1, { rev: true });
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`activity:${id}`);
  }
  const results = await pipeline.exec<(ActivityEntry | null)[]>();
  return results.filter((r): r is ActivityEntry => r !== null);
}
