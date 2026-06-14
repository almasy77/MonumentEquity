/**
 * Monument Equity — Monthly Underwriting Calculation Engine
 *
 * All calculations are monthly over a configurable hold period (default 60 months).
 * Pure functions — no side effects, fully testable.
 */

import { calculateIRR } from "./irr";
import { computeTaxLayer } from "./tax";
import type { TaxAssumptions, TaxResult } from "./tax";

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
  // Fix-spec Phase 4.1: lenders size to min(LTV, DSCR). Defaults ON at 1.25x
  // on year-1 NOI with the fully-amortizing payment (lender convention even
  // during an IO period). Set size_to_dscr=false to model LTV-only proceeds.
  size_to_dscr?: boolean; // default true
  dscr_floor?: number; // default 1.25
}

// Per-unit detail for a unit-mix row (spec B2 / ramp Phase 2). When present,
// these drive a unit-level absorption schedule: each unit gets its own
// time-to-market (vacant ~lease-up months, MTM per pacing policy, fixed
// lease = lease end + turn downtime) instead of the linear approximation.
export interface UnitDetail {
  unit_id: string; // e.g. "A-3"
  status: "occupied" | "mtm" | "vacant"; // occupied = fixed lease; mtm = month-to-month
  current_rent: number; // $0 for vacant
  market_rent?: number; // per-unit override; defaults to the row's market_rent
  lease_end?: string; // ISO date — required for "occupied" to schedule its turn
}

export interface UnitMix {
  unit_number?: string; // free-text label, e.g. "Apt 101" or "Apartments". Display-only.
  type: string; // e.g. "1BR/1BA"
  count: number;
  current_rent: number; // average over occupied units (vacant units tracked via ramp.initial_vacant_units)
  market_rent: number;
  renovated_rent_premium: number; // additional rent after renovation
  unit_class?: "residential" | "commercial"; // informational tag for mixed-use; does NOT affect totals
  units?: UnitDetail[]; // optional per-unit expansion; when present, count/current_rent should mirror it
}

// Itemized breakdown of other income (stored $/mo per line; the UI offers
// $/mo or $/yr entry and converts). UI-only detail: the engine reads
// other_income_monthly, which the form keeps in sync with the sum here.
// Utility reimbursement (RUBS) may be entered EITHER here OR netted in the
// Utilities expense section (negative line) — one place only, never both.
export interface OtherIncomeSublines {
  laundry?: number;
  storage?: number;
  parking?: number;
  pet_admin?: number;
  utility_reimbursement?: number; // RUBS — if used here, do NOT also net in Utilities
  other?: number;
}

// Fix-spec Phase 4.2: structured RUBS. Instead of a hand-typed reimbursement
// number, derive it: recovery_pct × utilities expense × physical occupancy.
// recovery_pct defaults to 0.80; anything above 0.85 requires a source note
// (lease audit, current collections report) or the engine warns.
export interface RubsAssumptions {
  mode: "manual" | "structured";
  recovery_pct?: number; // default 0.80
  source_note?: string; // required (in practice) when recovery_pct > 0.85
}

// Itemized other income (FIX: itemized-other-income). On real deals other
// income is mostly RUBS plus a few flat line items, and a single opaque number
// can't be validated against a T-12, stressed, or explained. When
// `other_income.line_items` is present it is the source of truth and SUPERSEDES
// both the Phase 4 `rubs` knob and the flat `other_income_monthly` field.
export type RubsBasis =
  | "utilities_total"
  | "utilities_electric"
  | "utilities_water"
  | "utilities_gas";

export interface OtherIncomeLineItem {
  label: string; // "RUBS - Electric", "Laundry", "Parking", "Pet rent"
  kind: "flat" | "rubs"; // flat = $/mo fixed; rubs = recovery % of a utility expense
  monthly_amount?: number; // kind="flat"
  rubs_recovery_pct?: number; // kind="rubs", e.g. 0.80 (>1.0 = gross-up, allowed)
  rubs_basis?: RubsBasis; // kind="rubs"; default "utilities_total"
  source_note?: string; // e.g. "T-12 Jun25-May26 actual"
  recurring?: boolean; // default true; false = in-period only, EXCLUDED from exit value
}

export interface OtherIncomeAssumptions {
  line_items?: OtherIncomeLineItem[];
}

export interface RevenueAssumptions {
  unit_mix: UnitMix[];
  other_income_monthly: number; // laundry, parking, pet fees, etc. (sum of sublines when itemized)
  other_income_sublines?: OtherIncomeSublines; // optional itemization; engine ignores (reads the total)
  rubs?: RubsAssumptions; // structured mode REPLACES other_income_sublines.utility_reimbursement
  other_income?: OtherIncomeAssumptions; // itemized line items; supersedes rubs + flat when present
  vacancy_rate: number;
  bad_debt_rate: number;
  concessions_rate: number;
  rent_growth_rate: number; // annual
  rent_ramp?: RentRampAssumptions; // optional; absent = no ramp (legacy behavior)
}

/**
 * Models the absorption of in-place leases to market rent over time.
 *
 * The renovation schedule (CapEx) governs WHEN units get the premium.
 * The rent ramp governs WHEN below-market in-place units mark to market —
 * independent of renovation, since a routine tenant turnover lets you re-lease
 * at market without a gut reno.
 *
 * When `enabled` is false (the default), the engine ignores the ramp entirely
 * and behaves exactly as before.
 */
export interface RentRampAssumptions {
  enabled: boolean;
  mode: "linear" | "schedule"; // "linear" = even rollover over absorption_months; "schedule" = explicit per-month counts

  absorption_months: number; // months to fully mark the in-place book to market (e.g. 24)
  initial_belowmarket_units?: number; // override the auto-derived count of in-place units below market
  turn_downtime_months: number; // vacancy per unit on a market turn (separate from reno downtime)
  max_turns_per_month?: number; // operational cap on simultaneous turns (e.g. 2)

  // Vacant-at-acquisition units. Lease up first, then count as market-paying.
  initial_vacant_units?: number;
  vacant_leaseup_months?: number;

  // Optional explicit cumulative absorption curve (mode="schedule"); length = totalMonths.
  absorption_by_month?: number[];

