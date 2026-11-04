/* eslint-disable @typescript-eslint/no-explicit-any -- test harness pokes at untyped JSON-RPC / OAuth payloads */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeRedis } from "./helpers/fake-redis";
import { BRYAN, OTHER, ORIGIN, REDIRECT, pkcePair, seedDeal, seedUser } from "./helpers/mcp-fixtures";

const h = vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "http://fake";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake";
  process.env.AUTH_SECRET = "test-secret-test-secret";
  process.env.MCP_PUBLIC_URL = "https://app.monumentequity.com";
  return { redis: null as unknown as FakeRedis };
});
vi.mock("@upstash/redis", async () => {
  const { FakeRedis } = await import("./helpers/fake-redis");
  h.redis = new FakeRedis();
  return { Redis: class { constructor() { return h.redis; } } };
});
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/mcp/rate-limit", () => ({ allow: async () => true, clientIp: () => "1.2.3.4" }));

import { POST, GET, DELETE } from "@/app/api/mcp/route";
import { TOOLS, TOOL_NAMES } from "@/lib/mcp/tools";
import {
  exchangeAuthorizationCode,
  issueAuthorizationCode,
  registerClient,
  revokeAllGrants,
} from "@/lib/mcp/oauth-store";
import { logActivity } from "@/lib/activity";

// ─── harness ────────────────────────────────────────────────

async function mintToken(userId: string): Promise<string> {
  const client = await registerClient({ client_name: "Claude", redirect_uris: [REDIRECT] });
  const { verifier, challenge } = pkcePair();
  const code = await issueAuthorizationCode({
    client,
    user_id: userId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    resource: `${ORIGIN}/api/mcp`,
  });
  const t = await exchangeAuthorizationCode({
    code,
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
    expectedResource: `${ORIGIN}/api/mcp`,
  });
  return t.access_token;
}

function mcpRequest(method: string, params: unknown, token?: string, verb = "POST") {
  return new Request(`${ORIGIN}/api/mcp`, {
    method: verb,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: verb === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) : undefined,
  });
}

async function rpc(token: string, method: string, params: unknown = {}) {
  const res = await POST(mcpRequest(method, params, token));
  return { res, body: (await res.json()) as any };
}

async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  if (body.error) return { isError: true, protocolError: body.error.message as string, data: null as any };
  const r = body.result;
  const text: string = r.content[0].text;
  // Tool-level errors are JSON {error:{code,message}}; schema-validation failures are
  // rejected by the SDK before the tool runs, as plain text ("Input validation error: ...").
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: { code: "invalid_input", message: text } };
  }
  return { isError: !!r.isError, data, protocolError: null };
}

const UNIT_MIX = [
  { type: "2BR/1BA", count: 8, current_rent: 1100, market_rent: 1250, renovated_rent_premium: 150 },
  { type: "1BR/1BA", count: 4, current_rent: 900, market_rent: 1000, renovated_rent_premium: 100 },
];

let bryan: string;
let other: string;

beforeEach(async () => {
  h.redis.clear();
  await seedUser(h.redis, BRYAN);
  await seedUser(h.redis, OTHER);
  bryan = await mintToken(BRYAN.id);
  other = await mintToken(OTHER.id);
});

// ─── auth ───────────────────────────────────────────────────

