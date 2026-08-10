/**
 * First-principles verification of the underwriting RETURNS chain.
 *
 * The engine's own golden tests are regression guards — they assert the engine still
 * produces the numbers it produced before. They cannot catch an *original* error,
 * because the expected values were captured from the engine itself.
 *
 * This test is different: for a deliberately simple, fully-controlled stabilized deal
 * (no renovation, no refi, no reserves, no management-fee-on-income, uniform expense
 * escalation, no cash-tax layer), it recomputes the multi-year pro forma, the exit,
 * the levered IRR, and the equity multiple FROM SCRATCH with independent math, and
 * asserts the engine agrees. Because the money at stake rides on these numbers, this
 * is a correctness check, not just a regression check.
 */
import { describe, it, expect } from "vitest";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

// ── Independent math (deliberately not the engine's helpers) ──
function pmtMonthly(principal: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return principal / months;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}
/** Month-by-month amortization (ground truth), independent of any closed form. */
function loanBalanceSim(principal: number, monthlyRate: number, amortMonths: number, elapsed: number, ioMonths: number): number {
  const pmt = pmtMonthly(principal, monthlyRate, amortMonths);
  let bal = principal;
  for (let m = 1; m <= elapsed; m++) {
    if (m <= ioMonths) continue; // interest-only: no principal reduction
    bal -= pmt - bal * monthlyRate;
  }
  return Math.max(0, bal);
}
/** Independent IRR via bisection on NPV (annual periods). */
function irrBisect(flows: number[]): number {
  const npv = (r: number) => flows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 10;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-6) return mid;
    if (npv(lo) * v < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** A clean stabilized deal with every complicating feature switched off. */
function controlledDeal(): ScenarioInputs {
  return {
    purchase: { purchase_price: 1_200_000, closing_cost_rate: 0.02, capex_reserve: 0, cost_seg_study_cost: 0 },
    financing: { ltv: 0.7, interest_rate: 0.06, amortization_years: 30, loan_term_years: 10, io_period_months: 0, origination_fee_rate: 0.01, size_to_dscr: false },
    revenue: {
      unit_mix: [{ type: "1BR/1BA", count: 12, current_rent: 1000, market_rent: 1000, renovated_rent_premium: 0 }],
      other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0.03,
    },
    expenses: {
      management_fee_rate: 0, payroll_annual: 20_000, repairs_maintenance_per_unit: 500, turnover_cost_per_unit: 0,
      turnover_rate: 0, insurance_per_unit: 300, property_tax_total: 15_000, tax_escalation_rate: 0.03,
      expense_escalation_rate: 0.03, utilities_per_unit: 600, admin_legal_marketing: 4_000, contract_services: 3_000,
      reserves_per_unit: 0,
    },
    capex: { per_unit_cost: 0, units_to_renovate: 0, per_unit_enabled: false, renovation_start_month: 1, projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.02 },
    tax: null,
  } as unknown as ScenarioInputs;
}

describe("returns chain — first-principles verification", () => {
  const inp = controlledDeal();
  const res = calculateUnderwriting(inp);
  const m = res.metrics;

  // Independent pro forma
  const units = 12, rent = 1000, vac = 0.05, g = 0.03, ge = 0.03, hold = 5;
  const gpr1 = units * rent * 12; // 144,000
  const opex1 = 20_000 + 500 * units + 300 * units + 15_000 + 600 * units + 4_000 + 3_000; // 58,800
  const noi = (y: number) => gpr1 * Math.pow(1 + g, y - 1) * (1 - vac) - opex1 * Math.pow(1 + ge, y - 1);

  const price = 1_200_000, ltv = 0.7, rate = 0.06, amortMonths = 360;
  const loan = price * ltv; // 840,000
  const closing = price * 0.02, orig = loan * 0.01;
  const equity = price + closing + orig - loan; // 392,400
  const ds = pmtMonthly(loan, rate / 12, amortMonths) * 12;

  it("year-1 pro forma matches (GPR basis, EGI, NOI)", () => {
    expect(res.annual[0].gpr).toBeCloseTo(gpr1, 0);
    expect(res.annual[0].egi).toBeCloseTo(gpr1 * (1 - vac), 0);
    expect(res.annual[0].noi).toBeCloseTo(noi(1), 0);
  });

  it("multi-year NOI and cash flow match the independent projection", () => {
    for (let y = 1; y <= hold; y++) {
      expect(res.annual[y - 1].noi).toBeCloseTo(noi(y), 0);
      expect(res.annual[y - 1].cash_flow).toBeCloseTo(noi(y) - ds, 0);
    }
  });

  it("exit value, loan payoff, and net sale proceeds match", () => {
    const exitValue = noi(hold) / 0.065;
    const sellingCosts = exitValue * 0.02;
    const loanBal = loanBalanceSim(loan, rate / 12, amortMonths, hold * 12, 0);
    const netSale = exitValue - sellingCosts - loanBal;
    expect(m.exit_noi).toBeCloseTo(noi(hold), 0);
    expect(m.exit_value).toBeCloseTo(exitValue, 0);
    expect(m.net_sale_proceeds).toBeCloseTo(netSale, -1); // within ~$10 (rounding)
  });

  it("total equity, IRR, and equity multiple match independent calc", () => {
    const loanBal = loanBalanceSim(loan, rate / 12, amortMonths, hold * 12, 0);
    const netSale = noi(hold) / 0.065 - (noi(hold) / 0.065) * 0.02 - loanBal;
    const flows = [-equity];
    for (let y = 1; y <= hold; y++) flows.push(noi(y) - ds + (y === hold ? netSale : 0));
    const irr = irrBisect(flows);
    const em = flows.slice(1).reduce((s, v) => s + v, 0) / equity + 0; // (ΣCF + netSale)/equity; -equity excluded

    expect(m.total_equity).toBeCloseTo(equity, 0);
    expect(m.irr ?? NaN).toBeCloseTo(irr, 3); // within 0.1%
    expect(m.equity_multiple).toBeCloseTo(em, 2);
  });
});

describe("returns chain — interest-only variant", () => {
  const inp = controlledDeal();
  (inp.financing as { io_period_months: number }).io_period_months = 24; // 2 years IO
  const res = calculateUnderwriting(inp);
  const m = res.metrics;

  const units = 12, rent = 1000, vac = 0.05, g = 0.03, ge = 0.03, hold = 5;
  const gpr1 = units * rent * 12;
  const opex1 = 20_000 + 500 * units + 300 * units + 15_000 + 600 * units + 4_000 + 3_000;
  const noi = (y: number) => gpr1 * Math.pow(1 + g, y - 1) * (1 - vac) - opex1 * Math.pow(1 + ge, y - 1);
  const loan = 1_200_000 * 0.7, rate = 0.06, amortMonths = 360, io = 24;
  const pmt = pmtMonthly(loan, rate / 12, amortMonths), ioPmt = loan * (rate / 12);
  const dsYear = (y: number) => { let ds = 0; for (let mm = (y - 1) * 12 + 1; mm <= y * 12; mm++) ds += mm <= io ? ioPmt : pmt; return ds; };

  it("interest-only debt service and cash flow match year by year", () => {
    expect(dsYear(1)).toBeCloseTo(loan * rate, 0); // full year of IO = loan × rate
    for (let y = 1; y <= hold; y++) {
      expect(res.annual[y - 1].debt_service).toBeCloseTo(dsYear(y), 0);
      expect(res.annual[y - 1].cash_flow).toBeCloseTo(noi(y) - dsYear(y), 0);
    }
  });

  it("IRR matches independent calc with the IO loan payoff", () => {
    const bal = loanBalanceSim(loan, rate / 12, amortMonths, hold * 12, io);
    const exitValue = noi(hold) / 0.065;
    const netSale = exitValue - exitValue * 0.02 - bal;
    const equity = 1_200_000 + 1_200_000 * 0.02 + loan * 0.01 - loan;
    const flows = [-equity];
    for (let y = 1; y <= hold; y++) flows.push(noi(y) - dsYear(y) + (y === hold ? netSale : 0));
    expect(m.irr ?? NaN).toBeCloseTo(irrBisect(flows), 3);
  });
});
