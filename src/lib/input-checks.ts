/**
 * Input-plausibility linter — catches DATA-ENTRY mistakes before they turn into a
 * clean-looking wrong number. This is deliberately separate from:
 *   - checks.ts (internal reconciliation: does the model foot?), and
 *   - the engine's warnings (financial-sanity on the COMPUTED result: cap rate,
 *     DSCR, opex ratio, …).
 *
 * These check the RAW INPUTS for the classic six-figure typos:
 *   - a rate typed as a percent instead of a decimal (6.5 vs 0.065),
 *   - a rent typed as annual instead of monthly ($12,000 vs $1,000),
 *   - market rent below current rent (negative value-add), a $0 tax/insurance bill,
 *   - a nonsensical price-per-unit, hold, or amortization.
 *
 * `error` = almost certainly wrong (blocks trust); `warning` = verify. Pure function,
 * so it is unit-tested and can run anywhere (form, API, export).
 */
import type { ScenarioInputs } from "./underwriting";

export interface InputFlag {
  severity: "error" | "warning";
  field: string;
  message: string;
}

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`;

/** Rate fields that must be decimals in [0, 1]. A value > 1 is a percent-vs-decimal typo. */
function rateFields(inp: ScenarioInputs): Array<{ field: string; label: string; value: number | undefined; max?: number }> {
  const f = inp.financing as unknown as Record<string, number | undefined>;
  const r = inp.revenue as unknown as Record<string, number | undefined>;
  const e = inp.expenses as unknown as Record<string, number | undefined>;
  const x = inp.exit as unknown as Record<string, number | undefined>;
  const p = inp.purchase as unknown as Record<string, number | undefined>;
  return [
    { field: "financing.interest_rate", label: "Interest rate", value: f.interest_rate },
    { field: "financing.ltv", label: "LTV", value: f.ltv, max: 1 }, // 100% is the ceiling
    { field: "financing.origination_fee_rate", label: "Origination fee", value: f.origination_fee_rate },
    { field: "revenue.vacancy_rate", label: "Vacancy", value: r.vacancy_rate },
    { field: "revenue.bad_debt_rate", label: "Bad debt", value: r.bad_debt_rate },
    { field: "revenue.concessions_rate", label: "Concessions", value: r.concessions_rate },
    { field: "revenue.rent_growth_rate", label: "Rent growth", value: r.rent_growth_rate },
    { field: "expenses.expense_escalation_rate", label: "Expense escalation", value: e.expense_escalation_rate },
    { field: "expenses.tax_escalation_rate", label: "Tax escalation", value: e.tax_escalation_rate },
    { field: "expenses.management_fee_rate", label: "Management fee", value: e.management_fee_rate },
    { field: "exit.exit_cap_rate", label: "Exit cap rate", value: x.exit_cap_rate },
    { field: "exit.selling_cost_rate", label: "Selling costs", value: x.selling_cost_rate },
    { field: "exit.refi_cap_rate", label: "Refi cap rate", value: x.refi_cap_rate },
    { field: "exit.refi_ltv", label: "Refi LTV", value: x.refi_ltv, max: 1 },
    { field: "exit.refi_interest_rate", label: "Refi interest rate", value: x.refi_interest_rate },
    { field: "purchase.closing_cost_rate", label: "Closing costs", value: p.closing_cost_rate },
  ];
}

export function checkInputPlausibility(inputs: ScenarioInputs, deal?: { units?: number }): InputFlag[] {
  const flags: InputFlag[] = [];
  const add = (severity: InputFlag["severity"], field: string, message: string) => flags.push({ severity, field, message });

  // 1) Rate typed as a percent instead of a decimal (6.5 → should be 0.065).
  for (const { field, label, value, max } of rateFields(inputs)) {
    if (value == null || !Number.isFinite(value)) continue;
    const ceiling = max ?? 1;
    if (value > ceiling) {
      const asDecimal = value / 100;
      add("error", field, `${label} is ${value} — that looks like a percent. Enter ${asDecimal} for ${pct(asDecimal)}.`);
    } else if (value < 0) {
      add("warning", field, `${label} is negative (${value}) — verify.`);
    }
  }

  // 2) Rents that look annual (or mistyped) — monthly residential rent is ~$200–$8,000.
  type UnitRow = { type?: string; current_rent?: number; market_rent?: number; renovated_rent_premium?: number; count?: number; zero_rent_treatment?: string; units?: Array<{ current_rent?: number; zero_rent_treatment?: string }> };
  const units = (inputs.revenue as { unit_mix?: UnitRow[] }).unit_mix ?? [];
  units.forEach((u, i) => {
    const label = u.type || `unit type ${i + 1}`;
    for (const [k, v] of [["current_rent", u.current_rent], ["market_rent", u.market_rent]] as const) {
      if (v == null || v <= 0) continue;
      if (v > 8_000) add("warning", `revenue.unit_mix[${i}].${k}`, `${label} ${k.replace("_", " ")} is $${v.toLocaleString()}/mo — that looks like an annual figure. Enter the MONTHLY rent.`);
      else if (v < 150) add("warning", `revenue.unit_mix[${i}].${k}`, `${label} ${k.replace("_", " ")} is $${v}/mo — unusually low, verify.`);
    }
    // 3) Value-add sanity: market should be ≥ current; renovated premium ≥ 0.
    if (u.current_rent && u.market_rent && u.market_rent < u.current_rent) {
      add("warning", `revenue.unit_mix[${i}].market_rent`, `${label} market rent ($${u.market_rent.toLocaleString()}) is below current rent ($${u.current_rent.toLocaleString()}) — upside is negative, verify.`);
    }
    if ((u.renovated_rent_premium ?? 0) < 0) {
      add("warning", `revenue.unit_mix[${i}].renovated_rent_premium`, `${label} renovated-rent premium is negative — verify.`);
    }
  });

  // VAL-4: a $0 current rent is ambiguous — genuinely vacant, or producing under
  // other terms (STR) and not captured as a monthly LTR rent. Both lease up to
  // market, but the user should DECLARE which so the $0 isn't a silent data gap.
  // Count $0 units (by count) whose treatment is undeclared (undefined/unknown).
  let undeclaredZero = 0;
  units.forEach((u) => {
    const details = u.units ?? [];
    if (details.length > 0) {
      for (const d of details) {
        const declared = d.zero_rent_treatment === "vacant" || d.zero_rent_treatment === "str";
        if ((d.current_rent ?? 0) <= 0 && !declared) undeclaredZero += 1;
      }
    } else if ((u.current_rent ?? 0) <= 0) {
      const declared = u.zero_rent_treatment === "vacant" || u.zero_rent_treatment === "str";
      if (!declared) undeclaredZero += u.count ?? 1;
    }
  });
  if (undeclaredZero > 0) {
    add(
      "warning",
      "revenue.unit_mix.zero_rent_treatment",
      `${undeclaredZero} unit${undeclaredZero === 1 ? "" : "s"} bill $0 — mark each as Vacant or STR / available-at-market so the model knows they lease up to market (they are treated as leasing up to market until you classify them).`,
    );
  }

  // 4) Missing critical expenses (a $0 bill silently inflates NOI).
  const exp = inputs.expenses as unknown as Record<string, number | undefined> & { tax_reassessment?: { enabled?: boolean }; property_tax_v2?: { enabled?: boolean } };
  const hasReassess = !!(exp.tax_reassessment?.enabled || exp.property_tax_v2?.enabled);
  if (!hasReassess && (exp.property_tax_total ?? 0) === 0) add("warning", "expenses.property_tax_total", "Property taxes are $0 — verify (this inflates NOI and value).");
  if ((exp.insurance_per_unit ?? 0) === 0) add("warning", "expenses.insurance_per_unit", "Insurance is $0 — verify.");

  // 5) Price-per-unit sanity.
  const price = (inputs.purchase as { purchase_price?: number }).purchase_price ?? 0;
  const nUnits = deal?.units ?? units.reduce((s, u) => s + (u.count ?? 0), 0);
  if (price > 0 && nUnits > 0) {
    const ppu = price / nUnits;
    if (ppu < 15_000) add("warning", "purchase.purchase_price", `Price per unit is $${Math.round(ppu).toLocaleString()} — unusually low, verify units/price.`);
    else if (ppu > 750_000) add("warning", "purchase.purchase_price", `Price per unit is $${Math.round(ppu).toLocaleString()} — unusually high, verify units/price.`);
  }

  // 6) Hold / amortization plausibility.
  const hold = (inputs.exit as { hold_period_years?: number }).hold_period_years ?? 0;
  if (hold <= 0) add("error", "exit.hold_period_years", "Hold period must be at least 1 year.");
  else if (hold > 30) add("warning", "exit.hold_period_years", `Hold period is ${hold} years — verify.`);
  const amort = (inputs.financing as { amortization_years?: number }).amortization_years ?? 0;
  if (amort > 0 && (amort < 5 || amort > 40)) add("warning", "financing.amortization_years", `Amortization is ${amort} years — verify (typical 25–30).`);

  // 7) Exit valuation is undefined without a cap rate or an explicit price.
  const exit = inputs.exit as { exit_cap_rate?: number; sale_price?: number };
  if ((exit.exit_cap_rate ?? 0) <= 0 && (exit.sale_price ?? 0) <= 0) {
    add("error", "exit.exit_cap_rate", "No exit cap rate or sale price — exit value can't be computed.");
  }

  return flags;
}
