/**
 * Monument Equity — Monthly Underwriting Calculation Engine
 *
 * All calculations are monthly over a configurable hold period (default 60 months).
 * Pure functions — no side effects, fully testable.
 */

import { calculateIRR } from "./irr";

// ─── Input Types ─────────────────────────────────────────────

export interface ClosingCostBreakdown {
  title_insurance?: number;
  legal_fees?: number;
  property_costs?: number; // inspections, surveys, appraisals
  prorations?: number;
  third_party_reports?: number; // phase I/II, PCA
  transfer_taxes?: number;
  reserves_escrow?: number;
  other_closing?: number;
}

export type ClosingCostMode = "rate" | "itemized";

export interface PurchaseAssumptions {
  purchase_price: number;
  closing_cost_rate: number; // % of purchase price
  closing_cost_mode?: ClosingCostMode; // "rate" uses closing_cost_rate, "itemized" uses breakdown sum (default: "rate")
  closing_cost_breakdown?: ClosingCostBreakdown;
  capex_reserve?: number; // Additional equity funded at closing to cover renovation CapEx shortfalls
  earnest_money: number; // Metadata only — tracked for deal terms but not used in equity/cash flow calculations (earnest money is credited at closing, not additive to total equity)
  // Scenario-level deal terms (metadata, not used in calculations)
  bid_price?: number;
  loi_amount?: number;
  loi_date?: string;
  loi_expiration?: string;
  due_diligence_days?: number;
  closing_days?: number;
  buyer_entity?: string;
}

export interface FinancingAssumptions {
  ltv: number; // e.g. 0.75
  interest_rate: number; // annual, e.g. 0.065
  amortization_years: number;
  loan_term_years: number;
  io_period_months: number; // interest-only period
  origination_fee_rate: number; // % of loan
}

export interface UnitMix {
  type: string; // e.g. "1BR/1BA"
  count: number;
  current_rent: number;
  market_rent: number;
  renovated_rent_premium: number; // additional rent after renovation
}

export interface RevenueAssumptions {
  unit_mix: UnitMix[];
  other_income_monthly: number; // laundry, parking, pet fees, etc.
  vacancy_rate: number;
  bad_debt_rate: number;
  concessions_rate: number;
  rent_growth_rate: number; // annual
}

export interface UtilitiesBreakdown {
  electric_per_unit?: number; // annual
  water_sewer_per_unit?: number; // annual
  gas_per_unit?: number; // annual
  trash_per_unit?: number; // annual
  other_utilities_per_unit?: number; // annual
}

export interface ServicesBreakdown {
  landscaping?: number; // annual
  snow_removal?: number; // annual
  pest_control?: number; // annual
  security?: number; // annual
  cleaning?: number; // annual
  other_services?: number; // annual
}

export type OpexInputMode = "total_annual" | "per_unit_annual" | "per_unit_monthly" | "pct_egi" | "pct_gpr";

export interface OpexInput {
  value: number;
  mode: OpexInputMode;
}

export interface UtilitiesSublines {
  electric?: OpexInput;
  water_sewer?: OpexInput;
  gas?: OpexInput;
  trash?: OpexInput;
  internet?: OpexInput;
  other_utilities?: OpexInput;
}

export interface ServicesSublines {
  landscaping?: OpexInput;
  snow_removal?: OpexInput;
  pest_control?: OpexInput;
  security?: OpexInput;
  cleaning?: OpexInput;
  other_services?: OpexInput;
}

export interface OpexInputs {
  management_fees?: OpexInput;
  payroll?: OpexInput;
  repairs_maintenance?: OpexInput;
  turnover?: OpexInput;
  insurance?: OpexInput;
  property_tax?: OpexInput;
  utilities?: OpexInput;
  utilities_sublines?: UtilitiesSublines;
  admin_legal_marketing?: OpexInput;
  contract_services?: OpexInput;
  services_sublines?: ServicesSublines;
  reserves?: OpexInput;
}

export const UTILITIES_SUBLINE_KEYS: (keyof UtilitiesSublines)[] = [
  "electric", "water_sewer", "gas", "trash", "internet", "other_utilities",
];
export const SERVICES_SUBLINE_KEYS: (keyof ServicesSublines)[] = [
  "landscaping", "snow_removal", "pest_control", "security", "cleaning", "other_services",
];

export interface ExpenseAssumptions {
  management_fee_rate: number; // % of EGI (legacy)
  payroll_annual: number;
  repairs_maintenance_per_unit: number; // annual
  turnover_cost_per_unit: number; // annual cost per unit that turns over
  turnover_rate: number; // % of units that turn over per year (e.g. 0.50 = 50%)
  insurance_per_unit: number; // annual
  property_tax_total: number; // annual
  tax_escalation_rate: number; // annual, applied to property taxes only
  expense_escalation_rate: number; // annual, applied to all non-tax expenses
  utilities_per_unit: number; // annual total (sum of breakdown if provided)
  utilities_breakdown?: UtilitiesBreakdown;
  admin_legal_marketing: number; // annual
  contract_services: number; // annual total (sum of breakdown if provided)
  services_breakdown?: ServicesBreakdown;
  reserves_per_unit: number; // annual
  opex_inputs?: OpexInputs;
  // T12 baseline — scenario-local operating history used to seed expense fields
  t12_baseline?: {
    gross_potential_rent?: number;
    vacancy_loss?: number;
    other_income?: number;
    property_taxes?: number;
    insurance?: number;
    utilities?: number;
    repairs_maintenance?: number;
    payroll?: number;
    management_fees?: number;
    admin_marketing?: number;
    contract_services?: number;
  };
}

export interface CapexProject {
  name: string;
  cost: number;
  start_month: number; // 1-indexed
  duration_months: number;
}

export interface CapexAssumptions {
  per_unit_cost: number;
  units_to_renovate: number;
  units_per_month?: number; // legacy — derived from start/end when not set
  renovation_start_month: number; // 1-indexed, when per-unit renovations begin
  renovation_end_month?: number; // 1-indexed, when per-unit renovations end (inclusive)
  renovation_downtime_enabled?: boolean; // whether to model vacancy during renovation
  renovation_downtime_months?: number; // months each unit is offline (default 1)
  projects: CapexProject[];
}

export interface DepreciationAssumptions {
  land_tax_assessment?: number;
  improvement_tax_assessment?: number;
  accelerated_depreciation_pct?: number; // % of improvements on accelerated schedule
  // Computed from above, but stored for display
}

export type RentBasis = "current" | "market" | "current_plus_reno" | "market_plus_reno";

export interface ExitAssumptions {
  hold_period_years: number;
  exit_cap_rate: number;
  selling_cost_rate: number;
  sale_price?: number; // if provided, overrides exit_cap_rate-derived value
  sensitivity_rent_basis?: RentBasis; // which rents to use in sensitivity grid
  proforma_rent_basis?: RentBasis; // which rents to use in pro forma (default: "current")
}

export interface ScenarioInputs {
  purchase: PurchaseAssumptions;
  financing: FinancingAssumptions;
  revenue: RevenueAssumptions;
  expenses: ExpenseAssumptions;
  capex: CapexAssumptions;
  exit: ExitAssumptions;
  depreciation?: DepreciationAssumptions;
}

// ─── Output Types ────────────────────────────────────────────

export interface OpexBreakdown {
  management_fees: number;
  payroll: number;
  repairs_maintenance: number;
  turnover: number;
  insurance: number;
  property_tax: number;
  utilities: number;
  admin_legal_marketing: number;
  contract_services: number;
  reserves: number;
}

