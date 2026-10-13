import { createHash, randomBytes, randomUUID } from "crypto";

/**
 * Scoped API tokens for machine callers (Claude agents, scripts).
 *
 * A token authenticates as a "token principal" whose role is ALWAYS "va": it can
 * read, create deals at the lead stage, and edit deals and scenarios, but it can
 * never change a deal's stage or status, delete anything, or touch settings.
 *
 * Storage (never under the `deal:` prefix; see PR #180):
 *   api_token:<sha256(raw)>   -> ApiTokenRecord (JSON)
 *   api_token_id:<id>         -> sha256(raw)        (lookup for revoke by id)
 *   api_tokens                -> sorted set of ids  (listing)
 * The raw token is shown once at creation and never stored.
 *
 * Kept free of `@/` imports so scripts/create-api-token.ts can use it under tsx.
 */

export const TOKEN_PREFIX = "me_";
export const TOKEN_ROLE = "va" as const;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export interface ApiTokenRecord {
  id: string;
  name: string;
  user_id: string; // admin who created it; agent writes are attributed to this user
  role: typeof TOKEN_ROLE;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

/** Minimal Redis surface used here, so tests can pass an in-memory fake. */
export interface TokenStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: string): Promise<unknown>;
  zadd(key: string, entry: { score: number; member: string }): Promise<unknown>;
  zrange(key: string, start: number, stop: number, opts?: { rev?: boolean }): Promise<unknown[]>;
}

export function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export const tokenKey = (hash: string) => `api_token:${hash}`;
export const tokenIdKey = (id: string) => `api_token_id:${id}`;
export const TOKEN_INDEX = "api_tokens";

/** Extract a raw token from an Authorization header, or null if absent/malformed. */
export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!m || !m[1].startsWith(TOKEN_PREFIX)) return null;
  return m[1];
}

export async function createApiToken(
  store: TokenStore,
  opts: { name: string; userId: string; now?: Date }
): Promise<{ raw: string; record: ApiTokenRecord }> {
  const name = opts.name.trim();
  if (!name) throw new Error("Token name is required");
  const raw = generateRawToken();
  const hash = hashToken(raw);
  const now = opts.now ?? new Date();
  const record: ApiTokenRecord = {
    id: randomUUID(),
    name,
    user_id: opts.userId,
    role: TOKEN_ROLE,
    created_at: now.toISOString(),
  };
  await store.set(tokenKey(hash), JSON.stringify(record));
  await store.set(tokenIdKey(record.id), hash);
  await store.zadd(TOKEN_INDEX, { score: now.getTime(), member: record.id });
  return { raw, record };
}

/**
 * Resolve a raw token to its record. Returns null for unknown or revoked tokens.
 * Stamps last_used_at at most once per minute to keep writes cheap.
 */
export async function resolveApiToken(
  store: TokenStore,
  raw: string,
  now: Date = new Date()
): Promise<ApiTokenRecord | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(raw);
  const record = await store.get<ApiTokenRecord>(tokenKey(hash));
  if (!record || record.revoked_at) return null;
  const last = record.last_used_at ? Date.parse(record.last_used_at) : 0;
  if (now.getTime() - last >= LAST_USED_WRITE_INTERVAL_MS) {
    const updated: ApiTokenRecord = { ...record, last_used_at: now.toISOString() };
    await store.set(tokenKey(hash), JSON.stringify(updated));
    return updated;
  }
  return record;
}

export async function listApiTokens(store: TokenStore): Promise<ApiTokenRecord[]> {
  const ids = (await store.zrange(TOKEN_INDEX, 0, -1, { rev: true })) as string[];
  const out: ApiTokenRecord[] = [];
  for (const id of ids) {
    const hash = await store.get<string>(tokenIdKey(id));
    if (!hash) continue;
    const rec = await store.get<ApiTokenRecord>(tokenKey(hash));
    if (rec) out.push(rec);
  }
  return out;
}

/** Revoke by id. Returns the updated record, or null if no such token. Idempotent. */
export async function revokeApiToken(
  store: TokenStore,
  id: string,
  now: Date = new Date()
): Promise<ApiTokenRecord | null> {
  const hash = await store.get<string>(tokenIdKey(id));
  if (!hash) return null;
  const rec = await store.get<ApiTokenRecord>(tokenKey(hash));
  if (!rec) return null;
  if (rec.revoked_at) return rec;
  const updated: ApiTokenRecord = { ...rec, revoked_at: now.toISOString() };
  await store.set(tokenKey(hash), JSON.stringify(updated));
  return updated;
}
