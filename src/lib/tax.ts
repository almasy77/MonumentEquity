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

import { calculateAnnualXIRR } from "./irr";
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
  // Taxable-exit rates (only used when exit_via_1031 === false). Optional +
  // defaulted for backwards compatibility (older saved scenarios omit them).
  federal_ltcg_rate?: number; // long-term capital-gains rate on the residual gain, default 0.20
  sec1250_recapture_rate?: number; // unrecaptured §1250 gain rate, default 0.25
  // cost-seg study fee tax treatment (the fee itself lives in uses-of-funds as
  // purchase.cost_seg_study_cost). expense_year1 = §162 professional fee
  // deducted in full in Year 1 (default); capitalize_amortize = 15-yr SL.
  cost_seg_fee_tax_treatment?: "expense_year1" | "capitalize_amortize";
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
  federal_ltcg_rate: 0.2,
  sec1250_recapture_rate: 0.25,
  cost_seg_fee_tax_treatment: "expense_year1",
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

/**
 * Fully-taxable exit (exit_via_1031 === false). Recapture + capital-gain
 * waterfall computed at sale. Populated ONLY on the taxable path; undefined
 * when the exit is a 1031 (where deferred_gain_memo carries the memo instead).
 */
export interface ExitTax {
  total_gain: number; // max(0, exitValue − sellingCosts − adjustedBasis)
  sec1245_recapture: number; // ordinary recapture on 5-yr personal property (before PAL offset)
  sec1250_unrecaptured: number; // unrecaptured §1250 gain, taxed at 25% (before PAL offset)
  ltcg_gain: number; // residual long-term capital gain, taxed at 20% (before PAL offset)
  pal_released: number; // suspended passive losses applied against the gain at disposition
  niit: number; // 3.8% on the post-PAL §1250 + LTCG bases (only when exit-year REPS is OFF)
  state_tax: number; // state tax on the post-PAL taxable gain (taxed as ordinary)
  federal_tax: number; // §1245 + §1250 + LTCG + NIIT federal components
  total_exit_tax: number; // federal_tax + state_tax, floored at 0
  after_tax_net_sale_proceeds: number; // ctx.netSaleProceeds − total_exit_tax
}

export interface TaxResult {
  years: TaxYearRow[];
  after_tax_irr_propco: number | null;
  after_tax_irr_household: number | null;
  year1_federal_shield: number; // positive $ benefit in year 1 (0 if REPS off)
  year1_state_shield: number;
  cost_seg_fee_deduction_total: number; // total study-fee deduction taken over the hold
  cost_seg_fee_shield: number; // memo: that deduction × combined ordinary rate (gate-open reference)
  pal_carryforward_at_exit: number; // NOT released by the 1031 — deferred value
  deferred_gain_memo: DeferredGainMemo;
  // Populated only on the fully-taxable exit path (exit_via_1031 === false);
  // undefined on the 1031 path, which keeps deferred_gain_memo as its exit story.
  exit_tax?: ExitTax;
  // Realized value of the depreciation deductions = tax with depreciation minus
  // tax without it, per year. Respects REPS/§461(l)/PAL usability (suspended
  // years contribute ~0). Undefined only in the internal suppressed run.
  depreciation_shield?: DepreciationShield;
}

export interface DepreciationShield {
  by_year: number[]; // tax saved by depreciation each year (positive = savings)
  year1: number; // first-year shield (the cost-seg / bonus spike)
  total: number; // cumulative realized shield over the hold
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
  returnOfOperatingReserve: number; // recoverable reserve returned at exit (return of capital — non-taxable)
  exitValue: number;
  sellingCosts: number;
  originationFee: number;
  // Cash-out refinance (item 2), if any. Proceeds are non-taxable debt (added to
  // after-tax cash flow, not income); the prepay penalty is deductible in the
  // refi year; the refi cost amortizes over the new loan term. Post-refi interest
  // is already reflected in ctx.annual[].interest_paid.
  refi?: {
    year: number;
    netProceeds: number;
    prepayPenalty: number;
    cost: number;
    loanTermYears: number;
  };
}