export interface MonthlyRow {
  month: number; // 1-indexed
  // Revenue
  gpr: number; // Gross Potential Rent
  vacancy_loss: number;
  bad_debt: number;
  concessions: number;
  other_income: number;
  egi: number; // Effective Gross Income
  // Expenses
  total_opex: number;
  opex_breakdown: OpexBreakdown;
  // NOI
  noi: number;
  // Debt Service
  debt_service: number;
  // Cash Flow before CapEx
  cash_flow_before_capex: number; // NOI - debt service
  // CapEx
  capex: number;
  // Cash Flow
  cash_flow: number; // NOI - debt service - capex
  cumulative_cash_flow: number;
}

export interface AnnualSummary {
  year: number;
  gpr: number;
  vacancy_loss: number;
  bad_debt: number;
  concessions: number;
  other_income: number;
  egi: number;
  total_opex: number;
  opex_breakdown: OpexBreakdown;
  noi: number;
  debt_service: number;
  cash_flow_before_capex: number;
  capex: number;
  cash_flow: number;
  cumulative_cash_flow: number;
  cash_on_cash: number; // annual cash flow / total equity
}

export interface DepreciationResult {
  straight_line_annual: number; // purchase_price * % improvements / 27.5
  accelerated_year1: number; // full accelerated portion + remainder/27.5 in year 1
  accelerated_ongoing: number; // remainder / 27.5 for years 2+
  land_pct: number;
  improvement_pct: number;
}

export interface DealMetrics {
  // Purchase
  purchase_price: number;
  closing_costs: number;
  origination_fee: number;
  capex_reserve: number;
  total_cost: number; // purchase + closing + origination + capex reserve
  loan_amount: number;
  down_payment: number; // purchase_price - loan_amount (encompasses earnest money)
  total_equity: number;
  monthly_debt_service: number;
  // Depreciation
  depreciation?: DepreciationResult;
  // Cap Rates
  going_in_cap: number;
  stabilized_cap: number;
  // Returns
  irr: number | null;
  equity_multiple: number;
  average_cash_on_cash: number;
  // Coverage
  year1_dscr: number;
  min_dscr: number;
  // Exit
  exit_value: number;
  exit_noi: number;
  net_sale_proceeds: number;
  total_profit: number;
}

export interface SensitivityCell {
  purchase_price_delta: number; // e.g. -0.10 = -10%
  exit_cap_rate: number;
  irr: number | null;
}

export interface UnderwritingResult {
  monthly: MonthlyRow[];
  annual: AnnualSummary[];
  metrics: DealMetrics;
  sensitivity: SensitivityCell[];
  warnings: string[];
}

// ─── Closing Cost Helpers ────────────────────────────────────

/** Sum all itemized closing cost breakdown fields */
export function sumClosingCostBreakdown(ccBk?: ClosingCostBreakdown): number {
  if (!ccBk) return 0;
  return (ccBk.title_insurance || 0) + (ccBk.legal_fees || 0) +
    (ccBk.property_costs || 0) + (ccBk.prorations || 0) +
    (ccBk.third_party_reports || 0) + (ccBk.transfer_taxes || 0) +
    (ccBk.reserves_escrow || 0) + (ccBk.other_closing || 0);
}

/** Compute total closing costs based on the selected mode */
export function computeClosingCosts(purchase: PurchaseAssumptions): number {
  const mode = purchase.closing_cost_mode || "rate";
  if (mode === "itemized") {
    return sumClosingCostBreakdown(purchase.closing_cost_breakdown);
  }
  return purchase.purchase_price * purchase.closing_cost_rate;
}

// ─── Calculation Engine ──────────────────────────────────────