describe("/api/mcp authentication", () => {
  it("no token → 401 with a WWW-Authenticate challenge pointing at the resource metadata", async () => {
    const res = await POST(mcpRequest("tools/list", {}));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate")!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
  });

  it("GET and DELETE without a token are also 401 (never reach the handler)", async () => {
    expect((await GET(mcpRequest("", {}, undefined, "GET"))).status).toBe(401);
    expect((await DELETE(mcpRequest("", {}, undefined, "DELETE"))).status).toBe(401);
  });

  it.each([
    ["garbage", "not-a-token"],
    ["right shape, unknown value", "mea_" + "A".repeat(43)],
    ["a refresh token used as an access token", "mer_" + "A".repeat(43)],
  ])("%s → 401 invalid_token", async (_n, tok) => {
    const res = await POST(mcpRequest("tools/list", {}, tok));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("a revoked grant stops working immediately", async () => {
    expect((await rpc(bryan, "tools/list")).res.status).toBe(200);
    await revokeAllGrants(BRYAN.id);
    expect((await POST(mcpRequest("tools/list", {}, bryan))).status).toBe(401);
  });

  it("a deleted user's token stops working", async () => {
    await h.redis.del(`user:${BRYAN.id}`);
    expect((await POST(mcpRequest("tools/list", {}, bryan))).status).toBe(401);
  });

  it("a token minted for a different audience is rejected", async () => {
    process.env.MCP_PUBLIC_URL = "https://other.example.com";
    try {
      expect((await POST(mcpRequest("tools/list", {}, bryan))).status).toBe(401);
    } finally {
      process.env.MCP_PUBLIC_URL = ORIGIN;
    }
  });

  it("MCP_DISABLED=1 turns the endpoint off even with a valid token", async () => {
    process.env.MCP_DISABLED = "1";
    try {
      expect((await POST(mcpRequest("tools/list", {}, bryan))).status).toBe(503);
    } finally {
      delete process.env.MCP_DISABLED;
    }
  });

  it("authenticated GET/DELETE get 405 (stateless server, no streams or sessions)", async () => {
    expect((await GET(mcpRequest("", {}, bryan, "GET"))).status).toBe(405);
    expect((await DELETE(mcpRequest("", {}, bryan, "DELETE"))).status).toBe(405);
  });
});

// ─── protocol ───────────────────────────────────────────────

describe("MCP protocol", () => {
  it("initialize returns server info and instructions", async () => {
    const { body } = await rpc(bryan, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(body.result.serverInfo.name).toBe("monument-equity");
    expect(body.result.instructions).toMatch(/no delete tool/i);
  });

  it("tools/list exposes the ten documented tools with input schemas", async () => {
    const { body } = await rpc(bryan, "tools/list");
    const names = body.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(
      [
        "create_deal", "create_scenario", "get_deal", "get_deal_activity", "get_scenario",
        "list_deals", "list_scenarios", "pass_deal", "reactivate_deal", "update_deal", "update_scenario",
      ].sort()
    );
    for (const t of body.result.tools) expect(t.inputSchema.type).toBe("object");
  });
});

// ─── no-delete rule ─────────────────────────────────────────

describe("hard limit: nothing can be deleted or marked dead", () => {
  it("no tool is named or described like a delete/remove/kill/archive operation", () => {
    for (const t of TOOLS) {
      expect(t.name).not.toMatch(/delete|remove|destroy|purge|drop|kill|dead|archive|erase|wipe/i);
      expect(t.annotations.destructiveHint).toBe(false);
    }
  });

  it("the tool source never calls a Redis delete or imports a delete helper", () => {
    for (const f of ["tools.ts", "server.ts", "auth.ts", "../deal-service.ts", "../scenario-service.ts"]) {
      const src = readFileSync(join(__dirname, "../mcp", f), "utf8");
      expect(src, f).not.toMatch(/\.del\(|deleteEntity|DELETE FROM|unlink\(/);
    }
    // Only status index maintenance (pass/reactivate) may remove an INDEX entry; check the deal-service
    // never writes the "dead" status.
    const dealSvc = readFileSync(join(__dirname, "../deal-service.ts"), "utf8");
    expect(dealSvc).not.toMatch(/status:\s*"dead"/);
  });

  it("running every tool against real data deletes no deal, scenario, or activity key", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const created = (await call(bryan, "create_scenario", { deal_id: deal.id, revenue_assumptions: { unit_mix: UNIT_MIX } })).data;
    const sid = created.scenario.id;
    await call(bryan, "list_deals", { include_archived: true });
    await call(bryan, "get_deal", { deal_id: deal.id });
    await call(bryan, "update_deal", { deal_id: deal.id, fields: { market_notes: "x" } });
    await call(bryan, "list_scenarios", { deal_id: deal.id });
    await call(bryan, "get_scenario", { scenario_id: sid });
    await call(bryan, "update_scenario", { scenario_id: sid, notes: "n" });
    await call(bryan, "pass_deal", { deal_id: deal.id, reason: "testing pass" });
    await call(bryan, "reactivate_deal", { deal_id: deal.id });
    await call(bryan, "get_deal_activity", { deal_id: deal.id });
    await call(bryan, "create_deal", { address: "9 New Rd", city: "Pittsburgh", state: "PA", units: 6, asking_price: 600000, source: "Broker" });

    const touched = h.redis.deleted.filter((k) => /^(deal|scenario|scenario_version|activity|task|checklist|contact):/.test(k));
    expect(touched).toEqual([]);
    expect(await h.redis.get(`deal:${deal.id}`)).not.toBeNull();
    expect(await h.redis.get(`scenario:${sid}`)).not.toBeNull();
  });

  it("status can't be set to dead through any tool argument", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    for (const fields of [{ status: "dead" }, { stage: "closed" }, { kill_reason: "x" }, { pass_reason: "x" }, { user_id: OTHER.id }]) {
      const r = await call(bryan, "update_deal", { deal_id: deal.id, fields });
      expect(r.isError).toBe(true);
    }
    const r = await call(bryan, "pass_deal", { deal_id: deal.id, reason: "ok reason", status: "dead" });
    expect((await h.redis.get<any>(`deal:${deal.id}`))!.status).toBe(r.isError ? "active" : "passed");
    expect((await h.redis.get<any>(`deal:${deal.id}`))!.status).not.toBe("dead");
  });
});

// ─── row scoping ────────────────────────────────────────────

describe("row scoping: every tool treats another user's rows as missing", () => {
  let theirs: Record<string, any>;
  let theirScenario: string;
  beforeEach(async () => {
    theirs = await seedDeal(h.redis, OTHER.id, { address: "500 Their St" });
    theirScenario = (await call(other, "create_scenario", { deal_id: theirs.id })).data.scenario.id;
  });

  it.each([
    ["get_deal", () => ({ deal_id: theirs.id })],
    ["update_deal", () => ({ deal_id: theirs.id, fields: { market_notes: "hijack" } })],
    ["pass_deal", () => ({ deal_id: theirs.id, reason: "hijack pass" })],
    ["reactivate_deal", () => ({ deal_id: theirs.id })],
    ["list_scenarios", () => ({ deal_id: theirs.id })],
    ["create_scenario", () => ({ deal_id: theirs.id })],
    ["get_scenario", () => ({ scenario_id: theirScenario })],
    ["update_scenario", () => ({ scenario_id: theirScenario, notes: "hijack" })],
    ["get_deal_activity", () => ({ deal_id: theirs.id })],
  ])("%s → not_found (indistinguishable from a missing id)", async (tool, args) => {
    const r = await call(bryan, tool, args());
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("not_found");
    const missing = await call(bryan, tool, JSON.parse(JSON.stringify(args()).replaceAll(theirs.id, "nope").replaceAll(theirScenario, "nope")));
    expect(missing.data.error).toEqual(r.data.error);
  });

  it("leaves their data untouched after all those attempts", async () => {
    await call(bryan, "update_deal", { deal_id: theirs.id, fields: { market_notes: "hijack" } });
    await call(bryan, "update_scenario", { scenario_id: theirScenario, notes: "hijack" });
    expect((await h.redis.get<any>(`deal:${theirs.id}`))!.market_notes).toBeUndefined();
    expect((await h.redis.get<any>(`scenario:${theirScenario}`))!.notes).toBeUndefined();
  });

  it("list_deals shows only your own deals, active and archived", async () => {
    const mine = await seedDeal(h.redis, BRYAN.id, { address: "1 My St" });
    const myPassed = await seedDeal(h.redis, BRYAN.id, { address: "2 My St", status: "passed", pass_reason: "too small" });
    await seedDeal(h.redis, OTHER.id, { address: "3 Their St", status: "dead" });

    const active = (await call(bryan, "list_deals")).data;
    expect(active.deals.map((d: any) => d.id)).toEqual([mine.id]);

    const all = (await call(bryan, "list_deals", { include_archived: true })).data;
    expect(all.deals.map((d: any) => d.id).sort()).toEqual([mine.id, myPassed.id].sort());
    expect(all.deals.find((d: any) => d.id === myPassed.id).pass_reason).toBe("too small");
  });
});

// ─── tool behaviour ─────────────────────────────────────────

describe("read tools", () => {
  it("list_deals returns the documented summary fields", async () => {
    await seedDeal(h.redis, BRYAN.id, { bid_price: 1_100_000 });
    const [d] = (await call(bryan, "list_deals")).data.deals;
    expect(Object.keys(d).sort()).toEqual(
      ["address", "asking_price", "bid_price", "city", "id", "last_activity_at", "source", "stage", "state", "status", "units", "updated_at"].sort()
    );
  });

  it("get_deal returns every field plus the deal's scenario ids", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { market_notes: "Notes here", owner_name: "Acme LLC", pass_reason: "n/a" });
    const s1 = (await call(bryan, "create_scenario", { deal_id: deal.id, name: "Base Case" })).data.scenario;
    const s2 = (await call(bryan, "create_scenario", { deal_id: deal.id, name: "Downside", type: "downside" })).data.scenario;
    const { deal: got, scenarios } = (await call(bryan, "get_deal", { deal_id: deal.id })).data;
    expect(got.market_notes).toBe("Notes here");
    expect(got.owner_name).toBe("Acme LLC");
    expect(scenarios.map((s: any) => s.id).sort()).toEqual([s1.id, s2.id].sort());
    expect(scenarios[0]).toHaveProperty("calculated_metrics");
  });

  it("get_scenario returns the scenario plus metrics and annual, without the heavy grids", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const { scenario } = (await call(bryan, "create_scenario", { deal_id: deal.id, revenue_assumptions: { unit_mix: UNIT_MIX } })).data;
    const r = (await call(bryan, "get_scenario", { scenario_id: scenario.id })).data;
    expect(r.scenario.id).toBe(scenario.id);
    expect(r.underwriting.metrics).toBeDefined();
    expect(Array.isArray(r.underwriting.annual)).toBe(true);
    expect(r.underwriting.annual.length).toBeGreaterThan(0);
    expect(r.underwriting.monthly).toBeUndefined();
    expect(r.underwriting.sensitivity).toBeUndefined();
    const full = (await call(bryan, "get_scenario", { scenario_id: scenario.id, include_monthly: true, include_sensitivity: true })).data;
    expect(full.underwriting.monthly.length).toBeGreaterThan(0);
  });
});

