/**
 * Tax Treatment Module — after-tax cash flows per TAX_TREATMENT_SPEC.md
 * (CPA-informed handoff, 2026-06-11). NOT TAX ADVICE — modeling conventions
 * for an owner-specific situation (MFJ, NYC residents, OpCo/PropCo, REPS,
 * 1031 exit). Confirm with CPA; re-test REPS every year.
 *
 * Key conventions implemented here:
 *  - TWO depreciation schedules: federal (100% bonus on ≤20-yr buckets) vs
 *    NY/NYC (no bonus — regular recovery). Federal loss × 37%; NY loss × ~14.78%.
 *    Never blend the rates on bonus deductions.
 *  - REPS is a PER-YEAR toggle. ON → non-passive loss offsets W-2, gated by
 *    §461(l) (excess → NOL, released the following year — household W-2 of
 *    ~$1.5M makes the 80%-of-TI limit non-binding, documented simplification).
 *    OFF → passive loss suspended (PAL); NOT released at a 1031 exit.
 *  - NIIT (3.8%) applies to positive rental income only when REPS is OFF.
 *  - OpCo/PropCo: the 8% management fee is already an expense inside NOI
 *    (PropCo view). The household view adds back fee × (1 − opco_fee_tax_rate).
 *  - 1031 exit: NO gain/recapture tax modeled. Deferred gain reported as a
 *    memo. §1245 personal property assumed worthless at sale.
 *  - Closing costs split three ways: acquisition → basis (building share),
 *    financing (origination) → amortized over loan term (remainder expensed
 *    in exit year), prepaids/prorations → year-1 deduction.
 *
 * Depreciation simplifications (documented; CPA refines):
 *  - 5-yr and 15-yr non-bonused portions: straight-line over class life with
 *    half-year convention (approximates MACRS DB without the tables).
 *  - 27.5-yr: straight-line; acquisition vintage uses mid-month month-1
 *    (11.5/12 first year); capex vintages use half-year.
 */

import { calculateIRR } from "./irr";
import type { ScenarioInputs, AnnualSummary, ClosingCostBreakdown } from "./underwriting";

// ─── Inputs (TAX_TREATMENT_SPEC §8) ──────────────────────────

export interface TaxAssumptions {
  // rates
  federal_ordinary_rate: number; // default 0.37
  state_local_ordinary_rate: number; // NY+NYC, default ~0.1478
  niit_rate: number; // 0.038; rental income only when NOT shielded by REPS
  // REPS
  reps_status: boolean[]; // per hold year; gated by >50%/750hr attestation in the UI
  // entity
  opco_view: "propco" | "household";
  management_fee_pct: number; // 0.08 — informational; the fee expense already lives in NOI
  opco_fee_tax_rate: number; // SE/payroll leakage on the recycled fee
  // basis & cost-seg (applied to improvement basis, never full price)
  land_allocation_pct: number; // default = county auditor land ratio
  costseg_5yr_pct: number; // default 0.25 (5-yr personal property reclass)
  costseg_15yr_pct: number; // default 0.08 (15-yr land improvements)
  reno_5yr_pct: number; // default 0.58 — only applies to actual reno/capex spend
  reno_repairs_expensed_pct: number; // default 0
  // bonus / conformity
  federal_bonus_pct: number; // 1.00 post-1/19/2025
  state_conforms_bonus: boolean; // false for NY
  // loss limits
  ebl_cap_mfj: number; // 2026 = 512000; year-indexed input
  // exit
  exit_via_1031: boolean; // true → no gain/recapture tax modeled
  personal_property_worthless_at_exit: boolean; // true
}

export const TAX_DEFAULTS: TaxAssumptions = {
  federal_ordinary_rate: 0.37,
  state_local_ordinary_rate: 0.1478,
  niit_rate: 0.038,
  reps_status: [],
  opco_view: "household",
  management_fee_pct: 0.08,
  opco_fee_tax_rate: 0.15,
  land_allocation_pct: 0.2,
  costseg_5yr_pct: 0.25,
  costseg_15yr_pct: 0.08,
  reno_5yr_pct: 0.58,
  reno_repairs_expensed_pct: 0,
  federal_bonus_pct: 1.0,
  state_conforms_bonus: false,
  ebl_cap_mfj: 512_000,
  exit_via_1031: true,
  personal_property_worthless_at_exit: true,
};

// ─── Outputs ─────────────────────────────────────────────────

