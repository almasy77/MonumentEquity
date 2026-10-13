import { createHash, randomBytes, randomUUID } from "crypto";

/**
 * Scoped API tokens for machine callers (Claude agents, scripts).
 *
 * A token authenticates as a "token principal" whose role is ALWAYS "va": it can
 * read, create deals at the lead stage, and edit deals and scenarios, but it can
 * never change a deal's stage or status, delete anything, or touch settings.
 *
 * Storage (never under the `deal:` prefix; see PR #180):
 *   api_token:<sha256(raw)>            -> ApiTokenRecord (JSON); written only at create and revoke
 *   api_token_revoked:<sha256(raw)>    -> revoked-at ISO string (checked on every request)
 *   api_token_last_used:<sha256(raw)>  -> last-used ISO string (own key, so a request
 *                                         never rewrites the record and cannot undo a revoke)
 *   api_token_id:<id>                  -> sha256(raw)        (lookup for revoke by id)
 *   api_tokens                         -> sorted set of ids  (listing)
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
export const tokenRevokedKey = (hash: string) => `api_token_revoked:${hash}`;
export const tokenLastUsedKey = (hash: string) => `api_token_last_used:${hash}`;
export const tokenIdKey = (id: string) => `api_token_id:${id}`;
export const TOKEN_INDEX = "api_tokens";

/**
 * Extract a raw token from an Authorization header, or null if absent/malformed.
 * Callers must treat "header present but bearerToken() is null" as a FAILED
 * authentication, never as "no credentials" (see getActor and proxy.ts).
 */
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
 * Read-only on the record: last_used_at lives under its own key and is stamped at
 * most once per minute, so a concurrent request can never write back a stale
 * record over a revoke.
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
  if (await store.get<string>(tokenRevokedKey(hash))) return null;
  const lastRaw = await store.get<string>(tokenLastUsedKey(hash));
  const last = lastRaw ? Date.parse(String(lastRaw)) : 0;
  let lastUsed = lastRaw ? String(lastRaw) : undefined;
  if (now.getTime() - last >= LAST_USED_WRITE_INTERVAL_MS) {
    lastUsed = now.toISOString();
    await store.set(tokenLastUsedKey(hash), lastUsed);
  }
  return { ...record, last_used_at: lastUsed };
}

export async function listApiTokens(store: TokenStore): Promise<ApiTokenRecord[]> {
  const ids = (await store.zrange(TOKEN_INDEX, 0, -1, { rev: true })) as string[];
  const out: ApiTokenRecord[] = [];
  for (const id of ids) {
    const hash = await store.get<string>(tokenIdKey(id));
    if (!hash) continue;
    const rec = await store.get<ApiTokenRecord>(tokenKey(hash));
    if (!rec) continue;
    const lastUsed = await store.get<string>(tokenLastUsedKey(hash));
    out.push(lastUsed ? { ...rec, last_used_at: String(lastUsed) } : rec);
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
  const revokedAt = now.toISOString();
  // The marker key is what requests check; the record update is for listing.
  await store.set(tokenRevokedKey(hash), revokedAt);
  const updated: ApiTokenRecord = { ...rec, revoked_at: revokedAt };
  await store.set(tokenKey(hash), JSON.stringify(updated));
  return updated;
}

/**
 * The only API handlers that accept tokens (path + method). Enforced in proxy.ts
 * so a future route that forgets its own auth check is still not reachable with
 * a token. Must match the handlers that call getActor().
 */
const TOKEN_ROUTES: { re: RegExp; methods: string[] }[] = [
  { re: /^\/api\/deals$/, methods: ["GET", "POST"] },
  { re: /^\/api\/deals\/inactive$/, methods: ["GET"] },
  { re: /^\/api\/deals\/[0-9a-f-]{36}$/, methods: ["GET", "PUT"] },
  { re: /^\/api\/scenarios$/, methods: ["GET", "POST"] },
  { re: /^\/api\/scenarios\/[0-9a-f-]{36}$/, methods: ["GET", "PUT"] },
  { re: /^\/api\/contacts$/, methods: ["GET", "POST"] },
  { re: /^\/api\/contacts\/[0-9a-f-]{36}$/, methods: ["GET", "PUT"] },
  { re: /^\/api\/tasks$/, methods: ["GET", "POST"] },
  { re: /^\/api\/activities$/, methods: ["GET"] },
  { re: /^\/api\/search$/, methods: ["GET"] },
  { re: /^\/api\/leads\/count$/, methods: ["GET"] },
];

export function tokenRouteAllowed(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TOKEN_ROUTES.some((r) => r.re.test(path) && r.methods.includes(m));
}

/** Cheap validity check for the proxy: record exists and is not revoked. No writes. */
export async function isTokenActive(store: TokenStore, raw: string): Promise<boolean> {
  if (!raw.startsWith(TOKEN_PREFIX)) return false;
  const hash = hashToken(raw);
  const record = await store.get<ApiTokenRecord>(tokenKey(hash));
  if (!record || record.revoked_at) return false;
  return !(await store.get<string>(tokenRevokedKey(hash)));
}
