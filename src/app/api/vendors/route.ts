import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { ensureSeedVendors, listVendors, saveVendor } from "@/lib/vendor-store";
import { vendorInputSchema, type Vendor } from "@/lib/vendors";

// GET /api/vendors — full directory (seeds the starter vendors on first read)
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureSeedVendors();
    return NextResponse.json(await listVendors());
  } catch (err) {
    console.error("GET /api/vendors error:", err);
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 });
  }
}

// POST /api/vendors — create
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const parsed = vendorInputSchema.safeParse(bodyOrError);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid vendor" }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const vendor: Vendor = { ...parsed.data, id: crypto.randomUUID(), created_at: now, updated_at: now };
    await saveVendor(vendor, true);
    return NextResponse.json(vendor, { status: 201 });
  } catch (err) {
    console.error("POST /api/vendors error:", err);
    return NextResponse.json({ error: "Failed to create vendor" }, { status: 500 });
  }
}
