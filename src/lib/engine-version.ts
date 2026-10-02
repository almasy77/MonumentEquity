/**
 * Engine version stamp (P3-7).
 *
 * calculated_metrics stored on a scenario can be computed by an older engine than
 * the one running now. When engine math that moves returns changes, we bump
 * ENGINE_VERSION; scenarios stamped with an older version are recomputed lazily on
 * read, their prior metrics captured, and a "results changed" delta surfaced so the
 * change is visible rather than silent.
 *
 * When you change engine math that can move IRR / cash-on-cash / DSCR / NOI:
 *   1. bump ENGINE_VERSION,
 *   2. add a one-line reason under that version in ENGINE_CHANGE_REASONS,
 *   3. add a row to CHANGELOG-engine.md.
 */
import { calculateUnderwriting, type ScenarioInputs } from "./underwriting";
import type { Scenario } from "./validations";

/** Current engine version. Bump when engine math can move returns. */
export const ENGINE_VERSION = 3;

/**
 * Why each version differs from the one before it. Shown in the "results changed"
 * banner and keyed by the version a scenario was recomputed UP TO. See
 * CHANGELOG-engine.md for the full history.
 */
export const ENGINE_CHANGE_REASONS: Record<number, string> = {
  1: "Recomputed on the current engine (baseline version stamp)",
  2: "Turnover cost now reads from the OpEx inputs you edit (P1-1); lease-up deals that showed a turnover cost different from the legacy field are corrected",
  3: "Cash-on-cash and equity multiple are now computed on TOTAL equity invested (equity at close plus every capital call), per industry best practice; capex-heavy deals that previously showed these on closing equity only will read lower",
};

export interface StoredMetrics {
  irr?: number;
  cash_on_cash?: number;
  dscr?: number;
  equity_multiple?: number;
  going_in_cap?: number;
  stabilized_cap?: number;
}

/** Prior metrics captured when a version bump moved a scenario's results. */
export interface PreviousMetrics extends StoredMetrics {
  engine_version?: number;
  reason?: string;
  changed_at?: string;
}

/**
 * Adapt a stored scenario to the engine's input shape. This is the single place the
 * *_assumptions → engine field rename lives; every compute site goes through it.
 */
export function toEngineInputs(scenario: Scenario): ScenarioInputs {
  const s = scenario as unknown as Record<string, unknown>;
  return {
    purchase: s.purchase_assumptions,
    financing: s.financing_assumptions,
    revenue: s.revenue_assumptions,
    expenses: s.expense_assumptions,
    capex: s.capex_assumptions,
    exit: s.exit_assumptions,
    tax: s.tax_assumptions,
    depreciation: s.depreciation_assumptions || undefined,
  } as unknown as ScenarioInputs;
}

/** Project a full underwriting result down to the stored metrics blob. */
export function metricsFromResult(result: ReturnType<typeof calculateUnderwriting>): StoredMetrics {
  return {
    irr: result.metrics.irr ?? undefined,
    cash_on_cash: result.metrics.average_cash_on_cash,
    dscr: result.metrics.year1_dscr,
    equity_multiple: result.metrics.equity_multiple,
    going_in_cap: result.metrics.going_in_cap,
    stabilized_cap: result.metrics.stabilized_cap,
  };
}

/** Compute the stored metrics blob straight from a scenario. */
export function computeScenarioMetrics(scenario: Scenario): StoredMetrics {
  return metricsFromResult(calculateUnderwriting(toEngineInputs(scenario)));
}

/**
 * Stamp a scenario's metrics + engine version in one place, mutating it. Use at
 * every write site so calculated_metrics, engine_version and metrics_calculated_at
 * always move together. Pass a precomputed result to avoid recalculating.
 */
export function stampMetrics(
  scenario: Scenario,
  result?: ReturnType<typeof calculateUnderwriting>,
): void {
  const metrics = result ? metricsFromResult(result) : computeScenarioMetrics(scenario);
  const s = scenario as unknown as Record<string, unknown>;
  s.calculated_metrics = metrics;
  s.engine_version = ENGINE_VERSION;
  s.metrics_calculated_at = new Date().toISOString();
}

const KEYS: (keyof StoredMetrics)[] = [
  "irr",
  "cash_on_cash",
  "dscr",
  "equity_multiple",
  "going_in_cap",
  "stabilized_cap",
];

/** True if any metric differs beyond a tiny tolerance (rounding-safe). */
export function metricsDiffer(a: StoredMetrics | undefined, b: StoredMetrics | undefined): boolean {
  if (!a || !b) return false; // nothing to compare → treat as no visible change
  for (const k of KEYS) {
    const av = a[k];
    const bv = b[k];
    if (av == null && bv == null) continue;
    if (av == null || bv == null) return true;
    if (Math.abs(av - bv) > 1e-6) return true;
  }
  return false;
}