describe("create_deal", () => {
  const input = { address: "9 New Rd", city: "Pittsburgh", state: "PA", units: 6, asking_price: 600000, source: "Crexi", market_notes: "from saved search" };

  it("creates an indexed, owned, attributed deal", async () => {
    const { deal } = (await call(bryan, "create_deal", input)).data;
    expect(deal.user_id).toBe(BRYAN.id);
    expect(deal.status).toBe("active");
    expect(deal.stage).toBe("lead");
    expect(deal.updated_via).toBe("connector");
    expect((await call(bryan, "list_deals")).data.deals.map((d: any) => d.id)).toContain(deal.id);
    const act = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events;
    expect(act[0]).toMatchObject({ action: "deal_created", actor: "connector", user_id: BRYAN.id });
  });

  it("refuses a duplicate address unless allow_duplicate is set", async () => {
    const first = (await call(bryan, "create_deal", input)).data.deal;
    const dup = await call(bryan, "create_deal", { ...input, address: "9  NEW Rd." });
    expect(dup.isError).toBe(true);
    expect(dup.data.error).toMatchObject({ code: "conflict", existing_deal_id: first.id });
    expect((await call(bryan, "create_deal", { ...input, allow_duplicate: true })).isError).toBe(false);
  });

  it("validates inputs (bad source, non-positive price)", async () => {
    expect((await call(bryan, "create_deal", { ...input, source: "Facebook" })).isError).toBe(true);
    expect((await call(bryan, "create_deal", { ...input, asking_price: 0 })).isError).toBe(true);
  });
});

