import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRedis } from "@/lib/db";
import { safeJson, isErrorResponse } from "@/lib/api-helpers";
import { calculateUnderwriting } from "@/lib/underwriting";
import {
  ENGINE_VERSION,
  ENGINE_CHANGE_REASONS,
  toEngineInputs,
  metricsFromResult,
  metricsDiffer,
  stampMetrics,
  type StoredMetrics,
} from "@/lib/engine-version";
import { DEAL_STAGES, type DealStage } from "@/lib/constants";
import type { Scenario, Deal } from "@/lib/validations";

/**
 * Bulk metrics re-stamp (P3-7 backfill).
 *
 * Opening a scenario already recomputes it on the current engine, re-stamps the stored
 * calculated_metrics, and captures previous_metrics for the "results changed" banner
 * (see GET /api/scenarios/[id]). But list/pipeline views read the STORED metrics, so a
 * deal that hasn't been opened since an engine bump shows stale numbers. This route does
 * the exact same re-stamp in bulk for deals at a chosen stage or above.
 *
 *   GET  — READ-ONLY preview: what would change, nothing written.
 *   POST — guarded backfill: requires { confirm: "RESTAMP" }; writes the re-stamp.
 *
 * It only ever touches calculated_metrics / engine_version / metrics_calculated_at /
 * previous_metrics. It NEVER changes a scenario's inputs (*_assumptions).
 */
export const maxDuration = 60;

const METRIC_KEYS: (keyof StoredMetrics)[] = [
  "irr", "cash_on_cash", "dscr", "equity_multiple", "going_in_cap", "stabilized_cap",
];

interface RestampRow {
  deal_id: string;
  deal_address: string;
  deal_stage: string;
  scenario_id: string;
  scenario_name: string;
  stored_engine_version: number | null;
  values_changed: boolean;
  changed_fields: string[];
  previous: StoredMetrics | null;
  current: StoredMetrics;
}

/** Fields whose value moved beyond a tiny tolerance. */
function changedFields(a: StoredMetrics | undefined, b: StoredMetrics): string[] {
  if (!a) return [];
  const out: string[] = [];
  for (const k of METRIC_KEYS) {
    const av = a[k];
    const bv = b[k];
    if (av == null && bv == null) continue;
    if (av == null || bv == null || Math.abs(av - bv) > 1e-6) out.push(k);
  }
  return out;
}

/** Deal is at `minStage` or further along the pipeline. */
function atStageOrAbove(stage: string | undefined, minStageIndex: number): boolean {
  if (!stage) return false;
  const idx = DEAL_STAGES.indexOf(stage as DealStage);
  return idx >= 0 && idx >= minStageIndex;
}

/** Scan every key matching a pattern and GET it, in batches. */
async function scanAll<T>(match: string): Promise<T[]> {
  const redis = getRedis();
  const out: T[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, { match, count: 200 });
    cursor = String(next);
    if (keys.length === 0) continue;
    const pipe = redis.pipeline();
    for (const k of keys) pipe.get(k);
    const got = await pipe.exec<(T | null)[]>();
    for (const v of got) if (v) out.push(v);
  } while (cursor !== "0");
  return out;
}

/**
 * Resolve the eligible deals + the scenarios under them, and compute the re-stamp
 * candidates (scenarios whose stored engine_version lags the current engine).
 */
async function buildCandidates(opts: { minStageIndex: number; includeDead: boolean }) {
  const deals = await scanAll<Deal>("deal:*");
  const eligibleDeals = new Map<string, Deal>();
  for (const d of deals) {
    const dd = d as unknown as { id?: string; stage?: string; status?: string };
    if (!dd.id) continue;
    if (!opts.includeDead && dd.status && dd.status !== "active") continue;
    if (!atStageOrAbove(dd.stage, opts.minStageIndex)) continue;
    eligibleDeals.set(dd.id, d);
  }

  const scenarios = await scanAll<Scenario>("scenario:*");
  const candidates: { scenario: Scenario; deal: Deal; row: RestampRow }[] = [];
  let scenariosUnderEligibleDeals = 0;

  for (const s of scenarios) {
    const sc = s as unknown as Record<string, unknown>;
    const dealId = sc.deal_id as string | undefined;
    if (!dealId || !eligibleDeals.has(dealId)) continue;
    scenariosUnderEligibleDeals++;

    // Only scenarios whose stamp lags the current engine need a re-stamp.
    const storedVersion = (sc.engine_version as number | undefined) ?? null;
    if (storedVersion === ENGINE_VERSION) continue;

    let fresh: StoredMetrics;
    try {
      fresh = metricsFromResult(calculateUnderwriting(toEngineInputs(s)));
    } catch {
      continue; // a scenario that can't compute is left untouched
    }
    const stored = sc.calculated_metrics as StoredMetrics | undefined;
    const deal = eligibleDeals.get(dealId)!;
    candidates.push({
      scenario: s,
      deal,
      row: {
        deal_id: dealId,
        deal_address: (deal as unknown as { address?: string }).address ?? "(unknown)",
        deal_stage: (deal as unknown as { stage?: string }).stage ?? "",
        scenario_id: (sc.id as string) ?? "",
        scenario_name: (sc.name as string) ?? "",
        stored_engine_version: storedVersion,
        values_changed: metricsDiffer(stored, fresh),
        changed_fields: changedFields(stored, fresh),
        previous: stored ?? null,
        current: fresh,
      },
    });
  }

  return {
    deals_scanned: deals.length,
    eligible_deals: eligibleDeals.size,
    scenarios_under_eligible_deals: scenariosUnderEligibleDeals,
    candidates,
  };
}

