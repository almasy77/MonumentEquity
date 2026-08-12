/**
 * ENG-1: turnover expense must never collapse to $0 while a positive turnover
 * rate and a positive per-unit cost are configured.
 *
 * Root cause (fixed in computeRampTurnoverCost): the ongoing-churn term keyed off
 * "stabilized" units — only those in the `market`/`renovated` states. Under a
 * MARKET pro-forma basis every occupied unit stayed in the `in_place` state at
 * market rent and never migrated, so the stabilized count was 0 in all 120
 * months and turnover booked $0 — even though the assumptions specified a $/unit
 * cost at a positive turnover rate. Natural tenant churn happens on EVERY
 * rent-paying unit, so ongoing churn is now based on occupied units (in_place +
 * market + renovated).
 *
 * This test isolates the turnover floor on a STABILIZED deal (in-place already
 * at market, no vacancy) so the assertion is invariant to the ENG-2 ramp — the
 * ramp has nothing to migrate here. It reproduces the ENG-1 bug precisely:
 * before the fix every unit sits in `in_place`, the stabilized count is 0, and
 * the old code booked $0 turnover; after the fix, turnover = units × rate × cost.
 */
import { describe, it, expect } from "vitest";
import {
  calculateUnderwriting,
  computeRampTurnoverCost,
  type ScenarioInputs,
} from "../underwriting";

/** 24 units, in-place already at market ($1,000), Market basis, ramp ON but with
 *  nothing to migrate. Turnover $2,500/unit at 8%/yr → $4,800/yr. */
function stabilizedMarketDeal(): ScenarioInputs {
  return {
    purchase: { purchase_price: 2_050_000, closing_cost_rate: 0.02, capex_reserve: 0, cost_seg_study_cost: 0 },
    financing: { ltv: 0.7, interest_rate: 0.065, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0, size_to_dscr: false },
    revenue: {
      unit_mix: [{ type: "1BR/1BA", count: 24, current_rent: 1_000, market_rent: 1_000, renovated_rent_premium: 0 }],
      other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0,
      rent_ramp: { enabled: true, mode: "linear", absorption_months: 24, turn_downtime_months: 1, max_turns_per_month: 2, initial_vacant_units: 0, vacant_leaseup_months: 2 },
    },
    expenses: {
      management_fee_rate: 0, payroll_annual: 0, repairs_maintenance_per_unit: 0,
      turnover_cost_per_unit: 2_500, turnover_rate: 0.08, insurance_per_unit: 0, property_tax_total: 0,
      tax_escalation_rate: 0, expense_escalation_rate: 0, utilities_per_unit: 0, admin_legal_marketing: 0, contract_services: 0, reserves_per_unit: 0,
    },
    capex: { per_unit_cost: 0, units_to_renovate: 0, per_unit_enabled: false, renovation_start_month: 1, projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.02, proforma_unrenovated_basis: "market", proforma_renovated_basis: "market_plus_premium" },
    tax: null,
  } as unknown as ScenarioInputs;
}

describe("ENG-1: turnover is assumption-derived, never $0 under Market basis", () => {
  const res = calculateUnderwriting(stabilizedMarketDeal());

  it("Year 1 turnover = $2,500 × 24 × 8% = $4,800.00 (old code booked $0)", () => {
    expect(res.annual[0].opex_breakdown.turnover).toBeCloseTo(4800, 6);
  });

  it("every one of the 60 months books a positive turnover expense", () => {
    for (const mo of res.monthly) expect(mo.opex_breakdown.turnover).toBeGreaterThan(0);
  });

  it("no loss to lease and no ramp churn on an already-stabilized deal (isolates the floor)", () => {
    expect(res.annual[0].loss_to_lease).toBeCloseTo(0, 6);
    // Constant $4,800/yr every year — pure ongoing churn, no absorption spike.
    for (const a of res.annual) expect(a.opex_breakdown.turnover).toBeCloseTo(4800, 6);
  });
});

describe("ENG-1: computeRampTurnoverCost floor invariant", () => {
  it("returns > 0 whenever occupied units, rate and cost are all positive — even with zero turns", () => {
    const cost = computeRampTurnoverCost({ perUnitCost: 2500, marketTurnsThisMonth: 0, renoTurnsThisMonth: 0, occupiedUnits: 24, turnoverRate: 0.08 });
    expect(cost).toBeCloseTo(400, 6); // 24 × (0.08/12) × 2500 = $400/mo → $4,800/yr
  });

  it("is $0 only when there is no occupancy and no turns (a truly empty month)", () => {
    expect(computeRampTurnoverCost({ perUnitCost: 2500, marketTurnsThisMonth: 0, renoTurnsThisMonth: 0, occupiedUnits: 0, turnoverRate: 0.08 })).toBe(0);
  });

  it("adds ramp make-ready on top of ongoing churn during absorption turns", () => {
    const withTurns = computeRampTurnoverCost({ perUnitCost: 2500, marketTurnsThisMonth: 2, renoTurnsThisMonth: 0, occupiedUnits: 24, turnoverRate: 0.08 });
    const noTurns = computeRampTurnoverCost({ perUnitCost: 2500, marketTurnsThisMonth: 0, renoTurnsThisMonth: 0, occupiedUnits: 24, turnoverRate: 0.08 });
    expect(withTurns - noTurns).toBeCloseTo(2 * 2500, 6); // two non-reno turns × cost
  });
});
