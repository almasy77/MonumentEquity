/**
 * Operating (hold-forever) metrics — how a deal performs on OPERATIONS alone,
 * with no sale assumption. For a property held for years/decades, IRR and equity
 * multiple are dominated by a speculative terminal value; these are the figures
 * long-term holders actually underwrite to:
 *
 *  - yield-on-cost: stabilized NOI ÷ all-in basis. Compared to the market cap
 *    rate, the SPREAD is the margin of safety, independent of any sale.
 *  - cash-on-cash: pre-tax cash flow ÷ invested equity, and its trajectory.
 *  - debt yield & DSCR: lender-view resilience.
 *  - return on equity (marked-to-market): as equity builds, ROE drifts down —
 *    the classic "refi or sell?" signal.
 *  - operating equity multiple: cumulative distributions from operations ÷ equity
 *    (excludes any sale) — how many years to return capital from operations.
 *  - break-even occupancy: downside durability.
 *
 * Pure + deterministic — derived entirely from the engine's annual schedule and
 * headline metrics, so it never diverges from the pro forma.
 */
import type { UnderwritingResult } from "./underwriting";

export interface OperatingYearRow {
  year: number;
  noi: number;
  cash_flow: number;
  yield_on_cost: number; // NOI ÷ all-in basis (total cost)
  cash_on_cash: number; // annual cash flow ÷ invested equity
  loan_balance: number; // outstanding balance at year end
  debt_yield: number; // NOI ÷ outstanding loan balance
  dscr: number; // NOI ÷ annual debt service
  property_value: number; // NOI ÷ valuation cap (constant-cap proxy)
  equity_value: number; // property value − loan balance (marked-to-market)
  return_on_equity: number; // annual cash flow ÷ marked-to-market equity
  cumulative_operating_multiple: number; // cumulative cash flow ÷ invested equity (no sale)
  breakeven_occupancy: number; // (opex + debt service) ÷ GPR
}

export interface OperatingMetrics {
  rows: OperatingYearRow[];
  going_in_yield_on_cost: number; // year-1 NOI ÷ basis
  stabilized_yield_on_cost: number; // last-year NOI ÷ basis
  market_cap_rate: number; // the cap the market would pay for stabilized NOI (exit cap)
  yield_spread_bps: number; // (stabilized yield-on-cost − market cap) in basis points
  avg_cash_on_cash: number;
  years_to_return_capital: number | null; // first year cumulative operating multiple ≥ 1
  total_cost: number;
  invested_equity: number;
}

/**
 * @param result   the underwriting result (annual schedule + metrics)
 * @param marketCapRate the cap the market would pay for stabilized NOI — used both
 *   as the constant valuation cap for the marked-to-market equity/ROE columns and
 *   as the benchmark for the yield-on-cost spread. Pass the exit cap rate.
 */
export function computeOperatingMetrics(
  result: UnderwritingResult,
  marketCapRate: number,
): OperatingMetrics {
  const m = result.metrics;
  const basis = m.total_cost || 0;
  const equity = m.total_equity || 0;
  const loan0 = m.loan_amount || 0;
  const valCap = marketCapRate > 0 ? marketCapRate : m.going_in_cap > 0 ? m.going_in_cap : 0;

  let cumulativePrincipal = 0;
  let cumulativeCashFlow = 0;
  let yearsToReturn: number | null = null;

  const rows: OperatingYearRow[] = result.annual.map((a) => {
    cumulativePrincipal += a.principal_paid || 0;
    cumulativeCashFlow += a.cash_flow || 0;
    // Outstanding balance from amortization. (For a mid-hold refi this is an
    // approximation — the refi re-bases the balance; the headline min_debt_yield
    // resets exactly, this operating view trends.)
    const loanBalance = Math.max(0, loan0 - cumulativePrincipal);
    const propertyValue = valCap > 0 ? a.noi / valCap : 0;
    const equityValue = propertyValue - loanBalance;
    const cumMultiple = equity > 0 ? cumulativeCashFlow / equity : 0;
    if (yearsToReturn === null && cumMultiple >= 1) yearsToReturn = a.year;

    return {
      year: a.year,
      noi: a.noi,
      cash_flow: a.cash_flow,
      yield_on_cost: basis > 0 ? a.noi / basis : 0,
      cash_on_cash: equity > 0 ? a.cash_flow / equity : 0,
      loan_balance: loanBalance,
      debt_yield: loanBalance > 0 ? a.noi / loanBalance : 0,
      dscr: a.debt_service > 0 ? a.noi / a.debt_service : 0,
      property_value: propertyValue,
      equity_value: equityValue,
      return_on_equity: equityValue > 0 ? a.cash_flow / equityValue : 0,
      cumulative_operating_multiple: cumMultiple,
      breakeven_occupancy: a.gpr > 0 ? (a.total_opex + a.debt_service) / a.gpr : 0,
    };
  });

  const goingIn = rows.length > 0 ? rows[0].yield_on_cost : 0;
  const stabilized = rows.length > 0 ? rows[rows.length - 1].yield_on_cost : 0;
  const avgCoC = rows.length > 0 ? rows.reduce((s, r) => s + r.cash_on_cash, 0) / rows.length : 0;

  return {
    rows,
    going_in_yield_on_cost: goingIn,
    stabilized_yield_on_cost: stabilized,
    market_cap_rate: valCap,
    yield_spread_bps: Math.round((stabilized - valCap) * 10000),
    avg_cash_on_cash: avgCoC,
    years_to_return_capital: yearsToReturn,
    total_cost: basis,
    invested_equity: equity,
  };
}
