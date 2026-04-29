import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { normalizeRentRoll } from "@/lib/import-normalize";
import { fetchBlobFile } from "@/lib/blob-helpers";
import { calculateUnderwriting, buildUnitMixFromRentRoll, type ScenarioInputs } from "@/lib/underwriting";
import type { Scenario, Deal } from "@/lib/validations";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const blobUrl = formData.get("blobUrl") as string | null;
    const blobFileName = formData.get("fileName") as string | null;

    let buffer: ArrayBuffer;
    let actualFileName: string;
    let blobCleanup: (() => Promise<void>) | null = null;

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
      const fileName = file.name.toLowerCase();
      if (!fileName.endsWith(".csv") && !fileName.endsWith(".xlsx") && !fileName.endsWith(".pdf")) {
        return NextResponse.json({ error: "Unsupported format. Use CSV, XLSX, or PDF." }, { status: 400 });
      }
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large. Maximum 25MB." }, { status: 400 });
      }
      buffer = await file.arrayBuffer();
      actualFileName = file.name;
    }

    const redis = getRedis();
    const scenario = await redis.get<Scenario>(`scenario:${id}`);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const deal = await redis.get<Deal>(`deal:${scenario.deal_id}`);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const rentRoll = await normalizeRentRoll(buffer, actualFileName);
    if (blobCleanup) await blobCleanup();

    if (rentRoll.length === 0) {
      return NextResponse.json({ error: "No units found in the uploaded file." }, { status: 422 });
    }

    // Save rent roll to deal
    const now = new Date().toISOString();
    deal.rent_roll = rentRoll;
    deal.updated_at = now;
    await redis.set(`deal:${scenario.deal_id}`, JSON.stringify(deal));

    // Update scenario unit mix
    const unitMix = buildUnitMixFromRentRoll(rentRoll, deal.units);
    const updated: Scenario = {
      ...scenario,
      revenue_assumptions: {
        ...scenario.revenue_assumptions,
        unit_mix: unitMix,
      },
      version: scenario.version + 1,
      updated_at: now,
    };

    const inputs = {
      purchase: updated.purchase_assumptions,
      financing: updated.financing_assumptions,
      revenue: updated.revenue_assumptions,
      expenses: updated.expense_assumptions,
      capex: updated.capex_assumptions,
      exit: updated.exit_assumptions,
    } as unknown as ScenarioInputs;

    const result = calculateUnderwriting(inputs);

    updated.monthly_pro_forma = result.monthly;
    updated.calculated_metrics = {
      irr: result.metrics.irr ?? undefined,
      cash_on_cash: result.metrics.average_cash_on_cash,
      dscr: result.metrics.year1_dscr,
      equity_multiple: result.metrics.equity_multiple,
      going_in_cap: result.metrics.going_in_cap,
      stabilized_cap: result.metrics.stabilized_cap,
    };

    await redis.set(`scenario_version:${id}:${scenario.version}`, JSON.stringify(scenario));
    await redis.set(`scenario:${id}`, JSON.stringify(updated));

    await logActivity({
      deal_id: scenario.deal_id,
      action: "rent_roll_imported",
      entity_type: "scenario",
      entity_id: id,
      details: {
        name: updated.name,
        file_name: actualFileName,
        units_imported: rentRoll.length,
        unit_types: unitMix.length,
      },
      user_id: session.user.id,
    });

    return NextResponse.json({
      scenario: updated,
      underwriting: {
        monthly: result.monthly,
        annual: result.annual,
        metrics: result.metrics,
        sensitivity: result.sensitivity,
        warnings: result.warnings,
      },
      imported: { units: rentRoll.length, unit_types: unitMix.length },
    });
  } catch (err) {
    console.error("POST /api/scenarios/[id]/import-rent-roll error:", err);
    const message = err instanceof Error ? err.message : "Failed to import rent roll";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