export function calculateUnderwriting(inputs: ScenarioInputs): UnderwritingResult {
  const { purchase, financing, revenue, expenses, capex, exit } = inputs;
  const totalMonths = exit.hold_period_years * 12;
  const warnings: string[] = [];

  // ── Purchase & Financing ──
  const closingCosts = computeClosingCosts(purchase);
  const capexReserve = purchase.capex_reserve || 0;
  const loanAmount = purchase.purchase_price * financing.ltv;
  const originationFee = loanAmount * financing.origination_fee_rate;
  const totalCost = purchase.purchase_price + closingCosts + originationFee + capexReserve;
  const totalEquity = totalCost - loanAmount;

  // Monthly debt service calculation
  const monthlyRate = financing.interest_rate / 12;
  const amortMonths = financing.amortization_years * 12;
  const monthlyDS = calculateMonthlyPayment(loanAmount, monthlyRate, amortMonths);
  const monthlyIO = loanAmount * monthlyRate; // interest-only payment

  // ── Total units ──
  const totalUnits = revenue.unit_mix.reduce((sum, u) => sum + u.count, 0);

  // ── Renovation schedule ──
  // Track cumulative renovated units per month
  const renovatedByMonth = buildRenovationSchedule(capex, totalMonths);
  const offlineByMonth = buildDowntimeSchedule(capex, renovatedByMonth, totalMonths);

  // ── Monthly Pro Forma ──
  const monthly: MonthlyRow[] = [];
  let cumulativeCF = 0;

  const pfRentBasis: RentBasis = exit.proforma_rent_basis || "current";
  // When basis is "*_plus_reno", treat all units as fully renovated from month 1
  const pfHasRenoAllUnits = pfRentBasis === "current_plus_reno" || pfRentBasis === "market_plus_reno";

  for (let m = 1; m <= totalMonths; m++) {
    const yearIndex = Math.floor((m - 1) / 12); // 0-indexed year
    const monthlyRentGrowth = Math.pow(1 + revenue.rent_growth_rate, yearIndex); // compound annually

    // GPR: sum across unit mix, accounting for renovated and offline units
    let gpr = 0;
    const totalOffline = offlineByMonth[m - 1];
    // When downtime is enabled, units completing THIS month are still offline,
    // so paying renovated = previous month's cumulative (their downtime has passed).
    // When downtime is disabled, units earn renovated rent immediately on completion.
    const totalPayingRenovated = capex.renovation_downtime_enabled
      ? (m >= 2 ? renovatedByMonth[m - 2] : 0)
      : renovatedByMonth[m - 1];

    for (const unit of revenue.unit_mix) {
      const unitShare = totalUnits > 0 ? unit.count / totalUnits : 0;
      const payingRenovatedInType = Math.min(
        Math.floor(totalPayingRenovated * unitShare),
        unit.count
      );
      const offlineInType = Math.min(
        Math.floor(totalOffline * unitShare),
        unit.count
      );
      // Paying unrenovated = total - paying renovated - offline
      const payingUnrenovatedInType = Math.max(0, unit.count - payingRenovatedInType - offlineInType);

      // Base rent per the selected pro forma basis (current vs market)
      const baseRentRaw = (pfRentBasis === "market" || pfRentBasis === "market_plus_reno")
        ? unit.market_rent
        : unit.current_rent;
      const baseRent = baseRentRaw * monthlyRentGrowth;
      const renovatedRent = (baseRentRaw + unit.renovated_rent_premium) * monthlyRentGrowth;

      if (pfHasRenoAllUnits) {
        // "*_plus_reno": assume all units already renovated — reno premium applied to every paying unit
        const payingAll = payingUnrenovatedInType + payingRenovatedInType;
        gpr += payingAll * renovatedRent;
      } else {
        gpr += payingUnrenovatedInType * baseRent + payingRenovatedInType * renovatedRent;
      }
    }

    const vacancyLoss = gpr * revenue.vacancy_rate;
    const badDebt = gpr * revenue.bad_debt_rate;
    const concessions = gpr * revenue.concessions_rate;
    const otherIncome = revenue.other_income_monthly;
    const egi = gpr - vacancyLoss - badDebt - concessions + otherIncome;

    // OpEx — resolve each line from opex_inputs (if set) or legacy fields
    const annualTaxEscalation = Math.pow(1 + expenses.tax_escalation_rate, yearIndex);
    const annualExpEscalation = Math.pow(1 + (expenses.expense_escalation_rate || 0), yearIndex);
    const oi = expenses.opex_inputs;
    const opexCtx = { totalUnits, monthlyEgi: egi, monthlyGpr: gpr, escalation: annualExpEscalation };
    const taxCtx = { ...opexCtx, escalation: annualTaxEscalation };

    const utilSubSum = resolveSublinesMonthly(oi?.utilities_sublines as Record<string, OpexInput | undefined> | undefined, opexCtx);
    const svcSubSum = resolveSublinesMonthly(oi?.services_sublines as Record<string, OpexInput | undefined> | undefined, opexCtx);
    const opexBk: OpexBreakdown = {
      management_fees: resolveOpexMonthly(oi?.management_fees, expenses.management_fee_rate, "pct_egi", opexCtx),
      payroll: resolveOpexMonthly(oi?.payroll, expenses.payroll_annual, "total_annual", opexCtx),
      repairs_maintenance: resolveOpexMonthly(oi?.repairs_maintenance, expenses.repairs_maintenance_per_unit, "per_unit_annual", opexCtx),
      turnover: resolveOpexMonthly(oi?.turnover, expenses.turnover_cost_per_unit, "per_unit_annual", opexCtx) * (expenses.turnover_rate ?? 0.50),
      insurance: resolveOpexMonthly(oi?.insurance, expenses.insurance_per_unit, "per_unit_annual", opexCtx),
      property_tax: resolveOpexMonthly(oi?.property_tax, expenses.property_tax_total, "total_annual", taxCtx),
      utilities: utilSubSum !== null ? utilSubSum : resolveOpexMonthly(oi?.utilities, expenses.utilities_per_unit, "per_unit_annual", opexCtx),
      admin_legal_marketing: resolveOpexMonthly(oi?.admin_legal_marketing, expenses.admin_legal_marketing, "total_annual", opexCtx),
      contract_services: svcSubSum !== null ? svcSubSum : resolveOpexMonthly(oi?.contract_services, expenses.contract_services, "total_annual", opexCtx),
      reserves: resolveOpexMonthly(oi?.reserves, expenses.reserves_per_unit, "per_unit_annual", opexCtx),
    };
    const monthlyOpex = Object.values(opexBk).reduce((s, v) => s + v, 0);

    const noi = egi - monthlyOpex;

    // Debt service (IO period vs amortizing)
    const ds = m <= financing.io_period_months ? monthlyIO : monthlyDS;

    // CapEx for this month
    const monthCapex = calculateMonthCapex(capex, m);

    const cashFlowBeforeCapex = noi - ds;
    const cashFlow = cashFlowBeforeCapex - monthCapex;
    cumulativeCF += cashFlow;

    monthly.push({
      month: m,
      gpr,
      vacancy_loss: vacancyLoss,
      bad_debt: badDebt,
      concessions,
      other_income: otherIncome,
      egi,
      total_opex: monthlyOpex,
      opex_breakdown: opexBk,
      noi,
      debt_service: ds,
      cash_flow_before_capex: cashFlowBeforeCapex,
      capex: monthCapex,
      cash_flow: cashFlow,
      cumulative_cash_flow: cumulativeCF,
    });
  }

  // ── Annual Summary ──
  const annual: AnnualSummary[] = [];
  let annualCumulativeCF = 0;

  for (let y = 0; y < exit.hold_period_years; y++) {
    const yearMonths = monthly.slice(y * 12, (y + 1) * 12);
    const sum = (fn: (r: MonthlyRow) => number) =>
      yearMonths.reduce((s, r) => s + fn(r), 0);

    const annualCF = sum((r) => r.cash_flow);
    annualCumulativeCF += annualCF;

    annual.push({
      year: y + 1,
      gpr: sum((r) => r.gpr),
      vacancy_loss: sum((r) => r.vacancy_loss),
      bad_debt: sum((r) => r.bad_debt),
      concessions: sum((r) => r.concessions),
      other_income: sum((r) => r.other_income),
      egi: sum((r) => r.egi),
      total_opex: sum((r) => r.total_opex),
      opex_breakdown: {
        management_fees: sum((r) => r.opex_breakdown.management_fees),
        payroll: sum((r) => r.opex_breakdown.payroll),
        repairs_maintenance: sum((r) => r.opex_breakdown.repairs_maintenance),
        turnover: sum((r) => r.opex_breakdown.turnover),
        insurance: sum((r) => r.opex_breakdown.insurance),
        property_tax: sum((r) => r.opex_breakdown.property_tax),
        utilities: sum((r) => r.opex_breakdown.utilities),
        admin_legal_marketing: sum((r) => r.opex_breakdown.admin_legal_marketing),
        contract_services: sum((r) => r.opex_breakdown.contract_services),
        reserves: sum((r) => r.opex_breakdown.reserves),
      },
      noi: sum((r) => r.noi),
      debt_service: sum((r) => r.debt_service),
      cash_flow_before_capex: sum((r) => r.cash_flow_before_capex),
      capex: sum((r) => r.capex),
      cash_flow: annualCF,
      cumulative_cash_flow: annualCumulativeCF,
      cash_on_cash: totalEquity > 0 ? annualCF / totalEquity : 0,
    });
  }

  // ── Exit ──
  const lastYearNOI = annual.length > 0 ? annual[annual.length - 1].noi : 0;
  const exitValue = exit.sale_price && exit.sale_price > 0
    ? exit.sale_price
    : (exit.exit_cap_rate > 0 ? lastYearNOI / exit.exit_cap_rate : 0);
  const sellingCosts = exitValue * exit.selling_cost_rate;

  // Outstanding loan balance at exit
  const loanBalance = calculateLoanBalance(
    loanAmount,
    monthlyRate,
    amortMonths,
    totalMonths,
    financing.io_period_months
  );

  const netSaleProceeds = exitValue - sellingCosts - loanBalance;
  const totalDistributions = cumulativeCF + netSaleProceeds;
  const totalProfit = totalDistributions - totalEquity;

  // ── Metrics ──
  const year1NOI = annual.length > 0 ? annual[0].noi : 0;
  const stabilizedNOI = annual.length > 1 ? annual[annual.length - 1].noi : year1NOI;
  const goingInCap = purchase.purchase_price > 0 ? year1NOI / purchase.purchase_price : 0;
  const stabilizedCap = purchase.purchase_price > 0 ? stabilizedNOI / purchase.purchase_price : 0;

  // IRR: cash flows = [-equity, annual CF year 1..N-1, annual CF year N + net sale proceeds]
  const irrFlows: number[] = [-totalEquity];
  for (let y = 0; y < annual.length; y++) {
    if (y === annual.length - 1) {
      irrFlows.push(annual[y].cash_flow + netSaleProceeds);
    } else {
      irrFlows.push(annual[y].cash_flow);
    }
  }
  const irr = calculateIRR(irrFlows);

  const equityMultiple = totalEquity > 0 ? totalDistributions / totalEquity : 0;
  const avgCoC =
    annual.length > 0
      ? annual.reduce((s, a) => s + a.cash_on_cash, 0) / annual.length
      : 0;

  // DSCR
  const year1DS = annual.length > 0 ? annual[0].debt_service : 0;
  const year1DSCR = year1DS > 0 ? year1NOI / year1DS : 0;
  const minDSCR = annual.reduce((min, a) => {
    const dscr = a.debt_service > 0 ? a.noi / a.debt_service : Infinity;
    return Math.min(min, dscr);
  }, Infinity);

  // ── Depreciation ──
  const dep = inputs.depreciation;
  let depreciation: DepreciationResult | undefined;
  if (dep && dep.land_tax_assessment && dep.improvement_tax_assessment) {
    const totalAssessment = dep.land_tax_assessment + dep.improvement_tax_assessment;
    const landPct = totalAssessment > 0 ? dep.land_tax_assessment / totalAssessment : 0;
    const improvementPct = totalAssessment > 0 ? dep.improvement_tax_assessment / totalAssessment : 0;
    const depreciableBasis = purchase.purchase_price * improvementPct;
    const straightLine = depreciableBasis / 27.5; // residential 27.5 years
    const accelPct = dep.accelerated_depreciation_pct || 0;
    const acceleratedPortion = depreciableBasis * accelPct; // bonus depreciation taken in year 1
    const remainingPortion = depreciableBasis - acceleratedPortion;
    const remainingAnnual = remainingPortion / 27.5;
    depreciation = {
      straight_line_annual: straightLine,
      accelerated_year1: acceleratedPortion + remainingAnnual, // full accelerated portion + remainder year 1
      accelerated_ongoing: remainingAnnual, // only remainder for years 2+
      land_pct: landPct,
      improvement_pct: improvementPct,
    };
  }

  const downPayment = purchase.purchase_price - loanAmount;

  const metrics: DealMetrics = {
    purchase_price: purchase.purchase_price,
    closing_costs: closingCosts,
    origination_fee: originationFee,
    capex_reserve: capexReserve,
    total_cost: totalCost,
    loan_amount: loanAmount,
    down_payment: downPayment,
    total_equity: totalEquity,
    monthly_debt_service: monthlyDS,
    depreciation,
    going_in_cap: goingInCap,
    stabilized_cap: stabilizedCap,
    irr,
    equity_multiple: equityMultiple,
    average_cash_on_cash: avgCoC,
    year1_dscr: year1DSCR,
    min_dscr: !isFinite(minDSCR) ? year1DSCR : minDSCR,
    exit_value: exitValue,
    exit_noi: lastYearNOI,
    net_sale_proceeds: netSaleProceeds,
    total_profit: totalProfit,
  };

  // ── Sensitivity ──
  const sensitivity = buildSensitivityGrid(inputs);

  // ── Sanity Checks ──
  if (goingInCap < 0.03) warnings.push("Going-in cap rate below 3% — verify pricing");
  if (goingInCap > 0.12) warnings.push("Going-in cap rate above 12% — verify pricing");
  if (year1DSCR > 0 && year1DSCR < 1.0) warnings.push("DSCR below 1.0 — negative cash flow");
  if (revenue.vacancy_rate < 0.03) warnings.push("Vacancy below 3% — may be aggressive");
  if (revenue.vacancy_rate > 0.20) warnings.push("Vacancy above 20% — verify assumption");
  if (revenue.rent_growth_rate > 0.05) warnings.push("Rent growth above 5%/yr — may be aggressive");
  if (exit.exit_cap_rate > 0 && goingInCap > 0 && exit.exit_cap_rate < goingInCap * 0.85) {
    warnings.push("Exit cap significantly below going-in — verify exit assumptions");
  }

  const totalCapex = capex.per_unit_cost * capex.units_to_renovate +
    capex.projects.reduce((s, p) => s + p.cost, 0);
  if (totalUnits > 0 && totalCapex / totalUnits > 25000) {
    warnings.push("CapEx exceeds $25K/unit — verify intentional");
  }

  const opexRatio = annual.length > 0 && annual[0].egi > 0
    ? annual[0].total_opex / annual[0].egi
    : 0;
  if (opexRatio < 0.35 && opexRatio > 0) warnings.push("OpEx ratio below 35% — may underestimate expenses");
  if (opexRatio > 0.60) warnings.push("OpEx ratio above 60% — verify expenses");

  return { monthly, annual, metrics, sensitivity, warnings };
}

