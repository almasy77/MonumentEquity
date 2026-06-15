/**
 * Cost segregation (cost-seg-implementation-spec.md): the study COST is a
 * one-time uses-of-funds outflow (never opex/NOI), and the study BENEFIT runs
 * through depreciation. The two must stay separate. Plus the Part-2 guardrails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { TAX_DEFAULTS } from "../tax";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

describe("Cost-seg Part 1 — study cost (uses-of-funds)", () => {
  it("adds to total cost & equity but never touches NOI / cap / DSCR", () => {
    const base = calculateUnderwriting(brydenInputs());
    const withFee = brydenInputs();
    withFee.purchase.cost_seg_study_cost = 10_000;
    const r = calculateUnderwriting(withFee);

    expect(r.metrics.cost_seg_study_cost).toBe(10_000);
    expect(r.metrics.total_cost - base.metrics.total_cost).toBeCloseTo(10_000, 2);
    expect(r.metrics.total_equity - base.metrics.total_equity).toBeCloseTo(10_000, 2);
    // Loan is unchanged (sized off price/NOI, not equity).
    expect(r.metrics.loan_amount).toBeCloseTo(base.metrics.loan_amount, 2);
    // Operating metrics untouched — it's a transaction cost, not opex.
    expect(r.annual[0].noi).toBeCloseTo(base.annual[0].noi, 2);
    expect(r.metrics.going_in_cap).toBeCloseTo(base.metrics.going_in_cap, 9);
    expect(r.metrics.year1_dscr).toBeCloseTo(base.metrics.year1_dscr, 9);
  });

  it("is deducted as a Year-1 professional fee on the tax sheet", () => {
    const base = calculateUnderwriting(brydenInputs());
    const withFee = brydenInputs();
    withFee.purchase.cost_seg_study_cost = 10_000;
    const r = calculateUnderwriting(withFee);

    const ti0Base = base.tax!.years[0].federal_taxable_income;
    const ti0Fee = r.tax!.years[0].federal_taxable_income;
    // Year-1 taxable income lower by exactly the fee.
    expect(ti0Base - ti0Fee).toBeCloseTo(10_000, 2);
  });

  it("absent field ⇒ no change (legacy byte-identical)", () => {
    const r = calculateUnderwriting(brydenInputs());
    expect(r.metrics.cost_seg_study_cost).toBe(0);
  });
});

describe("Cost-seg Part 2 — defaults & guardrails", () => {
  it("default reclass is 25% (5-yr) / 8% (15-yr)", () => {
    expect(TAX_DEFAULTS.costseg_5yr_pct).toBe(0.25);
    expect(TAX_DEFAULTS.costseg_15yr_pct).toBe(0.08);
    expect(TAX_DEFAULTS.land_allocation_pct).toBe(0.2);
    expect(TAX_DEFAULTS.federal_bonus_pct).toBe(1.0);
  });

  it("warns when short-life reclass exceeds 40%", () => {
    const inputs = brydenInputs();
    inputs.tax!.costseg_5yr_pct = 0.30;
    inputs.tax!.costseg_15yr_pct = 0.15; // 45% combined
    const r = calculateUnderwriting(inputs);
    expect(r.warnings.some((w) => w.includes("short-life reclass") || w.includes("reclass is 45%"))).toBe(true);
  });

  it("warns when a reno 5-yr share is set but there is no renovation capex", () => {
    const inputs = brydenInputs();
    inputs.capex.units_to_renovate = 0;
    inputs.capex.projects = [];
    inputs.tax!.reno_5yr_pct = 0.58;
    const r = calculateUnderwriting(inputs);
    expect(r.warnings.some((w) => w.includes("Reno 5-yr") && w.includes("no renovation capex"))).toBe(true);
  });

  it("warns when the Depreciation-block land % disagrees with the Tax sheet", () => {
    const inputs = brydenInputs();
    inputs.tax!.land_allocation_pct = 0.20;
    inputs.depreciation = { land_tax_assessment: 300_000, improvement_tax_assessment: 700_000 }; // 30% land
    const r = calculateUnderwriting(inputs);
    expect(r.warnings.some((w) => w.includes("Land allocation differs"))).toBe(true);
  });

  it("does NOT warn on land when the two agree", () => {
    const inputs = brydenInputs();
    inputs.tax!.land_allocation_pct = 0.20;
    inputs.depreciation = { land_tax_assessment: 200_000, improvement_tax_assessment: 800_000 }; // 20% land
    const r = calculateUnderwriting(inputs);
    expect(r.warnings.some((w) => w.includes("Land allocation differs"))).toBe(false);
  });

  it("surfaces a suspended Year-1 loss when REPS is off (usability gate)", () => {
    const inputs = brydenInputs();
    inputs.tax!.reps_status = [false, false, false, false, false];
    const r = calculateUnderwriting(inputs);
    // Cost-seg + bonus drives a Year-1 loss; REPS off ⇒ suspended, not credited.
    expect(r.tax!.years[0].federal_taxable_income).toBeLessThan(0);
    expect(r.warnings.some((w) => w.includes("suspended") && w.includes("REPS off"))).toBe(true);
    // The shield is NOT credited (federal_tax not a benefit that year).
    expect(r.tax!.year1_federal_shield).toBe(0);
  });
});
