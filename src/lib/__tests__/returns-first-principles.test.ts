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

describe("returns chain — cash-out refinance path", () => {
  const inp = controlledDeal();
  Object.assign(inp.exit as object, {
    refi_enabled: true, refi_year: 3, refi_cap_rate: 0.06, refi_ltv: 0.7,
    refi_interest_rate: 0.055, refi_amortization_years: 30, refi_io_months: 0,
    refi_cost_rate: 0.01, refi_prepayment_penalty_rate: 0,
  });
  const res = calculateUnderwriting(inp);
  const m = res.metrics;

  const gpr1 = 12 * 1000 * 12, opex1 = 20_000 + 500 * 12 + 300 * 12 + 15_000 + 600 * 12 + 4_000 + 3_000;
  const noi = (y: number) => gpr1 * Math.pow(1.03, y - 1) * 0.95 - opex1 * Math.pow(1.03, y - 1);
  const origLoan = 840_000, origRate = 0.06 / 12, amort = 360, hold = 5, refiYear = 3;
  const oldDS = pmtMonthly(origLoan, origRate, amort) * 12;
  // Refi at end of year 3, valued on year-3 NOI.
  const refiValue = noi(refiYear) / 0.06;
  const refiNewLoan = refiValue * 0.7;
  const oldBalance = loanBalanceSim(origLoan, origRate, amort, refiYear * 12, 0);
  const refiCost = refiNewLoan * 0.01;
  const refiNet = refiNewLoan - oldBalance - refiCost;
  const newRate = 0.055 / 12, newDS = pmtMonthly(refiNewLoan, newRate, amort) * 12;
  const dsY = (y: number) => (y <= refiYear ? oldDS : newDS);

  it("refi value, new loan, and cash-out proceeds match", () => {
    expect(m.refi_year).toBe(3);
    expect(m.refi_net_proceeds).toBeCloseTo(refiNet, -1);
  });

  it("IRR and net sale (on the NEW loan balance) match with the refi distribution", () => {
    const exitBal = loanBalanceSim(refiNewLoan, newRate, amort, hold * 12 - refiYear * 12, 0);
    const exitValue = noi(hold) / 0.065;
    const netSale = exitValue - exitValue * 0.02 - exitBal;
    const equity = 1_200_000 + 24_000 + 8_400 - origLoan;
    const flows = [-equity];
    for (let y = 1; y <= hold; y++) {
      let cf = noi(y) - dsY(y);
      if (y === refiYear) cf += refiNet;
      if (y === hold) cf += netSale;
      flows.push(cf);
    }
    expect(m.net_sale_proceeds).toBeCloseTo(netSale, -1);
    expect(m.irr ?? NaN).toBeCloseTo(irrBisect(flows), 3);
    expect(m.equity_multiple).toBeCloseTo(flows.slice(1).reduce((s, v) => s + v, 0) / equity, 2);
  });
});

describe("returns chain — tax reassessment at exit", () => {
  const inp = controlledDeal();
  (inp.expenses as { tax_reassessment?: object }).tax_reassessment = {
    enabled: true, effective_tax_rate: 0.015, phase_in_year: 1, apply_at_exit: true,
  };
  const res = calculateUnderwriting(inp);
  const m = res.metrics;

  const gpr1 = 12 * 1000 * 12;
  const nonTaxOpex1 = 20_000 + 500 * 12 + 300 * 12 + 600 * 12 + 4_000 + 3_000; // 43,800 (no property tax)
  const reTax = (y: number) => 1_200_000 * 0.015 * Math.pow(1.03, y - 1); // reassessed to purchase price
  const noi = (y: number) => gpr1 * Math.pow(1.03, y - 1) * 0.95 - nonTaxOpex1 * Math.pow(1.03, y - 1) - reTax(y);

  it("during-hold property tax is reassessed to purchase price (overrides the seller bill)", () => {
    expect(res.annual[0].opex_breakdown.property_tax).toBeCloseTo(reTax(1), 0); // 18,000
    expect(res.annual[4].opex_breakdown.property_tax).toBeCloseTo(reTax(5), 0);
  });

  it("multi-year NOI matches with the reassessed tax", () => {
    for (let y = 1; y <= 5; y++) expect(res.annual[y - 1].noi).toBeCloseTo(noi(y), 0);
  });

  it("exit uses the closed-form NOI_exTax / (exitCap + effTaxRate)", () => {
    const noiExTax = noi(5) + reTax(5);
    const exitValue = noiExTax / (0.065 + 0.015);
    expect(m.exit_noi).toBeCloseTo(noi(5), 0);
    expect(m.exit_value).toBeCloseTo(exitValue, -1);
  });

  it("IRR and equity multiple match through the reassessed exit", () => {
    const ds = pmtMonthly(840_000, 0.06 / 12, 360) * 12;
    const exitValue = (noi(5) + reTax(5)) / (0.065 + 0.015);
    const loanBal = loanBalanceSim(840_000, 0.06 / 12, 360, 60, 0);
    const netSale = exitValue - exitValue * 0.02 - loanBal;
    const equity = 1_200_000 + 24_000 + 8_400 - 840_000;
    const flows = [-equity];
    for (let y = 1; y <= 5; y++) flows.push(noi(y) - ds + (y === 5 ? netSale : 0));
    expect(m.irr ?? NaN).toBeCloseTo(irrBisect(flows), 3);
    expect(m.equity_multiple).toBeCloseTo(flows.slice(1).reduce((s, v) => s + v, 0) / equity, 2);
  });
});