export interface TaxYearRow {
  year: number;
  reps_on: boolean;
  federal_depreciation: number;
  state_depreciation: number;
  financing_amortization: number;
  federal_taxable_income: number; // NOI − interest − fed dep − fin amort (− prepaids yr 1)
  state_taxable_income: number;
  federal_tax: number; // negative = shield (benefit)
  state_tax: number; // negative = shield
  niit: number; // ≥ 0
  nol_carryforward: number; // federal NOL balance at year end (REPS-on overflow)
  pal_carryforward: number; // suspended passive losses at year end (REPS-off years)
  after_tax_cash_flow_propco: number;
  after_tax_cash_flow_household: number;
}

export interface DeferredGainMemo {
  deferred_gain: number; // gain NOT taxed at exit because of the 1031
  accumulated_federal_depreciation: number;
  sec1250_depreciation: number; // 27.5-yr + 15-yr land improvements
  sec1245_depreciation: number; // 5-yr personal property (assumed worthless at sale)
  adjusted_basis_at_exit: number;
}

export interface TaxResult {
  years: TaxYearRow[];
  after_tax_irr_propco: number | null;
  after_tax_irr_household: number | null;
  year1_federal_shield: number; // positive $ benefit in year 1 (0 if REPS off)
  year1_state_shield: number;
  pal_carryforward_at_exit: number; // NOT released by the 1031 — deferred value
  deferred_gain_memo: DeferredGainMemo;
}

// ─── Depreciation helpers ────────────────────────────────────

/** Straight-line with half-year convention: y1 and y(life+1) get half. */
function slHalfYear(basis: number, life: number, yearsSincePlaced: number): number {
  if (basis <= 0 || yearsSincePlaced < 1) return 0;
  const annual = basis / life;
  if (yearsSincePlaced === 1 || yearsSincePlaced === life + 1) return annual / 2;
  return yearsSincePlaced <= life ? annual : 0;
}

/** 27.5-yr straight-line. Acquisition vintage: mid-month, placed month 1 → 11.5/12 in year 1. */
function sl275(basis: number, yearsSincePlaced: number, midMonthFirstYear: boolean): number {
  if (basis <= 0 || yearsSincePlaced < 1) return 0;
  const annual = basis / 27.5;
  if (yearsSincePlaced === 1 && midMonthFirstYear) return annual * (11.5 / 12);
  return yearsSincePlaced <= 28 ? annual : 0;
}

// ─── Main entry ──────────────────────────────────────────────

export interface TaxLayerContext {
  annual: AnnualSummary[];
  totalEquity: number;
  netSaleProceeds: number; // pre-tax (1031 — stays pre-tax)
  exitValue: number;
  sellingCosts: number;
  originationFee: number;
}

