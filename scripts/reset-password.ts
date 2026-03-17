/**
 * Password reset script for existing users.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@monumentequity.com ADMIN_PASSWORD=newpassword npx tsx scripts/reset-password.ts
 *
 * Requires environment variables:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *   ADMIN_EMAIL     (email of user to reset)
 *   ADMIN_PASSWORD  (new plaintext password)
 */

import { Redis } from "@upstash/redis";
import bcrypt from "bcryptjs";

const EMAIL = process.env.ADMIN_EMAIL || "admin@monumentequity.com";
const NEW_PASSWORD = process.env.ADMIN_PASSWORD;

if (!NEW_PASSWORD) {
    console.error("Error: ADMIN_PASSWORD environment variable is required.");
    console.error("Usage: ADMIN_PASSWORD=yournewpassword npx tsx scripts/reset-password.ts");
    process.exit(1);
}

async function resetPassword() {
    const redis = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL!,
          token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

  // Look up user ID by email
  const userId = await redis.get<string>(`user:email:${EMAIL}`);
    if (!userId) {
          console.error(`No user found with email: ${EMAIL}`);
          process.exit(1);
    }

  // Fetch current user record
  const raw = await redis.get<string>(`user:${userId}`);
    if (!raw) {
          console.error(`User record not found for id: ${userId}`);
          process.exit(1);
    }

  const user = typeof raw === "string" ? JSON.parse(raw) : raw;

  // Hash new password and update record
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 12);
    user.password_hash = passwordHash;
    user.updated_at = new Date().toISOString();

  await redis.set(`user:${userId}`, JSON.stringify(user));

  console.log(`Password updated successfully for ${EMAIL}`);
    console.log(`  User ID: ${userId}`);
    console.log(`  Updated at: ${user.updated_at}`);
    console.log(`\nYou can now sign in at /login with the new password.`);
}

resetPassword().catch((err) => {
    console.error("Password reset failed:", err);
    process.exit(1);
});
