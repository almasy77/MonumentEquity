import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { extractFromOM } from "@/lib/om-extract";
import { extractImageFromUrl } from "@/lib/ai-extract";
import { fetchBlobFile } from "@/lib/blob-helpers";
import type { OMExtractedData, ExtractedContact } from "@/lib/om-extract";
import type { Deal, Contact } from "@/lib/validations";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  let blobCleanup: (() => Promise<void>) | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const blobUrl = formData.get("blobUrl") as string | null;
    const blobFileName = formData.get("fileName") as string | null;
    const mode = formData.get("mode") as string | null;
    const dealId = formData.get("deal_id") as string | null;

    let buffer: ArrayBuffer;
    let actualFileName: string;

    if (blobUrl) {
      if (!blobFileName) {
        return NextResponse.json({ error: "fileName is required with blobUrl" }, { status: 400 });
      }
      const blob = await fetchBlobFile(blobUrl);
      buffer = blob.buffer;
      blobCleanup = blob.cleanup;
      actualFileName = blobFileName;
    } else {
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      actualFileName = file.name;

      const isImage = file.name.toLowerCase().endsWith(".png") || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg");
      const maxSize = isImage ? 3.5 * 1024 * 1024 : 25 * 1024 * 1024;
      if (file.size > maxSize) {
        if (isImage) {
          return NextResponse.json(
            { error: "Image too large (max ~3.5 MB). For larger documents, please upload as PDF instead." },
            { status: 400 }
          );
        }
        return NextResponse.json({ error: "File too large. Maximum 25MB." }, { status: 400 });
      }
      buffer = await file.arrayBuffer();
    }

    const fileName = actualFileName.toLowerCase();
    let mediaType: "application/pdf" | "image/png" | "image/jpeg" = "application/pdf";
    if (fileName.endsWith(".png")) mediaType = "image/png";
    else if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) mediaType = "image/jpeg";
    else if (!fileName.endsWith(".pdf")) {
      if (blobCleanup) await blobCleanup();
      return NextResponse.json(
        { error: "Unsupported file format. Use PDF, PNG, or JPG." },
        { status: 400 }
      );
    }

    const base64 = Buffer.from(buffer).toString("base64");

    const extracted = await extractFromOM(base64, mediaType);
    if (blobCleanup) await blobCleanup();

    if (mode === "preview") {
      const duplicates = await findDuplicates(extracted);
      return NextResponse.json({ ...extracted, duplicates });
    }

    if (dealId) {
      const contactIds = await createContacts(extracted.contacts);
      return await updateExistingDeal(dealId, extracted, userId(session), contactIds);
    }

    return await createNewDeal(extracted, userId(session));
  } catch (err) {
    if (blobCleanup) await blobCleanup().catch(() => {});
    const errObj = err as { status?: number; message?: string; error?: unknown };
    console.error("POST /api/deals/import-om error:", {
      message: errObj.message,
      status: errObj.status,
      error: errObj.error,
      stack: err instanceof Error ? err.stack : undefined,
    });
    const message = err instanceof Error ? err.message : "Failed to process offering memo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function userId(session: { user: { id: string } }): string {
  return session.user.id;
}

async function findDuplicates(data: OMExtractedData): Promise<{ id: string; address: string; city: string; state: string; units: number }[]> {
  const addr = data.property.address?.toLowerCase().trim();
  if (!addr) return [];

  const redis = getRedis();
  const ids = await redis.zrange("deals:active", 0, -1);
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`deal:${id}`);
  }
  const results = await pipeline.exec<(Deal | null)[]>();

  const matches: { id: string; address: string; city: string; state: string; units: number }[] = [];
  for (const deal of results) {
    if (!deal) continue;
    const dealAddr = deal.address.toLowerCase().trim();
    if (dealAddr === addr || dealAddr.includes(addr) || addr.includes(dealAddr)) {
      matches.push({
        id: deal.id,
        address: deal.address,
        city: deal.city,
        state: deal.state,
        units: deal.units,
      });
    }
  }
  return matches;
}

async function createContacts(contacts: ExtractedContact[]): Promise<string[]> {
  if (!contacts || contacts.length === 0) return [];

  const redis = getRedis();
  const now = new Date().toISOString();
  const contactIds: string[] = [];

  for (const c of contacts) {
    if (!c.name) continue;

    const nameParts = c.name.trim().split(/\s+/);
    const firstName = nameParts[0] || c.name;
    const lastName = nameParts.slice(1).join(" ") || undefined;

    const id = crypto.randomUUID();
    const contact: Contact = {
      id,
      first_name: firstName,
      last_name: lastName,
      company: c.company,
      title: c.title,
      type: c.type || "broker",
      tags: [],
      email: c.email,
      phone: c.phone,
      phones: c.phone ? [{ number: c.phone, label: "office" }] : [],
      deal_ids: [],
      created_at: now,
      updated_at: now,
    };

    await redis.set(`contact:${id}`, JSON.stringify(contact));
    await addToIndex("contacts:active", id, Date.now());
    contactIds.push(id);
  }

  return contactIds;
}