// ─── Helper Functions ────────────────────────────────────────

/** Resolve an OpexInput (or legacy fallback) to a monthly dollar amount */
function resolveOpexMonthly(
  input: OpexInput | undefined,
  legacyValue: number,
  legacyMode: OpexInputMode,
  ctx: { totalUnits: number; monthlyEgi: number; monthlyGpr: number; escalation: number },
): number {
  const oi = input || { value: legacyValue, mode: legacyMode };
  const v = oi.value || 0;
  const esc = (oi.mode === "pct_egi" || oi.mode === "pct_gpr") ? 1 : ctx.escalation;
  switch (oi.mode) {
    case "total_annual":     return (v * esc) / 12;
    case "per_unit_annual":  return (ctx.totalUnits * v * esc) / 12;
    case "per_unit_monthly": return ctx.totalUnits * v * esc;
    case "pct_egi":          return ctx.monthlyEgi * v;
    case "pct_gpr":          return ctx.monthlyGpr * v;
    default:                 return (v * esc) / 12;
  }
}

/** Resolve an OpexInput to an annual dollar amount (for simplified/sensitivity calc) */
function resolveOpexAnnual(
  input: OpexInput | undefined,
  legacyValue: number,
  legacyMode: OpexInputMode,
  ctx: { totalUnits: number; annualEgi: number; annualGpr: number; escalation: number },
): number {
  const oi = input || { value: legacyValue, mode: legacyMode };
  const v = oi.value || 0;
  const esc = (oi.mode === "pct_egi" || oi.mode === "pct_gpr") ? 1 : ctx.escalation;
  switch (oi.mode) {
    case "total_annual":     return v * esc;
    case "per_unit_annual":  return ctx.totalUnits * v * esc;
    case "per_unit_monthly": return ctx.totalUnits * v * 12 * esc;
    case "pct_egi":          return ctx.annualEgi * v;
    case "pct_gpr":          return ctx.annualGpr * v;
    default:                 return v * esc;
  }
}

/** Sum monthly resolution of sublines; returns null if no subline has a nonzero value */
function resolveSublinesMonthly(
  sublines: Record<string, OpexInput | undefined> | undefined,
  ctx: { totalUnits: number; monthlyEgi: number; monthlyGpr: number; escalation: number },
): number | null {
  if (!sublines) return null;
  let anyHasValue = false;
  let sum = 0;
  for (const key of Object.keys(sublines)) {
    const s = sublines[key];
    if (s && s.value) {
      anyHasValue = true;
      sum += resolveOpexMonthly(s, 0, s.mode, ctx);
    }
  }
  return anyHasValue ? sum : null;
}

/** Sum annual resolution of sublines; returns null if no subline has a nonzero value */
function resolveSublinesAnnual(
  sublines: Record<string, OpexInput | undefined> | undefined,
  ctx: { totalUnits: number; annualEgi: number; annualGpr: number; escalation: number },
): number | null {
  if (!sublines) return null;
  let anyHasValue = false;
  let sum = 0;
  for (const key of Object.keys(sublines)) {
    const s = sublines[key];
    if (s && s.value) {
      anyHasValue = true;
      sum += resolveOpexAnnual(s, 0, s.mode, ctx);
    }
  }
  return anyHasValue ? sum : null;
}

function calculateMonthlyPayment(
  principal: number,
  monthlyRate: number,
  months: number
): number {
  if (monthlyRate === 0) return principal / months;
  return (
    (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) /
    (Math.pow(1 + monthlyRate, months) - 1)
  );
}

function calculateLoanBalance(
  principal: number,
  monthlyRate: number,
  amortMonths: number,
  elapsedMonths: number,
  ioMonths: number
): number {
  // During IO period, no principal reduction
  const amortizingMonths = Math.max(0, elapsedMonths - ioMonths);
  if (amortizingMonths <= 0) return principal;
  if (monthlyRate === 0) return principal * (1 - amortizingMonths / amortMonths);

  const balance =
    principal *
    ((Math.pow(1 + monthlyRate, amortMonths) -
      Math.pow(1 + monthlyRate, amortizingMonths)) /
      (Math.pow(1 + monthlyRate, amortMonths) - 1));

  return Math.max(0, balance);
}

