/**
 * Maps the app's deal + scenarios into the SDA template's input cells.
 *
 * The SDA is driven entirely by its "Scenarios" sheet: each of the 8 built-in
 * columns (D, G, J, M, P, S, V, Y) is an independent mini-underwrite, and
 * `Summary!G3` selects which one feeds the detailed P&L / Returns / Exit / One-Pager
 * sheets via `CHOOSE(...)`. So to render our underwriting in the exact SDA we:
 *   1. Write up to 4 of our scenarios into columns D/G/J/M (the first four:
 *      "Marketing Package / My Version / Projected / Offer"), each as year-1 inputs.
 *   2. Point `Summary!G3` at the active scenario so the multi-year model computes
 *      off it, while all 4 sit side-by-side on the Scenarios tab.
 *   3. Set the handful of global knobs that don't live per-column: sale year, the
 *      exit-cap escalation, and the income/expense escalators on the P&L sheet.
 *
 * The SDA applies its OWN annual escalators across the 10-year P&L, so we feed
 * year-1 (pre-growth) figures and set the escalators; year 1 matches the app exactly
 * and later years track the same growth assumptions.
 */
import type { ScenarioInputs, UnderwritingResult } from "./underwriting";
import type { ScenarioType } from "./constants";
import type { SdaSheetWrite, SdaCellValue } from "./sda-template-fill";

export interface SdaScenarioColumnInput {
  name: string;
  type: ScenarioType;
  inputs: ScenarioInputs;
  result: UnderwritingResult;
  units: number;
}

// The four scenario input columns on the SDA "Scenarios" sheet.
const COLS = ["D", "G", "J", "M"] as const;

/**
 * Order scenarios to match the SDA's four column headers
 * (Marketing Package → My Version → Projected → Offer), then anything else.
 */
export function orderScenariosForSda<T extends { type: ScenarioType }>(scenarios: T[]): T[] {
  const priority: Record<string, number> = { marketing: 0, current: 1, base: 2, renovation: 3 };
  return [...scenarios].sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9));
}

/** Build all input-cell writes for the SDA template from the ordered scenario columns. */
export function buildSdaWrites(columns: SdaScenarioColumnInput[], activeIndex: number): SdaSheetWrite[] {
  const cols = columns.slice(0, 4);
  const active = cols[activeIndex] ?? cols[0];

  const scenarioCells: Record<string, SdaCellValue> = {};
  cols.forEach((col, i) => {
    const L = COLS[i];
    const m = col.result.metrics;
    const a0 = col.result.annual[0];
    const ob = a0.opex_breakdown;
    const price = m.purchase_price;
    const units = col.units || 1;
    const downFrac = price > 0 ? Math.max(0, Math.min(1, 1 - m.loan_amount / price)) : 0.25;

    Object.assign(scenarioCells, {
      [`${L}3`]: col.name, // column header label
      [`${L}6`]: price, // Asking Price
      [`${L}7`]: price, // Purchase (override the copy-forward formula)
      [`${L}8`]: units, // # Units
      [`${L}10`]: downFrac, // Down payment %  →  loan = price − down = m.loan_amount
      [`${L}12`]: col.inputs.financing.io_period_months ?? 0, // Interest Only (months)
      [`${L}15`]: 0, // Operating Reserves (carried in the app's equity, not itemized here)
      [`${L}21`]: a0.gpr, // Gross Potential Rent (annual)
      [`${L}22`]: -a0.vacancy_loss, // − Vacancy (dollars; the sheet derives the %)
      [`${L}23`]: -(a0.bad_debt + a0.concessions), // − Concessions / Loss-to-Lease / Bad Debt
      [`${L}25`]: a0.other_income, // Other Income
      // Expense lines (rows 29–41) mapped from our opex breakdown; unmapped SDA
      // lines (Advertising, Legal, Trash, Water/Sewer) stay 0 — the mapped lines
      // already sum to our total operating expenses.
      [`${L}29`]: 0, // Advertising
      [`${L}30`]: ob.contract_services, // Contract Services
      [`${L}31`]: ob.utilities, // Gas & Electric (all utilities)
      [`${L}32`]: ob.admin_legal_marketing, // General / Admin
      [`${L}33`]: ob.insurance, // Insurance
      [`${L}34`]: 0, // Legal
      [`${L}35`]: ob.property_tax, // Real Estate Taxes
      [`${L}36`]: 0, // Trash Removal
      [`${L}37`]: ob.management_fees, // Management Fee
      [`${L}38`]: ob.payroll, // Payroll
      [`${L}39`]: ob.repairs_maintenance, // Repairs & Maintenance
      [`${L}40`]: ob.turnover, // Turnover
      [`${L}41`]: 0, // Water & Sewer
      [`${L}53`]: col.inputs.financing.interest_rate, // Interest Rate
      [`${L}54`]: col.inputs.financing.amortization_years, // Amortization (years)
      [`${L}60`]: m.going_in_cap, // Market Cap Rate (current) — drives FMV and the exit base
    });
  });

  // Kill the template's $250/unit rule-of-thumb replacement reserve so the SDA's
  // NOI matches ours (our reserves sit below NOI, not in operating expenses).
  scenarioCells["AE42"] = 0;

  // Global (single-deal) knobs, driven by the active scenario.
  const am = active.result.metrics;
  const hold = active.inputs.exit.hold_period_years;
  const goingIn = am.going_in_cap;
  const exitCap = active.inputs.exit.exit_cap_rate;
  // Exit cap = current cap + bump × years. Solve the per-year bump so the SDA's
  // exit cap lands on the scenario's exit cap.
  const capBump = hold > 0 ? Math.max(0, (exitCap - goingIn) / hold) : 0;

  const summaryCells: Record<string, SdaCellValue> = {
    G3: activeIndex + 1, // "Populate with scenario #"
  };
  const exitCells: Record<string, SdaCellValue> = {
    D5: hold, // Sale / Disposition at end of year
    I9: capBump, // Cap-rate increase per year (var_capRateBump)
  };
  const pnlCells: Record<string, SdaCellValue> = {
    F6: active.inputs.revenue.rent_growth_rate, // Annual Income Escalator (Yr2+; later years inherit)
    F7: active.inputs.expenses.expense_escalation_rate, // Annual Expense Escalator
  };

  return [
    { sheet: "Scenarios", cells: scenarioCells },
    { sheet: "Summary", cells: summaryCells },
    { sheet: "Exit Strategy", cells: exitCells },
    { sheet: "P&L", cells: pnlCells },
  ];
}
