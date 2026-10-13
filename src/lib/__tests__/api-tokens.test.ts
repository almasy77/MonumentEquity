import { describe, it, expect } from "vitest";
import {
  bearerToken,
  createApiToken,
  hashToken,
  isTokenActive,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
  tokenKey,
  tokenRouteAllowed,
  TOKEN_PREFIX,
  type TokenStore,
} from "../api-tokens";

// In-memory stand-in for the Upstash client (get parses JSON like Upstash does).
function memStore() {
  const kv = new Map<string, string>();
  const zsets = new Map<string, { score: number; member: string }[]>();
  const store: TokenStore & { kv: Map<string, string> } = {
    kv,
    async get<T>(key: string) {
      const v = kv.get(key);
      if (v === undefined) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    },
    async set(key, value) {
      kv.set(key, value);
      return "OK";
    },
    async zadd(key, entry) {
      const z = zsets.get(key) ?? [];
      z.push(entry);
      zsets.set(key, z);
      return 1;
    },
    async zrange(key, _s, _e, opts) {
      const z = [...(zsets.get(key) ?? [])].sort((a, b) => a.score - b.score);
      if (opts?.rev) z.reverse();
      return z.map((x) => x.member);
    },
  };
  return store;
}

describe("api tokens", () => {
  it("creates a VA token and stores only its hash", async () => {
    const store = memStore();
    const { raw, record } = await createApiToken(store, { name: "Scout agent", userId: "u1" });
    expect(raw.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(record.role).toBe("va");
    expect(record.user_id).toBe("u1");
    for (const [k, v] of store.kv) {
      expect(k.includes(raw)).toBe(false);
      expect(v.includes(raw)).toBe(false);
    }
    expect(store.kv.has(tokenKey(hashToken(raw)))).toBe(true);
  });

  it("resolves a valid token and rejects unknown or malformed ones", async () => {
    const store = memStore();
    const { raw } = await createApiToken(store, { name: "t", userId: "u1" });
    expect((await resolveApiToken(store, raw))?.name).toBe("t");
    expect(await resolveApiToken(store, raw + "x")).toBeNull();
    expect(await resolveApiToken(store, "not-a-token")).toBeNull();
  });

  it("rejects a revoked token on the next request", async () => {
    const store = memStore();
    const { raw, record } = await createApiToken(store, { name: "t", userId: "u1" });
    await revokeApiToken(store, record.id);
    expect(await resolveApiToken(store, raw)).toBeNull();
    const listed = await listApiTokens(store);
    expect(listed[0].revoked_at).toBeTruthy();
  });

  it("stamps last_used_at at most once per minute", async () => {
    const store = memStore();
    const { raw } = await createApiToken(store, { name: "t", userId: "u1" });
    const t0 = new Date("2026-10-13T12:00:00Z");
    const a = await resolveApiToken(store, raw, t0);
    const b = await resolveApiToken(store, raw, new Date(t0.getTime() + 30_000));
    const c = await resolveApiToken(store, raw, new Date(t0.getTime() + 61_000));
    expect(a?.last_used_at).toBe(t0.toISOString());
    expect(b?.last_used_at).toBe(t0.toISOString());
    expect(c?.last_used_at).toBe(new Date(t0.getTime() + 61_000).toISOString());
  });

  it("reads only well-formed bearer headers with the token prefix", () => {
    expect(bearerToken("Bearer me_abc")).toBe("me_abc");
    expect(bearerToken("bearer me_abc")).toBe("me_abc");
    expect(bearerToken("Bearer abc")).toBeNull();
    expect(bearerToken("Basic me_abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("requires a token name", async () => {
    await expect(createApiToken(memStore(), { name: "  ", userId: "u1" })).rejects.toThrow();
  });

  it("a request in flight cannot undo a revoke (review finding #1)", async () => {
    const store = memStore();
    const { raw, record } = await createApiToken(store, { name: "t", userId: "u1" });
    const recordKey = tokenKey(hashToken(raw));
    const before = store.kv.get(recordKey);
    // Resolving never rewrites the record, so there is no stale copy to write back.
    await resolveApiToken(store, raw, new Date("2026-10-13T12:00:00Z"));
    expect(store.kv.get(recordKey)).toBe(before);
    await revokeApiToken(store, record.id);
    await resolveApiToken(store, raw, new Date("2026-10-13T12:05:00Z"));
    expect(await resolveApiToken(store, raw)).toBeNull();
    expect(await isTokenActive(store, raw)).toBe(false);
  });

  it("isTokenActive accepts live tokens only", async () => {
    const store = memStore();
    const { raw } = await createApiToken(store, { name: "t", userId: "u1" });
    expect(await isTokenActive(store, raw)).toBe(true);
    expect(await isTokenActive(store, "me_unknown")).toBe(false);
    expect(await isTokenActive(store, "nope")).toBe(false);
  });

  it("allowlists only the handlers that accept tokens", () => {
    const id = "0a7fee8a-f879-419a-b94c-b6c0702efaa8";
    expect(tokenRouteAllowed("/api/deals", "GET")).toBe(true);
    expect(tokenRouteAllowed("/api/deals", "POST")).toBe(true);
    expect(tokenRouteAllowed(`/api/deals/${id}`, "PUT")).toBe(true);
    expect(tokenRouteAllowed(`/api/deals/${id}/`, "GET")).toBe(true);
    expect(tokenRouteAllowed(`/api/deals/${id}`, "DELETE")).toBe(false);
    expect(tokenRouteAllowed(`/api/scenarios/${id}`, "DELETE")).toBe(false);
    expect(tokenRouteAllowed(`/api/contacts/${id}`, "DELETE")).toBe(false);
    expect(tokenRouteAllowed("/api/deals/bulk-import", "POST")).toBe(false);
    expect(tokenRouteAllowed(`/api/export/${id}`, "GET")).toBe(false);
    expect(tokenRouteAllowed("/api/tokens", "POST")).toBe(false);
    expect(tokenRouteAllowed("/api/settings", "GET")).toBe(false);
    expect(tokenRouteAllowed("/api/team", "GET")).toBe(false);
    expect(tokenRouteAllowed("/api/share", "POST")).toBe(false);
    expect(tokenRouteAllowed(`/api/leads/${id}/approve`, "POST")).toBe(false);
    expect(tokenRouteAllowed("/api/search", "GET")).toBe(true);
  });
});
