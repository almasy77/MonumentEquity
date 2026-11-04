/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import type { FakeRedis } from "./fake-redis";

export const BRYAN = { id: "11111111-1111-4111-8111-111111111111", email: "bryan@example.com", role: "admin" as const };
export const OTHER = { id: "22222222-2222-4222-8222-222222222222", email: "other@example.com", role: "admin" as const };

export const ORIGIN = "https://app.monumentequity.com";
export const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function seedUser(r: FakeRedis, u: { id: string; email: string; role: string }) {
  await r.set(`user:${u.id}`, { id: u.id, email: u.email, name: u.email, role: u.role, password_hash: "x" });
}

let n = 0;
export async function seedDeal(
  r: FakeRedis,
  userId: string,
  over: Record<string, unknown> = {}
): Promise<Record<string, any>> {
  n++;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const now = new Date().toISOString();
  const deal = {
    id,
    user_id: userId,
    stage: "lead",
    status: "active",
    address: `${n} Test St`,
    city: "Pittsburgh",
    state: "PA",
    units: 12,
    asking_price: 1_200_000,
    source: "Broker",
    contact_ids: [],
    created_by: userId,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
    ...over,
  };
  await r.set(`deal:${id}`, JSON.stringify(deal));
  if (deal.status === "active") {
    await r.zadd("deals:active", { score: n, member: id });
    await r.zadd(`deals:by_stage:${deal.stage}`, { score: n, member: id });
  }
  return deal;
}