export function computeTaxLayer(
  inputs: ScenarioInputs,
  ctx: TaxLayerContext,
  // Internal: when true, zero the depreciation deductions so the caller (this
  // same function, one level down) can measure depreciation's realized tax value
  // as the with-minus-without tax delta — automatically gated by REPS/§461(l)/PAL.
  opts?: { suppressDepreciation?: boolean },
): TaxResult {
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

  // Cost-seg study FEE deduction (operating-reserve-return spec Part 2):
  // §162 professional fee. expense_year1 → full deduction in Year 1; or 15-yr
  // straight-line if capitalize_amortize. NOT added to depreciable basis (it's
  // the cost of the study, not the building) and NOT in NOI — the cash already
  // sits in uses-of-funds. Runs through the SAME usability gate as depreciation
  // because it lands inside taxable income below.
  const costSegFee = purchase.cost_seg_study_cost || 0;
  const costSegTreatment = tax.cost_seg_fee_tax_treatment ?? "expense_year1";
  const costSegFeeDeductionForYear = (y: number): number =>
    costSegTreatment === "capitalize_amortize"
      ? (y <= 15 ? costSegFee / 15 : 0)
      : (y === 1 ? costSegFee : 0);
  let costSegFeeDeductedTotal = 0;

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
  // Refi cost amortizes straight-line over the new loan term (same treatment as
  // the origination fee); prepay penalty is a one-time deduction in the refi year.
  const refiCostAnnual = ctx.refi ? ctx.refi.cost / Math.max(1, ctx.refi.loanTermYears) : 0;

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

    // Financing amortization: straight-line over the loan term, capped at the fee
    // (so a hold that outruns the loan term can't amortize past 100%), with the
    // remaining balance expensed in the exit year on payoff.
    const isExitYear = y === holdYears;
    const amortizedBefore = Math.min(ctx.originationFee, finAmortAnnual * (y - 1));
    const finAmort = isExitYear
      ? Math.max(0, ctx.originationFee - amortizedBefore)
      : Math.max(0, Math.min(finAmortAnnual, ctx.originationFee - amortizedBefore));

    // Year-1 deductions: prepaids/prorations. The cost-seg study fee is a
    // separate deduction line (Year-1 or amortized) folded into taxable income
    // alongside depreciation so it runs through the same gate.
    const prepaids = y === 1 ? prepaidDeductionY1 : 0;
    const costSegFeeDed = costSegFeeDeductionForYear(y);
    costSegFeeDeductedTotal += costSegFeeDed;
    const capexExpDeduction = capexExpensed;

    // Refi deductions (item 2): prepay penalty in the refi year + refi-cost
    // amortization from the refi year onward (remainder expensed at exit).
    let refiDed = 0;
    if (ctx.refi && y >= ctx.refi.year) {
      if (y === ctx.refi.year) refiDed += ctx.refi.prepayPenalty;
      const amortizedBeforeRefi = Math.min(ctx.refi.cost, refiCostAnnual * (y - ctx.refi.year));
      refiDed += isExitYear
        ? Math.max(0, ctx.refi.cost - amortizedBeforeRefi)
        : Math.max(0, Math.min(refiCostAnnual, ctx.refi.cost - amortizedBeforeRefi));
    }

    // Taxable income (§4): NOI − interest − dep − fin amort − prepaids − study fee − expensed repairs − refi deductions.
    // depFed/depState are zeroed in the suppress-depreciation run (shield measurement).
    const depFed = opts?.suppressDepreciation ? 0 : fedDep;
    const depState = opts?.suppressDepreciation ? 0 : stateDep;
    const tiFed = a.noi - a.interest_paid - depFed - finAmort - prepaids - costSegFeeDed - capexExpDeduction - refiDed;
    const tiState = a.noi - a.interest_paid - depState - finAmort - prepaids - costSegFeeDed - capexExpDeduction - refiDed;

    // ── Federal loss routing: REPS → §461(l) → NOL ──
    // NOL carried INTO this year (from prior years) is release-eligible now via
    // the one-year lag below. Capture it before this year's excess is added, so
    // a fresh §461(l) overflow is NOT released in the same year it is created
    // (which would defeat the EBL cap entirely).
    const nolOpening = nolCF;
    let fedTax = 0;
    let niitBase = 0; // §1411 net investment income (set post-PAL in the positive branch)
    if (tiFed < 0) {
      const loss = -tiFed;
      if (repsOn) {
        const allowed = Math.min(loss, tax.ebl_cap_mfj);
        nolCF += loss - allowed; // this year's excess — waits until next year
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
      // §1411 net investment income for NIIT: rental income NET of passive losses,
      // but BEFORE the NOL deduction (NOLs don't reduce NII).
      niitBase = ti;
      // NOL: usable against ≤80% of taxable income — household W-2 (~$1.5M)
      // makes the limit non-binding, so the NOL releases in full (simplification).
      const nolUsed = Math.min(nolCF, ti);
      nolCF -= nolUsed;
      ti -= nolUsed;
      fedTax = ti * fedRate;
    }
    // Release the PRIOR-year NOL against household W-2 the year AFTER it arises
    // (80% of household TI >> NOL). Only the balance carried INTO this year is
    // eligible; this year's fresh §461(l) excess (added above) waits until next
    // year, so the EBL cap actually limits the current-year shield.
    if (y > 1) {
      const releasable = Math.min(nolOpening, nolCF);
      if (releasable > 0) {
        fedTax -= releasable * fedRate;
        nolCF -= releasable;
      }
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

    // NIIT: positive net investment income (after passive-loss offset), only when
    // REPS is OFF (§4). Uses the post-PAL base, not raw taxable income, so income
    // absorbed by released passive losses isn't taxed.
    const niit = !repsOn && niitBase > 0 ? niitBase * tax.niit_rate : 0;

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

  // ── Exit (§7) ──
  const capitalizedCapex = vintages.reduce((s, v) => s + v.c5 + v.c275, 0);
  const adjustedBasis = totalCostBasis + capitalizedCapex - accumFedDep;
  const deferredGain = Math.max(0, ctx.exitValue - ctx.sellingCosts - adjustedBasis);

  // Fully-taxable exit (exit_via_1031 === false): model depreciation recapture +
  // capital gains + NIIT + state. On the 1031 path this whole block is skipped and
  // exitTax stays undefined — the exit proceeds land pre-tax exactly as before, so
  // the 1031 output is byte-identical to the prior behavior.
  let exitTax: ExitTax | undefined;
  // Default: pre-tax proceeds (the 1031 treatment). Overwritten below on the taxable path.
  let exitNetSaleProceeds = ctx.netSaleProceeds;
  if (!tax.exit_via_1031) {
    const ltcgRate = tax.federal_ltcg_rate ?? 0.2;
    const sec1250Rate = tax.sec1250_recapture_rate ?? 0.25;

    // 1. Total gain over the depreciation-adjusted basis, net of selling costs.
    const totalGain = Math.max(0, ctx.exitValue - ctx.sellingCosts - adjustedBasis);

    // 2. §1245 ordinary recapture on 5-yr personal property. If the personal
    //    property is assumed worthless at sale, it is treated as sold for $0 →
    //    no §1245 recapture. Otherwise recapture the lesser of accumulated 5-yr
    //    depreciation and the total gain, taxed at the ordinary rate.
    const sec1245Recapture = tax.personal_property_worthless_at_exit
      ? 0
      : Math.min(accumFed1245, totalGain);

    // 3. Unrecaptured §1250 gain (real property depreciation): the lesser of
    //    accumulated 27.5-yr + 15-yr depreciation and the gain remaining after
    //    §1245, taxed at the §1250 recapture rate (25%).
    const unrecap1250 = Math.min(accumFed1250, Math.max(0, totalGain - sec1245Recapture));

    // 4. Residual long-term capital gain, taxed at the LTCG rate (20%).
    const ltcgGain = Math.max(0, totalGain - sec1245Recapture - unrecap1250);

    // 5. PAL release. A fully-taxable disposition frees the suspended passive
    //    losses. They are applied against the taxable gain BEFORE tax, in the
    //    order that maximizes the benefit to the taxpayer: ordinary §1245 first
    //    (highest rate), then §1250 (25%), then LTCG (20%). Each taxed base is
    //    reduced accordingly and floored at 0.
    //    Simplification (documented): only the portion of suspended PAL up to the
    //    gain is credited here. Any PAL beyond the gain would, in reality, release
    //    as an ordinary deduction usable against other income (e.g. W-2); we do
    //    NOT credit that excess, which keeps the exit tax conservatively ≥ 0 and
    //    avoids importing a household-income assumption into the sale year.
    let palRemaining = palCFFed;
    const palVs1245 = Math.min(palRemaining, sec1245Recapture);
    palRemaining -= palVs1245;
    const taxed1245 = sec1245Recapture - palVs1245;

    const palVs1250 = Math.min(palRemaining, unrecap1250);
    palRemaining -= palVs1250;
    const taxed1250 = unrecap1250 - palVs1250;

    const palVsLtcg = Math.min(palRemaining, ltcgGain);
    palRemaining -= palVsLtcg;
    const taxedLtcg = ltcgGain - palVsLtcg;

    const palReleased = palCFFed - palRemaining; // amount actually applied to the gain

    // 6. NIIT (3.8%) on the capital-gain portions remaining after PAL offset —
    //    the §1250 + LTCG bases, NOT the §1245 ordinary portion. Gated the SAME
    //    way operating NIIT is gated in this file: it applies only when REPS is
    //    OFF (§1411 net investment income). We mirror that using the exit-year
    //    REPS status. Assumption (documented): a REPS-material-participation exit
    //    year shields the gain from NIIT, consistent with the operating treatment.
    const exitReps = repsForYear(holdYears);
    const niitExitBase = taxed1250 + taxedLtcg;
    const niitExit = !exitReps && niitExitBase > 0 ? niitExitBase * tax.niit_rate : 0;

    // 7. State tax. Most states (incl. NY/NYC) tax the whole gain as ordinary
    //    income with no preferential capital-gains rate, so we apply the ordinary
    //    state rate to the full post-PAL taxable gain. Simplification (documented):
    //    state bonus/§1250 conformity nuances are not separately modeled here.
    const postPalGain = taxed1245 + taxed1250 + taxedLtcg;
    const stateExitTax = postPalGain * stateRate;

    // 8. Assemble. Each component is non-negative, so the sum is ≥ 0; we still
    //    floor to be explicit (the excess-PAL ordinary benefit above is not
    //    credited, so nothing here can drive the total negative).
    const federalExitTax = taxed1245 * fedRate + taxed1250 * sec1250Rate + taxedLtcg * ltcgRate + niitExit;
    const totalExitTax = Math.max(0, federalExitTax + stateExitTax);

    // 9. After-tax net sale proceeds feed the after-tax IRR final period.
    exitNetSaleProceeds = ctx.netSaleProceeds - totalExitTax;

    exitTax = {
      total_gain: totalGain,
      sec1245_recapture: sec1245Recapture,
      sec1250_unrecaptured: unrecap1250,
      ltcg_gain: ltcgGain,
      pal_released: palReleased,
      niit: niitExit,
      state_tax: stateExitTax,
      federal_tax: federalExitTax,
      total_exit_tax: totalExitTax,
      after_tax_net_sale_proceeds: exitNetSaleProceeds,
    };
  }

  // After-tax IRRs: equity out, after-tax CFs, exit proceeds in the final year.
  // 1031 path → pre-tax proceeds (exitNetSaleProceeds === ctx.netSaleProceeds).
  // Taxable path → after-tax proceeds (net of the exit tax computed above).
  // Exit proceeds + return of the operating reserve (return of capital —
  // non-taxable) land in the final period of both after-tax IRRs.
  // Refi cash-out proceeds — non-taxable debt — land in the refi year of both
  // after-tax IRRs (the tax benefit of the prepay/refi-cost deductions is already
  // inside atcf via reduced tax; here we add the cash itself).
  if (ctx.refi) {
    atcfPropco[ctx.refi.year - 1] += ctx.refi.netProceeds;
    atcfHousehold[ctx.refi.year - 1] += ctx.refi.netProceeds;
  }
  const flowsPropco = [-ctx.totalEquity, ...atcfPropco];
  flowsPropco[flowsPropco.length - 1] += exitNetSaleProceeds + ctx.returnOfOperatingReserve;
  const flowsHousehold = [-ctx.totalEquity, ...atcfHousehold];
  flowsHousehold[flowsHousehold.length - 1] += exitNetSaleProceeds + ctx.returnOfOperatingReserve;

  // ── Realized depreciation shield ── re-run with depreciation zeroed and take
  // the per-year tax delta. One level of recursion only (the suppressed run does
  // not recurse). Skipped in the suppressed run itself.
  let depreciationShield: DepreciationShield | undefined;
  if (!opts?.suppressDepreciation) {
    const noDep = computeTaxLayer(inputs, ctx, { suppressDepreciation: true });
    const byYear = years.map((ty, i) => {
      const withDep = ty.federal_tax + ty.state_tax + ty.niit;
      const n = noDep.years[i];
      const withoutDep = n ? n.federal_tax + n.state_tax + n.niit : 0;
      return withoutDep - withDep; // positive = tax saved by depreciation
    });
    depreciationShield = {
      by_year: byYear,
      year1: byYear[0] ?? 0,
      total: byYear.reduce((s, v) => s + v, 0),
    };
  }

  const y1 = years[0];

  return {
    years,
    depreciation_shield: depreciationShield,
    after_tax_irr_propco: calculateAnnualXIRR(flowsPropco),
    after_tax_irr_household: calculateAnnualXIRR(flowsHousehold),
    year1_federal_shield: y1 && y1.federal_tax < 0 ? -y1.federal_tax : 0,
    year1_state_shield: y1 && y1.state_tax < 0 ? -y1.state_tax : 0,
    cost_seg_fee_deduction_total: costSegFeeDeductedTotal,
    // Memo (gate-open reference): the fee deduction × the combined ordinary
    // rate. The ACTUAL benefit is already inside the after-tax IRR, gated by
    // REPS/§461(l) like the depreciation shield.
    cost_seg_fee_shield: costSegFeeDeductedTotal * (fedRate + stateRate),
    pal_carryforward_at_exit: palCFFed, // a 1031 is NOT a fully-taxable disposition — PALs stay suspended
    deferred_gain_memo: {
      deferred_gain: deferredGain,
      accumulated_federal_depreciation: accumFedDep,
      sec1250_depreciation: accumFed1250,
      sec1245_depreciation: accumFed1245,
      adjusted_basis_at_exit: adjustedBasis,
    },
    exit_tax: exitTax, // undefined on the 1031 path; the taxable-exit breakdown otherwise
  };
}
