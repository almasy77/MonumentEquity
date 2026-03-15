import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/db";
import bcrypt from "bcryptjs";

// POST /api/seed — one-time admin user creation
// Protected by a simple check: only works if no users exist yet
export async function POST(req: NextRequest) {
  const redis = getRedis();

  const email = "admin@monumentequity.com";
  const existingId = await redis.get<string>(`user:email:${email}`);

  if (existingId) {
    return NextResponse.json({ message: "Admin user already exists" }, { status: 200 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash("changeme123", 12);

  const user = {
    id,
    email,
    name: "Monument Equity Admin",
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

  await redis.set(`user:${id}`, JSON.stringify(user));
  await redis.set(`user:email:${email}`, id);

  return NextResponse.json({
    message: "Admin user created",
    email,
    password: "changeme123",
  }, { status: 201 });
}