  // Anchor for converting per-unit lease_end dates to pro forma month indexes
  // (month 1 = the month containing this date). Required for "occupied" units
  // with fixed leases to schedule their turns; without it they are treated as MTM.
  analysis_start_date?: string; // ISO date, e.g. "2026-07-01"
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

/**
 * Turnover cost has two valid input shapes:
 *   1) per-unit annual cost  →  rate × cost-per-unit × units = annual expense
 *   2) total annual          →  the entered figure IS the annual expense
 * The turnover_rate multiplier only applies to per-unit inputs. For total /
 * percent modes the user already entered an aggregate, so re-multiplying
 * would double-count.
 */
export function applyTurnoverRate(
  resolved: number,
  input: OpexInput | undefined,
  rate: number,
): number {
  // No custom input → default fallback is per-unit, so apply rate.
  if (!input) return resolved * rate;
  const isPerUnit = input.mode === "per_unit_annual" || input.mode === "per_unit_monthly";
  return isPerUnit ? resolved * rate : resolved;
}

/**
 * Ramp-aware monthly turnover make-ready cost (Spec REVENUE_CARD §A1).
 *
 * Two components:
 *   1. Non-reno market turns this month × per-unit make-ready cost. Reno turns
 *      are absorbed by the renovation CapEx (the reno covers the make-ready),
 *      so only NON-reno absorption turns book this cost. Captures the spike
 *      during the absorption ramp.
 *   2. Stabilized units × (annual turnover_rate / 12) × per-unit cost. Captures
 *      ongoing steady-state churn on units that have already reached market or
 *      been renovated.
 *
 * Called only when ramp.enabled === true. The legacy applyTurnoverRate path
 * is preserved for backwards compat when ramp is off.
 */
export function computeRampTurnoverCost(args: {
  perUnitCost: number;                // turnover_cost_per_unit, escalated
  marketTurnsThisMonth: number;       // delta of markedToMarketByMonth
  renoTurnsThisMonth: number;         // delta of renovatedByMonth
  stabilizedUnits: number;            // payingMarket + payingRenovated this month
  turnoverRate: number;               // annual churn rate (e.g. 0.10 = 10%/yr)
}): number {
  const nonRenoTurns = Math.max(0, args.marketTurnsThisMonth - args.renoTurnsThisMonth);
  const rampMakeReady = nonRenoTurns * args.perUnitCost;
  const ongoingChurn = args.stabilizedUnits * (args.turnoverRate / 12) * args.perUnitCost;
  return rampMakeReady + ongoingChurn;
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


// ─── Property Tax v2 (fix-spec Phase 2) ──────────────────────
// Extends TaxReassessment with Ohio-realistic mechanics: abatement records,
// calendar anchoring (Ohio: calendar tax year, lien Jan 1, billed in arrears),
// HB 920 bill shape (small floating share rides valuation; the voted
// remainder is dollar-flat plus levy drift), and three named scenario
// vectors computed for every deal. Exit math is UNCHANGED — the ops basis
// and the exit-side rate may legitimately differ.

export interface PropertyTaxAbatement {
  program?: string; // e.g. "CRA 100% residential"
  abated_annual_tax: number; // bill while the abatement applies
  unabated_annual_tax: number; // full bill once it ends or is lost
  final_abated_tax_year: number; // last TAX YEAR the abatement applies, e.g. 2028
  transferable: "confirmed" | "unconfirmed" | "none";
  notes?: string;
}

export interface ParcelMeta {
  parcel_id?: string;
  taxing_district?: string;
  property_class?: string;
  effective_tax_rate_source?: string;
  as_of_date?: string;
  auditor_permalink?: string;
}

/** HB 920: only a small share of the bill floats with valuation. */
export interface HB920Shape {
  floating_share: number; // default 0.125
  inflation_cap: number; // annual growth cap on the floating share, default 0.03
  levy_drift: number; // annual drift on the voted (dollar-flat) remainder, default 0.015
  reappraisal_years?: number[]; // e.g. [2026, 2029] (Franklin triennial/sexennial)
  reappraisal_bump_pct?: number; // extra valuation bump to the floating share in those years, default 0.10
}

export const HB920_DEFAULTS: HB920Shape = {
  floating_share: 0.125,
  inflation_cap: 0.03,
  levy_drift: 0.015,
  reappraisal_years: [2026, 2029],
  reappraisal_bump_pct: 0.10,
};

export type PropertyTaxScenarioName = "abated_transfers" | "abatement_lost" | "reassessed_to_price";

export interface PropertyTaxAssumptions {
  enabled: boolean;
  closing_date?: string; // ISO — anchors tax years to pro forma months
  proration_method?: "short" | "long"; // memo for sources & uses; not modeled yet
  effective_tax_rate: number; // drives reassessed_to_price
  reassessed_value?: number; // default purchase price
  apply_at_exit?: boolean; // exit-side loaded cap (same as v1). Default true.
  scenario?: PropertyTaxScenarioName; // in force; defaulted by rule below
  abatement?: PropertyTaxAbatement;
  parcel?: ParcelMeta;
  hb920?: HB920Shape;
}

/**
 * Scenario-in-force default (spec Phase 2.4): abatement_lost whenever an
 * abatement exists but its transfer is not CONFIRMED; abated_transfers when
 * confirmed; reassessed_to_price when there is no abatement record.
 */
export function propertyTaxScenarioInForce(pt: PropertyTaxAssumptions): PropertyTaxScenarioName {
  if (pt.scenario) return pt.scenario;
  if (!pt.abatement) return "reassessed_to_price";
  return pt.abatement.transferable === "confirmed" ? "abated_transfers" : "abatement_lost";
}

/** HB 920 year-over-year growth factor, with reappraisal bumps. */
function hb920Step(shape: HB920Shape, fromTaxYear: number): number {
  const isReappraisal = (shape.reappraisal_years ?? []).includes(fromTaxYear + 1);
  const floatGrowth = (1 + shape.inflation_cap) * (isReappraisal ? 1 + (shape.reappraisal_bump_pct ?? 0.10) : 1);
  return shape.floating_share * floatGrowth + (1 - shape.floating_share) * (1 + shape.levy_drift);
}

/** Grow an anchored bill from its anchor tax year to the requested tax year. */
function shapeBill(base: number, anchorTaxYear: number, taxYear: number, shape: HB920Shape): number {
  let bill = base;
  for (let ty = anchorTaxYear; ty < taxYear; ty++) bill *= hb920Step(shape, ty);
  return bill;
}

/** Calendar tax year containing a given 0-indexed pro forma month. */
export function taxYearOfMonth(pt: PropertyTaxAssumptions, monthIdx: number): number {
  const closing = pt.closing_date ? new Date(pt.closing_date + "T00:00:00") : null;
  const y0 = closing ? closing.getFullYear() : new Date().getFullYear();
  const m0 = closing ? closing.getMonth() : 0;
  return y0 + Math.floor((m0 + monthIdx) / 12);
}

/**
 * Annual property tax bill for a given TAX YEAR under a named scenario.
 * The anchor tax year is the closing year; bills are shaped forward by HB 920.
 */
export function propertyTaxBillForTaxYear(
  pt: PropertyTaxAssumptions,
  purchasePrice: number,
  scenario: PropertyTaxScenarioName,
  taxYear: number,
): number {
  const shape = { ...HB920_DEFAULTS, ...pt.hb920 };
  const anchor = taxYearOfMonth(pt, 0);
  const ab = pt.abatement;

  switch (scenario) {
    case "reassessed_to_price": {
      const base = (pt.reassessed_value ?? purchasePrice) * pt.effective_tax_rate;
      return shapeBill(base, anchor, taxYear, shape);
    }
    case "abatement_lost": {
      const base = ab ? ab.unabated_annual_tax : (pt.reassessed_value ?? purchasePrice) * pt.effective_tax_rate;
      return shapeBill(base, anchor, taxYear, shape);
    }
    case "abated_transfers": {
      if (!ab) return shapeBill((pt.reassessed_value ?? purchasePrice) * pt.effective_tax_rate, anchor, taxYear, shape);
      if (taxYear <= ab.final_abated_tax_year) {
        return shapeBill(ab.abated_annual_tax, anchor, taxYear, shape);
      }
      // Post-abatement: the full bill, shaped from the anchor (the unabated
      // levy kept drifting while the abatement ran).
      return shapeBill(ab.unabated_annual_tax, anchor, taxYear, shape);
    }
  }
}

/** Monthly property tax under the scenario in force (1/12 of that month's tax-year bill). */
export function propertyTaxForMonthV2(
  pt: PropertyTaxAssumptions,
  purchasePrice: number,
  monthIdx: number,
): number {
  const scenario = propertyTaxScenarioInForce(pt);
  const ty = taxYearOfMonth(pt, monthIdx);
  return propertyTaxBillForTaxYear(pt, purchasePrice, scenario, ty) / 12;
}

export interface PropertyTaxVectorRow {
  tax_year: number;
  abated_transfers: number;
  abatement_lost: number;
  reassessed_to_price: number;
}

/** All three vectors by tax year across the hold — exported in full (Phase 3). */
export function computePropertyTaxVectors(
  pt: PropertyTaxAssumptions,
  purchasePrice: number,
  holdYears: number,
): { scenario_in_force: PropertyTaxScenarioName; rows: PropertyTaxVectorRow[] } {
  const startTy = taxYearOfMonth(pt, 0);
  const endTy = taxYearOfMonth(pt, holdYears * 12 - 1);
  const rows: PropertyTaxVectorRow[] = [];
  for (let ty = startTy; ty <= endTy; ty++) {
    rows.push({
      tax_year: ty,
      abated_transfers: propertyTaxBillForTaxYear(pt, purchasePrice, "abated_transfers", ty),
      abatement_lost: propertyTaxBillForTaxYear(pt, purchasePrice, "abatement_lost", ty),
      reassessed_to_price: propertyTaxBillForTaxYear(pt, purchasePrice, "reassessed_to_price", ty),
    });
  }
  return { scenario_in_force: propertyTaxScenarioInForce(pt), rows };
}

/**
 * Property tax reassessment (post-acquisition + exit-side).
 * The seller's frozen bill understates the buyer's real tax burden twice:
 *  1. Operations — the county reassesses toward the sale price (Franklin
 *     County OH: triennial update; sale prices feed assessments).
 *  2. Exit — YOUR buyer underwrites THEIR reassessed taxes at THEIR price,
 *     so exit NOI capitalized at the seller-era bill overstates exit value.
 *     Closed form resolves the circularity: exitValue = NOI_excl_tax / (cap + rate).
 */
export interface TaxReassessment {
  enabled: boolean;
  effective_tax_rate: number; // annual tax / market value, e.g. 0.0185 for Franklin County
  reassessed_value?: number; // default: purchase price
  phase_in_year?: number; // pro forma year the reassessed bill starts (1 = immediately). Default 1.
  apply_at_exit?: boolean; // recompute exit value with buyer's tax at exit price. Default true.
}

export interface ExpenseAssumptions {
  management_fee_rate: number; // % of EGI (legacy)
  payroll_annual: number;
  repairs_maintenance_per_unit: number; // annual
  turnover_cost_per_unit: number; // annual cost per unit that turns over
  turnover_rate: number; // % of units that turn over per year (e.g. 0.50 = 50%)
  insurance_per_unit: number; // annual
  property_tax_total: number; // annual
  tax_escalation_rate: number; // annual, applied to property taxes only
  tax_reassessment?: TaxReassessment; // optional; absent = seller's bill escalated (legacy)
  property_tax_v2?: PropertyTaxAssumptions; // Phase 2 — takes precedence over tax_reassessment when enabled
  expense_escalation_rate: number; // annual, applied to all non-tax expenses
  utilities_per_unit: number; // annual total (sum of breakdown if provided)
  utilities_breakdown?: UtilitiesBreakdown;
  admin_legal_marketing: number; // annual
  contract_services: number; // annual total (sum of breakdown if provided)
  services_breakdown?: ServicesBreakdown;
  reserves_per_unit: number; // annual
  opex_inputs?: OpexInputs;
  opex_rent_basis?: RentBasis;
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
  pca_complete?: boolean; // property condition assessment on file (Phase 4.3 guardrail)
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

// Pro forma rent basis is split into two independent choices so renovation
// timing can be honored: unrenovated units pay one base, renovated units pay
// another (typically with the renovation premium applied).
export type UnrenovatedBasis = "current" | "market";
export type RenovatedBasis = "current_plus_premium" | "market_plus_premium";

export interface ExitAssumptions {
  hold_period_years: number;
  exit_cap_rate: number;
  selling_cost_rate: number;
  sale_price?: number; // if provided, overrides exit_cap_rate-derived value
  sensitivity_rent_basis?: RentBasis; // which rents to use in sensitivity grid
  /** @deprecated Use proforma_unrenovated_basis + proforma_renovated_basis. Kept for backwards compat. */
  proforma_rent_basis?: RentBasis;
  proforma_unrenovated_basis?: UnrenovatedBasis;
  proforma_renovated_basis?: RenovatedBasis;
}

/**
 * Resolve the two pro forma rent bases. If the new split fields are set, use
 * them. Otherwise fall back to the legacy combined field with a sensible map:
 *   current            -> unrenovated=current, renovated=current_plus_premium
 *   market             -> unrenovated=market,  renovated=market_plus_premium
 *   current_plus_reno  -> unrenovated=current, renovated=current_plus_premium
 *   market_plus_reno   -> unrenovated=market,  renovated=market_plus_premium
 * Note: the old "_plus_reno" values used to short-circuit the renovation
 * schedule and treat all units as renovated from month 1. Under the split
 * model, the renovation schedule is always respected.
 */
export function resolveProformaBases(exit: ExitAssumptions): {
  unrenovated: UnrenovatedBasis;
  renovated: RenovatedBasis;
} {
  if (exit.proforma_unrenovated_basis && exit.proforma_renovated_basis) {
    return {
      unrenovated: exit.proforma_unrenovated_basis,
      renovated: exit.proforma_renovated_basis,
    };
  }
  const legacy = exit.proforma_rent_basis;
  const isMarket = legacy === "market" || legacy === "market_plus_reno";
  return {
    unrenovated: isMarket ? "market" : "current",
    renovated: isMarket ? "market_plus_premium" : "current_plus_premium",
  };
}

export interface ScenarioInputs {
  purchase: PurchaseAssumptions;
  financing: FinancingAssumptions;
  revenue: RevenueAssumptions;
  expenses: ExpenseAssumptions;
  capex: CapexAssumptions;
  exit: ExitAssumptions;
  depreciation?: DepreciationAssumptions;
  tax?: TaxAssumptions; // optional; absent → no tax layer computed
}

// ─── Output Types ────────────────────────────────────────────

// OpexBreakdown contains only OPERATING expenses (above NOI). Reserves are
// treated as a capital item below NOI — see MonthlyRow.reserves / AnnualSummary.reserves.
// This is the institutional treatment: NOI = EGI - operating opex (no reserves);
// reserves and CapEx sit below NOI as capital outflows.
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
  // Operating Expenses (excludes reserves)
  total_opex: number;
  opex_breakdown: OpexBreakdown;
  // NOI = EGI - operating opex
  noi: number;
  // Debt Service (interest + principal; only interest is tax-deductible)
  debt_service: number;
  interest_paid: number;
  principal_paid: number;
  // Cash Flow before CapEx & Reserves = NOI - debt service
  cash_flow_before_capex_and_reserves: number;
  // Capital items (below NOI)
  reserves: number;
  // Cash Flow before CapEx = NOI - debt service - reserves
  cash_flow_before_capex: number;
  capex: number;
  // Cash Flow = NOI - debt service - reserves - capex
  cash_flow: number;
  cumulative_cash_flow: number;
  // Annualized per-period metrics
  cap_rate: number; // NOI * 12 / purchase_price
  cash_on_cash: number; // cash_flow * 12 / total_equity
  // Rent ramp visibility: share of units paying market rent OR renovated rent.
  // 0 when ramp is disabled. 1 = fully absorbed.
  pct_marked_to_market: number;
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
  interest_paid: number;
  principal_paid: number;
  cash_flow_before_capex_and_reserves: number;
  reserves: number;
  cash_flow_before_capex: number;
  capex: number;
  cash_flow: number;
  cumulative_cash_flow: number;
  cap_rate: number; // annual NOI / purchase_price
  cash_on_cash: number; // annual cash flow / total equity
  pct_marked_to_market: number; // year-end snapshot of mark-to-market progress
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
  loan_sizing_constraint: "ltv" | "dscr"; // which limb of min(LTV, DSCR) bound
  ltv_loan_amount: number; // LTV-sized proceeds (= loan_amount when constraint is ltv)
  dscr_loan_amount: number | null; // DSCR-sized proceeds (null when sizing disabled)
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

// Per-line and aggregate view of itemized other income (FIX: itemized-other-
// income). Year-1 figures; consumed by the Excel export and Validation check.
export interface OtherIncomeLineResult {
  label: string;
  kind: "flat" | "rubs";
  annual_amount: number; // year-1 annual $ (recurring or not)
  recurring: boolean;
  rubs_basis?: RubsBasis;
  implied_recovery_ratio?: number; // rubs only: annual_amount / basis annual expense
  source_note?: string;
}

export interface OtherIncomeDetail {
  lines: OtherIncomeLineResult[];
  total_annual: number; // all lines, year 1
  stabilized_annual: number; // recurring lines only (drives exit value)
  rubs_total_annual: number;
  utilities_annual: number; // year-1 total utilities expense
  aggregate_recovery_ratio: number | null; // rubs_total / utilities; null if no utilities
}

export interface UnderwritingResult {
  monthly: MonthlyRow[];
  annual: AnnualSummary[];
  metrics: DealMetrics;
  sensitivity: SensitivityCell[];
  warnings: string[];
  tax?: TaxResult; // present only when inputs.tax is provided
  unit_schedule: UnitStateSchedule; // per-unit monthly states — Rent Matrix + diagnostics
  property_tax_vectors?: ReturnType<typeof computePropertyTaxVectors>; // Phase 2 — all 3 scenarios by tax year
  other_income_detail?: OtherIncomeDetail; // present only when itemized line items are used
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

export function calculateUnderwriting(
  inputs: ScenarioInputs,
  // Internal: second pass of DSCR sizing. NOI is loan-independent, so one
  // re-pass with the resized loan converges exactly. Not part of the API.
  _resize?: { loanOverride: number },
): UnderwritingResult {
  const { purchase, financing, revenue, expenses, capex, exit } = inputs;
  const totalMonths = exit.hold_period_years * 12;
  const warnings: string[] = [];

  // ── Purchase & Financing ──
  const closingCosts = computeClosingCosts(purchase);
  const capexReserve = purchase.capex_reserve || 0;
  const ltvLoanAmount = purchase.purchase_price * financing.ltv;
  const loanAmount = _resize?.loanOverride ?? ltvLoanAmount;
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

  // ── Unit-state schedule (fix-spec Phase 1) ──
  // ONE per-unit state machine drives GPR, % marked-to-market, and turnover
  // counts. Replaces the floor-share bucket allocation (which zeroed out
  // absorption for per-unit count=1 rows) and the separate linear code path.
  const ramp = revenue.rent_ramp;
  const rampEnabled = !!(ramp && ramp.enabled);
  const { unrenovated: pfUnrenBasis, renovated: pfRenoBasis } = resolveProformaBases(exit);
  const unitSchedule = buildUnitStateSchedule({
    unitMix: revenue.unit_mix,
    ramp,
    capex,
    totalMonths,
    inPlaceBasis: pfUnrenBasis,
    renoBasis: pfRenoBasis,
    warnings,
  });

  // Rent-growth anchoring (Spec REVENUE_CARD §A3, also RAMP_UP §3.4):
  // monthlyRentGrowth = (1 + g)^yearIndex applies uniformly to every state's
  // rent. Units that turn later inherit the current year's growth factor on
  // the market basis — no per-unit catch-up compounding. This slightly
  // OVERSTATES late-turn rents; intentional simplification — do NOT switch to
  // months-since-turn compounding without revisiting the spec.

  // ── Monthly Pro Forma ──
  const monthly: MonthlyRow[] = [];
  let cumulativeCF = 0;
  let amortBalance = loanAmount; // running balance for the interest/principal split
  // Per-month non-recurring other income (line-item model). Received in-period
  // but excluded from the stabilized NOI that drives exit value.
  const nonRecurringOtherByMonth: number[] = [];

  for (let m = 1; m <= totalMonths; m++) {
    const yearIndex = Math.floor((m - 1) / 12); // 0-indexed year
    const monthlyRentGrowth = Math.pow(1 + revenue.rent_growth_rate, yearIndex); // compound annually

    // GPR: direct read from the unit-state schedule (pre-growth), times the
    // year growth factor. Offline/vacant states contribute $0 by construction.
    const gpr = unitSchedule.gprByMonth[m - 1] * monthlyRentGrowth;
    const stabilizedUnitsThisMonth = unitSchedule.stabilizedByMonth[m - 1];

    const vacancyLoss = gpr * revenue.vacancy_rate;
    const badDebt = gpr * revenue.bad_debt_rate;
    const concessions = gpr * revenue.concessions_rate;
    // Physical occupancy from the unit-state schedule — offline and vacant
    // units don't reimburse. Shared by both RUBS computations below.
    const occupiedUnitsThisMonth = unitSchedule.units.reduce((c, u) => {
      const st = u.states[m - 1];
      return c + (st === "in_place" || st === "market" || st === "renovated" ? 1 : 0);
    }, 0);
    const physOcc = totalUnits > 0 ? occupiedUnitsThisMonth / totalUnits : 0;
    // Other income, in precedence order: itemized line items → Phase 4 rubs
    // knob → legacy flat field. Utilities (for RUBS basis) are resolved with a
    // pre-other-income EGI context, which only matters if utilities were
    // entered as % of EGI.
    const otherIncomeEscalation = Math.pow(1 + (expenses.expense_escalation_rate || 0), yearIndex);
    let otherIncome: number;
    let nonRecurringOther = 0;
    if (hasOtherIncomeLineItems(revenue)) {
      const items = revenue.other_income!.line_items!;
      const preEgi = gpr - vacancyLoss - badDebt - concessions;
      const utilCtx = { totalUnits, monthlyEgi: preEgi, monthlyGpr: gpr, escalation: otherIncomeEscalation };
      const { resolve } = makeUtilityBasisResolverMonthly(expenses, utilCtx);
      otherIncome = lineItemOtherIncomeMonthly(items, physOcc, resolve, false);
      const stabilized = lineItemOtherIncomeMonthly(items, physOcc, resolve, true);
      nonRecurringOther = otherIncome - stabilized;
    } else if (revenue.rubs?.mode === "structured") {
      const flat = revenue.other_income_monthly;
      const preEgi = gpr - vacancyLoss - badDebt - concessions + flat;
      const preCtx = { totalUnits, monthlyEgi: preEgi, monthlyGpr: gpr, escalation: otherIncomeEscalation };
      const preUtilSub = resolveSublinesMonthly(expenses.opex_inputs?.utilities_sublines as Record<string, OpexInput | undefined> | undefined, preCtx);
      const utilitiesPre = preUtilSub !== null ? preUtilSub : resolveOpexMonthly(expenses.opex_inputs?.utilities, expenses.utilities_per_unit, "per_unit_annual", preCtx);
      const recovery = revenue.rubs.recovery_pct ?? 0.80;
      const manualRubs = revenue.other_income_sublines?.utility_reimbursement ?? 0;
      otherIncome = flat - manualRubs + recovery * utilitiesPre * physOcc;
    } else {
      otherIncome = revenue.other_income_monthly;
    }
    nonRecurringOtherByMonth.push(nonRecurringOther);
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
      turnover: rampEnabled
        ? computeRampTurnoverCost({
            perUnitCost: (expenses.turnover_cost_per_unit ?? 0) * annualExpEscalation,
            marketTurnsThisMonth: unitSchedule.marketTurnsByMonth[m - 1],
            renoTurnsThisMonth: unitSchedule.renoTurnsByMonth[m - 1],
            stabilizedUnits: stabilizedUnitsThisMonth,
            turnoverRate: expenses.turnover_rate ?? 0.50,
          })
        : applyTurnoverRate(
            resolveOpexMonthly(oi?.turnover, expenses.turnover_cost_per_unit, "per_unit_annual", opexCtx),
            oi?.turnover,
            expenses.turnover_rate ?? 0.50,
          ),
      insurance: resolveOpexMonthly(oi?.insurance, expenses.insurance_per_unit, "per_unit_annual", opexCtx),
      // Property tax precedence: v2 scenario vectors (calendar-anchored,
      // HB 920 shaped) → v1 reassessment phase-in → the entered bill.
      property_tax: (() => {
        const v2 = expenses.property_tax_v2;
        if (v2?.enabled) return propertyTaxForMonthV2(v2, purchase.purchase_price, m - 1);
        const reassessed = reassessedAnnualTax(expenses, purchase.purchase_price, yearIndex);
        return reassessed !== null
          ? reassessed / 12
          : resolveOpexMonthly(oi?.property_tax, expenses.property_tax_total, "total_annual", taxCtx);
      })(),
      utilities: utilSubSum !== null ? utilSubSum : resolveOpexMonthly(oi?.utilities, expenses.utilities_per_unit, "per_unit_annual", opexCtx),
      admin_legal_marketing: resolveOpexMonthly(oi?.admin_legal_marketing, expenses.admin_legal_marketing, "total_annual", opexCtx),
      contract_services: svcSubSum !== null ? svcSubSum : resolveOpexMonthly(oi?.contract_services, expenses.contract_services, "total_annual", opexCtx),
    };
    // total_opex = operating expenses only. Reserves are tracked separately below NOI.
    const monthlyOpex = Object.values(opexBk).reduce((s, v) => s + v, 0);
    const monthlyReserves = resolveOpexMonthly(oi?.reserves, expenses.reserves_per_unit, "per_unit_annual", opexCtx);

    const noi = egi - monthlyOpex;

    // Debt service (IO period vs amortizing), split into interest and principal.
    // Only INTEREST is tax-deductible — the tax layer consumes this split.
    const ds = m <= financing.io_period_months ? monthlyIO : monthlyDS;
    const interestPaid = amortBalance * monthlyRate;
    const principalPaid = m <= financing.io_period_months ? 0 : Math.max(0, ds - interestPaid);
    amortBalance = Math.max(0, amortBalance - principalPaid);

    // CapEx for this month
    const monthCapex = calculateMonthCapex(capex, m);

    const cashFlowBeforeCapexAndReserves = noi - ds;
    const cashFlowBeforeCapex = cashFlowBeforeCapexAndReserves - monthlyReserves;
    const cashFlow = cashFlowBeforeCapex - monthCapex;
    cumulativeCF += cashFlow;

    // Per-period metrics (annualized for readability)
    const periodCapRate = purchase.purchase_price > 0 ? (noi * 12) / purchase.purchase_price : 0;
    const periodCoC = totalEquity > 0 ? (cashFlow * 12) / totalEquity : 0;

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
      interest_paid: interestPaid,
      principal_paid: principalPaid,
      cash_flow_before_capex_and_reserves: cashFlowBeforeCapexAndReserves,
      reserves: monthlyReserves,
      cash_flow_before_capex: cashFlowBeforeCapex,
      capex: monthCapex,
      cash_flow: cashFlow,
      cumulative_cash_flow: cumulativeCF,
      cap_rate: periodCapRate,
      cash_on_cash: periodCoC,
      pct_marked_to_market: unitSchedule.pctMarkedByMonth[m - 1],
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

    const annualNOI = sum((r) => r.noi);
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
      },
      noi: annualNOI,
      debt_service: sum((r) => r.debt_service),
      interest_paid: sum((r) => r.interest_paid),
      principal_paid: sum((r) => r.principal_paid),
      cash_flow_before_capex_and_reserves: sum((r) => r.cash_flow_before_capex_and_reserves),
      reserves: sum((r) => r.reserves),
      cash_flow_before_capex: sum((r) => r.cash_flow_before_capex),
      capex: sum((r) => r.capex),
      cash_flow: annualCF,
      cumulative_cash_flow: annualCumulativeCF,
      cap_rate: purchase.purchase_price > 0 ? annualNOI / purchase.purchase_price : 0,
      cash_on_cash: totalEquity > 0 ? annualCF / totalEquity : 0,
      // Year-end snapshot — use the last month of the year for a single value.
      pct_marked_to_market: yearMonths.length > 0
        ? yearMonths[yearMonths.length - 1].pct_marked_to_market
        : 0,
    });
  }

