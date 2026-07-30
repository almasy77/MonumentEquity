/**
 * Decomposed reassessment entry (mill rate + assessment ratio). The UI derives
 * effective_tax_rate = assessment_ratio × (mill_rate/1000) and leaves
 * reassessed_value unset so the bill auto-tracks the purchase price:
 *   property tax = purchase_price × assessment_ratio × (mill_rate/1000)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
  inp.revenue.rent_ramp = { ...inp.revenue.rent_ramp!, enabled: false };
  inp.expenses.tax_escalation_rate = 0;
  inp.expenses.property_tax_v2 = undefined;
  return inp;
}

describe("reassessment — decomposed mill × ratio", () => {
  it("auto-tracks the purchase price when reassessed_value is unset", () => {
    const ratio = 0.35;
    const mills = 90; // → 0.09 on assessed
    const effective = ratio * (mills / 1000); // 0.0315 on market — what the UI stores

    const inputs = bryden();
    inputs.expenses.tax_reassessment = {
      enabled: true,
      effective_tax_rate: effective,
      assessment_ratio: ratio,
      mill_rate: mills,
      phase_in_month: 1,
      // reassessed_value intentionally unset → engine uses the live purchase price
    };
    const r = calculateUnderwriting(inputs);

    const price = inputs.purchase.purchase_price;
    const expectedMonthly = (price * ratio * (mills / 1000)) / 12;
    // Month 1 (phase-in), no escalation: assessed × rate / 12.
    expect(r.monthly[0].opex_breakdown.property_tax).toBeCloseTo(expectedMonthly, 2);
    // Raising the purchase price raises the tax proportionally (no stale value).
    const up = calculateUnderwriting({ ...inputs, purchase: { ...inputs.purchase, purchase_price: price * 2 } });
    expect(up.monthly[0].opex_breakdown.property_tax).toBeCloseTo(expectedMonthly * 2, 2);
  });
});
