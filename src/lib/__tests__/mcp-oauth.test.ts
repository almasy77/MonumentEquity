import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeRedis } from "./helpers/fake-redis";
import { BRYAN, ORIGIN, REDIRECT, pkcePair, seedUser } from "./helpers/mcp-fixtures";

const h = vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "http://fake";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake";
  process.env.AUTH_SECRET = "test-secret-test-secret";
  process.env.MCP_PUBLIC_URL = "https://app.monumentequity.com";
  return { redis: null as unknown as FakeRedis, session: null as unknown };
});
vi.mock("@upstash/redis", async () => {
  const { FakeRedis } = await import("./helpers/fake-redis");
  h.redis = new FakeRedis();
  return { Redis: class { constructor() { return h.redis; } } };
});
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("@/lib/mcp/rate-limit", () => ({ allow: async () => true, clientIp: () => "1.2.3.4" }));

import { GET as asMeta } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as prMeta } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { POST as revoke } from "@/app/api/oauth/revoke/route";
import { POST as authorize } from "@/app/api/oauth/authorize/route";
import { GET as listGrantsRoute, DELETE as deleteGrant } from "@/app/api/oauth/grants/route";
import { signAuthorizeParams } from "@/lib/mcp/authorize-request";
import { verifyAccessToken, listGrants } from "@/lib/mcp/oauth-store";
import { NextRequest } from "next/server";

const req = (path: string, init?: RequestInit) =>
  new NextRequest(`${ORIGIN}${path}`, init as ConstructorParameters<typeof NextRequest>[1]);
const form = (data: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(data).toString(),
});

async function registerClient(redirect = REDIRECT) {
  const res = await register(
    req("/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect], token_endpoint_auth_method: "none" }),
    })
  );
  return { res, body: await res.json() };
}

/** Drive the consent POST as a signed-in user and return the redirect Location. */
async function approve(clientId: string, challenge: string, decision = "approve", state = "xyz") {
  h.session = { user: { id: BRYAN.id, email: BRYAN.email, role: "admin" } };
  const { request, sig } = signAuthorizeParams(BRYAN.id, {
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    state,
    resource: `${ORIGIN}/api/mcp`,
  });
  const res = await authorize(
    req("/api/oauth/authorize", { ...form({ request, sig, decision }), headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, host: "app.monumentequity.com" } })
  );
  return res;
}

async function fullLogin() {
  const { body: client } = await registerClient();
  const { verifier, challenge } = pkcePair();
  const res = await approve(client.client_id, challenge);
  const loc = new URL(res.headers.get("location")!);
  const code = loc.searchParams.get("code")!;
  const tokenRes = await token(
    req("/api/oauth/token", form({ grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${ORIGIN}/api/mcp` }))
  );
  return { client, verifier, code, tokenRes, tokens: await tokenRes.clone().json() };
}

beforeEach(async () => {
  h.redis.clear();
  h.session = null;
  await seedUser(h.redis, BRYAN);
});

describe("discovery metadata", () => {
  it("advertises PKCE-only public-client OAuth with every endpoint on the app origin", async () => {
    const m = await (await asMeta(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(m.issuer).toBe(ORIGIN);
    expect(m.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(m.token_endpoint).toBe(`${ORIGIN}/api/oauth/token`);
    expect(m.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("protected-resource metadata names the MCP URL and this server as the authorization server", async () => {
    const m = await (await prMeta(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`))).json();
    expect(m.resource).toBe(`${ORIGIN}/api/mcp`);
    expect(m.authorization_servers).toEqual([ORIGIN]);
  });
});