  // ── Exit ──
  const rawLastYearNOI = annual.length > 0 ? annual[annual.length - 1].noi : 0;
  // Stabilized exit NOI excludes non-recurring other income (e.g. deposit
  // forfeiture): it is received in-period but must NOT be capitalized into the
  // sale value. For scenarios without itemized line items this is a no-op, so
  // legacy output is byte-identical.
  const lastYearNonRecurringOther = nonRecurringOtherByMonth.slice(-12).reduce((a, b) => a + b, 0);
  const lastYearNOI = rawLastYearNOI - lastYearNonRecurringOther;
  // Exit-side reassessment: your buyer underwrites THEIR taxes at THEIR price.
  // Circular (value depends on NOI depends on tax depends on value) — closed
  // form: exitValue = NOI_excluding_tax / (cap + effective_tax_rate).
  const ptV2 = expenses.property_tax_v2;
  const exitRateSource = ptV2?.enabled ? ptV2 : expenses.tax_reassessment;
  const reassess = exitRateSource;
  const exitReassess = !!(reassess?.enabled && (reassess.apply_at_exit ?? true) && reassess.effective_tax_rate > 0);
  let exitValue: number;
  if (exit.sale_price && exit.sale_price > 0) {
    exitValue = exit.sale_price; // explicit price — buyer's tax is their problem
  } else if (exit.exit_cap_rate > 0) {
    if (exitReassess && annual.length > 0) {
      const lastYearTax = annual[annual.length - 1].opex_breakdown.property_tax;
      const noiExTax = lastYearNOI + lastYearTax;
      exitValue = noiExTax / (exit.exit_cap_rate + reassess!.effective_tax_rate);
    } else {
      exitValue = lastYearNOI / exit.exit_cap_rate;
    }
  } else {
    exitValue = 0;
  }
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
    loan_sizing_constraint: _resize ? "dscr" : "ltv",
    ltv_loan_amount: ltvLoanAmount,
    dscr_loan_amount: null,
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