describe("update_deal", () => {
  it("changes a harmless field, logs it as the connector, and reverts cleanly", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const a = (await call(bryan, "update_deal", { deal_id: deal.id, fields: { market_notes: "smoke test" } })).data;
    expect(a.changed_fields).toEqual(["market_notes"]);
    expect(a.deal.market_notes).toBe("smoke test");
    expect(a.deal.updated_by).toBe(BRYAN.id);
    expect(a.deal.updated_via).toBe("connector");
    expect(a.deal.user_id).toBe(BRYAN.id);

    const b = (await call(bryan, "update_deal", { deal_id: deal.id, fields: { market_notes: null } })).data;
    expect(b.deal.market_notes).toBeUndefined();

    const events = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events;
    expect(events.filter((e: any) => e.action === "deal_updated").map((e: any) => e.actor)).toEqual(["connector", "connector"]);
    expect(events[0].details.fields).toEqual(["market_notes"]);
  });

  it("is a merge: unrelated fields are untouched, and a no-op writes no activity", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { owner_name: "Keep Me LLC" });
    await call(bryan, "update_deal", { deal_id: deal.id, fields: { county: "Allegheny" } });
    const got = (await call(bryan, "get_deal", { deal_id: deal.id })).data.deal;
    expect(got.owner_name).toBe("Keep Me LLC");
    expect(got.county).toBe("Allegheny");
    const noop = (await call(bryan, "update_deal", { deal_id: deal.id, fields: { county: "Allegheny" } })).data;
    expect(noop.changed_fields).toEqual([]);
    const events = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events;
    expect(events.filter((e: any) => e.action === "deal_updated")).toHaveLength(1);
  });

  it("rejects a percent-style occupancy (the source of the -89 vacancy bug)", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const r = await call(bryan, "update_deal", { deal_id: deal.id, fields: { current_occupancy: 92 } });
    expect(r.isError).toBe(true);
    expect(r.data.error.message).toMatch(/fraction/);
    expect((await call(bryan, "update_deal", { deal_id: deal.id, fields: { current_occupancy: 0.92 } })).isError).toBe(false);
  });

  it("does not let you change identity, stage, status or file fields", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    for (const fields of [{ id: "x" }, { user_id: OTHER.id }, { stage: "loi" }, { status: "passed" }, { files: [] }, { photos: [] }, { contact_ids: [] }]) {
      expect((await call(bryan, "update_deal", { deal_id: deal.id, fields })).isError, JSON.stringify(fields)).toBe(true);
    }
    const after = await h.redis.get<any>(`deal:${deal.id}`);
    expect(after.user_id).toBe(BRYAN.id);
    expect(after.status).toBe("active");
  });
});

