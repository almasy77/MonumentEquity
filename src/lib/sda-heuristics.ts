/**
 * Michael Blank "Syndicated Deal Analyzer" (SDA) rules of thumb.
 *
 * These are the benchmark assumptions and deal-readiness thresholds baked into
 * the SDA template (the "Rules of Thumb" columns on the Scenarios sheet and the
 * thresholds on the hidden Variables sheet). They drive the SDA export's default
 * assumptions and the Deal Readiness dashboard. Sources are the SDA v2.9.4
 * template cells noted per entry.
 */

// ── Acquisition / financing defaults (SDA Scenarios + Summary) ──
export const SDA_ACQUISITION_DEFAULTS = {
  down_payment_pct: 0.25, // Scenarios D10
  earnest_money_pct: 0.01, // Summary C8 (EMD = 1% of price)
  acquisition_fee_pct: 0.02, // Summary C19 (2% of purchase price)
  interest_rate: 0.05, // Scenarios D53
  amortization_years: 30, // Scenarios D54
  closing_cost_note: "See Acquisition Costs sheet — title, legal, lender, escrows.",
} as const;

// ── Income rules of thumb (SDA Scenarios I22/I23, 2-Minute Analysis) ──
export const SDA_INCOME_DEFAULTS = {
  vacancy_rate: 0.10, // Scenarios I22 (economic + physical vacancy rule of thumb)
  concessions_ltl_baddebt_rate: 0.05, // Scenarios I23 (concessions + loss-to-lease + bad debt)
  economic_physical_vacancy_2min: 0.10, // 2-Minute Analysis C5
  expense_ratio_rule: 0.50, // 2-Minute Analysis C8 / manual override default
  market_cap_rate: 0.07, // Scenarios D60 / 2-Minute Analysis C12
} as const;

/**
 * Operating expense benchmarks. `per_unit` is $/unit/year unless noted;
 * `pct_of` expresses the SDA's percent-based rules. Exactly one of the fields is
 * the SDA's primary rule; the others are documented alternates.
 */
export const SDA_EXPENSE_RULES: {
  key: string;
  label: string;
  per_unit?: number;
  pct_of?: { rate: number; base: "sales_price" | "gross_income" | "egi" };
  note: string;
}[] = [
  { key: "real_estate_taxes", label: "Real Estate Taxes", pct_of: { rate: 0.01, base: "sales_price" }, note: "1% of sales price (verify against the actual assessment — see the app's tax model)" },
  { key: "insurance", label: "Insurance", per_unit: 400, pct_of: { rate: 0.007, base: "sales_price" }, note: "$400–450/unit or 0.7% of sales price" },
  { key: "management_fee", label: "Management Fee", pct_of: { rate: 0.06, base: "egi" }, note: "5–10% of gross income (6% typical)" },
  { key: "repairs_maintenance", label: "Repairs & Maintenance", per_unit: 1000, pct_of: { rate: 0.10, base: "gross_income" }, note: "10% of gross income or ~$1,000/unit" },
  { key: "contract_services", label: "Contract Services", per_unit: 200, note: "$200/unit/year" },
  { key: "trash_removal", label: "Trash Removal", per_unit: 200, note: "$200/unit/year" },
  { key: "water_sewer", label: "Water & Sewer", per_unit: 400, note: "$400–500/unit/year" },
  { key: "gas", label: "Gas", per_unit: 1200, note: "$100/unit/month if owner-paid" },
  { key: "electric", label: "Electric (common)", per_unit: 100, note: "$100/unit for common areas" },
  { key: "legal", label: "Legal", per_unit: 150, note: "$150/unit/year" },
  { key: "replacement_reserves", label: "Replacement Reserves", per_unit: 250, note: "$250/unit/year (deposit to reserve)" },
  { key: "payroll", label: "Payroll", note: "~1 FT leasing + 1 FT maintenance per 100 units — confirm with the property manager" },
];