export function computeTaxLayer(inputs: ScenarioInputs, ctx: TaxLayerContext): TaxResult {
  const tax = { ...TAX_DEFAULTS, ...inputs.tax };
  const { purchase, financing, exit } = inputs;
  const holdYears = exit.hold_period_years;
  const fedRate = tax.federal_ordinary_rate;
  const stateRate = tax.state_local_ordinary_rate;

  // ── Closing-cost three-way split (§6) ──
  // Itemized mode: prorations → year-1 deduction; reserves_escrow → neither
  // (escrowed cash, not a cost); the rest → acquisition costs capitalized to basis.
  // Rate mode: all → acquisition (documented default).
  const ccBk: ClosingCostBreakdown | undefined = purchase.closing_cost_breakdown;
  let acquisitionCosts = 0;
  let prepaidDeductionY1 = 0;
  if (purchase.closing_cost_mode === "itemized" && ccBk) {
    prepaidDeductionY1 = ccBk.prorations || 0;
    acquisitionCosts =
      (ccBk.title_insurance || 0) + (ccBk.legal_fees || 0) + (ccBk.property_costs || 0) +
      (ccBk.third_party_reports || 0) + (ccBk.transfer_taxes || 0) + (ccBk.other_closing || 0);
  } else {
    acquisitionCosts = purchase.purchase_price * (purchase.closing_cost_rate || 0);
  }

  // Cost-seg study fee (spec Part 1): deductible as a Year-1 professional fee.
  // Immaterial vs. the depreciation shield, but kept honest. NOT capitalized
  // to basis and NOT in NOI — it's a transaction cost in uses-of-funds.
  const costSegFeeY1 = purchase.cost_seg_study_cost || 0;

  // ── Basis & buckets (§6): land carve-out FIRST, cost-seg on improvement basis ──
  const totalCostBasis = purchase.purchase_price + acquisitionCosts;
  const improvementBasis = totalCostBasis * (1 - tax.land_allocation_pct);
  const b5 = improvementBasis * tax.costseg_5yr_pct;
  const b15 = improvementBasis * tax.costseg_15yr_pct;
  const b275 = improvementBasis - b5 - b15;

  // Federal bonus on ≤20-yr buckets (5-yr AND 15-yr), year 1.
  const fedBonusAcq = tax.federal_bonus_pct * (b5 + b15);
  const b5NonBonus = b5 * (1 - tax.federal_bonus_pct);
  const b15NonBonus = b15 * (1 - tax.federal_bonus_pct);

  // ── CapEx vintages (§6): expensed slice + capitalized 5-yr / 27.5-yr ──
  const capexByYear = ctx.annual.map((a) => a.capex);
  interface CapexVintage { year: number; c5: number; c275: number; expensed: number }
  const vintages: CapexVintage[] = capexByYear.map((spend, i) => {
    const expensed = spend * tax.reno_repairs_expensed_pct;
    const capitalized = spend - expensed;
    return {
      year: i + 1,
      c5: capitalized * tax.reno_5yr_pct,
      c275: capitalized * (1 - tax.reno_5yr_pct),
      expensed,
    };
  });

  // ── Financing-cost amortization ──
  const loanTermYears = Math.max(1, financing.loan_term_years || financing.amortization_years || 30);
  const finAmortAnnual = ctx.originationFee / loanTermYears;

  // ── Per-year schedules & tax flow ──
  const years: TaxYearRow[] = [];
  let nolCF = 0; // federal NOL carryforward (REPS-on overflow over §461(l))
  let palCFFed = 0; // suspended passive losses, federal (REPS-off years)
  let palCFState = 0;
  let accumFedDep = 0;
  let accumFed1245 = 0;
  let accumFed1250 = 0;
  const atcfPropco: number[] = [];
  const atcfHousehold: number[] = [];

  const repsForYear = (y: number): boolean =>
    tax.reps_status.length === 0 ? true : (tax.reps_status[y - 1] ?? tax.reps_status[tax.reps_status.length - 1]);

  for (let y = 1; y <= holdYears; y++) {
    const a = ctx.annual[y - 1];
    const repsOn = repsForYear(y);

    // Federal depreciation
    let fedDep =
      (y === 1 ? fedBonusAcq : 0) +
      slHalfYear(b5NonBonus, 5, y) +
      slHalfYear(b15NonBonus, 15, y) +
      sl275(b275, y, true);
    let fed1245 = (y === 1 ? tax.federal_bonus_pct * b5 : 0) + slHalfYear(b5NonBonus, 5, y);
    let fed1250 = fedDep - fed1245;
    // State (NY): no bonus unless state_conforms_bonus
    let stateDep = tax.state_conforms_bonus
      ? fedDep
      : slHalfYear(b5, 5, y) + slHalfYear(b15, 15, y) + sl275(b275, y, true);

    // CapEx vintages placed in service in year v
    let capexExpensed = 0;
    for (const v of vintages) {
      const age = y - v.year + 1;
      if (age < 1) continue;
      if (age === 1) capexExpensed += v.expensed;
      const fedC5 = age === 1
        ? tax.federal_bonus_pct * v.c5 + slHalfYear(v.c5 * (1 - tax.federal_bonus_pct), 5, age)
        : slHalfYear(v.c5 * (1 - tax.federal_bonus_pct), 5, age);
      const c275Dep = sl275(v.c275, age, false);
      fedDep += fedC5 + c275Dep;
      fed1245 += fedC5;
      fed1250 += c275Dep;
      stateDep += tax.state_conforms_bonus
        ? fedC5 + c275Dep
        : slHalfYear(v.c5, 5, age) + c275Dep;
    }

    accumFedDep += fedDep;
    accumFed1245 += fed1245;
    accumFed1250 += fed1250;

    // Financing amortization (remaining balance expensed in exit year on payoff)
    const isExitYear = y === holdYears;
    const finAmort = isExitYear
      ? Math.max(0, ctx.originationFee - finAmortAnnual * (y - 1))
      : finAmortAnnual;

    // Year-1 deductions: prepaids/prorations + the cost-seg study fee.
    const prepaids = y === 1 ? prepaidDeductionY1 + costSegFeeY1 : 0;
    const capexExpDeduction = capexExpensed;

    // Taxable income (§4): NOI − interest − dep − fin amort − prepaids − expensed repairs
    const tiFed = a.noi - a.interest_paid - fedDep - finAmort - prepaids - capexExpDeduction;
    const tiState = a.noi - a.interest_paid - stateDep - finAmort - prepaids - capexExpDeduction;

    // ── Federal loss routing: REPS → §461(l) → NOL ──
    let fedTax = 0;
    if (tiFed < 0) {
      const loss = -tiFed;
      if (repsOn) {
        const allowed = Math.min(loss, tax.ebl_cap_mfj);
        nolCF += loss - allowed;
        fedTax = -(allowed * fedRate); // shield against W-2 ordinary income
      } else {
        palCFFed += loss; // suspended — no current benefit
      }
    } else {
      let ti = tiFed;
      // PAL offsets rental (passive) income first
      const palUsed = Math.min(palCFFed, ti);
      palCFFed -= palUsed;
      ti -= palUsed;
      // NOL: usable against ≤80% of taxable income — household W-2 (~$1.5M)
      // makes the limit non-binding, so the NOL releases in full (simplification).
      const nolUsed = Math.min(nolCF, ti);
      nolCF -= nolUsed;
      ti -= nolUsed;
      fedTax = ti * fedRate;
    }
    // Release NOL against household W-2 the year AFTER it arises (80% of household
    // TI >> NOL). Modeled as a shield in the following year.
    if (nolCF > 0 && y > 1) {
      fedTax -= nolCF * fedRate;
      nolCF = 0;
    }

    // ── State loss routing (no EBL cap modeled — NY conformity out of scope) ──
    let stateTax = 0;
    if (tiState < 0) {
      if (repsOn) stateTax = -(-tiState * stateRate);
      else palCFState += -tiState;
    } else {
      let ti = tiState;
      const palUsed = Math.min(palCFState, ti);
      palCFState -= palUsed;
      ti -= palUsed;
      stateTax = ti * stateRate;
    }

    // NIIT: positive rental income, only when REPS is OFF (§4)
    const niit = !repsOn && tiFed > 0 ? tiFed * tax.niit_rate : 0;

    const netTax = fedTax + stateTax + niit; // negative = net shield
    const propcoCF = a.cash_flow - netTax;
    // Household view (§5): the 8% fee inside NOI returns to the household
    // minus OpCo-level leakage (SE/payroll). Income-tax wash documented in spec.
    const feeRecycled = a.opex_breakdown.management_fees * (1 - tax.opco_fee_tax_rate);
    const householdCF = propcoCF + feeRecycled;

    atcfPropco.push(propcoCF);
    atcfHousehold.push(householdCF);

    years.push({
      year: y,
      reps_on: repsOn,
      federal_depreciation: fedDep,
      state_depreciation: stateDep,
      financing_amortization: finAmort,
      federal_taxable_income: tiFed,
      state_taxable_income: tiState,
      federal_tax: fedTax,
      state_tax: stateTax,
      niit,
      nol_carryforward: nolCF,
      pal_carryforward: palCFFed,
      after_tax_cash_flow_propco: propcoCF,
      after_tax_cash_flow_household: householdCF,
    });
  }

  // ── Exit (§7): 1031 — NO gain/recapture tax. Memo only. ──
  const capitalizedCapex = vintages.reduce((s, v) => s + v.c5 + v.c275, 0);
  const adjustedBasis = totalCostBasis + capitalizedCapex - accumFedDep;
  const deferredGain = Math.max(0, ctx.exitValue - ctx.sellingCosts - adjustedBasis);

  // After-tax IRRs: equity out, after-tax CFs, exit proceeds (pre-tax per 1031) in final year.
  const flowsPropco = [-ctx.totalEquity, ...atcfPropco];
  flowsPropco[flowsPropco.length - 1] += ctx.netSaleProceeds;
  const flowsHousehold = [-ctx.totalEquity, ...atcfHousehold];
  flowsHousehold[flowsHousehold.length - 1] += ctx.netSaleProceeds;

  const y1 = years[0];

  return {
    years,
    after_tax_irr_propco: calculateIRR(flowsPropco),
    after_tax_irr_household: calculateIRR(flowsHousehold),
    year1_federal_shield: y1 && y1.federal_tax < 0 ? -y1.federal_tax : 0,
    year1_state_shield: y1 && y1.state_tax < 0 ? -y1.state_tax : 0,
    pal_carryforward_at_exit: palCFFed, // a 1031 is NOT a fully-taxable disposition — PALs stay suspended
    deferred_gain_memo: {
      deferred_gain: deferredGain,
      accumulated_federal_depreciation: accumFedDep,
      sec1250_depreciation: accumFed1250,
      sec1245_depreciation: accumFed1245,
      adjusted_basis_at_exit: adjustedBasis,
    },
  };
}
