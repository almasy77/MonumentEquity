/**
 * Redis-backed OAuth 2.1 state for the MCP connector.
 *
 * Keys (every secret is stored only as a SHA-256 hash):
 *   oauth:client:{client_id}        registered client (DCR)             TTL 1 year
 *   oauth:code:{hash}               one-time authorization code         TTL 10 min
 *   oauth:grant:{grant_id}          a user's authorization of a client  until revoked
 *   oauth:grants:{user_id}          SET of that user's grant ids
 *   oauth:at:{hash}                 access token -> grant               TTL 1 hour
 *   oauth:rt:{hash}                 refresh token -> grant              TTL 30 days
 *   oauth:rt_used:{hash}            tombstone of a rotated refresh token
 *
 * Revoking a grant deletes the grant record; access tokens are checked against it on
 * every call, so revocation is immediate rather than waiting for the 1-hour expiry.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/lib/db";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  CLIENT_TTL_SECONDS,
  MCP_SCOPE,
  REFRESH_TOKEN_TTL_SECONDS,
  isAllowedRedirectUri,
} from "./oauth-config";

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: string;
}

export interface OAuthGrant {
  id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  scope: string;
  resource: string;
  created_at: string;
  last_used_at?: string;
}

interface CodeRecord {
  client_id: string;
  user_id: string;
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
}

interface TokenRecord {
  grant_id: string;
  user_id: string;
  client_id: string;
}

export interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export class OAuthError extends Error {
  constructor(
    public code:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "invalid_scope"
      | "unsupported_grant_type"
      | "invalid_redirect_uri"
      | "invalid_client_metadata",
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

// ─── primitives ─────────────────────────────────────────────

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

const k = {
  client: (id: string) => `oauth:client:${id}`,
  code: (hash: string) => `oauth:code:${hash}`,
  grant: (id: string) => `oauth:grant:${id}`,
  grants: (userId: string) => `oauth:grants:${userId}`,
  at: (hash: string) => `oauth:at:${hash}`,
  rt: (hash: string) => `oauth:rt:${hash}`,
  rtUsed: (hash: string) => `oauth:rt_used:${hash}`,
};

/** RFC 7636 S256: base64url(SHA256(verifier)) must equal the stored challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── clients (RFC 7591 dynamic registration) ────────────────

export async function registerClient(meta: {
  client_name?: unknown;
  redirect_uris?: unknown;
}): Promise<OAuthClient> {
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === "string")) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must be a non-empty array of URLs");
  }
  for (const u of uris as string[]) {
    if (!isAllowedRedirectUri(u)) {
      throw new OAuthError("invalid_redirect_uri", `redirect_uri not allowed: ${u}`);
    }
  }
  const name =
    typeof meta.client_name === "string" && meta.client_name.trim()
      ? meta.client_name.trim().slice(0, 100)
      : "MCP client";

  const client: OAuthClient = {
    client_id: newSecret("mec"),
    client_name: name,
    redirect_uris: uris as string[],
    created_at: new Date().toISOString(),
  };
  await getRedis().set(k.client(client.client_id), JSON.stringify(client), { ex: CLIENT_TTL_SECONDS });
  return client;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 200) return null;
  return await getRedis().get<OAuthClient>(k.client(clientId));
}

// ─── authorization codes + grants ───────────────────────────

/** Called after the signed-in user approves. Creates the grant and a one-time code. */
export async function issueAuthorizationCode(input: {
  client: OAuthClient;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope?: string;
  resource: string;
}): Promise<string> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const grant: OAuthGrant = {
    id: crypto.randomUUID(),
    user_id: input.user_id,
    client_id: input.client.client_id,
    client_name: input.client.client_name,
    scope: MCP_SCOPE,
    resource: input.resource,
    created_at: now,
  };
  await redis.set(k.grant(grant.id), JSON.stringify(grant));
  await redis.sadd(k.grants(input.user_id), grant.id);

  const code = newSecret("mecode");
  const record: CodeRecord = {
    client_id: input.client.client_id,
    user_id: input.user_id,
    grant_id: grant.id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    scope: MCP_SCOPE,
    resource: input.resource,
  };
  await redis.set(k.code(sha256(code)), JSON.stringify(record), { ex: AUTH_CODE_TTL_SECONDS });
  return code;
}

async function mintTokens(grant: OAuthGrant): Promise<TokenPair> {
  const redis = getRedis();
  const access = newSecret("mea");
  const refresh = newSecret("mer");
  const rec: TokenRecord = { grant_id: grant.id, user_id: grant.user_id, client_id: grant.client_id };
  await redis.set(k.at(sha256(access)), JSON.stringify(rec), { ex: ACCESS_TOKEN_TTL_SECONDS });
  await redis.set(k.rt(sha256(refresh)), JSON.stringify(rec), { ex: REFRESH_TOKEN_TTL_SECONDS });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
    scope: grant.scope,
  };
}

