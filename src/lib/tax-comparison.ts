/**
 * Cost-seg / REPS side-by-side. Re-runs the full engine on variants of the
 * scenario's tax assumptions so the user can see what a cost segregation study
 * is worth with and without Real Estate Professional Status, against no study.
 *
 * This is a READ-ONLY lens: it never mutates the scenario, and the scenario's
 * own (as-modeled) result is unchanged by its existence. Hurdles stay tested on
 * pre-tax IRR; after-tax is shown alongside.
 *
 * Variants
 *  - as_modeled        the scenario exactly as saved
 *  - no_cost_seg       no reclassification (5-yr, 15-yr, reno 5-yr = 0) and no
 *                      study fee; everything depreciates 27.5-yr. REPS as saved.
 *  - cost_seg_reps     cost-seg percentages, REPS ON every hold year
 *  - cost_seg_no_reps  cost-seg percentages, REPS OFF every hold year (losses
 *                      suspended as passive)
 *
 * When the saved scenario has no cost-seg reclass (both pcts 0), the cost-seg
 * variants fall back to TAX_DEFAULTS percentages so the comparison still shows
 * a study's effect.
 */
import { calculateUnderwriting, type ScenarioInputs } from "./underwriting";
import { TAX_DEFAULTS, type TaxAssumptions } from "./tax";

export type TaxComparisonKey = "as_modeled" | "no_cost_seg" | "cost_seg_reps" | "cost_seg_no_reps";

export interface TaxComparisonRow {
  key: TaxComparisonKey;
  label: string;
  pre_tax_irr: number | null;
  after_tax_irr_household: number | null;
  year1_depreciation_shield: number;
  total_depreciation_shield: number;
  exit_tax: number | null; // null on a 1031 exit (taxes deferred)
  deferred_gain: number | null; // populated on a 1031 exit
  pal_at_exit: number; // suspended passive losses left at exit
  cost_seg_study_cost: number;
}

export interface TaxComparison {
  rows: TaxComparisonRow[];
  exit_via_1031: boolean;
  costseg_5yr_pct: number;
  costseg_15yr_pct: number;
  used_default_pcts: boolean;
}

function run(key: TaxComparisonKey, label: string, inputs: ScenarioInputs): TaxComparisonRow {
  const r = calculateUnderwriting(inputs);
  const t = r.tax;
  return {
    key,
    label,
    pre_tax_irr: r.metrics.irr,
    after_tax_irr_household: t?.after_tax_irr_household ?? null,
    year1_depreciation_shield: t?.depreciation_shield?.year1 ?? 0,
    total_depreciation_shield: t?.depreciation_shield?.total ?? 0,
    exit_tax: t?.exit_tax ? t.exit_tax.total_exit_tax : null,
    deferred_gain: t?.exit_tax ? null : t?.deferred_gain_memo.deferred_gain ?? null,
    pal_at_exit: t?.pal_carryforward_at_exit ?? 0,
    cost_seg_study_cost: inputs.purchase.cost_seg_study_cost ?? 0,
  };
}

export function compareCostSegScenarios(inputs: ScenarioInputs): TaxComparison | null {
  if (!inputs.tax) return null;
  const saved: TaxAssumptions = { ...TAX_DEFAULTS, ...inputs.tax };
  const holdYears = Math.max(1, Math.round(inputs.exit.hold_period_years || 1));

  const hasReclass = saved.costseg_5yr_pct + saved.costseg_15yr_pct > 0;
  const seg5 = hasReclass ? saved.costseg_5yr_pct : TAX_DEFAULTS.costseg_5yr_pct;
  const seg15 = hasReclass ? saved.costseg_15yr_pct : TAX_DEFAULTS.costseg_15yr_pct;

  const withTax = (tax: TaxAssumptions, purchasePatch?: Partial<ScenarioInputs["purchase"]>): ScenarioInputs => ({
    ...inputs,
    purchase: { ...inputs.purchase, ...purchasePatch },
    tax,
  });

  const costSegTax: TaxAssumptions = { ...saved, costseg_5yr_pct: seg5, costseg_15yr_pct: seg15 };

  const rows: TaxComparisonRow[] = [
    run("as_modeled", "As modeled", inputs),
    run(
      "no_cost_seg",
      "No cost seg",
      withTax({ ...saved, costseg_5yr_pct: 0, costseg_15yr_pct: 0, reno_5yr_pct: 0 }, { cost_seg_study_cost: 0 }),
    ),
    run("cost_seg_reps", "Cost seg + REPS", withTax({ ...costSegTax, reps_status: Array(holdYears).fill(true) })),
    run("cost_seg_no_reps", "Cost seg, no REPS", withTax({ ...costSegTax, reps_status: Array(holdYears).fill(false) })),
  ];

  return {
    rows,
    exit_via_1031: saved.exit_via_1031,
    costseg_5yr_pct: seg5,
    costseg_15yr_pct: seg15,
    used_default_pcts: !hasReclass,
  };
}
