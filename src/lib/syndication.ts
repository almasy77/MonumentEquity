/**
 * Syndication waterfall — LP (member) / GP (manager) distribution model, faithful
 * to Michael Blank's Syndicated Deal Analyzer (SDA v2.9.4). Turns a deal's annual
 * distributable cash flow and its refi/sale proceeds into the LP/GP split the SDA
 * computes on its P&L, Exit Strategy, and Returns sheets:
 *
 *   1. Asset management fee off the top (% of EGI), to the GP — SDA P&L line 45.
 *   2. Preferred return to LPs, accruing with a deficiency carryforward — lines 46-48.
 *   3. Excess cash flow split LP/GP (the promote) — lines 49-50.
 *   4. At refi/sale: return LP capital, pay accrued pref deficiency, split the
 *      remaining profit LP/GP — Exit Strategy H17-H25.
 *
 * Then LP-level returns: IRR, equity multiple, average annual return, cash-on-cash
 * — SDA Returns N16-N19. Pure + deterministic; unit-tested against hand-derived math.
 */
import { calculateAnnualXIRR } from "./irr";

export interface SyndicationAssumptions {
  lp_equity_pct: number; // LP (member) share of equity, e.g. 0.80
  preferred_return_rate: number; // annual pref on LP capital, e.g. 0.08
  acquisition_fee_pct: number; // GP fee on purchase price at close, e.g. 0.02
  asset_management_fee_pct: number; // GP fee, % of EGI each year, e.g. 0.02
  capital_transaction_fee_pct: number; // GP fee on refi loan / sale price, e.g. 0
  lp_excess_split: number; // LP share of excess CF and sale profit (promote); defaults to lp_equity_pct
}

export interface SyndicationYearInput {
  year: number; // 1-indexed
  egi: number; // effective gross income that year
  distributable_cash_flow: number; // NOI − debt service − reserves (pre-waterfall)
}

export interface SyndicationInput {
  assumptions: SyndicationAssumptions;
  initial_lp_capital: number; // total member capital to close (SDA Summary D22)
  purchase_price: number; // for the acquisition fee
  sale_year: number;
  net_sale_equity: number; // partnership equity at sale BEFORE return of capital / pref / profit split (SDA H17)
  sale_price?: number; // for the capital-transaction fee at sale
  years: SyndicationYearInput[]; // operating years 1..sale_year
  refi?: {
    year: number;
    net_refi_proceeds: number; // refi proceeds after costs/prepay/payoff, before cap return / split
    refi_loan?: number; // for the capital-transaction fee at refi
  };
}

export interface SyndicationYearResult {
  year: number;
  distributable_cash_flow: number;
  asset_mgmt_fee: number;
  pref_due: number;
  pref_paid: number;
  pref_deficiency: number; // accrued this year (carried forward)
  excess_to_lp: number;
  excess_to_gp: number;
  lp_operating_distributions: number; // pref_paid + excess_to_lp
  gp_distributions_from_cf: number; // asset_mgmt_fee + excess_to_gp
  lp_capital_begin: number;
  lp_capital_returned: number; // via refi/sale this year
  lp_capital_end: number;
  lp_cash_on_cash: number; // lp_operating_distributions / lp_capital_begin
  lp_total_cash: number; // operating + capital-event cash to LP this year (for IRR)
}

export interface SyndicationResult {
  years: SyndicationYearResult[];
  lp_irr: number | null;
  lp_equity_multiple: number;
  lp_average_annual_return: number;
  lp_average_cash_on_cash: number;
  lp_total_cash_returned: number; // sum of all LP cash inflows over the hold
  lp_profit: number; // lp_total_cash_returned − initial_lp_capital
  // GP compensation
  gp_acquisition_fee: number;
  gp_asset_mgmt_fees_total: number;
  gp_capital_transaction_fees: number;
  gp_promote_total: number; // excess-CF + sale/refi profit share to GP
  gp_total_compensation: number;
  // Sale detail (SDA Exit Strategy H-column)
  sale_return_of_capital: number;
  sale_pref_deficiency_paid: number;
  sale_net_profit: number;
  sale_profit_to_lp: number;
  sale_profit_to_gp: number;
}

