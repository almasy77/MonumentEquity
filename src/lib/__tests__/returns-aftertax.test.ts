/**
 * After-tax layer — internal-consistency + first-principles verification.
 *
 * The tax layer already has targeted coverage (cost-seg, depreciation-shield,
 * taxable-exit, reassessment). This adds two independent cross-checks of the
 * after-tax RETURN itself:
 *   1. after-tax IRR consistency — reconstruct the after-tax cash flows (pre-tax CF
 *      − federal/state/NIIT tax, exit proceeds net of exit tax) and confirm an
 *      independent IRR solver reproduces the reported after-tax IRR — on a 1031 deal
 *      (bryden) AND a fully-taxable-exit deal (so the recapture/gain path is exercised).
 *   2. straight-line depreciation from first principles — with bonus and cost-seg off,
 *      the schedule must be constant 27.5-yr straight-line on the land-carved
 *      improvement basis, with the mid-month first-year convention.
 *
 * NOTE: this verifies the tax MATH is self-consistent and the straight-line core is
 * right. The LEGAL correctness of the advanced features (bonus depreciation, cost-seg
 * reclass, §1245/§1250 recapture, PAL/§461(l), 1031) should be reviewed by a CPA — that
 * is a tax-law question, not something a numeric check can certify.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { TAX_DEFAULTS } from "../tax";

function irrBisect(flows: number[]): number {
  const npv = (r: number) => flows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 10;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let i = 0; i < 300; i++) { const m = (lo + hi) / 2; if (npv(lo) * npv(m) <= 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

function taxDeal(overrides?: Partial<ScenarioInputs["tax"] & Record<string, unknown>>): ScenarioInputs {
  return {
    purchase: { purchase_price: 1_200_000, closing_cost_rate: 0.02, capex_reserve: 0, cost_seg_study_cost: 0 },
    financing: { ltv: 0.7, interest_rate: 0.06, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0.01, size_to_dscr: false },
    revenue: {
      unit_mix: [{ type: "1BR/1BA", count: 12, current_rent: 1_200, market_rent: 1_200, renovated_rent_premium: 0 }],
      other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0.03,
    },
    expenses: {
      management_fee_rate: 0, payroll_annual: 20_000, repairs_maintenance_per_unit: 500, turnover_cost_per_unit: 0,
      turnover_rate: 0, insurance_per_unit: 300, property_tax_total: 15_000, tax_escalation_rate: 0.03,
      expense_escalation_rate: 0.03, utilities_per_unit: 600, admin_legal_marketing: 4_000, contract_services: 3_000, reserves_per_unit: 0,
    },
    capex: { per_unit_cost: 0, units_to_renovate: 0, per_unit_enabled: false, renovation_start_month: 1, projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.02 },
    tax: { ...TAX_DEFAULTS, opco_view: "propco", reps_status: [true, true, true, true, true], ...overrides },
  } as unknown as ScenarioInputs;
}

/** Reconstruct the propco after-tax IRR from the engine's own components. */
function reconstructAfterTaxIrr(res: ReturnType<typeof calculateUnderwriting>): number {
  const m = res.metrics, tax = res.tax!;
  const exitProceeds = tax.exit_tax ? m.net_sale_proceeds - tax.exit_tax.total_exit_tax : m.net_sale_proceeds;
  const flows = [-m.total_equity, ...tax.years.map((y) => y.after_tax_cash_flow_propco)];
  flows[flows.length - 1] += exitProceeds + m.return_of_operating_reserve;
  if (m.refi_year && m.refi_net_proceeds) flows[m.refi_year] += m.refi_net_proceeds;
  return irrBisect(flows);
}

describe("after-tax IRR consistency", () => {
  it("1031 deal (bryden): reported after-tax IRR matches an independent solver", () => {
    const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
    const res = calculateUnderwriting(inp);
    expect(res.tax).toBeTruthy();
    expect(res.tax!.after_tax_irr_propco ?? NaN).toBeCloseTo(reconstructAfterTaxIrr(res), 4);
  });

  it("fully-taxable exit: after-tax IRR matches (recapture/gain path exercised)", () => {
    const res = calculateUnderwriting(taxDeal({ exit_via_1031: false }));
    expect(res.tax!.exit_tax).toBeTruthy(); // taxable path populates exit tax
    expect(res.tax!.after_tax_irr_propco ?? NaN).toBeCloseTo(reconstructAfterTaxIrr(res), 4);
  });

  it("per-year after-tax cash flow foots to pre-tax CF minus taxes", () => {
    const res = calculateUnderwriting(taxDeal({ exit_via_1031: false }));
    res.tax!.years.forEach((y, i) => {
      const expected = res.annual[i].cash_flow - (y.federal_tax + y.state_tax + y.niit);
      expect(y.after_tax_cash_flow_propco).toBeCloseTo(expected, 0);
    });
  });
});

describe("depreciation — straight-line first principles (bonus & cost-seg off)", () => {
  const res = calculateUnderwriting(taxDeal({ federal_bonus_pct: 0, costseg_5yr_pct: 0, costseg_15yr_pct: 0, land_allocation_pct: 0.2 }));
  const dep = res.tax!.years.map((y) => y.federal_depreciation);

  it("is constant 27.5-yr straight-line after year 1", () => {
    for (let y = 2; y < dep.length; y++) expect(dep[y]).toBeCloseTo(dep[1], 0);
  });

  it("applies the mid-month convention in year 1 (11.5/12 of a full year)", () => {
    expect(dep[0]).toBeCloseTo(dep[1] * (11.5 / 12), 0);
  });

  it("depreciates the land-carved improvement basis over 27.5 years", () => {
    const fullYear = dep[1]; // = improvementBasis / 27.5
    const impliedImprovementBasis = fullYear * 27.5;
    // Improvement basis = (purchase + capitalized acquisition costs) × (1 − land 20%).
    // With a small closing amount, it sits just above purchase × 0.8.
    expect(impliedImprovementBasis).toBeGreaterThan(1_200_000 * 0.8 - 1);
    expect(impliedImprovementBasis).toBeLessThan(1_200_000 * 1.05 * 0.8);
  });
});