describe("pass_deal / reactivate_deal", () => {
  it("passes with the supplied reason, leaves the active list, and logs a status change", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const r = await call(bryan, "pass_deal", { deal_id: deal.id, reason: "Seller won't move off ask; DSCR 0.92" });
    expect(r.data.deal).toMatchObject({ status: "passed" });

    const stored = await h.redis.get<any>(`deal:${deal.id}`);
    expect(stored.pass_reason).toBe("Seller won't move off ask; DSCR 0.92");
    expect(stored.updated_via).toBe("connector");
    expect((await call(bryan, "list_deals")).data.count).toBe(0);
    expect(await h.redis.zrange("deals:active", 0, -1)).not.toContain(deal.id);
    expect(await h.redis.zrange("deals:by_stage:lead", 0, -1)).not.toContain(deal.id);

    const ev = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events[0];
    expect(ev).toMatchObject({ action: "status_changed", actor: "connector" });
    expect(ev.details).toMatchObject({ old_status: "active", new_status: "passed", reason: "Seller won't move off ask; DSCR 0.92" });
  });

  it("requires a real reason", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    expect((await call(bryan, "pass_deal", { deal_id: deal.id, reason: "" })).isError).toBe(true);
    expect((await call(bryan, "pass_deal", { deal_id: deal.id, reason: "  " })).isError).toBe(true);
    expect((await call(bryan, "pass_deal", { deal_id: deal.id })).isError).toBe(true);
  });

  it("reactivating clears the old pass/kill reason from the record but keeps it in the activity history", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { kill_reason: "Marked dead" });
    await call(bryan, "pass_deal", { deal_id: deal.id, reason: "DSCR 0.92 at ask" });
    await call(bryan, "reactivate_deal", { deal_id: deal.id });
    const stored = await h.redis.get<any>(`deal:${deal.id}`);
    expect(stored.status).toBe("active");
    expect(stored.pass_reason).toBeUndefined();
    expect(stored.kill_reason).toBeUndefined();
    const events = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events;
    expect(events.find((e: any) => e.details?.new_status === "passed").details.reason).toBe("DSCR 0.92 at ask");
  });

  it("reactivate on an ACTIVE deal with stale reasons cleans them (fixes records reactivated before this change)", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { kill_reason: "Marked dead", pass_reason: "Passed on deal", market_notes: "keep me" });
    const r = await call(bryan, "reactivate_deal", { deal_id: deal.id });
    expect(r.isError).toBe(false);
    expect(r.data.cleared_stale_fields.sort()).toEqual(["kill_reason", "pass_reason"]);
    const stored = await h.redis.get<any>(`deal:${deal.id}`);
    expect(stored).toMatchObject({ status: "active", stage: "lead", market_notes: "keep me", updated_via: "connector" });
    expect(stored.pass_reason).toBeUndefined();
    expect(stored.kill_reason).toBeUndefined();
    // still in the active list and index, untouched
    expect((await call(bryan, "list_deals")).data.deals.map((d: any) => d.id)).toContain(deal.id);
    const ev = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events[0];
    expect(ev).toMatchObject({ action: "deal_updated", actor: "connector" });
    expect(ev.details.fields.sort()).toEqual(["kill_reason", "pass_reason"]);
    // a second call has nothing to clean
    expect((await call(bryan, "reactivate_deal", { deal_id: deal.id })).data.error.code).toBe("conflict");
  });

  it("reactivate restores the deal to the active list and stage index; passing twice is a conflict", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    await call(bryan, "pass_deal", { deal_id: deal.id, reason: "first pass" });
    expect((await call(bryan, "pass_deal", { deal_id: deal.id, reason: "second pass" })).data.error.code).toBe("conflict");
    expect((await call(bryan, "reactivate_deal", { deal_id: deal.id })).isError).toBe(false);
    expect((await call(bryan, "list_deals")).data.deals.map((d: any) => d.id)).toEqual([deal.id]);
    expect(await h.redis.zrange("deals:by_stage:lead", 0, -1)).toContain(deal.id);
    expect((await call(bryan, "reactivate_deal", { deal_id: deal.id })).data.error.code).toBe("conflict");
  });
});