export function computeSyndication(input: SyndicationInput): SyndicationResult {
  const a = input.assumptions;
  const saleYear = input.sale_year;
  const lpSplit = a.lp_excess_split;
  const gpSplit = 1 - lpSplit;

  // Sale-detail accumulator, local to this call (populated at the sale year).
  const saleDetail = {
    return_of_capital: 0,
    pref_deficiency_paid: 0,
    net_profit: 0,
    profit_to_lp: 0,
    profit_to_gp: 0,
    cap_txn_fee: 0,
  };

  // ── Refi (if any): return of capital + profit split at the refi year ──
  let refiCapReturned = 0;
  let refiProfitToLp = 0;
  let refiProfitToGp = 0;
  let refiCapTxnFee = 0;
  // capital account balance heading into the refi year is the initial capital minus
  // nothing (refi precedes sale; no prior capital events in this single-refi model).
  if (input.refi) {
    refiCapTxnFee = a.capital_transaction_fee_pct * (input.refi.refi_loan ?? 0);
    const distributable = input.refi.net_refi_proceeds - refiCapTxnFee;
    refiCapReturned = Math.max(0, Math.min(distributable, input.initial_lp_capital));
    const refiProfit = Math.max(0, distributable - refiCapReturned);
    refiProfitToLp = refiProfit * lpSplit;
    refiProfitToGp = refiProfit * gpSplit;
  }

  // ── Annual operating waterfall ──
  const years: SyndicationYearResult[] = [];
  let capBegin = input.initial_lp_capital;
  let priorDeficiency = 0;
  let accruedDeficiency = 0; // running total of unpaid pref, paid down at sale
  let amFeesTotal = 0;
  let gpExcessTotal = 0;

  for (const y of input.years) {
    if (y.year > saleYear) break;
    const cf = y.distributable_cash_flow;
    const withinHold = y.year <= saleYear;

    // (1) Asset management fee — SDA pays the full fee only if it fits under CF, else $0.
    const amFeeRaw = withinHold ? a.asset_management_fee_pct * y.egi : 0;
    const amFee = amFeeRaw > 0 && amFeeRaw < cf ? amFeeRaw : 0;

    // (2) Preferred return — due on the capital balance plus any carried deficiency.
    const prefDue = capBegin === 0 ? 0 : capBegin * a.preferred_return_rate + priorDeficiency;
    const prefPaid = cf > 0 ? (prefDue + amFee > cf ? Math.max(0, cf - amFee) : prefDue) : 0;
    const prefDeficiency = prefDue > 0 ? prefDue - prefPaid : 0;

    // (3) Excess cash flow split (promote).
    const excess = cf - amFee - prefPaid;
    const excessLp = withinHold && excess > 0 ? excess * lpSplit : 0;
    const excessGp = withinHold && excess > 0 ? excess * gpSplit : 0;

    const lpOperating = prefPaid + excessLp;
    const gpFromCf = amFee + excessGp;

    // Capital returned this year (refi and/or sale).
    let capReturnedThisYear = 0;
    let capitalEventCashToLp = 0;
    if (input.refi && y.year === input.refi.year) {
      capReturnedThisYear += refiCapReturned;
      capitalEventCashToLp += refiCapReturned + refiProfitToLp;
    }

    // Sale happens at saleYear (handled after the loop for the profit detail, but the
    // LP cash lands in this year's total).
    let saleCashToLp = 0;
    if (y.year === saleYear) {
      // Resolve the sale split using the capital balance entering the sale year.
      const capAtSale = capBegin;
      const capTxnFeeSale = a.capital_transaction_fee_pct * (input.sale_price ?? 0);
      const netSaleEquity = input.net_sale_equity - capTxnFeeSale;
      const returnOfCapital = Math.max(0, Math.min(capAtSale, netSaleEquity));
      const prefDefPaid = Math.max(0, Math.min(netSaleEquity - returnOfCapital, accruedDeficiency + prefDeficiency));
      const netProfit = Math.max(0, netSaleEquity - returnOfCapital - prefDefPaid);
      const profitToLp = netProfit * lpSplit;
      // stash sale detail on the result via closure vars
      saleDetail.return_of_capital = returnOfCapital;
      saleDetail.pref_deficiency_paid = prefDefPaid;
      saleDetail.net_profit = netProfit;
      saleDetail.profit_to_lp = profitToLp;
      saleDetail.profit_to_gp = netProfit * gpSplit;
      saleDetail.cap_txn_fee = capTxnFeeSale;
      capReturnedThisYear += returnOfCapital;
      saleCashToLp = returnOfCapital + prefDefPaid + profitToLp;
      capitalEventCashToLp += saleCashToLp;
    }

    const capEnd = Math.max(0, capBegin - capReturnedThisYear);

    amFeesTotal += amFee;
    gpExcessTotal += excessGp;
    accruedDeficiency += prefDeficiency;

    years.push({
      year: y.year,
      distributable_cash_flow: cf,
      asset_mgmt_fee: amFee,
      pref_due: prefDue,
      pref_paid: prefPaid,
      pref_deficiency: prefDeficiency,
      excess_to_lp: excessLp,
      excess_to_gp: excessGp,
      lp_operating_distributions: lpOperating,
      gp_distributions_from_cf: gpFromCf,
      lp_capital_begin: capBegin,
      lp_capital_returned: capReturnedThisYear,
      lp_capital_end: capEnd,
      lp_cash_on_cash: capBegin > 0 ? lpOperating / capBegin : 0,
      lp_total_cash: lpOperating + capitalEventCashToLp,
    });

    priorDeficiency = prefDeficiency;
    capBegin = capEnd;
  }

  // ── LP return metrics ──
  const initial = input.initial_lp_capital;
  // IRR flow vector: −initial at t0, then each year's total LP cash.
  const flows = [-initial, ...years.map((y) => y.lp_total_cash)];
  const lpIrr = initial > 0 ? calculateAnnualXIRR(flows) : null;

  const totalLpCash = years.reduce((s, y) => s + y.lp_total_cash, 0);
  const equityMultiple = initial > 0 ? totalLpCash / initial : 0;
  const avgCoc =
    years.filter((y) => y.year <= saleYear).length > 0
      ? years.filter((y) => y.year <= saleYear).reduce((s, y) => s + y.lp_cash_on_cash, 0) /
        years.filter((y) => y.year <= saleYear).length
      : 0;
  // Average annual return = total LP profit ÷ initial ÷ years (SDA AAR-to-date at sale).
  const avgAnnualReturn = initial > 0 && saleYear > 0 ? (totalLpCash - initial) / initial / saleYear : 0;

  // ── GP compensation ──
  const gpAcqFee = a.acquisition_fee_pct * input.purchase_price;
  const gpCapTxnFees = refiCapTxnFee + saleDetail.cap_txn_fee;
  const gpPromote = gpExcessTotal + refiProfitToGp + saleDetail.profit_to_gp;
  const gpTotal = gpAcqFee + amFeesTotal + gpCapTxnFees + gpPromote;

  return {
    years,
    lp_irr: lpIrr,
    lp_equity_multiple: equityMultiple,
    lp_average_annual_return: avgAnnualReturn,
    lp_average_cash_on_cash: avgCoc,
    lp_total_cash_returned: totalLpCash,
    lp_profit: totalLpCash - initial,
    gp_acquisition_fee: gpAcqFee,
    gp_asset_mgmt_fees_total: amFeesTotal,
    gp_capital_transaction_fees: gpCapTxnFees,
    gp_promote_total: gpPromote,
    gp_total_compensation: gpTotal,
    sale_return_of_capital: saleDetail.return_of_capital,
    sale_pref_deficiency_paid: saleDetail.pref_deficiency_paid,
    sale_net_profit: saleDetail.net_profit,
    sale_profit_to_lp: saleDetail.profit_to_lp,
    sale_profit_to_gp: saleDetail.profit_to_gp,
  };
}
