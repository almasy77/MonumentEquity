import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { getDealVendor, saveDealVendor, deleteDealVendor } from "@/lib/vendor-store";
import { dealVendorInputSchema, type DealVendor } from "@/lib/vendors";

type RouteContext = { params: Promise<{ id: string; linkId: string }> };

const updateSchema = dealVendorInputSchema.omit({ vendor_id: true }).partial();

// PUT /api/deals/[id]/vendors/[linkId] — update quote amount/date/status/notes
export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const parsed = updateSchema.safeParse(bodyOrError);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const { id: dealId, linkId } = await context.params;
    const existing = await getDealVendor(linkId);
    if (!existing || existing.deal_id !== dealId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const updated: DealVendor = { ...existing, ...parsed.data, updated_at: new Date().toISOString() };
    await saveDealVendor(updated, false);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("PUT /api/deals/[id]/vendors/[linkId] error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

// DELETE /api/deals/[id]/vendors/[linkId] — unlink vendor from deal
export async function DELETE(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  try {
    const { id: dealId, linkId } = await context.params;
    const existing = await getDealVendor(linkId);
    if (!existing || existing.deal_id !== dealId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await deleteDealVendor(existing);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/deals/[id]/vendors/[linkId] error:", err);
    return NextResponse.json({ error: "Failed to unlink" }, { status: 500 });
  }
}
