/**
 * Paced renovation ramp — property-based verification.
 *
 * The exact month-by-month turn schedule (which unit renovates when, downtime,
 * absorption) is the engine's own machinery and has its own tests; re-deriving it here
 * would just re-implement it. Instead this asserts the INVARIANTS that must hold for
 * any correct schedule, on a paced reno (units 3→14, 1-month downtime):
 *   - renovation capex is CONSERVED (= per-unit × units) and WINDOWED (only inside the
 *     renovation months, zero afterward);
 *   - year-1 GPR (mid-ramp) is strictly BETWEEN all-current and all-renovated;
 *   - GPR is MONOTONIC non-decreasing;
 *   - once the ramp finishes, the deal is fully STABILIZED at renovated rents
 *     (units × renovated × 12, grown by rent growth);
 *   - downtime REDUCES rent during the window and has no effect after it.
 */
import { describe, it, expect } from "vitest";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const UNITS = 12, CURRENT = 1_000, MARKET = 1_200, PREMIUM = 100, RENOVATED = MARKET + PREMIUM; // 1,300
const ALL_CURRENT = UNITS * CURRENT * 12; // 144,000
const ALL_RENOVATED = UNITS * RENOVATED * 12; // 187,200

function pacedDeal(downtime: boolean): ScenarioInputs {
  return {
    purchase: { purchase_price: 1_200_000, closing_cost_rate: 0.02, capex_reserve: 0, cost_seg_study_cost: 0 },
    financing: { ltv: 0.7, interest_rate: 0.06, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0.01, size_to_dscr: false },
    revenue: { unit_mix: [{ type: "1BR/1BA", count: UNITS, current_rent: CURRENT, market_rent: MARKET, renovated_rent_premium: PREMIUM }], other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0.03 },
    expenses: { management_fee_rate: 0, payroll_annual: 20_000, repairs_maintenance_per_unit: 500, turnover_cost_per_unit: 0, turnover_rate: 0, insurance_per_unit: 300, property_tax_total: 15_000, tax_escalation_rate: 0.03, expense_escalation_rate: 0.03, utilities_per_unit: 600, admin_legal_marketing: 4_000, contract_services: 3_000, reserves_per_unit: 0 },
    capex: { per_unit_cost: 8_000, units_to_renovate: UNITS, per_unit_enabled: true, renovation_start_month: 3, renovation_end_month: 14, renovation_downtime_enabled: downtime, renovation_downtime_months: 1, projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.02, proforma_unrenovated_basis: "current", proforma_renovated_basis: "market_plus_premium" },
    tax: null,
  } as unknown as ScenarioInputs;
}

describe("paced renovation ramp — invariants", () => {
  const res = calculateUnderwriting(pacedDeal(false));
  const gpr = res.annual.map((a) => a.gpr);
  const reno = res.annual.map((a) => a.capex_renovation ?? 0);

  it("renovation capex is conserved and windowed", () => {
    expect(reno.reduce((s, v) => s + v, 0)).toBeCloseTo(8_000 * UNITS, 0); // total = per-unit × units
    // Renovation window is months 3–14, so spend lands only in years 1–2.
    expect(reno[2]).toBe(0); expect(reno[3]).toBe(0); expect(reno[4]).toBe(0);
    expect(reno[0] + reno[1]).toBeCloseTo(8_000 * UNITS, 0);
  });

  it("year-1 GPR (mid-ramp) is strictly between all-current and all-renovated", () => {
    expect(gpr[0]).toBeGreaterThan(ALL_CURRENT);
    expect(gpr[0]).toBeLessThan(ALL_RENOVATED);
  });

  it("GPR ramps monotonically", () => {
    for (let y = 1; y < gpr.length; y++) expect(gpr[y]).toBeGreaterThanOrEqual(gpr[y - 1] - 1);
  });

  it("stabilizes at renovated rents once the ramp completes", () => {
    // By year 3 all units are renovated; GPR = units × renovated × 12, grown by rent growth.
    expect(gpr[2]).toBeCloseTo(ALL_RENOVATED * Math.pow(1.03, 2), 0);
    expect(gpr[4]).toBeCloseTo(ALL_RENOVATED * Math.pow(1.03, 4), 0);
  });
});

describe("paced renovation ramp — downtime", () => {
  const noDt = calculateUnderwriting(pacedDeal(false)).annual.map((a) => a.gpr);
  const withDt = calculateUnderwriting(pacedDeal(true)).annual.map((a) => a.gpr);

  it("reduces GPR during the renovation window", () => {
    expect(withDt[0]).toBeLessThan(noDt[0]); // year 1 is inside the window
  });

  it("has no effect after the ramp completes", () => {
    expect(withDt[4]).toBeCloseTo(noDt[4], 0); // year 5 identical
  });
});
