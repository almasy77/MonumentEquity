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
  it("per-unit rows: stabilized GPR equals sum of market rents (FIXED: Phase 1 unit-state engine)", () => {
    // One unit already at market → max(marked) = 7 < 8 → floor(7/8) = 0 forever.
    const r = calculateUnderwriting(perUnitInputs({ atMarketCount: 1 }));
    const gprM36 = r.monthly[35].gpr;
    expect(Math.abs(gprM36 - 8 * 1000)).toBeLessThanOrEqual(1);
  });

  it("pct_marked_to_market agrees with the rent actually billed (FIXED: Phase 1)", () => {
    const r = calculateUnderwriting(perUnitInputs());
    // Exact identity at every month: pct == stabilized/total, and GPR equals
    // the sum of each unit's state rent (offline bills $0).
    for (let mi = 0; mi < 24; mi++) {
      const sched = r.unit_schedule;
      let stabilized = 0;
      let expectedGpr = 0;
      for (const u of sched.units) {
        const st = u.states[mi];
        if (st === "market" || st === "renovated") stabilized++;
        expectedGpr +=
          st === "in_place" ? u.in_place_rent :
          st === "market" ? u.market_rent :
          st === "renovated" ? u.renovated_rent : 0;
      }
      expect(r.monthly[mi].pct_marked_to_market).toBeCloseTo(stabilized / 8, 9);
      expect(Math.abs(r.monthly[mi].gpr - expectedGpr)).toBeLessThanOrEqual(0.01); // growth=0
    }
    // And the ramp actually completes: by month 12 everyone is at market.
    expect(r.monthly[11].pct_marked_to_market).toBe(1);
  });

  it("vacant units (rent $0, status vacant) lease up to market even when the override is 0 (FIXED: Phase 1)", () => {
    const r = calculateUnderwriting(perUnitInputs({ vacantCount: 2 }));
    // Vacant lease-up = 2 months → from month 3 (index 2) both vacant units
    // are in the market state billing $1,000, regardless of the 0 override
    // (a vacant-override mismatch warning is pushed instead).
    const vacants = r.unit_schedule.units.filter((u) => u.in_place_rent === 0);
    expect(vacants).toHaveLength(2);
    for (const v of vacants) {
      expect(v.states[0]).toBe("vacant_leaseup");
      expect(v.states[1]).toBe("vacant_leaseup");
      expect(v.states[2]).toBe("market");
    }
    expect(r.warnings.some((w) => w.includes("Vacant @ Acquisition"))).toBe(true);
  });

  it("modeled loan respects min(LTV loan, DSCR-sized loan)", () => {
    // Price high enough that the DSCR-sized loan binds below the LTV loan
    // (Phase 4 sizing: loan = min(LTV proceeds, DSCR proceeds @ floor)).
    const inputs = perUnitInputs();
    inputs.purchase.purchase_price = 1_100_000;
    const r = calculateUnderwriting(inputs);
    const ltvLoan = 1_100_000 * 0.7;
    // DSCR-sized at 1.25 from year-1 NOI and the actual payment constant.
    const monthlyRate = 0.07 / 12;
    const n = 360;
    const pmtFactor = (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
    const maxAnnualDS = r.annual[0].noi / 1.25;
    const dscrLoan = maxAnnualDS / 12 / pmtFactor;
    expect(r.metrics.loan_amount).toBeLessThanOrEqual(Math.min(ltvLoan, dscrLoan) + 1);
  });
});
