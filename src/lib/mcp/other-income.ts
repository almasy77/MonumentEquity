/**
 * `other_income_items: [{label, monthly}]` → the engine's itemized other income.
 *
 * The engine already supports any number of lines via
 * `revenue_assumptions.other_income.line_items` (it supersedes the single
 * `other_income_monthly` number, sub-lines and the RUBS knob). This helper is the
 * connector-friendly spelling of that, mirroring what the underwriting form does when
 * its "itemize" panel is opened: write the lines, keep `other_income_monthly` equal
 * to their sum, and clear the superseded sub-lines / RUBS knob.
 */
export interface OtherIncomeItemInput {
  label: string;
  monthly: number;
  /** false = one-time / in-period only; excluded from exit value. Default true. */
  recurring?: boolean;
}

export function applyOtherIncomeItems(
  revenue: Record<string, unknown>,
  items: OtherIncomeItemInput[]
): Record<string, unknown> {
  const line_items = items.map((i) => ({
    label: i.label,
    kind: "flat" as const,
    monthly_amount: i.monthly,
    entry_period: "mo" as const,
    recurring: i.recurring ?? true,
  }));
  const monthly = Math.round(items.reduce((s, i) => s + i.monthly, 0) * 100) / 100;
  return {
    ...revenue,
    other_income: { line_items },
    other_income_monthly: monthly,
    other_income_sublines: undefined,
    rubs: undefined,
  };
}
