/**
 * operating-reserve-return-spec.md.
 * Part 1: the operating reserve funded at closing is returned at exit (lifts
 * IRR/EM without changing NOI). Part 2: the cost-seg study fee is a Year-1
 * deduction (memo shield), separate from depreciation and gated by REPS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

describe("Part 1 — return of operating reserve at exit", () => {
  it("returns the funded reserve at exit; in equity at t0 and distributions at exit", () => {
    const base = calculateUnderwriting(brydenInputs()); // fixture reserve = 0
    const withReserve = brydenInputs();
    withReserve.purchase.capex_reserve = 135_000;
    const r = calculateUnderwriting(withReserve);

    // Base case (no yield): returned exactly the funded amount.
    expect(r.metrics.return_of_operating_reserve).toBeCloseTo(135_000, 2);
    // Counted in equity at t0 (equity rises by the funded amount)...
    expect(r.metrics.total_equity - base.metrics.total_equity).toBeCloseTo(135_000, 2);
    // ...and returned at exit, so it nets out of profit (in both equity and
    // distributions) — confirming it is NOT a permanent sink.
    expect(r.metrics.total_profit).toBeCloseTo(base.metrics.total_profit, 0);
    // A balance-sheet reserve does NOT touch NOI / cap / DSCR.
    expect(r.annual[0].noi).toBeCloseTo(base.annual[0].noi, 2);
    expect(r.metrics.going_in_cap).toBeCloseTo(base.metrics.going_in_cap, 9);
    expect(r.metrics.year1_dscr).toBeCloseTo(base.metrics.year1_dscr, 9);
  });

  it("yield grows the returned balance", () => {
    const inputs = brydenInputs();
    inputs.purchase.capex_reserve = 100_000;
    inputs.purchase.operating_reserve_yield_rate = 0.04; // 4%/yr over 5-yr hold
    const r = calculateUnderwriting(inputs);
    expect(r.metrics.return_of_operating_reserve).toBeCloseTo(100_000 * Math.pow(1.04, 5), 0);
  });

  it("no reserve ⇒ no return (legacy byte-identical)", () => {
    const r = calculateUnderwriting(brydenInputs()); // fixture reserve = 0
    expect(r.metrics.return_of_operating_reserve).toBe(0);
  });
});

describe("Part 2 — cost-seg study fee deduction", () => {
  it("deducts the fee Year-1 (expense_year1) and reports the memo shield", () => {
    const inputs = brydenInputs();
    inputs.purchase.cost_seg_study_cost = 10_000;
    inputs.tax!.cost_seg_fee_tax_treatment = "expense_year1";
    const r = calculateUnderwriting(inputs);
    expect(r.tax!.cost_seg_fee_deduction_total).toBeCloseTo(10_000, 2);
    // Memo shield = fee × combined ordinary rate (fed + state).
    const rate = inputs.tax!.federal_ordinary_rate + inputs.tax!.state_local_ordinary_rate;
    expect(r.tax!.cost_seg_fee_shield).toBeCloseTo(10_000 * rate, 1);
  });

  it("capitalize_amortize spreads the deduction over 15 years (within hold)", () => {
    const inputs = brydenInputs(); // 5-year hold
    inputs.purchase.cost_seg_study_cost = 15_000;
    inputs.tax!.cost_seg_fee_tax_treatment = "capitalize_amortize";
    const r = calculateUnderwriting(inputs);
    // Only 5 of 15 years fall inside the hold → 5 × (15,000/15) = 5,000.
    expect(r.tax!.cost_seg_fee_deduction_total).toBeCloseTo(5_000, 2);
  });

  it("the fee deduction lowers Year-1 taxable income (separate from depreciation)", () => {
    const noFee = brydenInputs();
    const withFee = brydenInputs();
    withFee.purchase.cost_seg_study_cost = 10_000;
    const a = calculateUnderwriting(noFee).tax!.years[0].federal_taxable_income;
    const b = calculateUnderwriting(withFee).tax!.years[0].federal_taxable_income;
    expect(a - b).toBeCloseTo(10_000, 2);
  });

  it("the fee is NOT added to depreciable basis (depreciation unchanged)", () => {
    const noFee = brydenInputs();
    const withFee = brydenInputs();
    withFee.purchase.cost_seg_study_cost = 10_000;
    const depA = calculateUnderwriting(noFee).tax!.years[0].federal_depreciation;
    const depB = calculateUnderwriting(withFee).tax!.years[0].federal_depreciation;
    expect(depB).toBeCloseTo(depA, 2);
  });
});
