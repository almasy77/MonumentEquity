import { describe, it, expect } from "vitest";
import {
  bearerToken,
  createApiToken,
  hashToken,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
  tokenKey,
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
});
