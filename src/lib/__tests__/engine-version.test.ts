import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import type { Scenario } from "../validations";
import {
  ENGINE_VERSION,
  metricsDiffer,
  metricsFromResult,
  stampMetrics,
  computeScenarioMetrics,
  toEngineInputs,
} from "../engine-version";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

// A stored-scenario shape built from a golden engine input (field rename).
function scenarioFromInputs(inp: ScenarioInputs): Scenario {
  return {
    purchase_assumptions: inp.purchase,
    financing_assumptions: inp.financing,
    revenue_assumptions: inp.revenue,
    expense_assumptions: inp.expenses,
    capex_assumptions: inp.capex,
    exit_assumptions: inp.exit,
    tax_assumptions: inp.tax,
  } as unknown as Scenario;
}

describe("engine-version (P3-7)", () => {
  it("toEngineInputs round-trips a scenario back to the same metrics as the raw input", () => {
    const direct = metricsFromResult(calculateUnderwriting(GOLDEN));
    const viaScenario = computeScenarioMetrics(scenarioFromInputs(GOLDEN));
    expect(viaScenario.irr).toBeCloseTo(direct.irr ?? 0, 9);
    expect(viaScenario.equity_multiple).toBeCloseTo(direct.equity_multiple ?? 0, 9);
    expect(toEngineInputs(scenarioFromInputs(GOLDEN)).purchase).toEqual(GOLDEN.purchase);
  });

  it("stampMetrics writes calculated_metrics, the current engine version, and a timestamp", () => {
    const scenario = scenarioFromInputs(GOLDEN);
    const result = calculateUnderwriting(GOLDEN);
    stampMetrics(scenario, result);
    const s = scenario as unknown as Record<string, unknown>;
    expect(s.engine_version).toBe(ENGINE_VERSION);
    expect(typeof s.metrics_calculated_at).toBe("string");
    expect((s.calculated_metrics as { irr?: number }).irr).toBeCloseTo(result.metrics.irr ?? 0, 9);
  });

  it("metricsDiffer detects a real move but tolerates rounding and missing sides", () => {
    expect(metricsDiffer({ irr: 0.195 }, { irr: 0.161 })).toBe(true);
    expect(metricsDiffer({ irr: 0.195 }, { irr: 0.195 + 1e-9 })).toBe(false);
    expect(metricsDiffer(undefined, { irr: 0.2 })).toBe(false); // nothing prior to compare
    expect(metricsDiffer({ irr: 0.2 }, { cash_on_cash: 0.06 })).toBe(true); // irr present vs absent
  });
});