/** Derive the per-month renovation throughput from start/end or legacy units_per_month */
function getUnitsPerMonth(capex: CapexAssumptions): number {
  if (capex.renovation_end_month && capex.renovation_end_month >= (capex.renovation_start_month || 1)) {
    const span = capex.renovation_end_month - (capex.renovation_start_month || 1) + 1;
    return capex.units_to_renovate / span;
  }
  return capex.units_per_month || 0;
}

function buildRenovationSchedule(
  capex: CapexAssumptions,
  totalMonths: number
): number[] {
  const schedule: number[] = new Array(totalMonths).fill(0);
  const upm = getUnitsPerMonth(capex);
  if (upm <= 0 || capex.units_to_renovate <= 0) return schedule;

  const startMonth = Math.max(1, capex.renovation_start_month || 1);
  let renovated = 0;
  for (let m = 0; m < totalMonths; m++) {
    if (m + 1 >= startMonth) {
      renovated = Math.min(
        renovated + upm,
        capex.units_to_renovate
      );
    }
    schedule[m] = renovated;
  }
  return schedule;
}

/**
 * Build a schedule of units offline for renovation each month.
 * A unit completing renovation in month M is offline for `downtime_months`
 * months ending in M (i.e., months M-downtime+1 through M inclusive).
 */
function buildDowntimeSchedule(
  capex: CapexAssumptions,
  renovatedByMonth: number[],
  totalMonths: number
): number[] {
  const offline: number[] = new Array(totalMonths).fill(0);
  if (!capex.renovation_downtime_enabled) return offline;
  const downtimeMonths = capex.renovation_downtime_months || 1;
  if (downtimeMonths <= 0) return offline;

  // For each month, figure out how many units are completing
  // (delta in cumulative renovated). Those units were offline
  // for `downtimeMonths` months ending at that month.
  for (let m = 0; m < totalMonths; m++) {
    const prevRenovated = m > 0 ? renovatedByMonth[m - 1] : 0;
    const completedThisMonth = renovatedByMonth[m] - prevRenovated;
    if (completedThisMonth > 0) {
      // These units were offline from month (m - downtimeMonths + 1) through m
      for (let d = 0; d < downtimeMonths; d++) {
        const offlineMonth = m - d;
        if (offlineMonth >= 0) {
          offline[offlineMonth] += completedThisMonth;
        }
      }
    }
  }
  return offline;
}

function calculateMonthCapex(capex: CapexAssumptions, month: number): number {
  let total = 0;

  // Per-unit renovations: spread cost evenly across renovation window
  const upm = getUnitsPerMonth(capex);
  const startMonth = Math.max(1, capex.renovation_start_month || 1);
  if (upm > 0 && capex.per_unit_cost > 0 && month >= startMonth) {
    const monthsActive = month - startMonth + 1;
    const monthsActivePrev = monthsActive - 1;
    const totalRenovatedBefore = Math.min(
      monthsActivePrev * upm,
      capex.units_to_renovate
    );
    const totalRenovatedAfter = Math.min(
      monthsActive * upm,
      capex.units_to_renovate
    );
    const unitsThisMonth = totalRenovatedAfter - totalRenovatedBefore;
    total += unitsThisMonth * capex.per_unit_cost;
  }

  // Project-based CapEx
  for (const project of capex.projects) {
    const duration = project.duration_months || 1; // guard against zero
    if (
      month >= project.start_month &&
      month < project.start_month + duration
    ) {
      total += project.cost / duration;
    }
  }

  return total;
}

function buildSensitivityGrid(
  inputs: ScenarioInputs,
): SensitivityCell[] {
  const priceDeltaOptions = [-0.10, -0.05, 0, 0.05, 0.10];
  const capRateDeltas = [-0.01, -0.005, 0, 0.005, 0.01];
  const grid: SensitivityCell[] = [];

  for (const priceDelta of priceDeltaOptions) {
    for (const capDelta of capRateDeltas) {
      const adjustedInputs: ScenarioInputs = {
        ...inputs,
        purchase: {
          ...inputs.purchase,
          purchase_price: inputs.purchase.purchase_price * (1 + priceDelta),
        },
        exit: {
          ...inputs.exit,
          exit_cap_rate: inputs.exit.exit_cap_rate + capDelta,
        },
      };

      // Recalculate with adjusted inputs
      const adjustedLoan = adjustedInputs.purchase.purchase_price * adjustedInputs.financing.ltv;
      const adjustedClosing = computeClosingCosts(adjustedInputs.purchase);
      const adjustedOrigination = adjustedLoan * adjustedInputs.financing.origination_fee_rate;
      const adjustedCapexReserve = adjustedInputs.purchase.capex_reserve || 0;
      const adjustedEquity = adjustedInputs.purchase.purchase_price + adjustedClosing + adjustedOrigination + adjustedCapexReserve - adjustedLoan;

      // Skip invalid cap rates (zero or negative)
      if (adjustedInputs.exit.exit_cap_rate <= 0) {
        grid.push({
          purchase_price_delta: priceDelta,
          exit_cap_rate: inputs.exit.exit_cap_rate + capDelta,
          irr: null,
        });
        continue;
      }

      // Use simplified approach: scale base case results
      const result = calculateUnderwritingSimplified(adjustedInputs);
      const exitVal = result.exitNOI > 0
        ? result.exitNOI / adjustedInputs.exit.exit_cap_rate
        : 0;
      const netProceeds = exitVal * (1 - adjustedInputs.exit.selling_cost_rate) -
        result.loanBalance;

      const irrFlows: number[] = [-adjustedEquity];
      for (let y = 0; y < result.annualCashFlows.length; y++) {
        if (y === result.annualCashFlows.length - 1) {
          irrFlows.push(result.annualCashFlows[y] + netProceeds);
        } else {
          irrFlows.push(result.annualCashFlows[y]);
        }
      }

      grid.push({
        purchase_price_delta: priceDelta,
        exit_cap_rate: inputs.exit.exit_cap_rate + capDelta,
        irr: calculateIRR(irrFlows),
      });
    }
  }

  return grid;
}

/** Get the monthly rent for a unit based on rent basis selection */
function getUnitRent(unit: UnitMix, basis: RentBasis): number {
  switch (basis) {
    case "market":
      return unit.market_rent;
    case "current_plus_reno":
      return unit.current_rent + unit.renovated_rent_premium;
    case "market_plus_reno":
      return unit.market_rent + unit.renovated_rent_premium;
    case "current":
    default:
      return unit.current_rent;
  }
}

