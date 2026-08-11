/**
 * ENG-2: the mark-to-market ramp must run under EVERY display basis, a Loss to
 * Lease line must carry the gap from collectible to market potential, and a $0
 * current rent must be treated as VACANT (Bryan's decision), not "already at
 * market."
 *
 * Root cause (fixed in buildUnitStateSchedule): the migration queue was gated to
 * `inPlaceBasis === "current"`, and `in_place_rent` was set to market under the
 * Market basis. So a deal on Market basis (4443 Mobile Drive, Likely) booked
 * full market rent from month 1 — including on 15 of 24 units that collect
 * nothing — and %Marked-to-Market read 0 forever. Now the ramp always starts
 * from actual in-place rents, vacant lease-ups and mark-up turns share one
 * turn-slot budget, and aggregate $0 rows lease up instead of booking market.
 *
 * The Loss to Lease is exposed as `loss_to_lease`; the market ceiling is
 * `gpr + loss_to_lease` (the collectible line `gpr` = market once stabilized).
 *
 * Exact post-fix EGI/NOI are the ENGINE'S reported figures for the 4443 fixture
 * and were reported back before locking, per the spec. They reveal the real
 * economics the Market-basis bug hid: an 8.6% going-in cap collapses to ~0.5%
 * in Year 1 because 15 of 24 units pay nothing and lease up through a 2-turn/mo
 * cap. That is the point of the fix.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const LIKELY = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

describe("ENG-2: mark-to-market ramp + loss to lease (4443 Likely, Market basis)", () => {
  const res = calculateUnderwriting(LIKELY);
  const m1 = res.monthly[0];
  const y1 = res.annual[0];

  it("GPR stays at market: month-1 ceiling (collectible + loss to lease) = $29,880", () => {
    expect(m1.gpr + m1.loss_to_lease).toBeCloseTo(29880, 2);
  });

  it("month-1 collectible is only the 9 paying units' rent = $9,723 (15 $0 units are vacant)", () => {
    expect(m1.gpr).toBeCloseTo(9723, 2);
  });

  it("Loss to Lease is non-zero in month 1 and equals the exact $20,157 in-place gap", () => {
    expect(m1.loss_to_lease).toBeCloseTo(20157, 2);
  });

  it("%Marked-to-Market is < 100% in Year 1 and rises monotonically to 100%", () => {
    const mtm = res.annual.map((a) => a.pct_marked_to_market);
    expect(mtm[0]).toBeGreaterThan(0);
    expect(mtm[0]).toBeLessThan(1);
    for (let i = 1; i < mtm.length; i++) expect(mtm[i]).toBeGreaterThanOrEqual(mtm[i - 1] - 1e-9);
    expect(mtm[mtm.length - 1]).toBeCloseTo(1, 6);
  });

  it("Loss to Lease decays to $0 once the ramp stabilizes", () => {
    expect(y1.loss_to_lease).toBeGreaterThan(0);
    expect(res.annual[res.annual.length - 1].loss_to_lease).toBeCloseTo(0, 2);
  });

  it("Year 1 EGI falls materially below the Market-basis $359,546 (reported: $205,772.90)", () => {
    expect(y1.egi).toBeLessThan(300_000);
    expect(y1.egi).toBeCloseTo(205772.90, 0);
  });

  it("Year 1 NOI reflects the true collectible, not full market (reported: $9,620.75)", () => {
    expect(y1.noi).toBeCloseTo(9620.75, 0);
  });
});

/**
 * Ramp-wiring proof (spec: "Absorption Months = 0 reproduces GPR at market from
 * month 1, loss to lease zero"). Isolated on a no-vacancy deal with unlimited
 * turns and no downtime so the only variable is the absorption window.
 */
function occupiedBelowMarket(absorption: number): ScenarioInputs {
  return {
    purchase: { purchase_price: 2_000_000, closing_cost_rate: 0.02, capex_reserve: 0, cost_seg_study_cost: 0 },
    financing: { ltv: 0.7, interest_rate: 0.06, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0, size_to_dscr: false },
    revenue: {
      unit_mix: [{ type: "1BR/1BA", count: 24, current_rent: 900, market_rent: 1200, renovated_rent_premium: 0 }],
      other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0,
      rent_ramp: { enabled: true, mode: "linear", absorption_months: absorption, turn_downtime_months: 0, max_turns_per_month: 999, initial_vacant_units: 0, vacant_leaseup_months: 0 },
    },
    expenses: {
      management_fee_rate: 0, payroll_annual: 0, repairs_maintenance_per_unit: 0, turnover_cost_per_unit: 0, turnover_rate: 0,
      insurance_per_unit: 0, property_tax_total: 0, tax_escalation_rate: 0, expense_escalation_rate: 0, utilities_per_unit: 0, admin_legal_marketing: 0, contract_services: 0, reserves_per_unit: 0,
    },
    capex: { per_unit_cost: 0, units_to_renovate: 0, per_unit_enabled: false, renovation_start_month: 1, projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.02, proforma_unrenovated_basis: "market", proforma_renovated_basis: "market_plus_premium" },
    tax: null,
  } as unknown as ScenarioInputs;
}

describe("ENG-2: the ramp is wired to absorption, not merely present", () => {
  it("absorption 0 → GPR at market from month 1, loss to lease zero", () => {
    const r = calculateUnderwriting(occupiedBelowMarket(0)).monthly[0];
    expect(r.gpr).toBeCloseTo(24 * 1200, 2); // full market
    expect(r.loss_to_lease).toBeCloseTo(0, 2);
  });

  it("absorption 24 → month-1 loss to lease is strictly positive", () => {
    const r = calculateUnderwriting(occupiedBelowMarket(24)).monthly[0];
    expect(r.loss_to_lease).toBeGreaterThan(0);
    expect(r.gpr + r.loss_to_lease).toBeCloseTo(24 * 1200, 2); // ceiling still market
  });
});