describe("dynamic client registration", () => {
  it("registers a claude.ai client as a public client", async () => {
    const { res, body } = await registerClient();
    expect(res.status).toBe(201);
    expect(body.client_id).toMatch(/^mec_/);
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  it.each([
    ["an attacker host", "https://evil.example.com/cb"],
    ["plain http", "http://claude.ai/cb"],
    ["loopback (not allowlisted by default)", "http://localhost:8080/cb"],
    ["a fragment", "https://claude.ai/cb#x"],
  ])("rejects a redirect_uri on %s", async (_n, uri) => {
    const { res, body } = await registerClient(uri);
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
  });
});

describe("authorization + token exchange", () => {
  it("completes the full code+PKCE flow and issues a working access token bound to the user", async () => {
    const { tokenRes, tokens } = await fullLogin();
    expect(tokenRes.status).toBe(200);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token).toMatch(/^mea_/);
    expect(tokens.refresh_token).toMatch(/^mer_/);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    const v = await verifyAccessToken(tokens.access_token);
    expect(v?.user_id).toBe(BRYAN.id);
  });

  it("returns the code to the registered redirect with state and iss", async () => {
    const { body: client } = await registerClient();
    const res = await approve(client.client_id, pkcePair().challenge, "approve", "st-123");
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("st-123");
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
    expect(loc.searchParams.get("code")).toMatch(/^mecode_/);
  });

  it("denying redirects with access_denied and issues no code or grant", async () => {
    const { body: client } = await registerClient();
    const res = await approve(client.client_id, pkcePair().challenge, "deny");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("code")).toBeNull();
    expect(await listGrants(BRYAN.id)).toHaveLength(0);
  });

  it("requires a signed-in session", async () => {
    const { body: client } = await registerClient();
    const { request, sig } = signAuthorizeParams(BRYAN.id, { client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: pkcePair().challenge });
    h.session = null;
    const res = await authorize(req("/api/oauth/authorize", { ...form({ request, sig, decision: "approve" }) }));
    expect(res.status).toBe(401);
  });

  it("rejects tampered parameters (signature is bound to the exact request and user)", async () => {
    const { body: client } = await registerClient();
    const { request, sig } = signAuthorizeParams(BRYAN.id, { client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: pkcePair().challenge });
    const forged = Buffer.from(JSON.stringify({ client_id: client.client_id, redirect_uri: "https://evil.example.com/cb", code_challenge: pkcePair().challenge })).toString("base64url");
    h.session = { user: { id: BRYAN.id, email: BRYAN.email, role: "admin" } };
    for (const body of [{ request: forged, sig }, { request, sig: "AAAA" }]) {
      const res = await authorize(req("/api/oauth/authorize", { ...form({ ...body, decision: "approve" }) }));
      expect(res.status).toBe(400);
    }
    // Another user's signature does not work for this session.
    const other = signAuthorizeParams("someone-else", { client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: pkcePair().challenge });
    const res = await authorize(req("/api/oauth/authorize", { ...form({ ...other, decision: "approve" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects a cross-origin consent POST", async () => {
    const { body: client } = await registerClient();
    const { request, sig } = signAuthorizeParams(BRYAN.id, { client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: pkcePair().challenge });
    h.session = { user: { id: BRYAN.id, email: BRYAN.email, role: "admin" } };
    const res = await authorize(
      req("/api/oauth/authorize", { ...form({ request, sig, decision: "approve" }), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example.com", host: "app.monumentequity.com" } })
    );
    expect(res.status).toBe(403);
  });

  it("rejects a wrong PKCE verifier, wrong redirect_uri, and a replayed code", async () => {
    const { body: client } = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = new URL((await approve(client.client_id, challenge)).headers.get("location")!).searchParams.get("code")!;
    const base = { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: REDIRECT };

    // The failed attempts burn the code (GETDEL), so test each against a fresh code.
    const bad1 = await token(req("/api/oauth/token", form({ ...base, code_verifier: pkcePair().verifier })));
    expect(bad1.status).toBe(400);
    expect((await bad1.json()).error).toBe("invalid_grant");

    const code2 = new URL((await approve(client.client_id, challenge)).headers.get("location")!).searchParams.get("code")!;
    const bad2 = await token(req("/api/oauth/token", form({ ...base, code: code2, redirect_uri: "https://claude.com/other", code_verifier: verifier })));
    expect(bad2.status).toBe(400);

    const code3 = new URL((await approve(client.client_id, challenge)).headers.get("location")!).searchParams.get("code")!;
    const good = await token(req("/api/oauth/token", form({ ...base, code: code3, code_verifier: verifier })));
    expect(good.status).toBe(200);
    const replay = await token(req("/api/oauth/token", form({ ...base, code: code3, code_verifier: verifier })));
    expect(replay.status).toBe(400);
  });

  it("rejects a code redeemed by a different client", async () => {
    const { body: a } = await registerClient();
    const { body: b } = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = new URL((await approve(a.client_id, challenge)).headers.get("location")!).searchParams.get("code")!;
    const res = await token(req("/api/oauth/token", form({ grant_type: "authorization_code", client_id: b.client_id, code, redirect_uri: REDIRECT, code_verifier: verifier })));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown resource indicator", async () => {
    const { body: client } = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = new URL((await approve(client.client_id, challenge)).headers.get("location")!).searchParams.get("code")!;
    const res = await token(req("/api/oauth/token", form({ grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: REDIRECT, code_verifier: verifier, resource: "https://evil.example.com/api/mcp" })));
    expect(res.status).toBe(400);
  });

  it("rejects unsupported grant types and unknown clients", async () => {
    const { body: client } = await registerClient();
    const pw = await token(req("/api/oauth/token", form({ grant_type: "password", client_id: client.client_id })));
    expect((await pw.json()).error).toBe("unsupported_grant_type");
    const unknown = await token(req("/api/oauth/token", form({ grant_type: "refresh_token", client_id: "nope", refresh_token: "x" })));
    expect(unknown.status).toBe(401);
  });
});

describe("refresh tokens", () => {
  it("rotates: the new pair works, the old refresh token does not", async () => {
    const { client, tokens } = await fullLogin();
    const r = await token(req("/api/oauth/token", form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token })));
    expect(r.status).toBe(200);
    const next = await r.json();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(await verifyAccessToken(next.access_token)).not.toBeNull();

    const replay = await token(req("/api/oauth/token", form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token })));
    expect(replay.status).toBe(400);
    // A near-immediate replay is treated as a client race: the rotated pair keeps working.
    expect(await verifyAccessToken(next.access_token)).not.toBeNull();
  });

  it("a LATE replay of a rotated refresh token is treated as theft and revokes the grant", async () => {
    const { client, tokens } = await fullLogin();
    const r = await token(req("/api/oauth/token", form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token })));
    const next = await r.json();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    const replay = await token(req("/api/oauth/token", form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token })));
    vi.useRealTimers();
    expect(replay.status).toBe(400);
    expect(await verifyAccessToken(next.access_token)).toBeNull();
  });

  it("refuses a refresh token presented by a different client (and revokes)", async () => {
    const { tokens } = await fullLogin();
    const { body: other } = await registerClient();
    const r = await token(req("/api/oauth/token", form({ grant_type: "refresh_token", client_id: other.client_id, refresh_token: tokens.refresh_token })));
    expect(r.status).toBe(400);
    expect(await verifyAccessToken(tokens.access_token)).toBeNull();
  });
});