async function loadGrant(id: string): Promise<OAuthGrant | null> {
  return await getRedis().get<OAuthGrant>(k.grant(id));
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
  resource?: string;
  expectedResource: string;
}): Promise<TokenPair> {
  // GETDEL: the code can be redeemed exactly once, even under a race.
  const rec = await getRedis().getdel<CodeRecord>(k.code(sha256(input.code)));
  if (!rec) throw new OAuthError("invalid_grant", "Authorization code is invalid, expired, or already used");
  if (rec.client_id !== input.client_id) throw new OAuthError("invalid_grant", "Code was issued to a different client");
  if (rec.redirect_uri !== input.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri mismatch");
  if (!pkceMatches(input.code_verifier, rec.code_challenge)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }
  if (input.resource && input.resource !== input.expectedResource) {
    throw new OAuthError("invalid_request", "Unknown resource");
  }
  const grant = await loadGrant(rec.grant_id);
  if (!grant) throw new OAuthError("invalid_grant", "Grant was revoked");
  await getRedis().expire(k.client(grant.client_id), CLIENT_TTL_SECONDS); // keep an in-use client alive
  return mintTokens(grant);
}

/** Replays of a rotated refresh token inside this window are treated as a client race, not theft. */
const REFRESH_REPLAY_GRACE_MS = 60_000;

export async function refreshTokens(input: { refresh_token: string; client_id: string }): Promise<TokenPair> {
  const redis = getRedis();
  const hash = sha256(input.refresh_token);
  const rec = await redis.getdel<TokenRecord>(k.rt(hash));

  if (!rec) {
    // Was it a real token we already rotated? A late replay means it leaked: kill the grant.
    const used = await redis.get<{ grant_id: string; used_at: number }>(k.rtUsed(hash));
    if (used && Date.now() - used.used_at > REFRESH_REPLAY_GRACE_MS) {
      const grant = await loadGrant(used.grant_id);
      if (grant) await revokeGrant(grant.user_id, grant.id);
    }
    throw new OAuthError("invalid_grant", "Refresh token is invalid, expired, or already used");
  }
  if (rec.client_id !== input.client_id) {
    await revokeGrant(rec.user_id, rec.grant_id);
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client");
  }
  const grant = await loadGrant(rec.grant_id);
  if (!grant) throw new OAuthError("invalid_grant", "Grant was revoked");

  await redis.set(k.rtUsed(hash), JSON.stringify({ grant_id: grant.id, used_at: Date.now() }), {
    ex: REFRESH_TOKEN_TTL_SECONDS,
  });
  return mintTokens(grant);
}

// ─── resource-server side ───────────────────────────────────

export interface VerifiedToken {
  user_id: string;
  grant_id: string;
  client_id: string;
  resource: string;
}

export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  if (!token || token.length > 300 || !token.startsWith("mea_")) return null;
  const redis = getRedis();
  const rec = await redis.get<TokenRecord>(k.at(sha256(token)));
  if (!rec) return null;
  const grant = await loadGrant(rec.grant_id);
  if (!grant || grant.user_id !== rec.user_id) return null;

  // Throttled "last used" stamp so the connected-apps list is meaningful without a write per call.
  const last = grant.last_used_at ? Date.parse(grant.last_used_at) : 0;
  if (Date.now() - last > 5 * 60_000) {
    redis
      .set(k.grant(grant.id), JSON.stringify({ ...grant, last_used_at: new Date().toISOString() }))
      .catch(() => undefined);
  }
  return { user_id: grant.user_id, grant_id: grant.id, client_id: grant.client_id, resource: grant.resource };
}

// ─── revocation ─────────────────────────────────────────────

export async function listGrants(userId: string): Promise<OAuthGrant[]> {
  const redis = getRedis();
  const ids = (await redis.smembers(k.grants(userId))) as string[];
  const grants: OAuthGrant[] = [];
  for (const id of ids) {
    const g = await loadGrant(id);
    if (g && g.user_id === userId) grants.push(g);
    else await redis.srem(k.grants(userId), id); // prune dangling ids
  }
  return grants.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Revoke one grant. Its access/refresh tokens stop working immediately (they are
 * validated against the grant); the token records themselves expire on their own TTL.
 * Returns false when the grant does not exist or belongs to another user.
 */
export async function revokeGrant(userId: string, grantId: string): Promise<boolean> {
  const redis = getRedis();
  const grant = await loadGrant(grantId);
  if (!grant || grant.user_id !== userId) return false;
  await redis.del(k.grant(grantId));
  await redis.srem(k.grants(userId), grantId);
  return true;
}

export async function revokeAllGrants(userId: string): Promise<number> {
  const grants = await listGrants(userId);
  for (const g of grants) await revokeGrant(userId, g.id);
  return grants.length;
}

/** RFC 7009: revoking either token of a grant revokes the grant. Always succeeds quietly. */
export async function revokeByToken(token: string, clientId: string): Promise<void> {
  const redis = getRedis();
  const hash = sha256(token);
  const rec = (await redis.get<TokenRecord>(k.at(hash))) ?? (await redis.get<TokenRecord>(k.rt(hash)));
  if (rec && rec.client_id === clientId) await revokeGrant(rec.user_id, rec.grant_id);
}
