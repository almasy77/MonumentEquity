import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import type { Scenario, Deal } from "@/lib/validations";

/**
 * P1-1 mismatch report (read-only). Every expense line can be stored twice: a flat
 * field (e.g. turnover_cost_per_unit) and an opex_inputs entry ({value, mode}) that
 * the UI edits. The engine now reads opex_inputs first for every line, but where the
 * two disagree the stored metrics computed by an older engine (which read the flat
 * field on the ramp-path turnover line) may have been wrong. This scans every
 * scenario and reports the disagreements for Bryan to review BEFORE any backfill.
 * It changes nothing.
 */
export const maxDuration = 60;

type Mode = "total_annual" | "per_unit_annual" | "per_unit_monthly" | "pct_egi" | "pct_gpr";

// flat field ↔ opex_inputs key ↔ the mode the flat field implies.
const LINES: { line: string; flat: string; oi: string; flatMode: Mode }[] = [
  { line: "management", flat: "management_fee_rate", oi: "management_fees", flatMode: "pct_egi" },
  { line: "payroll", flat: "payroll_annual", oi: "payroll", flatMode: "total_annual" },
  { line: "repairs_maintenance", flat: "repairs_maintenance_per_unit", oi: "repairs_maintenance", flatMode: "per_unit_annual" },
  { line: "turnover", flat: "turnover_cost_per_unit", oi: "turnover", flatMode: "per_unit_annual" },
  { line: "insurance", flat: "insurance_per_unit", oi: "insurance", flatMode: "per_unit_annual" },
  { line: "property_tax", flat: "property_tax_total", oi: "property_tax", flatMode: "total_annual" },
  { line: "utilities", flat: "utilities_per_unit", oi: "utilities", flatMode: "per_unit_annual" },
  { line: "admin_legal_marketing", flat: "admin_legal_marketing", oi: "admin_legal_marketing", flatMode: "total_annual" },
  { line: "contract_services", flat: "contract_services", oi: "contract_services", flatMode: "total_annual" },
  { line: "reserves", flat: "reserves_per_unit", oi: "reserves", flatMode: "per_unit_annual" },
];

interface MismatchRow {
  deal_id: string;
  deal_address: string;
  scenario_id: string;
  scenario_name: string;
  line: string;
  flat_field: string;
  flat_value: number | null;
  opex_inputs_value: number | null;
  opex_inputs_mode: string | null;
  mode_matches_flat: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const redis = getRedis();

    // Scan every scenario.
    const scenarios: Scenario[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, { match: "scenario:*", count: 200 });
      cursor = String(next);
      if (keys.length === 0) continue;
      const pipe = redis.pipeline();
      for (const k of keys) pipe.get(k);
      const got = await pipe.exec<(Scenario | null)[]>();
      for (const s of got) if (s && (s as { id?: string }).id) scenarios.push(s);
    } while (cursor !== "0");

    // Resolve deal addresses in one batch.
    const dealIds = [...new Set(scenarios.map((s) => (s as { deal_id?: string }).deal_id).filter(Boolean) as string[])];
    const addresses: Record<string, string> = {};
    if (dealIds.length > 0) {
      const pipe = redis.pipeline();
      for (const id of dealIds) pipe.get(`deal:${id}`);
      const deals = await pipe.exec<(Deal | null)[]>();
      for (const d of deals) if (d?.id) addresses[d.id] = d.address;
    }

    const rows: MismatchRow[] = [];
    for (const s of scenarios) {
      const sc = s as unknown as Record<string, unknown>;
      const expenses = (sc.expense_assumptions as Record<string, unknown>) || {};
      const oi = (expenses.opex_inputs as Record<string, { value?: number; mode?: string } | undefined>) || {};
      for (const L of LINES) {
        const input = oi[L.oi];
        if (!input || input.value == null) continue; // no opex_inputs entry → nothing to disagree with
        const flatValue = num(expenses[L.flat]);
        const oiValue = num(input.value);
        const modeMatches = (input.mode ?? L.flatMode) === L.flatMode;
        // Flag when the opex_inputs value differs from the flat field, or its mode
        // isn't the one the flat field implies (so they aren't the same quantity).
        if (oiValue !== flatValue || !modeMatches) {
          rows.push({
            deal_id: (sc.deal_id as string) ?? "",
            deal_address: addresses[(sc.deal_id as string) ?? ""] ?? "(unknown)",
            scenario_id: (sc.id as string) ?? "",
            scenario_name: (sc.name as string) ?? "",
            line: L.line,
            flat_field: L.flat,
            flat_value: flatValue,
            opex_inputs_value: oiValue,
            opex_inputs_mode: input.mode ?? null,
            mode_matches_flat: modeMatches,
          });
        }
      }
    }

    const byLine: Record<string, number> = {};
    for (const r of rows) byLine[r.line] = (byLine[r.line] ?? 0) + 1;

    const report = {
      generated_at: new Date().toISOString(),
      scenarios_scanned: scenarios.length,
      mismatch_count: rows.length,
      by_line: byLine,
      note:
        "The engine now reads opex_inputs for every line (the UI-edited source). " +
        "These rows are where the flat field and opex_inputs disagree; review before any backfill. No data was changed.",
      rows,
    };

    // Keep the latest report retrievable without a rescan.
    try {
      await redis.set("opex_mismatch_report:latest", JSON.stringify(report));
    } catch {
      /* non-fatal */
    }

    return NextResponse.json(report);
  } catch (err) {
    console.error("GET /api/admin/opex-mismatch error:", err);
    return NextResponse.json({ error: "Failed to build mismatch report" }, { status: 500 });
  }
}
