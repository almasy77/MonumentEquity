import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error(
        "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variables"
      );
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Convenience alias
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Typed helper functions for Redis operations

export async function getEntity<T>(key: string): Promise<T | null> {
  const data = await getRedis().get<T>(key);
  return data;
}

export async function setEntity<T>(key: string, value: T): Promise<void> {
  await getRedis().set(key, JSON.stringify(value));
}

export async function deleteEntity(key: string): Promise<void> {
  await getRedis().del(key);
}

export async function addToIndex(
  indexKey: string,
  memberId: string,
  score: number = Date.now()
): Promise<void> {
  await getRedis().zadd(indexKey, { score, member: memberId });
}

export async function removeFromIndex(
  indexKey: string,
  memberId: string
): Promise<void> {
  await getRedis().zrem(indexKey, memberId);
}

export async function getFromIndex(
  indexKey: string,
  start: number = 0,
  end: number = -1
): Promise<string[]> {
  return await getRedis().zrange(indexKey, start, end, { rev: true });
}

export async function getEntitiesByIndex<T>(
  indexKey: string,
  entityPrefix: string,
  start: number = 0,
  end: number = -1
): Promise<T[]> {
  const ids = await getFromIndex(indexKey, start, end);
  if (ids.length === 0) return [];

  const r = getRedis();
  const pipeline = r.pipeline();
  for (const id of ids) {
    pipeline.get(`${entityPrefix}:${id}`);
  }
  const results = await pipeline.exec<(T | null)[]>();
  return results.filter((r): r is T => r !== null);
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * SCAN all keys matching a glob pattern (e.g. "deal:*"). Cursor-paged so it
 * returns the complete set even across large keyspaces. Use sparingly — SCAN
 * is O(N) over the keyspace — but it's the only way to reach entities that are
 * no longer in any index (e.g. dead/passed deals removed from deals:active).
 */
export async function scanKeys(pattern: string, count: number = 250): Promise<string[]> {
  const r = getRedis();
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await r.scan(cursor, { match: pattern, count });
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}