describe("returns chain — renovation (rent basis, capex conservation, cash-flow impact)", () => {
  const inp = controlledDeal();
  Object.assign(inp.revenue as object, {
    unit_mix: [{ type: "1BR/1BA", count: 12, current_rent: 1000, market_rent: 1200, renovated_rent_premium: 100 }],
  });
  Object.assign(inp.capex as object, {
    per_unit_cost: 8_000, units_to_renovate: 12, per_unit_enabled: true,
    renovation_start_month: 1, renovation_end_month: 1, renovation_downtime_enabled: false,
  });
  Object.assign(inp.exit as object, { proforma_unrenovated_basis: "current", proforma_renovated_basis: "market_plus_premium" });
  const res = calculateUnderwriting(inp);
  const m = res.metrics;

  const renovatedRent = 1200 + 100; // market + premium
  const gpr1 = 12 * renovatedRent * 12; // 187,200
  const opex1 = 20_000 + 500 * 12 + 300 * 12 + 15_000 + 600 * 12 + 4_000 + 3_000; // 58,800
  const noi = (y: number) => gpr1 * Math.pow(1.03, y - 1) * 0.95 - opex1 * Math.pow(1.03, y - 1);
  const ds = pmtMonthly(840_000, 0.06 / 12, 360) * 12;

  it("renovated units earn market+premium, growing at rent growth", () => {
    for (let y = 1; y <= 5; y++) expect(res.annual[y - 1].gpr).toBeCloseTo(gpr1 * Math.pow(1.03, y - 1), 0);
  });

  it("total renovation capex = per-unit cost × units (conserved over the hold)", () => {
    const totalReno = res.annual.reduce((s, a) => s + (a.capex_renovation ?? 0), 0);
    expect(totalReno).toBeCloseTo(8_000 * 12, 0);
  });

  it("renovation capex reduces year-1 cash flow (not upfront equity)", () => {
    expect(m.total_equity).toBeCloseTo(1_200_000 + 24_000 + 8_400 - 840_000, 0); // capex NOT in equity
    expect(res.annual[0].cash_flow).toBeCloseTo(noi(1) - ds - 8_000 * 12, 0); // year-1 CF absorbs the rehab
  });

  it("IRR and exit match independent calc with the rehab outflow", () => {
    const loanBal = loanBalanceSim(840_000, 0.06 / 12, 360, 60, 0);
    const exitValue = noi(5) / 0.065;
    const netSale = exitValue - exitValue * 0.02 - loanBal;
    const equity = 1_200_000 + 24_000 + 8_400 - 840_000;
    const flows = [-equity];
    for (let y = 1; y <= 5; y++) flows.push(noi(y) - ds - (y === 1 ? 96_000 : 0) + (y === 5 ? netSale : 0));
    expect(m.exit_value).toBeCloseTo(exitValue, -1);
    expect(m.irr ?? NaN).toBeCloseTo(irrBisect(flows), 3);
    expect(m.equity_multiple).toBeCloseTo(flows.slice(1).reduce((s, v) => s + v, 0) / equity, 2);
  });
});