  // ── DSCR-aware loan sizing (fix-spec Phase 4.1) ──
  // Lenders fund min(LTV proceeds, DSCR proceeds). DSCR proceeds = the loan
  // whose fully-amortizing payment year-1 NOI covers at the floor. NOI does
  // not depend on the loan, so one re-pass with the resized loan is exact.
  if (!_resize && financing.size_to_dscr !== false) {
    const floor = financing.dscr_floor ?? 1.25;
    const noi1 = annual[0]?.noi ?? 0;
    const pmtFactor = monthlyRate > 0
      ? (monthlyRate * Math.pow(1 + monthlyRate, amortMonths)) / (Math.pow(1 + monthlyRate, amortMonths) - 1)
      : 1 / Math.max(1, amortMonths);
    const dscrLoan = noi1 > 0 ? noi1 / floor / 12 / pmtFactor : 0;
    if (dscrLoan < ltvLoanAmount - 1) {
      const resized = calculateUnderwriting(inputs, { loanOverride: dscrLoan });
      resized.metrics.ltv_loan_amount = ltvLoanAmount;
      resized.metrics.dscr_loan_amount = dscrLoan;
      resized.warnings.unshift(
        `Loan sized by DSCR ${floor.toFixed(2)}x: $${Math.round(dscrLoan).toLocaleString()} vs LTV proceeds $${Math.round(ltvLoanAmount).toLocaleString()} — requires $${Math.round(ltvLoanAmount - dscrLoan).toLocaleString()} additional equity`,
      );
      return resized;
    }
    metrics.dscr_loan_amount = dscrLoan;
  }

