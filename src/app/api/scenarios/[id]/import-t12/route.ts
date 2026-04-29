import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { normalizeT12 } from "@/lib/import-normalize";
import { fetchBlobFile } from "@/lib/blob-helpers";
import { calculateUnderwriting, buildExpensesFromT12, sumT12Field, type ScenarioInputs } from "@/lib/underwriting";
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

  let blobCleanup: (() => Promise<void>) | null = null;

  try {
    const { id } = await ctx.params;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const blobUrl = formData.get("blobUrl") as string | null;
    const blobFileName = formData.get("fileName") as string | null;

    let buffer: ArrayBuffer;
    let actualFileName: string;

    if (blobUrl) {
      if (!blobFileName) {
        return NextResponse.json({ error: "fileName is required with blobUrl" }, { status: 400 });
      }
      const lower = blobFileName.toLowerCase();
      if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".pdf")) {
        return NextResponse.json({ error: "Unsupported format. Use CSV, XLSX, or PDF." }, { status: 400 });
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

    const t12 = await normalizeT12(buffer, actualFileName);
    if (blobCleanup) await blobCleanup();

    if (!t12.months || t12.months.length === 0) {
      return NextResponse.json({ error: "No T12 data found in the uploaded file." }, { status: 422 });
    }

    // Save T12 to deal
    const now = new Date().toISOString();
    deal.t12 = t12;
    deal.updated_at = now;
    await redis.set(`deal:${scenario.deal_id}`, JSON.stringify(deal));

    // Build expense updates from T12
    const t12Months = t12.months as Array<Record<string, number | string | undefined>>;
    const expenseUpdates = buildExpensesFromT12(t12Months, deal.units, scenario.expense_assumptions);

    // Also compute other_income_monthly for revenue
    const t12OtherIncome = sumT12Field(t12Months, "laundry_income") +
      sumT12Field(t12Months, "parking_income") +
      sumT12Field(t12Months, "pet_fees") +
      sumT12Field(t12Months, "application_fees") +
      sumT12Field(t12Months, "late_fees") +
      sumT12Field(t12Months, "utility_reimbursements") +
      sumT12Field(t12Months, "storage_income") +
      sumT12Field(t12Months, "other_income");
    const otherIncomeMonthly = t12OtherIncome > 0 && t12Months.length > 0
      ? Math.round(t12OtherIncome / t12Months.length)
      : (scenario.revenue_assumptions as Record<string, unknown>).other_income_monthly as number ?? 0;

    const updated: Scenario = {
      ...scenario,
      revenue_assumptions: {
        ...scenario.revenue_assumptions,
        other_income_monthly: otherIncomeMonthly,
      },
      expense_assumptions: {
        ...scenario.expense_assumptions,
        ...expenseUpdates,
        opex_inputs: undefined,
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
      action: "t12_imported",
      entity_type: "scenario",
      entity_id: id,
      details: {
        name: updated.name,
        file_name: actualFileName,
        months: t12.months.length,
        total_noi: t12.total_noi,
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
      imported: { months: t12.months.length, total_noi: t12.total_noi },
    });
  } catch (err) {
    if (blobCleanup) await blobCleanup().catch(() => {});
    console.error("POST /api/scenarios/[id]/import-t12 error:", err);
    const message = err instanceof Error ? err.message : "Failed to import T12";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
