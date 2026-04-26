import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { parseCSV, parseXLSX } from "@/lib/import-parser";
import type { ParseResult, ImportRow } from "@/lib/import-parser";
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

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    let result: ParseResult;
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".csv") || fileName.endsWith(".tsv")) {
      const text = await file.text();
      result = await parseCSV(text);
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const buffer = await file.arrayBuffer();
      result = await parseXLSX(buffer);
    } else {
      return NextResponse.json(
        { error: "Unsupported file format. Use CSV or XLSX." },
        { status: 400 }
      );
    }

    if (mode === "preview") {
      return NextResponse.json(result);
    }

    const validRows = result.rows.filter((r) => r.valid);
    if (validRows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows to import", result },
        { status: 400 }
      );
    }

    const redis = getRedis();
    const now = new Date().toISOString();
    const created: Deal[] = [];

    for (const row of validRows) {
      const d = row.data as ImportRow;
      const id = crypto.randomUUID();

      const deal: Deal = {
        id,
        user_id: session.user.id,
        stage: "lead",
        status: "active",
        address: d.address,
        city: d.city,
        state: d.state,
        zip: d.zip || undefined,
        county: d.county || undefined,
        units: d.units,
        year_built: d.year_built || undefined,
        property_type: d.property_type || undefined,
        asking_price: d.asking_price,
        bid_price: d.bid_price || undefined,
        source: d.source as Deal["source"],
        current_noi: d.current_noi || undefined,
        current_occupancy: d.current_occupancy || undefined,
        market_notes: d.market_notes || undefined,
        contact_ids: [],
        created_by: session.user.id,
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      };

      await redis.set(`deal:${id}`, JSON.stringify(deal));
      await addToIndex("deals:active", id, Date.now());
      await addToIndex(`deals:by_stage:lead`, id, Date.now());
      created.push(deal);
    }

    await logActivity({
      deal_id: created[0].id,
      action: "bulk_import",
      entity_type: "deal",
      entity_id: created[0].id,
      details: { count: created.length },
      user_id: session.user.id,
    });

    return NextResponse.json({
      imported: created.length,
      skipped: result.error_count,
      deals: created.map((d) => ({ id: d.id, address: d.address, units: d.units })),
    });
  } catch (err) {
    console.error("POST /api/deals/bulk-import error:", err);
    return NextResponse.json({ error: "Failed to process import" }, { status: 500 });
  }
}