/** Simplified calculation for sensitivity grid — avoids full monthly recalc */
function calculateUnderwritingSimplified(inputs: ScenarioInputs): {
  annualCashFlows: number[];
  exitNOI: number;
  loanBalance: number;
} {
  const { purchase, financing, revenue, expenses, capex, exit } = inputs;
  const totalMonths = exit.hold_period_years * 12;
  const totalUnits = revenue.unit_mix.reduce((s, u) => s + u.count, 0);
  const loanAmount = purchase.purchase_price * financing.ltv;
  const monthlyRate = financing.interest_rate / 12;
  const amortMonths = financing.amortization_years * 12;
  const monthlyDS = calculateMonthlyPayment(loanAmount, monthlyRate, amortMonths);
  const monthlyIO = loanAmount * monthlyRate;
  const rentBasis: RentBasis = exit.sensitivity_rent_basis || "current";

  // Build renovation schedule for renovation-aware rent calculations
  const renovatedByMonth = buildRenovationSchedule(capex, totalMonths);
  const offlineByMonth = buildDowntimeSchedule(capex, renovatedByMonth, totalMonths);

  const annualCashFlows: number[] = [];

  for (let y = 0; y < exit.hold_period_years; y++) {
    const yearGrowth = Math.pow(1 + revenue.rent_growth_rate, y);
    let annualGPR = 0;

    // Use mid-year renovation count for annual approximation
    const midYearMonth = y * 12 + 6;
    const totalRenovated = midYearMonth < totalMonths ? renovatedByMonth[midYearMonth] : renovatedByMonth[totalMonths - 1];
    // Sum offline units across the year's months for total lost unit-months
    let totalOfflineUnitMonths = 0;
    for (let mo = y * 12; mo < (y + 1) * 12 && mo < totalMonths; mo++) {
      totalOfflineUnitMonths += offlineByMonth[mo];
    }

    for (const unit of revenue.unit_mix) {
      const unitShare = totalUnits > 0 ? unit.count / totalUnits : 0;
      const renovatedInType = Math.min(Math.floor(totalRenovated * unitShare), unit.count);
      const offlineUnitMonthsInType = totalOfflineUnitMonths * unitShare;

      const baseRent = getUnitRent(unit, rentBasis);
      // Renovated units get the premium on top of whichever base rent is selected
      const hasRenoPremium = rentBasis === "current_plus_reno" || rentBasis === "market_plus_reno";
      if (hasRenoPremium) {
        // All units already include reno premium via getUnitRent
        annualGPR += unit.count * baseRent * yearGrowth * 12;
      } else {
        // Only renovated units get the premium
        const unrenovatedInType = unit.count - renovatedInType;
        const renovatedRent = baseRent + unit.renovated_rent_premium;
        annualGPR += (unrenovatedInType * baseRent + renovatedInType * renovatedRent) * yearGrowth * 12;
      }
      // Subtract revenue lost from offline units (they lose baseRent each month offline)
      annualGPR -= offlineUnitMonthsInType * baseRent * yearGrowth;
    }

    const annualEGI = annualGPR * (1 - revenue.vacancy_rate - revenue.bad_debt_rate - revenue.concessions_rate)
      + revenue.other_income_monthly * 12;

    const taxEscalation = Math.pow(1 + expenses.tax_escalation_rate, y);
    const expEscalation = Math.pow(1 + (expenses.expense_escalation_rate || 0), y);
    const oiS = expenses.opex_inputs;
    const sCtx = { totalUnits, annualEgi: annualEGI, annualGpr: annualGPR, escalation: expEscalation };
    const sTaxCtx = { ...sCtx, escalation: taxEscalation };
    const utilSubSumS = resolveSublinesAnnual(oiS?.utilities_sublines as Record<string, OpexInput | undefined> | undefined, sCtx);
    const svcSubSumS = resolveSublinesAnnual(oiS?.services_sublines as Record<string, OpexInput | undefined> | undefined, sCtx);
    const annualOpex =
      resolveOpexAnnual(oiS?.management_fees, expenses.management_fee_rate, "pct_egi", sCtx) +
      resolveOpexAnnual(oiS?.payroll, expenses.payroll_annual, "total_annual", sCtx) +
      resolveOpexAnnual(oiS?.repairs_maintenance, expenses.repairs_maintenance_per_unit, "per_unit_annual", sCtx) +
      resolveOpexAnnual(oiS?.turnover, expenses.turnover_cost_per_unit, "per_unit_annual", sCtx) * (expenses.turnover_rate ?? 0.50) +
      resolveOpexAnnual(oiS?.insurance, expenses.insurance_per_unit, "per_unit_annual", sCtx) +
      resolveOpexAnnual(oiS?.property_tax, expenses.property_tax_total, "total_annual", sTaxCtx) +
      (utilSubSumS !== null ? utilSubSumS : resolveOpexAnnual(oiS?.utilities, expenses.utilities_per_unit, "per_unit_annual", sCtx)) +
      resolveOpexAnnual(oiS?.admin_legal_marketing, expenses.admin_legal_marketing, "total_annual", sCtx) +
      (svcSubSumS !== null ? svcSubSumS : resolveOpexAnnual(oiS?.contract_services, expenses.contract_services, "total_annual", sCtx)) +
      resolveOpexAnnual(oiS?.reserves, expenses.reserves_per_unit, "per_unit_annual", sCtx);

    const annualNOI = annualEGI - annualOpex;

    // Debt service for the year
    let annualDS = 0;
    for (let m = y * 12 + 1; m <= (y + 1) * 12; m++) {
      annualDS += m <= financing.io_period_months ? monthlyIO : monthlyDS;
    }

    // Simplified CapEx (just projects + per-unit)
    let annualCapex = 0;
    for (let m = y * 12 + 1; m <= (y + 1) * 12; m++) {
      annualCapex += calculateMonthCapex(capex, m);
    }

    annualCashFlows.push(annualNOI - annualDS - annualCapex);
  }

  // Exit NOI: use end-of-hold renovation count
  const lastYearGrowth = Math.pow(1 + revenue.rent_growth_rate, exit.hold_period_years - 1);
  const exitRenovated = renovatedByMonth[totalMonths - 1];
  let exitGPR = 0;
  for (const unit of revenue.unit_mix) {
    const unitShare = totalUnits > 0 ? unit.count / totalUnits : 0;
    const renovatedInType = Math.min(Math.floor(exitRenovated * unitShare), unit.count);
    const baseRent = getUnitRent(unit, rentBasis);
    const hasRenoPremium = rentBasis === "current_plus_reno" || rentBasis === "market_plus_reno";
    if (hasRenoPremium) {
      exitGPR += unit.count * baseRent * lastYearGrowth * 12;
    } else {
      const unrenovatedInType = unit.count - renovatedInType;
      const renovatedRent = baseRent + unit.renovated_rent_premium;
      exitGPR += (unrenovatedInType * baseRent + renovatedInType * renovatedRent) * lastYearGrowth * 12;
    }
  }
  const exitEGI = exitGPR * (1 - revenue.vacancy_rate - revenue.bad_debt_rate - revenue.concessions_rate)
    + revenue.other_income_monthly * 12;
  const taxEsc = Math.pow(1 + expenses.tax_escalation_rate, exit.hold_period_years - 1);
  const expEsc = Math.pow(1 + (expenses.expense_escalation_rate || 0), exit.hold_period_years - 1);
  const oiE = expenses.opex_inputs;
  const eCtx = { totalUnits, annualEgi: exitEGI, annualGpr: exitGPR, escalation: expEsc };
  const eTaxCtx = { ...eCtx, escalation: taxEsc };
  const utilSubSumE = resolveSublinesAnnual(oiE?.utilities_sublines as Record<string, OpexInput | undefined> | undefined, eCtx);
  const svcSubSumE = resolveSublinesAnnual(oiE?.services_sublines as Record<string, OpexInput | undefined> | undefined, eCtx);
  const exitOpex =
    resolveOpexAnnual(oiE?.management_fees, expenses.management_fee_rate, "pct_egi", eCtx) +
    resolveOpexAnnual(oiE?.payroll, expenses.payroll_annual, "total_annual", eCtx) +
    resolveOpexAnnual(oiE?.repairs_maintenance, expenses.repairs_maintenance_per_unit, "per_unit_annual", eCtx) +
    resolveOpexAnnual(oiE?.turnover, expenses.turnover_cost_per_unit, "per_unit_annual", eCtx) * (expenses.turnover_rate ?? 0.50) +
    resolveOpexAnnual(oiE?.insurance, expenses.insurance_per_unit, "per_unit_annual", eCtx) +
    resolveOpexAnnual(oiE?.property_tax, expenses.property_tax_total, "total_annual", eTaxCtx) +
    (utilSubSumE !== null ? utilSubSumE : resolveOpexAnnual(oiE?.utilities, expenses.utilities_per_unit, "per_unit_annual", eCtx)) +
    resolveOpexAnnual(oiE?.admin_legal_marketing, expenses.admin_legal_marketing, "total_annual", eCtx) +
    (svcSubSumE !== null ? svcSubSumE : resolveOpexAnnual(oiE?.contract_services, expenses.contract_services, "total_annual", eCtx)) +
    resolveOpexAnnual(oiE?.reserves, expenses.reserves_per_unit, "per_unit_annual", eCtx);
  const exitNOI = exitEGI - exitOpex;

  const loanBalance = calculateLoanBalance(
    loanAmount, monthlyRate, amortMonths, totalMonths, financing.io_period_months
  );

  return { annualCashFlows, exitNOI, loanBalance };
}

