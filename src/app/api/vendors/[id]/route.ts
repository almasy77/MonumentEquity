import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { getVendor, saveVendor, deleteVendor, listDealVendorsByVendor } from "@/lib/vendor-store";
import { vendorInputSchema, type Vendor } from "@/lib/vendors";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/vendors/[id] — vendor plus its deal links (quote history)
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const vendor = await getVendor(id);
    if (!vendor) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const links = await listDealVendorsByVendor(id);
    return NextResponse.json({ vendor, links });
  } catch (err) {
    console.error("GET /api/vendors/[id] error:", err);
    return NextResponse.json({ error: "Failed to fetch vendor" }, { status: 500 });
  }
}

// PUT /api/vendors/[id] — full replace of editable fields
export async function PUT(req: NextRequest, context: RouteContext) {
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
    const { id } = await context.params;
    const existing = await getVendor(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const updated: Vendor = {
      ...parsed.data,
      id,
      seed_key: existing.seed_key,
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };
    await saveVendor(updated, false);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("PUT /api/vendors/[id] error:", err);
    return NextResponse.json({ error: "Failed to update vendor" }, { status: 500 });
  }
}

// DELETE /api/vendors/[id] — admin only; also removes its deal links
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    if (!(await getVendor(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await deleteVendor(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/vendors/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete vendor" }, { status: 500 });
  }
}
