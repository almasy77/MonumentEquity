/**
 * Known-bug tests (fix-spec 2026-06-12). Written with it.fails so the suite
 * is green while the bugs exist; each flips to a plain `it` as its phase lands.
 *
 * Deviation from the spec list: "three-path GPR agreement" is enforced by
 * Phase 1's structural unification (one schedule, three consumers) plus the
 * Phase 3 reconciliation tie-outs, rather than as a brittle pre-fix test —
 * the exit/sensitivity GPR paths are not independently exported today.
 * "bid_price labeled" is an export-level check (Phase 3 d), not an engine test.
 */
import { describe, it, expect } from "vitest";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs, UnitMix } from "../underwriting";

/**
 * 8 per-unit rows (count=1) — the shape PR #66 rent-roll loading produces.
 * The floor-share bug has two modes:
 *  - transient: while cumulative marked k < N, floor(k/N) = 0 → pure in-place rents
 *  - permanent: when max(marked) < N (e.g. one unit already AT market, so it
 *    never "turns"), floor stays 0 for the entire hold → market rent never bills.
 * atMarketCount > 0 produces the permanent mode (Bryden's unit 12).
 */
function perUnitInputs(overrides?: { vacantCount?: number; atMarketCount?: number }): ScenarioInputs {
  const vacantCount = overrides?.vacantCount ?? 0;
  const atMarketCount = overrides?.atMarketCount ?? 0;
  const unit_mix: UnitMix[] = Array.from({ length: 8 }, (_, i) => {
    const vacant = i < vacantCount;
    const atMarket = !vacant && i >= 8 - atMarketCount;
    const rent = vacant ? 0 : atMarket ? 1000 : 700;
    return {
      unit_number: `${i + 1}`,
      type: "1BR/1BA",
      count: 1,
      current_rent: rent,
      market_rent: 1000,
      renovated_rent_premium: 150,
      units: [{ unit_id: `${i + 1}`, status: vacant ? ("vacant" as const) : ("mtm" as const), current_rent: rent }],
    };
  });
  return {
    purchase: { purchase_price: 640000, closing_cost_rate: 0.02, earnest_money: 0, capex_reserve: 0 },
    financing: { ltv: 0.7, interest_rate: 0.07, amortization_years: 30, loan_term_years: 5, io_period_months: 0, origination_fee_rate: 0.01 },
    revenue: {
      unit_mix,
      other_income_monthly: 0,
      vacancy_rate: 0,
      bad_debt_rate: 0,
      concessions_rate: 0,
      rent_growth_rate: 0, // zero growth → stabilized GPR is exactly the market sum
      rent_ramp: {
        enabled: true,
        mode: "schedule",
        absorption_months: 12,
        turn_downtime_months: 1,
        max_turns_per_month: 2,
        initial_vacant_units: 0, // 5th-St-style data-entry gap: detail says vacant, override says 0
        vacant_leaseup_months: 2,
        analysis_start_date: "2026-06-01",
      },
    },
    expenses: {
      management_fee_rate: 0.08, payroll_annual: 0, repairs_maintenance_per_unit: 600,
      turnover_cost_per_unit: 1000, turnover_rate: 0.4, insurance_per_unit: 450,
      property_tax_total: 8000, tax_escalation_rate: 0.02, utilities_per_unit: 1000,
      admin_legal_marketing: 0, contract_services: 0, reserves_per_unit: 300,
    },
    capex: {
      per_unit_cost: 0, units_to_renovate: 0,
      renovation_downtime_enabled: false, renovation_downtime_months: 0,
      projects: [], reserves_per_unit: 300,
    },
    exit: {
      hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.02,
      proforma_unrenovated_basis: "current", proforma_renovated_basis: "market_plus_premium",
    },
  } as unknown as ScenarioInputs;
}

describe("known bugs (flip it.fails → it as phases land)", () => {
  it.fails("per-unit rows: stabilized GPR equals sum of market rents (floor-share bug, permanent mode)", () => {
    // One unit already at market → max(marked) = 7 < 8 → floor(7/8) = 0 forever.
    const r = calculateUnderwriting(perUnitInputs({ atMarketCount: 1 }));
    const gprM36 = r.monthly[35].gpr;
    expect(Math.abs(gprM36 - 8 * 1000)).toBeLessThanOrEqual(1);
  });

  it.fails("pct_marked_to_market agrees with the rent actually billed (transient mode)", () => {
    const r = calculateUnderwriting(perUnitInputs());
    // Month 3 (index 2): pacing 2/mo + 1mo downtime → 4 of 8 marked. floor(4/8)=0
    // bills pure in-place rents while pct reports 50%.
    const m = r.monthly[2];
    const pct = m.pct_marked_to_market;
    expect(pct).toBeGreaterThan(0); // sanity: the ramp is running
    const blended = 8 * 700 * (1 - pct) + 8 * 1000 * pct;
    expect(Math.abs(m.gpr - blended)).toBeLessThanOrEqual(1000);
  });

  it.fails("vacant units (rent $0, status vacant) lease up to market even when the override is 0", () => {
    const r = calculateUnderwriting(perUnitInputs({ vacantCount: 2 }));
    // Vacant lease-up = 2 months → in month 3 (index 2) the two vacant units
    // must pay market. Cumulative marked is 6 < 8 → floor zeroes it today and
    // those units bill $0 (their in-place rent).
    const gprM3 = r.monthly[2].gpr;
    expect(gprM3).toBeGreaterThanOrEqual(6 * 700 + 2 * 1000 - 1);
  });

  it.fails("modeled loan respects min(LTV loan, DSCR-sized loan)", () => {
    // Permanent floor mode keeps NOI at in-place levels → DSCR constraint binds
    // below the LTV loan, and the engine ignores it today.
    const inputs = perUnitInputs({ atMarketCount: 1 });
    const r = calculateUnderwriting(inputs);
    const ltvLoan = 640000 * 0.7;
    // DSCR-sized at 1.25 from year-1 NOI and the actual payment constant.
    const monthlyRate = 0.07 / 12;
    const n = 360;
    const pmtFactor = (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
    const maxAnnualDS = r.annual[0].noi / 1.25;
    const dscrLoan = maxAnnualDS / 12 / pmtFactor;
    expect(r.metrics.loan_amount).toBeLessThanOrEqual(Math.min(ltvLoan, dscrLoan) + 1);
  });
});