  // ── RUBS recovery surfacing (fix-spec Phase 4.2) ──
  {
    const utilitiesY1 = annual[0]?.opex_breakdown.utilities ?? 0;
    if (hasOtherIncomeLineItems(revenue)) {
      // Itemized model owns the warning; skip the Phase 4 single-knob path.
    } else if (revenue.rubs?.mode === "structured") {
      const rec = revenue.rubs.recovery_pct ?? 0.80;
      if (rec > 0.85 && !revenue.rubs.source_note?.trim()) {
        warnings.push(`RUBS recovery ${(rec * 100).toFixed(0)}% exceeds 85% with no source note — document collections evidence or lower the assumption`);
      }
    } else {
      const manualRubsAnnual = (revenue.other_income_sublines?.utility_reimbursement ?? 0) * 12;
      if (manualRubsAnnual > 0 && utilitiesY1 > 0) {
        const implied = manualRubsAnnual / utilitiesY1;
        if (implied > 0.85) {
          warnings.push(`Manual RUBS implies ${(implied * 100).toFixed(0)}% recovery of utilities — above the 85% guardrail; verify against collections or switch to structured RUBS`);
        }
      }
    }
  }

  // ── Itemized other income detail + warnings (FIX: itemized-other-income) ──
  let otherIncomeDetail: OtherIncomeDetail | undefined;
  if (hasOtherIncomeLineItems(revenue)) {
    const items = revenue.other_income!.line_items!;
    const utilitiesY1 = annual[0]?.opex_breakdown.utilities ?? 0;
    const egiY1 = annual[0]?.egi ?? 0;
    const gprY1 = annual[0]?.gpr ?? 0;
    // Year-1 average PHYSICAL occupancy from the unit schedule — matches the
    // monthly loop's RUBS basis so this detail ties to annual[0].other_income.
    let occSum = 0, occMonths = 0;
    for (let mo = 0; mo < Math.min(12, totalMonths); mo++) {
      const occ = unitSchedule.units.reduce((c, u) => {
        const st = u.states[mo];
        return c + (st === "in_place" || st === "market" || st === "renovated" ? 1 : 0);
      }, 0);
      occSum += totalUnits > 0 ? occ / totalUnits : 0;
      occMonths++;
    }
    const physOcc = occMonths > 0 ? occSum / occMonths : 1;
    const oiCtx = { totalUnits, annualEgi: egiY1, annualGpr: gprY1, escalation: 1 };
    const resolveBasis = makeUtilityBasisResolverAnnual(expenses, oiCtx);
    const subs = expenses.opex_inputs?.utilities_sublines as Record<string, OpexInput | undefined> | undefined;

    const lines: OtherIncomeLineResult[] = [];
    let totalAnnual = 0;
    let stabilizedAnnual = 0;
    let rubsTotalAnnual = 0;
    for (const it of items) {
      const recurring = it.recurring !== false;
      let annualAmount: number;
      let impliedRatio: number | undefined;
      if (it.kind === "rubs") {
        const basis = it.rubs_basis ?? "utilities_total";
        const basisAnnual = resolveBasis(basis);
        annualAmount = (it.rubs_recovery_pct ?? 0) * basisAnnual * physOcc;
        impliedRatio = basisAnnual > 0 ? annualAmount / basisAnnual : undefined;
        rubsTotalAnnual += annualAmount;
        // Sub-basis fallback warning (once per line).
        const key = rubsBasisToSublineKey(basis);
        if (key && !(subs?.[key] && subs[key]!.value)) {
          warnings.push(`RUBS line "${it.label}" bills against ${basis.replace("utilities_", "")} but that utility subline is not itemized — falling back to total utilities`);
        }
        // Gross-up (>100%) without a source note.
        if ((it.rubs_recovery_pct ?? 0) > 1.0 && !it.source_note?.trim()) {
          warnings.push(`RUBS line "${it.label}" recovers ${((it.rubs_recovery_pct ?? 0) * 100).toFixed(0)}% (gross-up) without a source note — cite a T-12 or lease audit`);
        }
      } else {
        annualAmount = (it.monthly_amount ?? 0) * 12;
      }
      totalAnnual += annualAmount;
      if (recurring) stabilizedAnnual += annualAmount;
      lines.push({ label: it.label, kind: it.kind, annual_amount: annualAmount, recurring, rubs_basis: it.rubs_basis, implied_recovery_ratio: impliedRatio, source_note: it.source_note });
    }

    const aggregateRatio = utilitiesY1 > 0 ? rubsTotalAnnual / utilitiesY1 : null;
    if (aggregateRatio !== null && aggregateRatio > 1.0) {
      warnings.push(`Aggregate RUBS recovery ${(aggregateRatio * 100).toFixed(0)}% of utilities — above 100% (gross-up); ensure each RUBS line cites a source`);
    }
    otherIncomeDetail = {
      lines,
      total_annual: totalAnnual,
      stabilized_annual: stabilizedAnnual,
      rubs_total_annual: rubsTotalAnnual,
      utilities_annual: utilitiesY1,
      aggregate_recovery_ratio: aggregateRatio,
    };
  }

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

  // ── Tax layer (TAX_TREATMENT_SPEC.md) — only when tax assumptions provided ──
  // tax.ts imports only TYPES from this module, so the static import in this
  // file's header creates no runtime cycle.
  const taxResult = inputs.tax
    ? computeTaxLayer(inputs, {
        annual,
        totalEquity,
        netSaleProceeds,
        exitValue,
        sellingCosts,
        originationFee,
      })
    : undefined;

  const propertyTaxVectors = expenses.property_tax_v2?.enabled
    ? computePropertyTaxVectors(expenses.property_tax_v2, purchase.purchase_price, exit.hold_period_years)
    : undefined;

