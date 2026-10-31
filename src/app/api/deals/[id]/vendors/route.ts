import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { logActivity } from "@/lib/activity";
import { getVendor, listDealVendorsByDeal, saveDealVendor } from "@/lib/vendor-store";
import { dealVendorInputSchema, type DealVendor } from "@/lib/vendors";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/deals/[id]/vendors — vendors linked to this deal
export async function GET(_req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    return NextResponse.json(await listDealVendorsByDeal(id));
  } catch (err) {
    console.error("GET /api/deals/[id]/vendors error:", err);
    return NextResponse.json({ error: "Failed to fetch deal vendors" }, { status: 500 });
  }
}

// POST /api/deals/[id]/vendors — link a vendor (default status: quote requested)
export async function POST(req: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

  const bodyOrError = await safeJson(req);
  if (isErrorResponse(bodyOrError)) return bodyOrError;
  const parsed = dealVendorInputSchema.safeParse(bodyOrError);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const { id: dealId } = await context.params;
    const deal = await getRedis().get(`deal:${dealId}`);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    const vendor = await getVendor(parsed.data.vendor_id);
    if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });

    const existing = await listDealVendorsByDeal(dealId);
    if (existing.some((l) => l.vendor_id === vendor.id)) {
      return NextResponse.json({ error: "Vendor already linked to this deal" }, { status: 409 });
    }

    const now = new Date().toISOString();
    const link: DealVendor = { ...parsed.data, id: crypto.randomUUID(), deal_id: dealId, created_at: now, updated_at: now };
    await saveDealVendor(link, true);
    await logActivity({
      deal_id: dealId,
      action: link.status === "requested" ? "vendor_quote_requested" : "vendor_linked",
      entity_type: "vendor",
      entity_id: vendor.id,
      details: { vendor_name: vendor.name, offering_id: link.offering_id },
      user_id: session.user.id ?? "",
    });
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    console.error("POST /api/deals/[id]/vendors error:", err);
    return NextResponse.json({ error: "Failed to link vendor" }, { status: 500 });
  }
}