describe("scenarios", () => {
  it("create_scenario builds from the deal, applies type presets and returns metrics", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const r = (await call(bryan, "create_scenario", { deal_id: deal.id, name: "Downside", type: "downside", revenue_assumptions: { unit_mix: UNIT_MIX } })).data;
    expect(r.scenario).toMatchObject({ name: "Downside", type: "downside", deal_id: deal.id, updated_via: "connector", updated_by: BRYAN.id });
    expect(r.scenario.revenue_assumptions.vacancy_rate).toBe(0.10); // downside preset
    expect(Number.isFinite(r.calculated_metrics.going_in_cap)).toBe(true);
    const ev = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events[0];
    expect(ev).toMatchObject({ action: "scenario_created", actor: "connector" });
  });

  it("a deal with percent-style occupancy no longer produces a negative vacancy rate", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { current_occupancy: 90 });
    const r = (await call(bryan, "create_scenario", { deal_id: deal.id })).data;
    expect(r.scenario.revenue_assumptions.vacancy_rate).toBeCloseTo(0.1, 6);
  });

  it("other_income_items become one engine line per income source", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const { scenario } = (await call(bryan, "create_scenario", {
      deal_id: deal.id,
      revenue_assumptions: { unit_mix: UNIT_MIX },
      other_income_items: [
        { label: "Laundry", monthly: 400 },
        { label: "Parking", monthly: 250 },
        { label: "Pet rent", monthly: 120.5, recurring: false },
      ],
    })).data;
    const rev = scenario.revenue_assumptions;
    expect(rev.other_income.line_items.map((l: any) => [l.label, l.kind, l.monthly_amount, l.recurring])).toEqual([
      ["Laundry", "flat", 400, true],
      ["Parking", "flat", 250, true],
      ["Pet rent", "flat", 120.5, false],
    ]);
    expect(rev.other_income_monthly).toBeCloseTo(770.5, 6);

    // ...and the engine actually uses them: year-1 other income reflects the items.
    const uw = (await call(bryan, "get_scenario", { scenario_id: scenario.id })).data.underwriting;
    expect(uw.annual[0].other_income).toBeGreaterThan(0);
    const without = (await call(bryan, "create_scenario", { deal_id: deal.id, revenue_assumptions: { unit_mix: UNIT_MIX, other_income_monthly: 0 } })).data.scenario;
    const base = (await call(bryan, "get_scenario", { scenario_id: without.id })).data.underwriting;
    expect(uw.annual[0].other_income - base.annual[0].other_income).toBeGreaterThan(5000);
  });

  it("update_scenario shallow-merges sections (keeps unit_mix), versions the prior state and attributes the edit", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const { scenario } = (await call(bryan, "create_scenario", { deal_id: deal.id, revenue_assumptions: { unit_mix: UNIT_MIX } })).data;

    const r = (await call(bryan, "update_scenario", { scenario_id: scenario.id, revenue_assumptions: { vacancy_rate: 0.06 }, notes: "tightened vacancy" })).data;
    expect(r.scenario.revenue_assumptions.vacancy_rate).toBe(0.06);
    expect(r.scenario.revenue_assumptions.unit_mix).toEqual(UNIT_MIX);
    expect(r.scenario.version).toBe(2);
    expect(r.scenario).toMatchObject({ updated_by: BRYAN.id, updated_via: "connector", notes: "tightened vacancy" });
    expect(await h.redis.get(`scenario_version:${scenario.id}:1`)).not.toBeNull();
    expect(r.calculated_metrics).toBeDefined();

    // Replacing an array replaces it whole.
    const r2 = (await call(bryan, "update_scenario", { scenario_id: scenario.id, revenue_assumptions: { unit_mix: [UNIT_MIX[0]] } })).data;
    expect(r2.scenario.revenue_assumptions.unit_mix).toHaveLength(1);
    expect(r2.scenario.revenue_assumptions.vacancy_rate).toBe(0.06);

    const ev = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events[0];
    expect(ev).toMatchObject({ action: "scenario_updated", actor: "connector" });
  });

  it("update_scenario with other_income_items replaces the itemized lines", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const { scenario } = (await call(bryan, "create_scenario", { deal_id: deal.id, other_income_items: [{ label: "Laundry", monthly: 300 }] })).data;
    const r = (await call(bryan, "update_scenario", { scenario_id: scenario.id, other_income_items: [{ label: "Parking", monthly: 100 }, { label: "Storage", monthly: 50 }] })).data;
    expect(r.scenario.revenue_assumptions.other_income.line_items.map((l: any) => l.label)).toEqual(["Parking", "Storage"]);
    expect(r.scenario.revenue_assumptions.other_income_monthly).toBe(150);
  });

  it("the deal-level bid stays in sync, exactly as when edited in the UI", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const { scenario } = (await call(bryan, "create_scenario", { deal_id: deal.id })).data;
    await call(bryan, "update_scenario", { scenario_id: scenario.id, purchase_assumptions: { bid_price: 1_050_000 } });
    expect((await h.redis.get<any>(`deal:${deal.id}`))!.bid_price).toBe(1_050_000);
  });
});