describe("revocation", () => {
  it("revoking a grant from the app kills its access token immediately", async () => {
    const { tokens } = await fullLogin();
    expect(await verifyAccessToken(tokens.access_token)).not.toBeNull();

    h.session = { user: { id: BRYAN.id, email: BRYAN.email, role: "admin" } };
    const list = await (await listGrantsRoute()).json();
    expect(list).toHaveLength(1);
    expect(list[0].client_name).toBe("Claude");
    const del = await deleteGrant(req(`/api/oauth/grants?id=${list[0].id}`, { method: "DELETE" }));
    expect(del.status).toBe(200);
    expect(await verifyAccessToken(tokens.access_token)).toBeNull();
  });

  it("revoke-all removes every grant for the user", async () => {
    await fullLogin();
    await fullLogin();
    h.session = { user: { id: BRYAN.id, email: BRYAN.email, role: "admin" } };
    const res = await deleteGrant(req("/api/oauth/grants?all=1", { method: "DELETE" }));
    expect((await res.json()).revoked).toBe(2);
    expect(await listGrants(BRYAN.id)).toHaveLength(0);
  });

  it("another user cannot revoke your grant", async () => {
    const { tokens } = await fullLogin();
    const [g] = await listGrants(BRYAN.id);
    h.session = { user: { id: "someone-else", email: "x@y.z", role: "admin" } };
    const res = await deleteGrant(req(`/api/oauth/grants?id=${g.id}`, { method: "DELETE" }));
    expect(res.status).toBe(404);
    expect(await verifyAccessToken(tokens.access_token)).not.toBeNull();
  });

  it("grants endpoints require a session", async () => {
    h.session = null;
    expect((await listGrantsRoute()).status).toBe(401);
    expect((await deleteGrant(req("/api/oauth/grants?all=1", { method: "DELETE" }))).status).toBe(401);
  });

  it("RFC 7009 revoke endpoint revokes the grant for the owning client only", async () => {
    const { client, tokens } = await fullLogin();
    const { body: other } = await registerClient();
    await revoke(req("/api/oauth/revoke", form({ token: tokens.access_token, client_id: other.client_id })));
    expect(await verifyAccessToken(tokens.access_token)).not.toBeNull();
    const res = await revoke(req("/api/oauth/revoke", form({ token: tokens.refresh_token, client_id: client.client_id })));
    expect(res.status).toBe(200);
    expect(await verifyAccessToken(tokens.access_token)).toBeNull();
  });

  it("stores only hashes: no raw token appears in Redis", async () => {
    const { tokens, code } = await fullLogin();
    const dump = JSON.stringify([...h.redis.kv.entries()]);
    for (const secret of [tokens.access_token, tokens.refresh_token, code]) expect(dump).not.toContain(secret);
  });
});

