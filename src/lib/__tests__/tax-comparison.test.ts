/**
 * Cost-seg / REPS comparison lens. Must never change the as-modeled result,
 * and the variants must move in the economically expected directions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { compareCostSegScenarios } from "../tax-comparison";

function golden(name: string): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", `${name}.input.json`), "utf8")) as ScenarioInputs;
}

describe("compareCostSegScenarios", () => {
  it("returns null when the scenario has no tax assumptions (layer off)", () => {
    const i = golden("bryden_base");
    delete (i as Partial<ScenarioInputs>).tax;
    expect(compareCostSegScenarios(i)).toBeNull();
  });

  it("as-modeled row equals the engine's own result, and inputs are not mutated", () => {
    const i = golden("bryden_base");
    const before = JSON.stringify(i);
    const base = calculateUnderwriting(golden("bryden_base"));
    const c = compareCostSegScenarios(i)!;
    expect(JSON.stringify(i)).toBe(before);
    const row = c.rows.find((r) => r.key === "as_modeled")!;
    expect(row.pre_tax_irr).toBe(base.metrics.irr);
    expect(row.after_tax_irr_household).toBe(base.tax!.after_tax_irr_household);
  });

  it("cost seg is a tax-only lever: pre-tax IRR identical across REPS variants", () => {
    const c = compareCostSegScenarios(golden("bryden_base"))!;
    const reps = c.rows.find((r) => r.key === "cost_seg_reps")!;
    const noReps = c.rows.find((r) => r.key === "cost_seg_no_reps")!;
    expect(reps.pre_tax_irr).toBeCloseTo(noReps.pre_tax_irr!, 12);
  });

  it("REPS beats no-REPS on year-1 shield and after-tax IRR; no-REPS leaves suspended losses", () => {
    const c = compareCostSegScenarios(golden("bryden_base"))!;
    const reps = c.rows.find((r) => r.key === "cost_seg_reps")!;
    const noReps = c.rows.find((r) => r.key === "cost_seg_no_reps")!;
    expect(reps.year1_depreciation_shield).toBeGreaterThan(noReps.year1_depreciation_shield);
    expect(reps.after_tax_irr_household!).toBeGreaterThan(noReps.after_tax_irr_household!);
    expect(noReps.pal_at_exit).toBeGreaterThan(0);
  });

  it("with REPS, cost seg front-loads the shield versus no study", () => {
    const i = golden("bryden_base"); // saved REPS = ON all years
    const c = compareCostSegScenarios(i)!;
    const none = c.rows.find((r) => r.key === "no_cost_seg")!;
    const reps = c.rows.find((r) => r.key === "cost_seg_reps")!;
    expect(reps.year1_depreciation_shield).toBeGreaterThan(none.year1_depreciation_shield);
    expect(none.cost_seg_study_cost).toBe(0);
  });

  it("falls back to default reclass percentages when the scenario has none", () => {
    const i = golden("bryden_base");
    i.tax = { ...i.tax!, costseg_5yr_pct: 0, costseg_15yr_pct: 0 };
    const c = compareCostSegScenarios(i)!;
    expect(c.used_default_pcts).toBe(true);
    expect(c.costseg_5yr_pct).toBeGreaterThan(0);
  });

  it("1031 exit reports deferred gain, not exit tax; taxable exit reports exit tax", () => {
    const c1031 = compareCostSegScenarios(golden("bryden_base"))!;
    expect(c1031.exit_via_1031).toBe(true);
    expect(c1031.rows[0].exit_tax).toBeNull();
    expect(c1031.rows[0].deferred_gain).not.toBeNull();

    const i = golden("bryden_base");
    i.tax = { ...i.tax!, exit_via_1031: false };
    const cTax = compareCostSegScenarios(i)!;
    expect(cTax.rows[0].exit_tax).not.toBeNull();
    expect(cTax.rows[0].deferred_gain).toBeNull();
  });
});