  return {
    monthly, annual, metrics, sensitivity, warnings,
    tax: taxResult,
    unit_schedule: unitSchedule,
    property_tax_vectors: propertyTaxVectors,
    other_income_detail: otherIncomeDetail,
  };
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

// ─── Itemized other income (FIX: itemized-other-income) ──────
// A RUBS basis maps to a specific utilities subline; "utilities_total" means
// the whole utilities line. Returns null for total.
function rubsBasisToSublineKey(basis: RubsBasis): keyof UtilitiesSublines | null {
  switch (basis) {
    case "utilities_electric": return "electric";
    case "utilities_water": return "water_sewer";
    case "utilities_gas": return "gas";
    default: return null; // utilities_total
  }
}

/**
 * Resolve the per-period utility expense that a RUBS line bills against.
 * Sub-bases (electric/water/gas) resolve the matching subline; if that subline
 * is absent we fall back to total utilities (the caller warns once). The
 * resolver closure is built per call site so it shares that site's escalation
 * and EGI context exactly.
 */
function makeUtilityBasisResolverMonthly(
  expenses: ExpenseAssumptions,
  ctx: { totalUnits: number; monthlyEgi: number; monthlyGpr: number; escalation: number },
): { resolve: (basis: RubsBasis) => number; missingSubBasis: (basis: RubsBasis) => boolean } {
  const subs = expenses.opex_inputs?.utilities_sublines as Record<string, OpexInput | undefined> | undefined;
  const total = () => {
    const s = resolveSublinesMonthly(subs, ctx);
    return s !== null ? s : resolveOpexMonthly(expenses.opex_inputs?.utilities, expenses.utilities_per_unit, "per_unit_annual", ctx);
  };
  const missingSubBasis = (basis: RubsBasis) => {
    const key = rubsBasisToSublineKey(basis);
    if (!key) return false;
    const sub = subs?.[key];
    return !(sub && sub.value);
  };
  const resolve = (basis: RubsBasis) => {
    const key = rubsBasisToSublineKey(basis);
    if (!key) return total();
    const sub = subs?.[key];
    if (sub && sub.value) return resolveOpexMonthly(sub, 0, sub.mode, ctx);
    return total();
  };
  return { resolve, missingSubBasis };
}

/** Annual analogue of makeUtilityBasisResolverMonthly. */
function makeUtilityBasisResolverAnnual(
  expenses: ExpenseAssumptions,
  ctx: { totalUnits: number; annualEgi: number; annualGpr: number; escalation: number },
): (basis: RubsBasis) => number {
  const subs = expenses.opex_inputs?.utilities_sublines as Record<string, OpexInput | undefined> | undefined;
  const total = () => {
    const s = resolveSublinesAnnual(subs, ctx);
    return s !== null ? s : resolveOpexAnnual(expenses.opex_inputs?.utilities, expenses.utilities_per_unit, "per_unit_annual", ctx);
  };
  return (basis: RubsBasis) => {
    const key = rubsBasisToSublineKey(basis);
    if (!key) return total();
    const sub = subs?.[key];
    if (sub && sub.value) return resolveOpexAnnual(sub, 0, sub.mode, ctx);
    return total();
  };
}

/**
 * Other income for ONE month from itemized line items.
 *   flat: monthly_amount (does NOT grow — matches legacy other_income_monthly).
 *   rubs: recovery_pct × resolved utility-basis expense × physical occupancy.
 * forStabilized=true drops non-recurring items (recurring===false) so they
 * never inflate the exit valuation.
 */
function lineItemOtherIncomeMonthly(
  items: OtherIncomeLineItem[],
  physOcc: number,
  resolveBasisMonthly: (basis: RubsBasis) => number,
  forStabilized: boolean,
): number {
  let total = 0;
  for (const it of items) {
    if (forStabilized && it.recurring === false) continue;
    if (it.kind === "rubs") {
      total += (it.rubs_recovery_pct ?? 0) * resolveBasisMonthly(it.rubs_basis ?? "utilities_total") * physOcc;
    } else {
      total += it.monthly_amount ?? 0;
    }
  }
  return total;
}

/** Annual analogue of lineItemOtherIncomeMonthly (flat amounts ×12). */
function lineItemOtherIncomeAnnual(
  items: OtherIncomeLineItem[],
  physOcc: number,
  resolveBasisAnnual: (basis: RubsBasis) => number,
  forStabilized: boolean,
): number {
  let total = 0;
  for (const it of items) {
    if (forStabilized && it.recurring === false) continue;
    if (it.kind === "rubs") {
      total += (it.rubs_recovery_pct ?? 0) * resolveBasisAnnual(it.rubs_basis ?? "utilities_total") * physOcc;
    } else {
      total += (it.monthly_amount ?? 0) * 12;
    }
  }
  return total;
}

/** True when the scenario drives other income from itemized line items. */
function hasOtherIncomeLineItems(revenue: RevenueAssumptions): boolean {
  return !!(revenue.other_income?.line_items && revenue.other_income.line_items.length > 0);
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

export function calculateLoanBalance(
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

/**
 * Reassessed annual property tax for a 0-indexed pro forma year, or null when
 * reassessment is disabled / not yet phased in (caller falls back to the
 * entered bill). Escalation applies from the phase-in year forward.
 */
export function reassessedAnnualTax(
  expenses: ExpenseAssumptions,
  purchasePrice: number,
  yearIndex: number,
): number | null {
  const r = expenses.tax_reassessment;
  if (!r || !r.enabled || r.effective_tax_rate <= 0) return null;
  const phaseInIndex = Math.max(0, (r.phase_in_year ?? 1) - 1);
  if (yearIndex < phaseInIndex) return null;
  const base = (r.reassessed_value ?? purchasePrice) * r.effective_tax_rate;
  return base * Math.pow(1 + expenses.tax_escalation_rate, yearIndex - phaseInIndex);
}


// ─── Unit-State Revenue Engine (fix-spec Phase 1) ────────────
// One per-unit, per-month state machine replaces the floor-share bucket
// allocation that zeroed out absorption for per-unit rows (count=1 →
// floor(k/N)=0). All three GPR consumers (monthly pro forma, sensitivity
// annual, exit NOI) read this single schedule. Linear mode is GENERATED
// over the same machine — there is no separate code path.

export type UnitState =
  | "in_place"
  | "market"
  | "renovated"
  | "offline_turn"
  | "offline_reno"
  | "vacant_leaseup";

export interface UnitTimeline {
  unit_id: string;
  row_index: number; // unit_mix row this unit came from
  in_place_rent: number; // 0 for initially-vacant units
  market_rent: number;
  renovated_rent: number; // reno basis + premium
  states: UnitState[]; // length totalMonths
}

export interface UnitStateSchedule {
  units: UnitTimeline[];
  /** Pre-growth GPR per month (caller applies the yearly growth factor). */
  gprByMonth: number[];
  /** Units entering "market" each month (non-reno turns completing). */
  marketTurnsByMonth: number[];
  /** Units entering "renovated" each month. */
  renoTurnsByMonth: number[];
  /** market + renovated counts per month (stabilized units). */
  stabilizedByMonth: number[];
  /** (market + renovated) / total — the % marked-to-market surface. */
  pctMarkedByMonth: number[];
}

function rentForState(u: UnitTimeline, s: UnitState): number {
  switch (s) {
    case "in_place": return u.in_place_rent;
    case "market": return u.market_rent;
    case "renovated": return u.renovated_rent;
    default: return 0; // offline_turn | offline_reno | vacant_leaseup
  }
}

export function buildUnitStateSchedule(args: {
  unitMix: UnitMix[];
  ramp: RentRampAssumptions | undefined;
  capex: CapexAssumptions;
  totalMonths: number;
  /** in_place rent basis when the ramp is DISABLED (legacy unrenovated basis). */
  inPlaceBasis: "current" | "market";
  renoBasis: RenovatedBasis;
  /** Mutated with data-quality warnings (e.g. vacant override mismatch). */
  warnings?: string[];
}): UnitStateSchedule {
  const { unitMix, ramp, capex, totalMonths, inPlaceBasis, renoBasis, warnings } = args;
  const rampEnabled = !!(ramp && ramp.enabled);

  // ── Expand every row into synthetic units. Rows with per-unit details use
  // them; aggregate rows expand `count` copies of the row averages. ──
  interface Expanded {
    unit_id: string;
    row_index: number;
    current_rent: number;
    market_rent: number;
    premium: number;
    status: "occupied" | "mtm" | "vacant";
    lease_end?: string;
    hasDetail: boolean;
  }
  const expanded: Expanded[] = [];
  let detailVacantCount = 0;
  let anyDetails = false;
  unitMix.forEach((row, rowIdx) => {
    const details = row.units ?? [];
    if (details.length > 0) {
      anyDetails = true;
      for (const d of details) {
        // Vacancy derivation (spec Phase 1.3): vacant iff the detail says so
        // OR the unit bills $0 today.
        const vacant = d.status === "vacant" || (d.current_rent ?? 0) === 0;
        if (vacant) detailVacantCount++;
        expanded.push({
          unit_id: d.unit_id || `${rowIdx + 1}`,
          row_index: rowIdx,
          current_rent: vacant ? 0 : d.current_rent,
          market_rent: d.market_rent ?? row.market_rent,
          premium: row.renovated_rent_premium,
          status: vacant ? "vacant" : d.status,
          lease_end: d.status === "occupied" ? d.lease_end : undefined,
          hasDetail: true,
        });
      }
    } else {
      for (let i = 0; i < row.count; i++) {
        expanded.push({
          unit_id: row.unit_number ? `${row.unit_number}-${i + 1}` : `${rowIdx + 1}-${i + 1}`,
          row_index: rowIdx,
          current_rent: row.current_rent,
          market_rent: row.market_rent,
          premium: row.renovated_rent_premium,
          status: "mtm",
          hasDetail: false,
        });
      }
    }
  });
  const total = expanded.length;

  // Aggregate-row vacancy comes only from the ramp override; with per-unit
  // details the DERIVED count wins and a disagreeing override warns.
  const overrideVacant = Math.max(0, ramp?.initial_vacant_units ?? 0);
  if (anyDetails) {
    if (rampEnabled && overrideVacant !== detailVacantCount && warnings) {
      warnings.push(
        `Vacant @ Acquisition override (${overrideVacant}) disagrees with the rent roll's vacant units (${detailVacantCount}) — using the rent roll.`
      );
    }
  } else if (rampEnabled && overrideVacant > 0) {
    // Mark the first N synthetic units vacant (lowest data resolution available).
    for (let i = 0; i < Math.min(overrideVacant, expanded.length); i++) {
      expanded[i].status = "vacant";
      expanded[i].current_rent = 0;
    }
  }

  // ── Timelines start fully in_place (in_place rent depends on ramp mode) ──
  const units: UnitTimeline[] = expanded.map((e) => ({
    unit_id: e.unit_id,
    row_index: e.row_index,
    // Ramp ON: in_place = actual current rent (the ramp IS the migration).
    // Ramp OFF: legacy basis semantics (unrenovated basis current|market).
    in_place_rent: rampEnabled
      ? e.current_rent
      : inPlaceBasis === "market"
      ? e.market_rent
      : e.current_rent,
    market_rent: e.market_rent,
    renovated_rent: (renoBasis === "market_plus_premium" ? e.market_rent : e.current_rent) + e.premium,
    states: new Array<UnitState>(totalMonths).fill("in_place"),
  }));

  // ── Market-turn queue (ramp ON only) ──
  if (rampEnabled && ramp) {
    const turnDowntime = Math.max(0, ramp.turn_downtime_months);
    const vacantLeaseup = Math.max(0, ramp.vacant_leaseup_months ?? 0);
    const maxPerMonth = Math.max(1, ramp.max_turns_per_month ?? Infinity);

    const anchor = ramp.analysis_start_date ? new Date(ramp.analysis_start_date + "T00:00:00") : null;
    const monthIndexOf = (iso: string): number | null => {
      if (!anchor) return null;
      const d = new Date(iso + "T00:00:00");
      if (isNaN(d.getTime())) return null;
      return (d.getFullYear() - anchor.getFullYear()) * 12 + (d.getMonth() - anchor.getMonth());
    };

    // Vacant units: lease-up path, not paced.
    expanded.forEach((e, i) => {
      if (e.status !== "vacant") return;
      const t = units[i].states;
      for (let m = 0; m < totalMonths; m++) {
        t[m] = m < vacantLeaseup ? "vacant_leaseup" : "market";
      }
    });

    // Below-market occupied/mtm units → eligibility queue.
    interface QueueItem { idx: number; eligible: number; gap: number }
    const queue: QueueItem[] = [];
    const useLinear = ramp.mode !== "schedule" || !anyDetails;
    const belowMarketIdxs = expanded
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.status !== "vacant" && e.current_rent < e.market_rent);

    if (useLinear) {
      // Linear mode GENERATED over the machine: spread eligibility evenly
      // across the absorption window (deepest gap first), same pacing rules.
      const span = Math.max(1, ramp.absorption_months);
      const sorted = [...belowMarketIdxs].sort(
        (a, b) => (b.e.market_rent - b.e.current_rent) - (a.e.market_rent - a.e.current_rent)
      );
      sorted.forEach(({ e, i }, k) => {
        const eligible = Math.floor((k * span) / Math.max(1, sorted.length));
        queue.push({ idx: i, eligible, gap: e.market_rent - e.current_rent });
      });
    } else {
      for (const { e, i } of belowMarketIdxs) {
        if (e.status === "occupied" && e.lease_end) {
          const mi = monthIndexOf(e.lease_end);
          queue.push({ idx: i, eligible: mi === null ? 0 : Math.max(0, mi + 1), gap: e.market_rent - e.current_rent });
        } else {
          queue.push({ idx: i, eligible: 0, gap: e.market_rent - e.current_rent });
        }
      }
    }
    queue.sort((a, b) => a.eligible - b.eligible || b.gap - a.gap);

    let qi = 0;
    const pending: QueueItem[] = [];
    for (let m = 0; m < totalMonths && (qi < queue.length || pending.length > 0); m++) {
      while (qi < queue.length && queue[qi].eligible <= m) pending.push(queue[qi++]);
      pending.sort((a, b) => b.gap - a.gap);
      let started = 0;
      while (pending.length > 0 && started < maxPerMonth) {
        const item = pending.shift()!;
        const t = units[item.idx].states;
        for (let k = m; k < Math.min(m + turnDowntime, totalMonths); k++) t[k] = "offline_turn";
        for (let k = m + turnDowntime; k < totalMonths; k++) t[k] = "market";
        started++;
      }
    }
  }

  // ── Renovation overlay (always — reno schedule is independent of the ramp).
  // Specific units are assigned deepest-below-market first; each unit's
  // downtime and renovated rent flow through its own timeline. ──
  const renoCount = Math.min(Math.max(0, Math.floor(capex.units_to_renovate || 0)), total);
  if (renoCount > 0) {
    const upm = getUnitsPerMonth(capex);
    if (upm > 0) {
      const startMonth = Math.max(1, capex.renovation_start_month || 1);
      const downtime = capex.renovation_downtime_enabled
        ? Math.max(0, capex.renovation_downtime_months || 0)
        : 0;
      const assigned = expanded
        .map((e, i) => ({ e, i }))
        .sort((a, b) => (b.e.market_rent - b.e.current_rent) - (a.e.market_rent - a.e.current_rent))
        .slice(0, renoCount);
      assigned.forEach(({ i }, j) => {
        // Unit j completes when cumulative pace reaches j+1 (matches the
        // legacy buildRenovationSchedule cumulative curve).
        const completion = startMonth + Math.ceil((j + 1) / upm) - 1; // 1-indexed month
        const c = completion - 1; // 0-indexed
        if (c >= totalMonths) return;
        const t = units[i].states;
        for (let k = Math.max(0, c - 0); k < Math.min(c + downtime, totalMonths); k++) t[k] = "offline_reno";
        for (let k = c + downtime; k < totalMonths; k++) t[k] = "renovated";
      });
    }
  }

  // ── Derive monthly aggregates ──
  const gprByMonth = new Array<number>(totalMonths).fill(0);
  const marketTurnsByMonth = new Array<number>(totalMonths).fill(0);
  const renoTurnsByMonth = new Array<number>(totalMonths).fill(0);
  const stabilizedByMonth = new Array<number>(totalMonths).fill(0);
  const pctMarkedByMonth = new Array<number>(totalMonths).fill(0);

  for (let m = 0; m < totalMonths; m++) {
    let gpr = 0;
    let stabilized = 0;
    for (const u of units) {
      const s = u.states[m];
      gpr += rentForState(u, s);
      if (s === "market" || s === "renovated") stabilized++;
      const prev = m > 0 ? u.states[m - 1] : "in_place";
      if (s === "market" && prev !== "market") marketTurnsByMonth[m]++;
      if (s === "renovated" && prev !== "renovated") renoTurnsByMonth[m]++;
    }
    gprByMonth[m] = gpr;
    stabilizedByMonth[m] = stabilized;
    pctMarkedByMonth[m] = total > 0 ? stabilized / total : 0;

    // Dev invariant: states partition the unit count (trivially true by
    // construction, but guards future refactors).
    if (process.env.NODE_ENV !== "production") {
      let counted = 0;
      for (const u of units) if (u.states[m]) counted++;
      if (counted !== total) {
        console.warn(`unit-state invariant failed at month ${m + 1}: ${counted} !== ${total}`);
      }
    }
  }

  return { units, gprByMonth, marketTurnsByMonth, renoTurnsByMonth, stabilizedByMonth, pctMarkedByMonth };
}

/**
 * Build a schedule of units offline for renovation each month.
 * A unit completing renovation in month M is offline for `downtime_months`
 * months ending in M (i.e., months M-downtime+1 through M inclusive).
 */
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

      const adjustedClosing = computeClosingCosts(adjustedInputs.purchase);
      const adjustedCapexReserve = adjustedInputs.purchase.capex_reserve || 0;

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
      // Equity off the DSCR/LTV-sized loan (Phase 4.1), not raw LTV proceeds.
      const adjustedOrigination = result.loanAmount * adjustedInputs.financing.origination_fee_rate;
      const adjustedEquity = adjustedInputs.purchase.purchase_price + adjustedClosing + adjustedOrigination + adjustedCapexReserve - result.loanAmount;
      const sensReassess = adjustedInputs.expenses.property_tax_v2?.enabled
        ? adjustedInputs.expenses.property_tax_v2
        : adjustedInputs.expenses.tax_reassessment;
      const sensExitReassess = !!(sensReassess?.enabled && (sensReassess.apply_at_exit ?? true) && sensReassess.effective_tax_rate > 0);
      let exitVal = 0;
      if (result.exitNOI > 0) {
        if (sensExitReassess) {
          const exitYearTax = reassessedAnnualTax(
            adjustedInputs.expenses,
            adjustedInputs.purchase.purchase_price,
            adjustedInputs.exit.hold_period_years - 1,
          ) ?? 0;
          exitVal = (result.exitNOI + exitYearTax) / (adjustedInputs.exit.exit_cap_rate + sensReassess!.effective_tax_rate);
        } else {
          exitVal = result.exitNOI / adjustedInputs.exit.exit_cap_rate;
        }
      }
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

/** Simplified calculation for sensitivity grid — avoids full monthly recalc */
// Annual escalation factor for opex lines (matches the main loop's compounding).
function expEscalationFor(expenses: ExpenseAssumptions, yearIndex: number): number {
  return Math.pow(1 + (expenses.expense_escalation_rate || 0), yearIndex);
}

// Structured-RUBS delta for the annual (sensitivity) path. Approximation
// relative to the monthly path: physical occupancy ≈ 1 − vacancy_rate instead
// of the unit-state schedule (the simplified path is approximate by design).
function structuredRubsAnnualDelta(
  revenue: RevenueAssumptions,
  expenses: ExpenseAssumptions,
  totalUnits: number,
  egiWithoutRubs: number,
  annualGpr: number,
  escalation: number,
): number {
  if (revenue.rubs?.mode !== "structured") return 0;
  const ctx = { totalUnits, annualEgi: egiWithoutRubs, annualGpr, escalation };
  const subSum = resolveSublinesAnnual(expenses.opex_inputs?.utilities_sublines as Record<string, OpexInput | undefined> | undefined, ctx);
  const utilities = subSum !== null ? subSum : resolveOpexAnnual(expenses.opex_inputs?.utilities, expenses.utilities_per_unit, "per_unit_annual", ctx);
  const recovery = revenue.rubs.recovery_pct ?? 0.80;
  const physOcc = Math.max(0, 1 - revenue.vacancy_rate);
  const manualRubs = (revenue.other_income_sublines?.utility_reimbursement ?? 0) * 12;
  return recovery * utilities * physOcc - manualRubs;
}

function calculateUnderwritingSimplified(inputs: ScenarioInputs): {
  annualCashFlows: number[];
  exitNOI: number;
  loanBalance: number;
  loanAmount: number;
} {
  const { purchase, financing, revenue, expenses, capex, exit } = inputs;
  const totalMonths = exit.hold_period_years * 12;
  const totalUnits = revenue.unit_mix.reduce((s, u) => s + u.count, 0);
  const ltvLoan = purchase.purchase_price * financing.ltv;
  const monthlyRate = financing.interest_rate / 12;
  const amortMonths = financing.amortization_years * 12;
  const rentBasis: RentBasis = exit.sensitivity_rent_basis || "current";

  // ── Unit-state schedule (fix-spec Phase 1) — same machine as the monthly
  // pro forma, so the sensitivity path can no longer diverge from it.
  // Legacy "_plus_reno" sensitivity bases mean "all units renovated from
  // month 1": expressed by overriding the capex pace to renovate everything
  // immediately rather than via a separate rent formula.
  const hasRenoPremiumBasis = rentBasis === "current_plus_reno" || rentBasis === "market_plus_reno";
  const sensCapex = hasRenoPremiumBasis
    ? { ...capex, units_to_renovate: totalUnits, renovation_start_month: 1, renovation_end_month: 1, renovation_downtime_enabled: false }
    : capex;
  const unitSchedule = buildUnitStateSchedule({
    unitMix: revenue.unit_mix,
    ramp: revenue.rent_ramp,
    capex: sensCapex,
    totalMonths,
    inPlaceBasis: rentBasis === "market" || rentBasis === "market_plus_reno" ? "market" : "current",
    renoBasis: rentBasis === "market" || rentBasis === "market_plus_reno" ? "market_plus_premium" : "current_plus_premium",
  });

  const annualCashFlows: number[] = [];
  const annualNOIs: number[] = [];
  const annualBelowNOI: number[] = [];

  for (let y = 0; y < exit.hold_period_years; y++) {
    const yearGrowth = Math.pow(1 + revenue.rent_growth_rate, y);
    // Annual GPR: exact 12-month sum from the unit-state schedule × growth.
    // (No more mid-year approximations or floor-share buckets.)
    let annualGPR = 0;
    for (let mo = y * 12; mo < (y + 1) * 12 && mo < totalMonths; mo++) {
      annualGPR += unitSchedule.gprByMonth[mo];
    }
    annualGPR *= yearGrowth;

    let annualEGI = annualGPR * (1 - revenue.vacancy_rate - revenue.bad_debt_rate - revenue.concessions_rate);
    if (hasOtherIncomeLineItems(revenue)) {
      const oiCtx = { totalUnits, annualEgi: annualEGI, annualGpr: annualGPR, escalation: expEscalationFor(expenses, y) };
      const resolveBasis = makeUtilityBasisResolverAnnual(expenses, oiCtx);
      annualEGI += lineItemOtherIncomeAnnual(revenue.other_income!.line_items!, Math.max(0, 1 - revenue.vacancy_rate), resolveBasis, false);
    } else {
      annualEGI += revenue.other_income_monthly * 12;
      annualEGI += structuredRubsAnnualDelta(revenue, expenses, totalUnits, annualEGI, annualGPR, expEscalationFor(expenses, y));
    }

    const taxEscalation = Math.pow(1 + expenses.tax_escalation_rate, y);
    const expEscalation = Math.pow(1 + (expenses.expense_escalation_rate || 0), y);
    const oiS = expenses.opex_inputs;
    const sCtx = { totalUnits, annualEgi: annualEGI, annualGpr: annualGPR, escalation: expEscalation };
    const sTaxCtx = { ...sCtx, escalation: taxEscalation };
    const utilSubSumS = resolveSublinesAnnual(oiS?.utilities_sublines as Record<string, OpexInput | undefined> | undefined, sCtx);
    const svcSubSumS = resolveSublinesAnnual(oiS?.services_sublines as Record<string, OpexInput | undefined> | undefined, sCtx);
    // Operating opex (excludes reserves — those are tracked separately below NOI)
    // Note: the simplified (sensitivity) calc uses the flat turnover formula even when
    // ramp is on. The main pro forma uses the ramp-aware computeRampTurnoverCost (spec
    // REVENUE_CARD §A1). Sensitivity precision on turnover during the ramp is a known
    // approximation — tracked as a follow-up.
    const annualOpex =
      resolveOpexAnnual(oiS?.management_fees, expenses.management_fee_rate, "pct_egi", sCtx) +
      resolveOpexAnnual(oiS?.payroll, expenses.payroll_annual, "total_annual", sCtx) +
      resolveOpexAnnual(oiS?.repairs_maintenance, expenses.repairs_maintenance_per_unit, "per_unit_annual", sCtx) +
      applyTurnoverRate(
        resolveOpexAnnual(oiS?.turnover, expenses.turnover_cost_per_unit, "per_unit_annual", sCtx),
        oiS?.turnover,
        expenses.turnover_rate ?? 0.50,
      ) +
      resolveOpexAnnual(oiS?.insurance, expenses.insurance_per_unit, "per_unit_annual", sCtx) +
      (expenses.property_tax_v2?.enabled
        ? propertyTaxForMonthV2(expenses.property_tax_v2, purchase.purchase_price, y * 12 + 6) * 12
        : (reassessedAnnualTax(expenses, purchase.purchase_price, y) ?? resolveOpexAnnual(oiS?.property_tax, expenses.property_tax_total, "total_annual", sTaxCtx))) +
      (utilSubSumS !== null ? utilSubSumS : resolveOpexAnnual(oiS?.utilities, expenses.utilities_per_unit, "per_unit_annual", sCtx)) +
      resolveOpexAnnual(oiS?.admin_legal_marketing, expenses.admin_legal_marketing, "total_annual", sCtx) +
      (svcSubSumS !== null ? svcSubSumS : resolveOpexAnnual(oiS?.contract_services, expenses.contract_services, "total_annual", sCtx));
    const annualReserves = resolveOpexAnnual(oiS?.reserves, expenses.reserves_per_unit, "per_unit_annual", sCtx);

    const annualNOI = annualEGI - annualOpex;

    // Simplified CapEx (just projects + per-unit)
    let annualCapex = 0;
    for (let m = y * 12 + 1; m <= (y + 1) * 12; m++) {
      annualCapex += calculateMonthCapex(capex, m);
    }

    // Debt service is applied AFTER the loop — the loan can't be sized until
    // year-1 NOI is known (Phase 4.1 DSCR sizing), and NOI is loan-independent.
    annualNOIs.push(annualNOI);
    annualBelowNOI.push(annualReserves + annualCapex);
  }

  // DSCR-aware sizing, mirroring the main engine so sensitivity cells use the
  // same proceeds rule (each cell re-sizes at its own price and NOI).
  let loanAmount = ltvLoan;
  if (financing.size_to_dscr !== false) {
    const floor = financing.dscr_floor ?? 1.25;
    const pmtFactor = monthlyRate > 0
      ? (monthlyRate * Math.pow(1 + monthlyRate, amortMonths)) / (Math.pow(1 + monthlyRate, amortMonths) - 1)
      : 1 / Math.max(1, amortMonths);
    const dscrLoan = annualNOIs[0] > 0 ? annualNOIs[0] / floor / 12 / pmtFactor : 0;
    loanAmount = Math.min(ltvLoan, dscrLoan);
  }
  const monthlyDS = calculateMonthlyPayment(loanAmount, monthlyRate, amortMonths);
  const monthlyIO = loanAmount * monthlyRate;
  for (let y = 0; y < exit.hold_period_years; y++) {
    let annualDS = 0;
    for (let m = y * 12 + 1; m <= (y + 1) * 12; m++) {
      annualDS += m <= financing.io_period_months ? monthlyIO : monthlyDS;
    }
    annualCashFlows.push(annualNOIs[y] - annualDS - annualBelowNOI[y]);
  }

  // Exit NOI GPR: exact last-12-months sum from the SAME unit-state schedule
  // the annual path used — the exit path can no longer diverge.
  const lastYearGrowth = Math.pow(1 + revenue.rent_growth_rate, exit.hold_period_years - 1);
  let exitGPR = 0;
  for (let mo = Math.max(0, totalMonths - 12); mo < totalMonths; mo++) {
    exitGPR += unitSchedule.gprByMonth[mo];
  }
  exitGPR *= lastYearGrowth;

  let exitEGI = exitGPR * (1 - revenue.vacancy_rate - revenue.bad_debt_rate - revenue.concessions_rate);
  if (hasOtherIncomeLineItems(revenue)) {
    // Exit uses the STABILIZED figure — non-recurring line items excluded.
    const exitOiCtx = { totalUnits, annualEgi: exitEGI, annualGpr: exitGPR, escalation: expEscalationFor(expenses, exit.hold_period_years - 1) };
    const resolveBasis = makeUtilityBasisResolverAnnual(expenses, exitOiCtx);
    exitEGI += lineItemOtherIncomeAnnual(revenue.other_income!.line_items!, Math.max(0, 1 - revenue.vacancy_rate), resolveBasis, true);
  } else {
    exitEGI += revenue.other_income_monthly * 12;
    exitEGI += structuredRubsAnnualDelta(revenue, expenses, totalUnits, exitEGI, exitGPR, expEscalationFor(expenses, exit.hold_period_years - 1));
  }
  const taxEsc = Math.pow(1 + expenses.tax_escalation_rate, exit.hold_period_years - 1);
  const expEsc = Math.pow(1 + (expenses.expense_escalation_rate || 0), exit.hold_period_years - 1);
  const oiE = expenses.opex_inputs;
  const eCtx = { totalUnits, annualEgi: exitEGI, annualGpr: exitGPR, escalation: expEsc };
  const eTaxCtx = { ...eCtx, escalation: taxEsc };
  const utilSubSumE = resolveSublinesAnnual(oiE?.utilities_sublines as Record<string, OpexInput | undefined> | undefined, eCtx);
  const svcSubSumE = resolveSublinesAnnual(oiE?.services_sublines as Record<string, OpexInput | undefined> | undefined, eCtx);
  // Exit NOI uses operating opex only (excludes reserves) — institutional convention
  const exitOpex =
    resolveOpexAnnual(oiE?.management_fees, expenses.management_fee_rate, "pct_egi", eCtx) +
    resolveOpexAnnual(oiE?.payroll, expenses.payroll_annual, "total_annual", eCtx) +
    resolveOpexAnnual(oiE?.repairs_maintenance, expenses.repairs_maintenance_per_unit, "per_unit_annual", eCtx) +
    applyTurnoverRate(
      resolveOpexAnnual(oiE?.turnover, expenses.turnover_cost_per_unit, "per_unit_annual", eCtx),
      oiE?.turnover,
      expenses.turnover_rate ?? 0.50,
    ) +
    resolveOpexAnnual(oiE?.insurance, expenses.insurance_per_unit, "per_unit_annual", eCtx) +
    (expenses.property_tax_v2?.enabled
      ? propertyTaxForMonthV2(expenses.property_tax_v2, purchase.purchase_price, exit.hold_period_years * 12 - 6) * 12
      : (reassessedAnnualTax(expenses, purchase.purchase_price, exit.hold_period_years - 1) ?? resolveOpexAnnual(oiE?.property_tax, expenses.property_tax_total, "total_annual", eTaxCtx))) +
    (utilSubSumE !== null ? utilSubSumE : resolveOpexAnnual(oiE?.utilities, expenses.utilities_per_unit, "per_unit_annual", eCtx)) +
    resolveOpexAnnual(oiE?.admin_legal_marketing, expenses.admin_legal_marketing, "total_annual", eCtx) +
    (svcSubSumE !== null ? svcSubSumE : resolveOpexAnnual(oiE?.contract_services, expenses.contract_services, "total_annual", eCtx));
  const exitNOI = exitEGI - exitOpex;

  const loanBalance = calculateLoanBalance(
    loanAmount, monthlyRate, amortMonths, totalMonths, financing.io_period_months
  );

  return { annualCashFlows, exitNOI, loanBalance, loanAmount };
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