describe("kill switch", () => {
  it("MCP_DISABLED=1 stops registration, token issuance and discovery", async () => {
    process.env.MCP_DISABLED = "1";
    try {
      expect((await registerClient()).res.status).toBe(503);
      expect((await token(req("/api/oauth/token", form({ grant_type: "refresh_token", client_id: "x" })))).status).toBe(503);
      expect((await asMeta(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).status).toBe(503);
    } finally {
      delete process.env.MCP_DISABLED;
    }
  });
});

describe("resource indicator handling (regression: consent page showed 'Unknown resource')", () => {
  const params = async (resource?: string) => {
    const { body: client } = await registerClient();
    return { client_id: client.client_id, redirect_uri: REDIRECT, response_type: "code", code_challenge: pkcePair().challenge, code_challenge_method: "S256", ...(resource ? { resource } : {}) };
  };
  const hostReq = () => new Request("https://placeholder.invalid/x", { headers: { host: "app.monumentequity.com" } });

  it.each([
    ["the canonical MCP URL", `${ORIGIN}/api/mcp`],
    ["a trailing slash", `${ORIGIN}/api/mcp/`],
    ["the bare origin", ORIGIN],
    ["different host casing", "https://App.MonumentEquity.com/api/mcp"],
    ["no resource at all", undefined],
  ])("accepts %s", async (_n, resource) => {
    const { validateAuthorizeRequest } = await import("@/lib/mcp/authorize-request");
    expect((await validateAuthorizeRequest(await params(resource))).ok).toBe(true);
  });

  it.each([["another host", "https://evil.example.com/api/mcp"], ["another path", `${ORIGIN}/api/other`], ["junk", "not a url"]])(
    "rejects %s",
    async (_n, resource) => {
      const { validateAuthorizeRequest } = await import("@/lib/mcp/authorize-request");
      const r = await validateAuthorizeRequest(await params(resource));
      expect(r.ok).toBe(false);
    }
  );

  it("resolves the origin from the request host when MCP_PUBLIC_URL/NEXTAUTH_URL are unset (the consent page case)", async () => {
    const { validateAuthorizeRequest } = await import("@/lib/mcp/authorize-request");
    const saved = process.env.MCP_PUBLIC_URL;
    delete process.env.MCP_PUBLIC_URL;
    delete process.env.NEXTAUTH_URL;
    try {
      const p = await params(`${ORIGIN}/api/mcp`);
      expect((await validateAuthorizeRequest(p, hostReq())).ok).toBe(true);
      // Without the request it can only guess localhost, which is exactly the bug.
      expect((await validateAuthorizeRequest(p)).ok).toBe(false);
    } finally {
      process.env.MCP_PUBLIC_URL = saved;
    }
  });

  it("token exchange accepts an equivalent resource spelling and still binds the token to the canonical audience", async () => {
    const { body: client } = await registerClient();
    const { verifier, challenge } = pkcePair();
    const code = new URL((await approve(client.client_id, challenge)).headers.get("location")!).searchParams.get("code")!;
    const res = await token(req("/api/oauth/token", form({ grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${ORIGIN}/api/mcp/` })));
    expect(res.status).toBe(200);
    const v = await verifyAccessToken((await res.json()).access_token);
    expect(v?.resource).toBe(`${ORIGIN}/api/mcp`);
  });
});
