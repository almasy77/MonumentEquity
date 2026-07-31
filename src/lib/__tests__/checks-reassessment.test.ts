/**
 * Validation check (j): the reassessment "basis" decomposition (mill_rate ×
 * assessment_ratio × (1 − reduction)) must tie to the effective_tax_rate the engine
 * actually bills. When they drift, the exported basis text ("75 mills") contradicts
 * the dollar figure — this check hard-FAILS on that drift rather than reporting n/a.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { computeReconciliationChecks } from "../checks";
import type { Deal } from "../validations";

function setup(tr: Record<string, unknown>) {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
  inp.expenses.property_tax_v2 = undefined;
  inp.expenses.tax_reassessment = tr as never;
  const result = calculateUnderwriting(inp);
  const deal = { id: "d1", units: inp.revenue.unit_mix.reduce((s, u) => s + u.count, 0) } as unknown as Deal;
  const checks = computeReconciliationChecks(deal, inp, result);
  return checks.find((c) => c.id === "j")!;
}

describe("check (j) — reassessment basis ties to billed rate", () => {
  it("PASSES when mill × ratio equals the effective rate (decomposed entry)", () => {
    const ratio = 0.35, mills = 75;
    const j = setup({ enabled: true, assessment_ratio: ratio, mill_rate: mills, effective_tax_rate: ratio * (mills / 1000), phase_in_month: 1 });
    expect(j.pass).toBe(true);
  });

  it("FAILS (not n/a) when mill_rate has drifted from the billed effective rate", () => {
    // 295 Thurman signature: mill_rate 75 but effective 2.198% (≈62.8 eff mills).
    const j = setup({ enabled: true, assessment_ratio: 0.35, mill_rate: 75, effective_tax_rate: 0.02198, phase_in_month: 1 });
    expect(j.pass).toBe(false);
    expect(j.detail).toMatch(/disagree/);
  });

  it("honors the mill reduction factor in the reconciliation", () => {
    const ratio = 0.35, mills = 90, reduction = 0.35;
    const j = setup({ enabled: true, assessment_ratio: ratio, mill_rate: mills, mill_reduction_rate: reduction, effective_tax_rate: ratio * (mills / 1000) * (1 - reduction), phase_in_month: 1 });
    expect(j.pass).toBe(true);
  });

  it("reports n/a only when reassessment is off", () => {
    const j = setup({ enabled: false, effective_tax_rate: 0.0185 });
    expect(j.pass).toBe(true);
    expect(j.detail).toMatch(/n\/a/);
  });
});