async function createNewDeal(data: OMExtractedData, createdBy: string) {
  const p = data.property;
  const f = data.financials;

  if (!p.address || !p.city || !p.state || !p.units || !f.asking_price) {
    return NextResponse.json({
      error: "Could not extract required fields (address, city, state, units, asking price). Please review and fill in manually.",
      extracted: data,
    }, { status: 422 });
  }

  const contactIds = await createContacts(data.contacts);

  const redis = getRedis();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const deal: Deal = {
    id,
    user_id: createdBy,
    stage: "lead",
    status: "active",
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    county: p.county,
    parcel_number: p.parcel_number,
    units: p.units,
    year_built: p.year_built,
    property_type: p.property_type,
    square_footage: p.square_footage,
    lot_size: p.lot_size,
    stories: p.stories,
    parking_spaces: p.parking_spaces,
    parking_type: p.parking_type,
    construction_type: p.construction_type,
    roof_type: p.roof_type,
    hvac_type: p.hvac_type,
    laundry_type: p.laundry_type,
    water_heater: p.water_heater,
    electrical: p.electrical,
    plumbing: p.plumbing,
    foundation: p.foundation,
    amenities: p.amenities,
    asking_price: f.asking_price,
    current_noi: f.current_noi,
    pro_forma_noi: f.pro_forma_noi,
    current_occupancy: f.current_occupancy,
    in_place_cap_rate: f.in_place_cap_rate,
    pro_forma_cap_rate: f.pro_forma_cap_rate,
    current_annual_taxes: f.current_annual_taxes,
    current_annual_insurance: f.current_annual_insurance,
    assessed_value: f.assessed_value,
    tax_rate: f.tax_rate,
    grm: f.grm,
    rent_roll: data.rent_roll.length > 0 ? data.rent_roll.map((u) => ({ ...u, status: u.status || "occupied" })) : undefined,
    t12: data.t12.months.length > 0 ? data.t12 : undefined,
    source: "Broker" as Deal["source"],
    market_notes: data.market_notes,
    contact_ids: contactIds,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };

  await redis.set(`deal:${id}`, JSON.stringify(deal));
  await addToIndex("deals:active", id, Date.now());
  await addToIndex("deals:by_stage:lead", id, Date.now());

  for (const cId of contactIds) {
    const contact = await redis.get<Contact>(`contact:${cId}`);
    if (contact) {
      contact.deal_ids = [...(contact.deal_ids || []), id];
      await redis.set(`contact:${cId}`, JSON.stringify(contact));
    }
  }

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
      contacts_created: contactIds.length,
    },
    user_id: createdBy,
  });

  return NextResponse.json({ deal, extracted: data }, { status: 201 });
}

async function updateExistingDeal(dealId: string, data: OMExtractedData, updatedBy: string, newContactIds: string[]) {
  const redis = getRedis();
  const existing = await redis.get<Deal>(`deal:${dealId}`);
  if (!existing) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const p = data.property;
  const f = data.financials;
  const now = new Date().toISOString();

  const mergedContactIds = [...new Set([...(existing.contact_ids || []), ...newContactIds])];

  const updated: Deal = {
    ...existing,
    zip: p.zip || existing.zip,
    county: p.county || existing.county,
    parcel_number: p.parcel_number || existing.parcel_number,
    year_built: p.year_built ?? existing.year_built,
    property_type: p.property_type || existing.property_type,
    square_footage: p.square_footage ?? existing.square_footage,
    lot_size: p.lot_size || existing.lot_size,
    stories: p.stories ?? existing.stories,
    parking_spaces: p.parking_spaces ?? existing.parking_spaces,
    parking_type: p.parking_type || existing.parking_type,
    construction_type: p.construction_type || existing.construction_type,
    roof_type: p.roof_type || existing.roof_type,
    hvac_type: p.hvac_type || existing.hvac_type,
    laundry_type: p.laundry_type || existing.laundry_type,
    water_heater: p.water_heater || existing.water_heater,
    electrical: p.electrical || existing.electrical,
    plumbing: p.plumbing || existing.plumbing,
    foundation: p.foundation || existing.foundation,
    amenities: p.amenities || existing.amenities,
    current_noi: f.current_noi ?? existing.current_noi,
    pro_forma_noi: f.pro_forma_noi ?? existing.pro_forma_noi,
    current_occupancy: f.current_occupancy ?? existing.current_occupancy,
    in_place_cap_rate: f.in_place_cap_rate ?? existing.in_place_cap_rate,
    pro_forma_cap_rate: f.pro_forma_cap_rate ?? existing.pro_forma_cap_rate,
    current_annual_taxes: f.current_annual_taxes ?? existing.current_annual_taxes,
    current_annual_insurance: f.current_annual_insurance ?? existing.current_annual_insurance,
    assessed_value: f.assessed_value ?? existing.assessed_value,
    tax_rate: f.tax_rate ?? existing.tax_rate,
    grm: f.grm ?? existing.grm,
    rent_roll: data.rent_roll.length > 0 ? data.rent_roll.map((u) => ({ ...u, status: u.status || "occupied" })) : existing.rent_roll,
    t12: data.t12.months.length > 0 ? data.t12 : existing.t12,
    market_notes: data.market_notes || existing.market_notes,
    contact_ids: mergedContactIds,
    updated_at: now,
    last_activity_at: now,
  };

  // Auto-extract photo from listing URL if deal has no photos
  if ((!updated.photos || updated.photos.length === 0) && updated.source_url) {
    try {
      const imageUrl = await extractImageFromUrl(updated.source_url);
      if (imageUrl) updated.photos = [imageUrl];
    } catch {
      // Non-critical
    }
  }

  await redis.set(`deal:${dealId}`, JSON.stringify(updated));

  for (const cId of newContactIds) {
    const contact = await redis.get<Contact>(`contact:${cId}`);
    if (contact) {
      contact.deal_ids = [...new Set([...(contact.deal_ids || []), dealId])];
      await redis.set(`contact:${cId}`, JSON.stringify(contact));
    }
  }

  await logActivity({
    deal_id: dealId,
    action: "deal_updated_from_om",
    entity_type: "deal",
    entity_id: dealId,
    details: {
      rent_roll_units: data.rent_roll.length,
      t12_months: data.t12.months.length,
      contacts_created: newContactIds.length,
    },
    user_id: updatedBy,
  });

  return NextResponse.json({ deal: updated, extracted: data });
}
