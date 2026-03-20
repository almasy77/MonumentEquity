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

export interface ExpenseAssumptions {
  management_fee_rate: number; // % of EGI
  payroll_annual: number;
  repairs_maintenance_per_unit: number; // annual
  turnover_cost_per_unit: number; // annual
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
  units_per_month: number; // renovation pace
  renovation_start_month: number; // 1-indexed, when per-unit renovations begin
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

  // ── Monthly Pro Forma ──
  const monthly: MonthlyRow[] = [];
  let cumulativeCF = 0;

  for (let m = 1; m <= totalMonths; m++) {
    const yearIndex = Math.floor((m - 1) / 12); // 0-indexed year
    const monthlyRentGrowth = Math.pow(1 + revenue.rent_growth_rate, yearIndex); // compound annually

    // GPR: sum across unit mix, accounting for renovated units
    let gpr = 0;
    const totalRenovated = renovatedByMonth[m - 1];

    for (const unit of revenue.unit_mix) {
      // Distribute renovated units proportionally across unit types
      const unitShare = totalUnits > 0 ? unit.count / totalUnits : 0;
      const renovatedInType = Math.min(
        Math.floor(totalRenovated * unitShare),
        unit.count
      );
      const unrenovatedInType = unit.count - renovatedInType;

      const baseRent = unit.current_rent * monthlyRentGrowth;
      const renovatedRent = (unit.current_rent + unit.renovated_rent_premium) * monthlyRentGrowth;

      gpr += unrenovatedInType * baseRent + renovatedInType * renovatedRent;
    }

    const vacancyLoss = gpr * revenue.vacancy_rate;
    const badDebt = gpr * revenue.bad_debt_rate;
    const concessions = gpr * revenue.concessions_rate;
    const otherIncome = revenue.other_income_monthly;
    const egi = gpr - vacancyLoss - badDebt - concessions + otherIncome;

    // OpEx (annualized per-unit costs → monthly)
    const annualTaxEscalation = Math.pow(1 + expenses.tax_escalation_rate, yearIndex);
    const annualExpEscalation = Math.pow(1 + (expenses.expense_escalation_rate || 0), yearIndex);

    const opexBk: OpexBreakdown = {
      management_fees: egi * expenses.management_fee_rate,
      payroll: (expenses.payroll_annual * annualExpEscalation) / 12,
      repairs_maintenance: (totalUnits * expenses.repairs_maintenance_per_unit * annualExpEscalation) / 12,
      turnover: (totalUnits * expenses.turnover_cost_per_unit * annualExpEscalation) / 12,
      insurance: (totalUnits * expenses.insurance_per_unit * annualExpEscalation) / 12,
      property_tax: (expenses.property_tax_total * annualTaxEscalation) / 12,
      utilities: (totalUnits * expenses.utilities_per_unit * annualExpEscalation) / 12,
      admin_legal_marketing: (expenses.admin_legal_marketing * annualExpEscalation) / 12,
      contract_services: (expenses.contract_services * annualExpEscalation) / 12,
      reserves: (totalUnits * expenses.reserves_per_unit * annualExpEscalation) / 12,
    };
    const monthlyOpex = Object.values(opexBk).reduce((s, v) => s + v, 0);

    const noi = egi - monthlyOpex;

    // Debt service (IO period vs amortizing)
    const ds = m <= financing.io_period_months ? monthlyIO : monthlyDS;

    // CapEx for this month
    const monthCapex = calculateMonthCapex(capex, m);

    const cashFlow = noi - ds - monthCapex;
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
  if (exit.exit_cap_rate < goingInCap) warnings.push("Exit cap below going-in — optimistic assumption");

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

function buildRenovationSchedule(
  capex: CapexAssumptions,
  totalMonths: number
): number[] {
  const schedule: number[] = new Array(totalMonths).fill(0);
  if (capex.units_per_month <= 0 || capex.units_to_renovate <= 0) return schedule;

  const startMonth = Math.max(1, capex.renovation_start_month || 1);
  let renovated = 0;
  for (let m = 0; m < totalMonths; m++) {
    if (m + 1 >= startMonth) {
      renovated = Math.min(
        renovated + capex.units_per_month,
        capex.units_to_renovate
      );
    }
    schedule[m] = renovated;
  }
  return schedule;
}

function calculateMonthCapex(capex: CapexAssumptions, month: number): number {
  let total = 0;

  // Per-unit renovations: spread cost evenly across renovation pace
  const startMonth = Math.max(1, capex.renovation_start_month || 1);
  if (capex.units_per_month > 0 && capex.per_unit_cost > 0 && month >= startMonth) {
    const monthsActive = month - startMonth + 1;
    const monthsActivePrev = monthsActive - 1;
    const totalRenovatedBefore = Math.min(
      monthsActivePrev * capex.units_per_month,
      capex.units_to_renovate
    );
    const totalRenovatedAfter = Math.min(
      monthsActive * capex.units_per_month,
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

  const annualCashFlows: number[] = [];

  for (let y = 0; y < exit.hold_period_years; y++) {
    const yearGrowth = Math.pow(1 + revenue.rent_growth_rate, y);
    let annualGPR = 0;

    // Use mid-year renovation count for annual approximation
    const midYearMonth = y * 12 + 6;
    const totalRenovated = midYearMonth < totalMonths ? renovatedByMonth[midYearMonth] : renovatedByMonth[totalMonths - 1];

    for (const unit of revenue.unit_mix) {
      const unitShare = totalUnits > 0 ? unit.count / totalUnits : 0;
      const renovatedInType = Math.min(Math.floor(totalRenovated * unitShare), unit.count);

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
    }

    const annualEGI = annualGPR * (1 - revenue.vacancy_rate - revenue.bad_debt_rate - revenue.concessions_rate)
      + revenue.other_income_monthly * 12;

    const taxEscalation = Math.pow(1 + expenses.tax_escalation_rate, y);
    const expEscalation = Math.pow(1 + (expenses.expense_escalation_rate || 0), y);
    const annualOpex =
      annualEGI * expenses.management_fee_rate +
      expenses.payroll_annual * expEscalation +
      totalUnits * expenses.repairs_maintenance_per_unit * expEscalation +
      totalUnits * expenses.turnover_cost_per_unit * expEscalation +
      totalUnits * expenses.insurance_per_unit * expEscalation +
      expenses.property_tax_total * taxEscalation +
      totalUnits * expenses.utilities_per_unit * expEscalation +
      expenses.admin_legal_marketing * expEscalation +
      expenses.contract_services * expEscalation +
      totalUnits * expenses.reserves_per_unit * expEscalation;

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
  const exitOpex =
    exitEGI * expenses.management_fee_rate +
    expenses.payroll_annual * expEsc +
    totalUnits * (expenses.repairs_maintenance_per_unit + expenses.turnover_cost_per_unit +
      expenses.insurance_per_unit + expenses.utilities_per_unit + expenses.reserves_per_unit) * expEsc +
    expenses.property_tax_total * taxEsc +
    (expenses.admin_legal_marketing + expenses.contract_services) * expEsc;
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
  let unitMix: UnitMix[];
  if (deal.rent_roll && deal.rent_roll.length > 0) {
    // Group by unit_type
    const typeMap = new Map<string, { count: number; totalRent: number; totalMarket: number }>();
    for (const unit of deal.rent_roll) {
      const type = unit.unit_type || "Average";
      const existing = typeMap.get(type) || { count: 0, totalRent: 0, totalMarket: 0 };
      existing.count += 1;
      existing.totalRent += unit.current_rent || 0;
      existing.totalMarket += unit.market_rent || unit.current_rent || 0;
      typeMap.set(type, existing);
    }
    unitMix = Array.from(typeMap.entries()).map(([type, data]) => ({
      type,
      count: data.count,
      current_rent: data.count > 0 ? Math.round(data.totalRent / data.count) : 1000,
      market_rent: data.count > 0 ? Math.round(data.totalMarket / data.count) : 1100,
      renovated_rent_premium: 200,
    }));
  } else {
    unitMix = [{
      type: "Average",
      count: deal.units,
      current_rent: 1000,
      market_rent: 1100,
      renovated_rent_premium: 200,
    }];
  }

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
    sumT12Field(t12Months, "utilities_gas");
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
      other_income_monthly: 0,
      vacancy_rate: vacancyRate,
      bad_debt_rate: d.bad_debt_rate ?? 0.02,
      concessions_rate: d.concessions_rate ?? 0,
      rent_growth_rate: d.rent_growth_rate ?? 0.03,
    },
    expenses: {
      management_fee_rate: d.management_fee_rate ?? 0.08,
      payroll_annual: payrollAnnual,
      repairs_maintenance_per_unit: repairsPerUnit,
      turnover_cost_per_unit: turnoverPerUnit,
      insurance_per_unit: insurancePerUnit,
      property_tax_total: annualTaxes,
      tax_escalation_rate: d.tax_escalation_rate ?? 0.02,
      expense_escalation_rate: d.expense_escalation_rate ?? 0.02,
      utilities_per_unit: utilitiesPerUnit,
      admin_legal_marketing: d.admin_legal_marketing ?? 0,
      contract_services: d.contract_services ?? 0,
      reserves_per_unit: d.reserves_per_unit ?? 300,
      t12_baseline: t12Months.length > 0 ? {
        gross_potential_rent: sumT12Field(t12Months, "gross_potential_rent"),
        vacancy_loss: sumT12Field(t12Months, "vacancy_loss"),
        other_income: sumT12Field(t12Months, "laundry_income") + sumT12Field(t12Months, "parking_income") +
          sumT12Field(t12Months, "pet_fees") + sumT12Field(t12Months, "application_fees") +
          sumT12Field(t12Months, "late_fees") + sumT12Field(t12Months, "utility_reimbursements") +
          sumT12Field(t12Months, "storage_income") + sumT12Field(t12Months, "other_income"),
        property_taxes: annualTaxes,
        insurance: annualInsurance,
        utilities: utilitiesTotal,
        repairs_maintenance: repairsTotal,
        payroll: payrollAnnual,
        management_fees: sumT12Field(t12Months, "management_fees"),
        admin_marketing: sumT12Field(t12Months, "admin_expenses") + sumT12Field(t12Months, "marketing"),
        contract_services: sumT12Field(t12Months, "contract_services"),
      } : undefined,
    },
    capex: {
      per_unit_cost: rehabPerUnit,
      units_to_renovate: rehabPerUnit > 0 ? deal.units : 0,
      units_per_month: rehabPerUnit > 0 ? Math.max(1, Math.ceil(deal.units / 12)) : 0,
      renovation_start_month: 1,
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
function sumT12Field(months: Array<Record<string, number | string | undefined>>, field: string): number {
  return months.reduce((sum, m) => sum + (typeof m[field] === "number" ? (m[field] as number) : 0), 0);
}
