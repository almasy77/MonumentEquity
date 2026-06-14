/**
 * Tax reassessment phase-in is MONTH-precise (not year-granular): the
 * reassessed bill switches on at the exact pro forma month, and a mid-year
 * switch is pro-rated. Legacy phase_in_year stays byte-identical.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, reassessedTaxForMonth } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function cleanReassessScenario(): ScenarioInputs {
  const inputs = JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
  // Isolate property tax: ramp off (stable occupancy), no escalation, known
  // entered bill ($12,000/yr) vs a reassessed bill ($24,000/yr).
  inputs.revenue.rent_ramp = { ...inputs.revenue.rent_ramp!, enabled: false };
  inputs.expenses.tax_escalation_rate = 0;
  inputs.expenses.property_tax_total = 12_000;
  inputs.expenses.opex_inputs = { ...(inputs.expenses.opex_inputs ?? {}), property_tax: { value: 12_000, mode: "total_annual" } };
  inputs.expenses.property_tax_v2 = undefined;
  inputs.expenses.tax_reassessment = {
    enabled: true,
    effective_tax_rate: 0.024,
    reassessed_value: 1_000_000, // 0.024 × 1,000,000 = $24,000/yr → $2,000/mo
    apply_at_exit: true,
  };
  return inputs;
}

describe("tax reassessment — month-precise phase-in", () => {
  it("switches the bill at the exact pro forma month (mid-year pro-rated)", () => {
    const inputs = cleanReassessScenario();
    inputs.expenses.tax_reassessment!.phase_in_month = 7; // month index 6
    const r = calculateUnderwriting(inputs);

    // Months 1–6 (index 0–5): entered bill $1,000/mo.
    expect(r.monthly[0].opex_breakdown.property_tax).toBeCloseTo(1000, 2);
    expect(r.monthly[5].opex_breakdown.property_tax).toBeCloseTo(1000, 2);
    // Month 7 onward (index 6+): reassessed $2,000/mo.
    expect(r.monthly[6].opex_breakdown.property_tax).toBeCloseTo(2000, 2);
    expect(r.monthly[11].opex_breakdown.property_tax).toBeCloseTo(2000, 2);
    // Year-1 annual is the blend: 6×1000 + 6×2000 = 18,000.
    expect(r.annual[0].opex_breakdown.property_tax).toBeCloseTo(18_000, 1);
    // Year 2 is fully reassessed.
    expect(r.annual[1].opex_breakdown.property_tax).toBeCloseTo(24_000, 1);
  });

  it("reassessedTaxForMonth returns null before phase-in, monthly bill after", () => {
    const inputs = cleanReassessScenario();
    inputs.expenses.tax_reassessment!.phase_in_month = 4; // index 3
    expect(reassessedTaxForMonth(inputs.expenses, inputs.purchase.purchase_price, 2)).toBeNull();
    expect(reassessedTaxForMonth(inputs.expenses, inputs.purchase.purchase_price, 3)).toBeCloseTo(2000, 2);
  });

  it("legacy phase_in_year is byte-identical to a year-boundary month", () => {
    const yearBased = cleanReassessScenario();
    yearBased.expenses.tax_reassessment!.phase_in_year = 2; // reassess from pro forma year 2

    const monthBased = cleanReassessScenario();
    monthBased.expenses.tax_reassessment!.phase_in_month = 13; // first month of year 2

    const rY = calculateUnderwriting(yearBased);
    const rM = calculateUnderwriting(monthBased);
    // Year 1 fully entered ($12k), year 2 fully reassessed ($24k), identical both ways.
    expect(rY.annual[0].opex_breakdown.property_tax).toBeCloseTo(12_000, 1);
    expect(rY.annual[1].opex_breakdown.property_tax).toBeCloseTo(24_000, 1);
    expect(rM.annual[0].opex_breakdown.property_tax).toBeCloseTo(rY.annual[0].opex_breakdown.property_tax, 2);
    expect(rM.annual[1].opex_breakdown.property_tax).toBeCloseTo(rY.annual[1].opex_breakdown.property_tax, 2);
  });
});
