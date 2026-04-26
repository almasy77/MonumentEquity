import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { extractFromOM } from "@/lib/om-extract";
import type { OMExtractedData } from "@/lib/om-extract";
import type { Deal } from "@/lib/validations";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mode = formData.get("mode") as string | null;
    const dealId = formData.get("deal_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: "File too large. Maximum 25MB." }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    let mediaType: "application/pdf" | "image/png" | "image/jpeg" = "application/pdf";
    if (fileName.endsWith(".png")) mediaType = "image/png";
    else if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) mediaType = "image/jpeg";
    else if (!fileName.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Unsupported file format. Use PDF, PNG, or JPG." },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const extracted = await extractFromOM(base64, mediaType);

    if (mode === "preview") {
      return NextResponse.json(extracted);
    }

    if (dealId) {
      return await updateExistingDeal(dealId, extracted, session.user.id);
    }

    return await createNewDeal(extracted, session.user.id);
  } catch (err) {
    console.error("POST /api/deals/import-om error:", err);
    const message = err instanceof Error ? err.message : "Failed to process offering memo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function createNewDeal(data: OMExtractedData, userId: string) {
  const p = data.property;
  const f = data.financials;

  if (!p.address || !p.city || !p.state || !p.units || !f.asking_price) {
    return NextResponse.json({
      error: "Could not extract required fields (address, city, state, units, asking price). Please review and fill in manually.",
      extracted: data,
    }, { status: 422 });
  }

  const redis = getRedis();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const deal: Deal = {
    id,
    user_id: userId,
    stage: "lead",
    status: "active",
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    county: p.county,
    units: p.units,
    year_built: p.year_built,
    property_type: p.property_type,
    square_footage: p.square_footage,
    lot_size: p.lot_size,
    stories: p.stories,
    parking_spaces: p.parking_spaces,
    parking_type: p.parking_type,
    construction_type: p.construction_type,
    hvac_type: p.hvac_type,
    laundry_type: p.laundry_type,
    amenities: p.amenities,
    asking_price: f.asking_price,
    current_noi: f.current_noi,
    pro_forma_noi: f.pro_forma_noi,
    current_occupancy: f.current_occupancy,
    in_place_cap_rate: f.in_place_cap_rate,
    pro_forma_cap_rate: f.pro_forma_cap_rate,
    current_annual_taxes: f.current_annual_taxes,
    current_annual_insurance: f.current_annual_insurance,
    grm: f.grm,
    rent_roll: data.rent_roll.length > 0 ? data.rent_roll.map((u) => ({ ...u, status: u.status || "occupied" })) : undefined,
    t12: data.t12.months.length > 0 ? data.t12 : undefined,
    source: "Broker" as Deal["source"],
    market_notes: data.market_notes,
    contact_ids: [],
    created_by: userId,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };

  await redis.set(`deal:${id}`, JSON.stringify(deal));
  await addToIndex("deals:active", id, Date.now());
  await addToIndex("deals:by_stage:lead", id, Date.now());

  await logActivity({
    deal_id: id,
    action: "deal_created_from_om",
    entity_type: "deal",
    entity_id: id,
    details: {
      address: deal.address,
      units: deal.units,
      asking_price: deal.asking_price,
      rent_roll_units: data.rent_roll.length,
      t12_months: data.t12.months.length,
    },
    user_id: userId,
  });

  return NextResponse.json({ deal, extracted: data }, { status: 201 });
}

async function updateExistingDeal(dealId: string, data: OMExtractedData, userId: string) {
  const redis = getRedis();
  const existing = await redis.get<Deal>(`deal:${dealId}`);
  if (!existing) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const p = data.property;
  const f = data.financials;
  const now = new Date().toISOString();

  const updated: Deal = {
    ...existing,
    zip: p.zip || existing.zip,
    county: p.county || existing.county,
    year_built: p.year_built || existing.year_built,
    property_type: p.property_type || existing.property_type,
    square_footage: p.square_footage || existing.square_footage,
    lot_size: p.lot_size || existing.lot_size,
    stories: p.stories || existing.stories,
    parking_spaces: p.parking_spaces || existing.parking_spaces,
    parking_type: p.parking_type || existing.parking_type,
    construction_type: p.construction_type || existing.construction_type,
    hvac_type: p.hvac_type || existing.hvac_type,
    laundry_type: p.laundry_type || existing.laundry_type,
    amenities: p.amenities || existing.amenities,
    current_noi: f.current_noi || existing.current_noi,
    pro_forma_noi: f.pro_forma_noi || existing.pro_forma_noi,
    current_occupancy: f.current_occupancy || existing.current_occupancy,
    in_place_cap_rate: f.in_place_cap_rate || existing.in_place_cap_rate,
    pro_forma_cap_rate: f.pro_forma_cap_rate || existing.pro_forma_cap_rate,
    current_annual_taxes: f.current_annual_taxes || existing.current_annual_taxes,
    current_annual_insurance: f.current_annual_insurance || existing.current_annual_insurance,
    grm: f.grm || existing.grm,
    rent_roll: data.rent_roll.length > 0 ? data.rent_roll.map((u) => ({ ...u, status: u.status || "occupied" })) : existing.rent_roll,
    t12: data.t12.months.length > 0 ? data.t12 : existing.t12,
    market_notes: data.market_notes || existing.market_notes,
    updated_at: now,
    last_activity_at: now,
  };

  await redis.set(`deal:${dealId}`, JSON.stringify(updated));

  await logActivity({
    deal_id: dealId,
    action: "deal_updated_from_om",
    entity_type: "deal",
    entity_id: dealId,
    details: {
      rent_roll_units: data.rent_roll.length,
      t12_months: data.t12.months.length,
    },
    user_id: userId,
  });

  return NextResponse.json({ deal: updated, extracted: data });
}
