/**
 * Seed script to create the initial admin user.
 *
 * Usage: npx tsx scripts/seed.ts
 *
 * Requires environment variables:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@monumentequity.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";
const ADMIN_NAME = process.env.ADMIN_NAME || "Monument Equity Admin";

async function seed() {
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  // Check if user already exists
  const existingUserId = await redis.get<string>(
    `user:email:${ADMIN_EMAIL}`
  );
  if (existingUserId) {
    console.log(`User with email ${ADMIN_EMAIL} already exists (id: ${existingUserId}). Skipping.`);
    return;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const user = {
    id,
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    password_hash: passwordHash,
    role: "admin",
    default_assumptions: {
      vacancy_rate: 0.07,
      bad_debt_rate: 0.02,
      management_fee_rate: 0.08,
      repairs_maintenance_per_unit: 750,
      insurance_per_unit: 600,
      tax_escalation_rate: 0.02,
      rent_growth_rate: 0.03,
      exit_cap_rate_spread: 0.005,
      hold_period_years: 5,
      reserves_per_unit: 300,
    },
    created_at: now,
    updated_at: now,
  };

  // Store user and email index
  await redis.set(`user:${id}`, JSON.stringify(user));
  await redis.set(`user:email:${ADMIN_EMAIL}`, id);

  console.log(`Admin user created successfully:`);
  console.log(`  ID:    ${id}`);
  console.log(`  Email: ${ADMIN_EMAIL}`);
  console.log(`  Name:  ${ADMIN_NAME}`);
  console.log(`  Role:  admin`);
  console.log(`\nYou can now sign in at /login`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