// ── Syndication / partnership defaults (SDA Summary D41–D45, P&L waterfall) ──
export const SDA_SYNDICATION_DEFAULTS = {
  lp_equity_pct: 0.80, // Summary D41 (Member Equity)
  gp_equity_pct: 0.20, // Summary D42 (Manager Equity) = 1 − LP
  preferred_return_rate: 0.08, // Summary D43 (template ships 0; 8% is the common pref)
  asset_management_fee_pct: 0.02, // Summary D44 (% of EGI; template ships 0, 2% typical)
  capital_transaction_fee_pct: 0.0, // Summary D45 (on refi/sale; template ships 0)
  // Promote: the split of EXCESS cash flow and sale profit. SDA defaults these to
  // the equity split (80/20); a true promote can differ.
  lp_excess_split: 0.80,
} as const;

// ── Exit / disposition defaults (SDA Exit Strategy) ──
export const SDA_EXIT_DEFAULTS = {
  hold_years: 5, // Exit Strategy D5 (Sale year) — "investors want their money back after 5 years"
  cap_rate_bump_per_year: 0.001, // Exit Strategy I9 (exit cap = going-in cap + 0.1%/yr)
  refi_ltv: 0.65, // Exit Strategy D11
  refi_cost_pct: 0.01, // Exit Strategy C16
  refi_term_years: 25, // Exit Strategy D13
  sales_cost_pct_small: 0.04, // Exit Strategy G13 (<$2M sale price)
  sales_cost_pct_large: 0.03, // >= $2M
  op_reserves_returned_pct: 0.50, // Exit Strategy I11 (remaining reserves returned at sale)
} as const;

/** Deal-readiness thresholds (hidden Variables sheet). Value-add vs stable. */
export interface DealReadinessThreshold {
  key: string;
  label: string;
  value_add: number;
  stable: number;
  unit: "ratio" | "pct" | "usd_per_unit" | "usd";
  direction: "min"; // all SDA thresholds are minimums
  message_under: string;
}

export const SDA_DEAL_READINESS: DealReadinessThreshold[] = [
  { key: "dcr", label: "Debt Coverage Ratio (Yr 1)", value_add: 1.25, stable: 1.25, unit: "ratio", direction: "min", message_under: "DCR is low — should be ≥ 1.25 in year 1 to qualify for financing." },
  { key: "aar", label: "Average Annual Return", value_add: 0.15, stable: 0.13, unit: "pct", direction: "min", message_under: "AAR is low — should be ≥ 15% (value-add) / 13% (stable) to sell the deal to investors." },
  { key: "irr", label: "IRR", value_add: 0.14, stable: 0.12, unit: "pct", direction: "min", message_under: "IRR is low — should be ≥ 14% (value-add) / 12% (stable)." },
  { key: "expense_ratio", label: "Expense Ratio", value_add: 0.50, stable: 0.50, unit: "pct", direction: "min", message_under: "Expenses look low — should be ≥ 50% of total net income (conservative)." },
  { key: "return_of_capital", label: "Return of Capital % (refi)", value_add: 0.60, stable: 0.60, unit: "pct", direction: "min", message_under: "Capital returned to investors is low — return ≥ 60% or a refinance isn't worth it." },
  { key: "avg_coc", label: "Average Cash-on-Cash", value_add: 0.07, stable: 0.07, unit: "pct", direction: "min", message_under: "Average cash-on-cash is low — should be ≥ 7% over the life of the investment." },
  { key: "reserves_per_unit", label: "Replacement Reserves / unit / yr", value_add: 250, stable: 250, unit: "usd_per_unit", direction: "min", message_under: "Replacement reserves should be ≥ $250/unit/year in the P&L." },
];

export type DealProfile = "value_add" | "stable";

/** Evaluate a metric against its SDA threshold for the given deal profile. */
export function evaluateReadiness(
  key: string,
  actual: number,
  profile: DealProfile,
): { threshold: DealReadinessThreshold; target: number; pass: boolean } | null {
  const threshold = SDA_DEAL_READINESS.find((t) => t.key === key);
  if (!threshold) return null;
  const target = profile === "value_add" ? threshold.value_add : threshold.stable;
  return { threshold, target, pass: actual >= target };
}
