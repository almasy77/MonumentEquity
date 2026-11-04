import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { getCrmEmailSettings } from "@/lib/crm-settings";

/**
 * CRM email-logging settings (the `settings:crm-email` Redis doc).
 * GET returns the effective settings; PUT (admin only) persists overrides —
 * currently the auto-create toggle, which wins over env/default.
 */

interface StoredCrmSettings {
  staff_emails?: string[];
  staff_domains?: string[];
  inbound_address?: string;
  auto_create?: boolean;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const effective = await getCrmEmailSettings();
  return NextResponse.json({
    autoCreate: effective.autoCreate,
    inboundAddress: effective.inboundAddress ?? null,
    staffEmails: effective.staffEmails,
    staffDomains: effective.staffDomains,
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can modify settings" }, { status: 403 });
  }

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const body = bodyOrError as { auto_create?: unknown };

  if (typeof body.auto_create !== "boolean") {
    return NextResponse.json({ error: "auto_create (boolean) is required" }, { status: 400 });
  }

  const redis = getRedis();
  // Merge into the existing doc so staff/domain/inbound overrides are preserved.
  const existing = (await redis.get<StoredCrmSettings>("settings:crm-email")) ?? {};
  const updated: StoredCrmSettings = { ...existing, auto_create: body.auto_create };
  await redis.set("settings:crm-email", JSON.stringify(updated));

  const effective = await getCrmEmailSettings();
  return NextResponse.json({ autoCreate: effective.autoCreate });
}