function parseStage(raw: string | null): { minStageIndex: number; minStage: string } {
  const requested = (raw || "screening").toLowerCase();
  const idx = DEAL_STAGES.indexOf(requested as DealStage);
  const minStageIndex = idx >= 0 ? idx : DEAL_STAGES.indexOf("screening");
  return { minStageIndex, minStage: DEAL_STAGES[minStageIndex] };
}

// GET — read-only preview. Shows every scenario that WOULD be re-stamped, with
// before/after metrics and which fields move. Writes nothing.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const params = req.nextUrl.searchParams;
    const { minStageIndex, minStage } = parseStage(params.get("stage"));
    const includeDead = params.get("include_dead") === "1" || params.get("include_dead") === "true";

    const { deals_scanned, eligible_deals, scenarios_under_eligible_deals, candidates } =
      await buildCandidates({ minStageIndex, includeDead });

    const rows = candidates.map((c) => c.row);
    const valueChanges = rows.filter((r) => r.values_changed);
    const byField: Record<string, number> = {};
    for (const r of valueChanges) for (const f of r.changed_fields) byField[f] = (byField[f] ?? 0) + 1;

    const report = {
      generated_at: new Date().toISOString(),
      mode: "preview",
      current_engine_version: ENGINE_VERSION,
      reason: ENGINE_CHANGE_REASONS[ENGINE_VERSION] ?? "Engine updated",
      min_stage: minStage,
      include_dead: includeDead,
      deals_scanned,
      eligible_deals,
      scenarios_under_eligible_deals,
      scenarios_needing_restamp: rows.length,
      scenarios_with_value_changes: valueChanges.length,
      by_changed_field: byField,
      note:
        "Preview only. No data was changed. Each row is a scenario whose stored engine " +
        "version lags the current engine; `values_changed` marks the ones whose metrics " +
        "actually move. POST to this route with { confirm: \"RESTAMP\" } to apply.",
      rows,
    };
    try {
      await getRedis().set("metrics_restamp_report:latest", JSON.stringify(report));
    } catch {
      /* non-fatal */
    }
    return NextResponse.json(report);
  } catch (err) {
    console.error("GET /api/admin/metrics-restamp error:", err);
    return NextResponse.json({ error: "Failed to build re-stamp preview" }, { status: 500 });
  }
}

// POST — guarded backfill. Requires { confirm: "RESTAMP" }. Re-stamps each candidate
// exactly as a scenario read does: captures previous_metrics when the values move, then
// stampMetrics + persist. Inputs are never touched.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const bodyOrError = await safeJson<{ confirm?: string; stage?: string; include_dead?: boolean }>(req);
    if (isErrorResponse(bodyOrError)) return bodyOrError;
    const body = bodyOrError;

    if (body.confirm !== "RESTAMP") {
      return NextResponse.json(
        {
          error: "Confirmation required",
          how_to: 'POST { "confirm": "RESTAMP", "stage": "screening" } to apply. Run GET first to preview.',
        },
        { status: 400 },
      );
    }

    const { minStageIndex, minStage } = parseStage(body.stage ?? null);
    const includeDead = body.include_dead === true;
    const redis = getRedis();

    const { deals_scanned, eligible_deals, scenarios_under_eligible_deals, candidates } =
      await buildCandidates({ minStageIndex, includeDead });

    const reason = ENGINE_CHANGE_REASONS[ENGINE_VERSION] ?? "Engine updated";
    const now = new Date().toISOString();
    const applied: RestampRow[] = [];
    let persistFailures = 0;

    for (const c of candidates) {
      const scenario = c.scenario;
      const sc = scenario as unknown as Record<string, unknown>;
      const stored = sc.calculated_metrics as StoredMetrics | undefined;
      // Capture previous_metrics only when the values actually move (mirrors the GET
      // lazy-recompute path), so the "results changed" banner has something to show.
      if (c.row.values_changed && stored) {
        sc.previous_metrics = {
          ...stored,
          engine_version: sc.engine_version as number | undefined,
          reason,
          changed_at: now,
        };
      }
      // Re-stamp from a fresh compute (recompute inside stampMetrics via the scenario).
      stampMetrics(scenario);
      try {
        await redis.set(`scenario:${c.row.scenario_id}`, JSON.stringify(scenario));
        applied.push(c.row);
      } catch (e) {
        persistFailures++;
        console.error("metrics-restamp persist failed for", c.row.scenario_id, e);
      }
    }

    const report = {
      applied_at: now,
      mode: "backfill",
      current_engine_version: ENGINE_VERSION,
      reason,
      min_stage: minStage,
      include_dead: includeDead,
      deals_scanned,
      eligible_deals,
      scenarios_under_eligible_deals,
      scenarios_restamped: applied.length,
      scenarios_with_value_changes: applied.filter((r) => r.values_changed).length,
      persist_failures: persistFailures,
      note:
        "Re-stamped the stored metrics to the current engine. Only calculated_metrics / " +
        "engine_version / metrics_calculated_at / previous_metrics were changed; inputs were not.",
      rows: applied,
    };
    try {
      await redis.set("metrics_restamp_report:last_backfill", JSON.stringify(report));
    } catch {
      /* non-fatal */
    }
    return NextResponse.json(report);
  } catch (err) {
    console.error("POST /api/admin/metrics-restamp error:", err);
    return NextResponse.json({ error: "Failed to run re-stamp backfill" }, { status: 500 });
  }
}