// ─── Default Scenario Inputs ─────────────────────────────────

export interface DealData {
  asking_price: number;
  units: number;
  loi_amount?: number;
  bid_price?: number;
  earnest_money?: number;
  // Financing fields from deal
  ltv?: number;
  interest_rate?: number;
  loan_term_years?: number;
  amortization_years?: number;
  io_period_months?: number;
  origination_fee_rate?: number;
  // Transaction costs
  transaction_costs?: {
    loan_fees?: number;
    title_insurance?: number;
    legal_fees?: number;
    property_costs?: number;
    prorations?: number;
    third_party_reports?: number;
    transfer_taxes?: number;
    reserves?: number;
  };
  // Revenue from rent roll / T12
  rent_roll?: Array<{
    unit_type?: string;
    current_rent?: number;
    market_rent?: number;
    status?: string;
  }>;
  current_occupancy?: number;
  current_noi?: number;
  // Expenses from T12 / deal
  current_annual_taxes?: number;
  current_annual_insurance?: number;
  t12?: {
    months?: Array<Record<string, number | string | undefined>>;
    total_noi?: number;
    total_opex?: number;
    total_egi?: number;
  };
  // CapEx from buy box
  buy_box_scores?: {
    rehab_per_unit?: number;
  };
}

export function buildUnitMixFromRentRoll(
  rentRoll: { unit_type?: string; current_rent?: number; market_rent?: number }[],
  totalUnits: number,
): UnitMix[] {
  if (rentRoll.length > 0) {
    const typeMap = new Map<string, { count: number; totalRent: number; totalMarket: number }>();
    for (const unit of rentRoll) {
      const type = unit.unit_type || "Average";
      const existing = typeMap.get(type) || { count: 0, totalRent: 0, totalMarket: 0 };
      existing.count += 1;
      existing.totalRent += unit.current_rent || 0;
      existing.totalMarket += unit.market_rent || unit.current_rent || 0;
      typeMap.set(type, existing);
    }
    return Array.from(typeMap.entries()).map(([type, data]) => ({
      type,
      count: data.count,
      current_rent: data.count > 0 ? Math.round(data.totalRent / data.count) : 1000,
      market_rent: data.count > 0 ? Math.round(data.totalMarket / data.count) : 1100,
      renovated_rent_premium: 200,
    }));
  }
  return [{
    type: "Average",
    count: totalUnits,
    current_rent: 1000,
    market_rent: 1100,
    renovated_rent_premium: 200,
  }];
}

export function buildDefaultInputs(
  deal: DealData,
  defaults: Record<string, number>
): ScenarioInputs {
  const d = defaults;

  // Purchase price: LOI amount > bid price > asking price
  const purchasePrice = deal.loi_amount || deal.bid_price || deal.asking_price;

  // Closing costs: sum of transaction costs if available, otherwise default rate
  const txCosts = deal.transaction_costs;
  const txCostTotal = txCosts
    ? (txCosts.loan_fees || 0) + (txCosts.title_insurance || 0) + (txCosts.legal_fees || 0) +
      (txCosts.property_costs || 0) + (txCosts.prorations || 0) + (txCosts.third_party_reports || 0) +
      (txCosts.transfer_taxes || 0) + (txCosts.reserves || 0)
    : 0;
  const closingCostRate = txCostTotal > 0 && purchasePrice > 0
    ? txCostTotal / purchasePrice
    : d.closing_cost_rate ?? 0.02;

  // Financing: feed from deal fields if available
  const ltv = deal.ltv ?? d.ltv ?? 0.75;
  const interestRate = deal.interest_rate ?? (d.interest_rate ? d.interest_rate : 0.065);
  const amortYears = deal.amortization_years ?? d.amortization_years ?? 30;
  const loanTermYears = deal.loan_term_years ?? d.loan_term_years ?? 5;
  const ioMonths = deal.io_period_months ?? d.io_period_months ?? 0;
  const origFeeRate = deal.origination_fee_rate ?? d.origination_fee_rate ?? 0.01;

  // Revenue from rent roll
  const unitMix = buildUnitMixFromRentRoll(deal.rent_roll || [], deal.units);

  // Vacancy from deal occupancy
  const vacancyRate = deal.current_occupancy
    ? 1 - deal.current_occupancy
    : d.vacancy_rate ?? 0.07;

  // Expenses from deal / T12
  const t12Months = deal.t12?.months || [];
  const annualTaxes = deal.current_annual_taxes || sumT12Field(t12Months, "property_taxes") || 0;
  const annualInsurance = deal.current_annual_insurance || sumT12Field(t12Months, "insurance") || 0;
  const insurancePerUnit = annualInsurance > 0 && deal.units > 0
    ? annualInsurance / deal.units
    : d.insurance_per_unit ?? 600;
  const payrollAnnual = sumT12Field(t12Months, "payroll") || 0;
  const utilitiesTotal = sumT12Field(t12Months, "utilities") +
    sumT12Field(t12Months, "utilities_water") +
    sumT12Field(t12Months, "utilities_electric") +
    sumT12Field(t12Months, "utilities_gas") +
    sumT12Field(t12Months, "trash_removal");
  const utilitiesPerUnit = utilitiesTotal > 0 && deal.units > 0
    ? utilitiesTotal / deal.units
    : d.utilities_per_unit ?? 1200;
  const repairsTotal = sumT12Field(t12Months, "repairs_maintenance");
  const repairsPerUnit = repairsTotal > 0 && deal.units > 0
    ? repairsTotal / deal.units
    : d.repairs_maintenance_per_unit ?? 750;
  const turnoverTotal = sumT12Field(t12Months, "turnover_costs");
  const turnoverPerUnit = turnoverTotal > 0 && deal.units > 0
    ? turnoverTotal / deal.units
    : d.turnover_cost_per_unit ?? 500;

  // Other income from T12
  const t12OtherIncome = sumT12Field(t12Months, "laundry_income") +
    sumT12Field(t12Months, "parking_income") +
    sumT12Field(t12Months, "pet_fees") +
    sumT12Field(t12Months, "application_fees") +
    sumT12Field(t12Months, "late_fees") +
    sumT12Field(t12Months, "utility_reimbursements") +
    sumT12Field(t12Months, "storage_income") +
    sumT12Field(t12Months, "other_income");
  const otherIncomeMonthly = t12OtherIncome > 0 && t12Months.length > 0
    ? Math.round(t12OtherIncome / t12Months.length)
    : 0;

  // Admin + marketing from T12
  const adminMarketingTotal = sumT12Field(t12Months, "admin_expenses") + sumT12Field(t12Months, "marketing");

  // Management fee rate from T12 if available
  const t12MgmtFees = sumT12Field(t12Months, "management_fees");
  const t12GPR = sumT12Field(t12Months, "gross_potential_rent");
  const t12VacancyLoss = sumT12Field(t12Months, "vacancy_loss");
  const t12EGI = t12GPR - t12VacancyLoss + t12OtherIncome;
  const mgmtFeeRate = t12MgmtFees > 0 && t12EGI > 0
    ? Math.round((t12MgmtFees / t12EGI) * 1000) / 1000
    : d.management_fee_rate ?? 0.08;

  // Contract services includes landscaping, pest control, and other miscellaneous expenses
  const contractServicesTotal = sumT12Field(t12Months, "contract_services") +
    sumT12Field(t12Months, "landscaping") +
    sumT12Field(t12Months, "pest_control") +
    sumT12Field(t12Months, "other_expenses");

  // CapEx from buy box scores
  const rehabPerUnit = deal.buy_box_scores?.rehab_per_unit || 0;

  return {
    purchase: {
      purchase_price: purchasePrice,
      closing_cost_rate: closingCostRate,
      earnest_money: deal.earnest_money || 0,
    },
    financing: {
      ltv,
      interest_rate: interestRate,
      amortization_years: amortYears,
      loan_term_years: loanTermYears,
      io_period_months: ioMonths,
      origination_fee_rate: origFeeRate,
    },
    revenue: {
      unit_mix: unitMix,
      other_income_monthly: otherIncomeMonthly,
      vacancy_rate: vacancyRate,
      bad_debt_rate: d.bad_debt_rate ?? 0.02,
      concessions_rate: d.concessions_rate ?? 0,
      rent_growth_rate: d.rent_growth_rate ?? 0.03,
    },
    expenses: {
      management_fee_rate: mgmtFeeRate,
      payroll_annual: payrollAnnual,
      repairs_maintenance_per_unit: repairsPerUnit,
      turnover_cost_per_unit: turnoverPerUnit,
      turnover_rate: d.turnover_rate ?? 0.50,
      insurance_per_unit: insurancePerUnit,
      property_tax_total: annualTaxes,
      tax_escalation_rate: d.tax_escalation_rate ?? 0.02,
      expense_escalation_rate: d.expense_escalation_rate ?? 0.02,
      utilities_per_unit: utilitiesPerUnit,
      admin_legal_marketing: adminMarketingTotal || d.admin_legal_marketing || 0,
      contract_services: contractServicesTotal || d.contract_services || 0,
      reserves_per_unit: d.reserves_per_unit ?? 300,
      t12_baseline: t12Months.length > 0 ? {
        gross_potential_rent: sumT12Field(t12Months, "gross_potential_rent"),
        vacancy_loss: sumT12Field(t12Months, "vacancy_loss"),
        other_income: t12OtherIncome,
        property_taxes: annualTaxes,
        insurance: annualInsurance,
        utilities: utilitiesTotal,
        repairs_maintenance: repairsTotal,
        payroll: payrollAnnual,
        management_fees: sumT12Field(t12Months, "management_fees"),
        admin_marketing: adminMarketingTotal,
        contract_services: contractServicesTotal,
      } : undefined,
    },
    capex: {
      per_unit_cost: rehabPerUnit,
      units_to_renovate: rehabPerUnit > 0 ? deal.units : 0,
      renovation_start_month: 1,
      renovation_end_month: 12,
      renovation_downtime_enabled: false,
      renovation_downtime_months: 1,
      projects: [],
    },
    exit: {
      hold_period_years: d.hold_period_years ?? 5,
      exit_cap_rate: 0.07,
      selling_cost_rate: d.selling_cost_rate ?? 0.02,
    },
  };
}

