import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeRedis } from "./helpers/fake-redis";
import { BRYAN, seedDeal } from "./helpers/mcp-fixtures";

const h = vi.hoisted(() => {
  process.env.UPSTASH_REDIS_REST_URL = "http://fake";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake";
  return { redis: null as unknown as FakeRedis, role: "admin" as "admin" | "va" | "viewer" };
});
vi.mock("@upstash/redis", async () => {
  const { FakeRedis } = await import("./helpers/fake-redis");
  h.redis = new FakeRedis();
  return { Redis: class { constructor() { return h.redis; } } };
});
vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111", email: "b@x.com", role: h.role } }),
}));
// The route imports these for unrelated handlers; keep them inert.
vi.mock("@/lib/ai-extract", () => ({ extractImageFromUrl: async () => null }));
vi.mock("@/lib/blob-helpers", () => ({ deleteBlobUrl: async () => undefined }));

import { NextRequest } from "next/server";
import { PUT } from "@/app/api/deals/[id]/route";

async function put(id: string, body: Record<string, unknown>) {
  const req = new NextRequest(`https://app.monumentequity.com/api/deals/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } as ConstructorParameters<typeof NextRequest>[1]);
  const res = await PUT(req, { params: Promise.resolve({ id }) });
  return { res, body: await res.json() };
}

const stored = async (id: string) => (await h.redis.get<Record<string, unknown>>(`deal:${id}`))!;

beforeEach(() => {
  h.redis.clear();
  h.role = "admin";
});

describe("web PUT /api/deals/[id]: status transitions and stale reasons", () => {
  it("Reactivate (status -> active) drops the old pass and kill reasons, restores indexes, keeps the reason in history", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    await put(deal.id, { status: "passed", pass_reason: "Passed on deal" });
    await put(deal.id, { status: "dead", kill_reason: "Marked dead" });
    expect((await stored(deal.id)).kill_reason).toBe("Marked dead");

    const { res, body } = await put(deal.id, { status: "active" });
    expect(res.status).toBe(200);
    expect(body.status).toBe("active");
    expect(body.pass_reason).toBeUndefined();
    expect(body.kill_reason).toBeUndefined();

    const rec = await stored(deal.id);
    expect(rec.pass_reason).toBeUndefined();
    expect(rec.kill_reason).toBeUndefined();
    expect(rec.updated_via).toBe("web");
    expect(await h.redis.zrange("deals:active", 0, -1)).toContain(deal.id);
    expect(await h.redis.zrange("deals:by_stage:lead", 0, -1)).toContain(deal.id);

    // The reason that was in force is still in the activity history.
    const ids = await h.redis.zrange(`activities:by_deal:${deal.id}`, 0, -1);
    const acts = await Promise.all(ids.map((i) => h.redis.get<any>(`activity:${i}`))); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(acts.some((a) => a.action === "status_changed" && a.details?.reason === "Passed on deal")).toBe(true);
  });

  it("passing / killing still records its reason", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id);
    const passed = await put(deal.id, { status: "passed", pass_reason: "Too small" });
    expect(passed.body).toMatchObject({ status: "passed", pass_reason: "Too small" });
    await put(deal.id, { status: "active" });
    const dead = await put(deal.id, { status: "dead", kill_reason: "Seller pulled it" });
    expect(dead.body).toMatchObject({ status: "dead", kill_reason: "Seller pulled it" });
  });

  it("a reactivation request that supplies a new reason keeps that reason", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { status: "passed", pass_reason: "old" });
    const { body } = await put(deal.id, { status: "active", pass_reason: "revisiting after price cut" });
    expect(body.pass_reason).toBe("revisiting after price cut");
  });

  it("editing a still-passed deal's other fields does not touch its reason", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { status: "passed", pass_reason: "Too small" });
    const { body } = await put(deal.id, { market_notes: "note" });
    expect(body).toMatchObject({ status: "passed", pass_reason: "Too small", market_notes: "note" });
  });

  it("ordinary edits to an already-active deal never alter reason fields (no transition, no strip)", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { kill_reason: "legacy", pass_reason: "legacy" });
    const { body } = await put(deal.id, { market_notes: "note" });
    expect(body).toMatchObject({ status: "active", kill_reason: "legacy", pass_reason: "legacy" });
    // a no-op "status: active" on an active deal is not a transition either
    const again = await put(deal.id, { status: "active" });
    expect(again.body).toMatchObject({ kill_reason: "legacy", pass_reason: "legacy" });
  });

  it("VAs still cannot change status (permission check unchanged)", async () => {
    const deal = await seedDeal(h.redis, BRYAN.id, { status: "passed", pass_reason: "x" });
    h.role = "va";
    const { res } = await put(deal.id, { status: "active" });
    expect(res.status).toBe(403);
    expect((await stored(deal.id)).status).toBe("passed");
  });
});
