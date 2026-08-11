/**
 * ENG-4: a deal whose equity cash-flow vector has no sign change has NO internal rate
 * of return. The headline must be null, and the sensitivity grid must render every
 * cell n/a — never a fabricated number. (The grid's fast path used to zero the exit
 * value on a negative-NOI deal, so a positive operating-reserve return manufactured a
 * spurious sign change and a meaningless deeply-negative IRR that even varied by price
 * row but not by exit-cap column.)
 */
import { describe, it, expect } from "vitest";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

/** All-equity deal with expenses well above income → negative NOI → no IRR. */
function brokenDeal(): ScenarioInputs {
  return {
    purchase: { purchase_price: 1_000_000, closing_cost_rate: 0.02, capex_reserve: 100_000, cost_seg_study_cost: 0 },
    financing: { ltv: 0, interest_rate: 0.06, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0, size_to_dscr: false },
    revenue: {
      unit_mix: [{ type: "1BR/1BA", count: 12, current_rent: 300, market_rent: 300, renovated_rent_premium: 0 }],
      other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0.02,
    },
    expenses: {
      management_fee_rate: 0, payroll_annual: 40_000, repairs_maintenance_per_unit: 1_000, turnover_cost_per_unit: 0,
      turnover_rate: 0, insurance_per_unit: 800, property_tax_total: 60_000, tax_escalation_rate: 0.03,
      expense_escalation_rate: 0.03, utilities_per_unit: 1_200, admin_legal_marketing: 6_000, contract_services: 4_000, reserves_per_unit: 0,
    },
    capex: { per_unit_cost: 0, units_to_renovate: 0, per_unit_enabled: false, renovation_start_month: 1, projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.07, selling_cost_rate: 0.02 },
    tax: null,
  } as unknown as ScenarioInputs;
}

describe("ENG-4: no IRR when the cash-flow vector never changes sign", () => {
  const res = calculateUnderwriting(brokenDeal());

  it("year-1 NOI is negative (the deal is fundamentally broken)", () => {
    expect(res.annual[0].noi).toBeLessThan(0);
  });

  it("headline IRR is null, not zero or a bound", () => {
    expect(res.metrics.irr).toBeNull();
  });

  it("every sensitivity cell is null (no fabricated -60% values)", () => {
    expect(res.sensitivity.length).toBeGreaterThan(0);
    for (const c of res.sensitivity) expect(c.irr).toBeNull();
  });

  it("a healthy deal still returns a numeric IRR and grid (regression guard)", () => {
    const healthy = brokenDeal();
    (healthy.expenses as { property_tax_total: number }).property_tax_total = 8_000;
    (healthy.expenses as { payroll_annual: number }).payroll_annual = 5_000;
    (healthy.revenue as { unit_mix: Array<{ current_rent: number; market_rent: number }> }).unit_mix[0].current_rent = 1_400;
    (healthy.revenue as { unit_mix: Array<{ current_rent: number; market_rent: number }> }).unit_mix[0].market_rent = 1_400;
    const r = calculateUnderwriting(healthy);
    expect(r.metrics.irr).not.toBeNull();
    expect(r.sensitivity.some((c) => c.irr != null)).toBe(true);
  });
});