/** Sum a numeric field across T12 months */
export function sumT12Field(months: Array<Record<string, number | string | undefined>>, field: string): number {
  return months.reduce((sum, m) => sum + (typeof m[field] === "number" ? (m[field] as number) : 0), 0);
}

export function buildExpensesFromT12(
  t12Months: Array<Record<string, number | string | undefined>>,
  units: number,
  existing?: Partial<ExpenseAssumptions>,
): Partial<ExpenseAssumptions> {
  if (t12Months.length === 0) return {};

  const annualTaxes = sumT12Field(t12Months, "property_taxes");
  const annualInsurance = sumT12Field(t12Months, "insurance");
  const insurancePerUnit = annualInsurance > 0 && units > 0 ? annualInsurance / units : existing?.insurance_per_unit ?? 600;

  const payrollAnnual = sumT12Field(t12Months, "payroll");
  const utilitiesTotal = sumT12Field(t12Months, "utilities") +
    sumT12Field(t12Months, "utilities_water") +
    sumT12Field(t12Months, "utilities_electric") +
    sumT12Field(t12Months, "utilities_gas") +
    sumT12Field(t12Months, "trash_removal");
  const utilitiesPerUnit = utilitiesTotal > 0 && units > 0 ? utilitiesTotal / units : existing?.utilities_per_unit ?? 1200;

  const repairsTotal = sumT12Field(t12Months, "repairs_maintenance");
  const repairsPerUnit = repairsTotal > 0 && units > 0 ? repairsTotal / units : existing?.repairs_maintenance_per_unit ?? 750;

  const turnoverTotal = sumT12Field(t12Months, "turnover_costs");
  const turnoverPerUnit = turnoverTotal > 0 && units > 0 ? turnoverTotal / units : existing?.turnover_cost_per_unit ?? 500;

  const t12OtherIncome = sumT12Field(t12Months, "laundry_income") +
    sumT12Field(t12Months, "parking_income") +
    sumT12Field(t12Months, "pet_fees") +
    sumT12Field(t12Months, "application_fees") +
    sumT12Field(t12Months, "late_fees") +
    sumT12Field(t12Months, "utility_reimbursements") +
    sumT12Field(t12Months, "storage_income") +
    sumT12Field(t12Months, "other_income");

  const t12MgmtFees = sumT12Field(t12Months, "management_fees");
  const t12GPR = sumT12Field(t12Months, "gross_potential_rent");
  const t12VacancyLoss = sumT12Field(t12Months, "vacancy_loss");
  const t12EGI = t12GPR - t12VacancyLoss + t12OtherIncome;
  const mgmtFeeRate = t12MgmtFees > 0 && t12EGI > 0
    ? Math.round((t12MgmtFees / t12EGI) * 1000) / 1000
    : existing?.management_fee_rate ?? 0.08;

  const adminMarketingTotal = sumT12Field(t12Months, "admin_expenses") + sumT12Field(t12Months, "marketing");
  const contractServicesTotal = sumT12Field(t12Months, "contract_services") +
    sumT12Field(t12Months, "landscaping") +
    sumT12Field(t12Months, "pest_control") +
    sumT12Field(t12Months, "other_expenses");

  return {
    management_fee_rate: mgmtFeeRate,
    payroll_annual: payrollAnnual || existing?.payroll_annual || 0,
    repairs_maintenance_per_unit: repairsPerUnit,
    turnover_cost_per_unit: turnoverPerUnit,
    turnover_rate: existing?.turnover_rate ?? 0.50,
    insurance_per_unit: insurancePerUnit,
    property_tax_total: annualTaxes || existing?.property_tax_total || 0,
    utilities_per_unit: utilitiesPerUnit,
    admin_legal_marketing: adminMarketingTotal || existing?.admin_legal_marketing || 0,
    contract_services: contractServicesTotal || existing?.contract_services || 0,
    t12_baseline: {
      gross_potential_rent: t12GPR,
      vacancy_loss: t12VacancyLoss,
      other_income: t12OtherIncome,
      property_taxes: annualTaxes,
      insurance: annualInsurance,
      utilities: utilitiesTotal,
      repairs_maintenance: repairsTotal,
      payroll: payrollAnnual,
      management_fees: t12MgmtFees,
      admin_marketing: adminMarketingTotal,
      contract_services: contractServicesTotal,
    },
  };
}
