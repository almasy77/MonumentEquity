/**
 * Create an API token from the command line (same path as Settings → Team → API Tokens).
 *
 * Usage:
 *   TOKEN_NAME="Scout agent" ADMIN_EMAIL=you@example.com npx tsx scripts/create-api-token.ts
 *
 * Requires: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
 * The token is printed once and is never stored in readable form. It always has
 * VA permissions and is attributed to the admin identified by ADMIN_EMAIL.
 */

import { Redis } from "@upstash/redis";
import { createApiToken, type TokenStore } from "../src/lib/api-tokens";

async function main() {
  const name = process.env.TOKEN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim();
  if (!name || !email) {
    console.error('Usage: TOKEN_NAME="Scout agent" ADMIN_EMAIL=you@example.com npx tsx scripts/create-api-token.ts');
    process.exit(1);
  }
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  const userId = await redis.get<string>(`user:email:${email}`);
  if (!userId) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }
  const user = await redis.get<{ role?: string }>(`user:${userId}`);
  if (user?.role !== "admin") {
    console.error(`${email} is not an admin; tokens must be created by an admin.`);
    process.exit(1);
  }
  const { raw, record } = await createApiToken(redis as unknown as TokenStore, { name, userId });
  console.log(`Created token "${record.name}" (id ${record.id}). Copy it now; it will not be shown again:`);
  console.log(raw);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