describe("get_deal_activity", () => {
  it("returns newest-first events with exact timestamps, honours limit and since, and labels legacy rows 'web'", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    await logActivity({ deal_id: deal.id, action: "stage_changed", entity_type: "deal", entity_id: deal.id, user_id: BRYAN.id });
    await new Promise((r) => setTimeout(r, 15));
    const cutoff = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 15));
    await call(bryan, "update_deal", { deal_id: deal.id, fields: { county: "Allegheny" } });

    const all = (await call(bryan, "get_deal_activity", { deal_id: deal.id })).data.events;
    expect(all.map((e: any) => e.action)).toEqual(["deal_updated", "stage_changed"]);
    expect(all[0].timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(all.map((e: any) => e.actor)).toEqual(["connector", "web"]);

    expect((await call(bryan, "get_deal_activity", { deal_id: deal.id, limit: 1 })).data.events).toHaveLength(1);
    const since = (await call(bryan, "get_deal_activity", { deal_id: deal.id, since: cutoff })).data.events;
    expect(since.map((e: any) => e.action)).toEqual(["deal_updated"]);
  });
});

describe("roles", () => {
  it("a viewer can read but every write is forbidden", async () => {
    const viewer = { id: "33333333-3333-4333-8333-333333333333", email: "v@example.com", role: "viewer" };
    await seedUser(h.redis, viewer);
    const tok = await mintToken(viewer.id);
    const deal = await seedDeal(h.redis, viewer.id);
    const sc = (await call(bryan, "list_deals")).data; // sanity: bryan unaffected
    expect(sc.count).toBe(0);

    expect((await call(tok, "list_deals")).data.count).toBe(1);
    expect((await call(tok, "get_deal", { deal_id: deal.id })).isError).toBe(false);
    const writes: [string, Record<string, unknown>][] = [
      ["create_deal", { address: "1 A St", city: "B", state: "PA", units: 4, asking_price: 100000, source: "Broker" }],
      ["update_deal", { deal_id: deal.id, fields: { county: "X" } }],
      ["pass_deal", { deal_id: deal.id, reason: "nope nope" }],
      ["reactivate_deal", { deal_id: deal.id }],
      ["create_scenario", { deal_id: deal.id }],
    ];
    for (const [name, args] of writes) {
      const r = await call(tok, name, args);
      expect(r.data.error.code, name).toBe("forbidden");
    }
  });

  it("a VA can edit deals and scenarios but cannot pass or reactivate (matches the web API)", async () => {
    const va = { id: "44444444-4444-4444-8444-444444444444", email: "va@example.com", role: "va" };
    await seedUser(h.redis, va);
    const tok = await mintToken(va.id);
    const deal = await seedDeal(h.redis, va.id);
    expect((await call(tok, "update_deal", { deal_id: deal.id, fields: { county: "X" } })).isError).toBe(false);
    expect((await call(tok, "create_scenario", { deal_id: deal.id })).isError).toBe(false);
    expect((await call(tok, "pass_deal", { deal_id: deal.id, reason: "va can't" })).data.error.code).toBe("forbidden");
    expect((await h.redis.get<any>(`deal:${deal.id}`))!.status).toBe("active");
  });

  it("role is read at call time: demoting a user takes effect on their existing token", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    await seedUser(h.redis, { ...BRYAN, role: "viewer" as never });
    expect((await call(bryan, "update_deal", { deal_id: deal.id, fields: { county: "X" } })).data.error.code).toBe("forbidden");
  });
});

describe("tool registry", () => {
  it("TOOL_NAMES matches what the server lists", async () => {
    const { body } = await rpc(bryan, "tools/list");
    expect(body.result.tools.map((t: any) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });
});
