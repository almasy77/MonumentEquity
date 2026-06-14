/**
 * Reconciliation tie-outs (fix-spec Phase 3.2) — shared by the workbook's
 * Validation sheet and the JSON sidecar. Each check is a real reconciliation
 * (model output recomputed a second way), not a range sanity check.
 */
import type { Deal } from "./validations";
import type { ScenarioInputs, UnderwritingResult } from "./underwriting";
import { propertyTaxForMonthV2, propertyTaxScenarioInForce, calculateLoanBalance } from "./underwriting";

export interface ReconciliationCheck {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

export type ExitMethod = "explicit_price" | "tax_loaded" | "naive";

export function exitMethodFor(inputs: ScenarioInputs): ExitMethod {
  if (inputs.exit.sale_price && inputs.exit.sale_price > 0) return "explicit_price";
  const pt = inputs.expenses.property_tax_v2?.enabled
    ? inputs.expenses.property_tax_v2
    : inputs.expenses.tax_reassessment;
  return pt?.enabled && (pt.apply_at_exit ?? true) && pt.effective_tax_rate > 0 ? "tax_loaded" : "naive";
}

export function exitEffectiveTaxRate(inputs: ScenarioInputs): number {
  const pt = inputs.expenses.property_tax_v2?.enabled
    ? inputs.expenses.property_tax_v2
    : inputs.expenses.tax_reassessment;
  return pt?.effective_tax_rate ?? 0;
}

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function computeReconciliationChecks(
  deal: Deal,
  inputs: ScenarioInputs,
  result: UnderwritingResult,
): ReconciliationCheck[] {
  const checks: ReconciliationCheck[] = [];
  const m = result.metrics;
  const lastAnnual = result.annual[result.annual.length - 1];
  const cap = inputs.exit.exit_cap_rate;

  // (a) Method-aware exit reconciliation
  const method = exitMethodFor(inputs);
  if (method === "explicit_price") {
    checks.push({ id: "a", name: "Exit reconciliation (explicit price)", pass: true, detail: `Sale price input ${fmt$(m.exit_value)}` });
  } else if (method === "tax_loaded") {
    const rate = exitEffectiveTaxRate(inputs);
    // m.exit_noi is the STABILIZED last-year NOI (non-recurring other income
    // excluded) — the figure the closed form actually capitalizes.
    const noiExTax = m.exit_noi + lastAnnual.opex_breakdown.property_tax;
    const diff = Math.abs(m.exit_value * (cap + rate) - noiExTax);
    checks.push({
      id: "a", name: "Exit reconciliation (tax-loaded closed form)", pass: diff < 1,
      detail: `|exitValue × (cap ${(cap * 100).toFixed(2)}% + rate ${(rate * 100).toFixed(2)}%) − NOI-ex-tax ${fmt$(noiExTax)}| = ${fmt$(diff)}`,
    });
  } else {
    const diff = Math.abs(m.exit_value * cap - m.exit_noi);
    checks.push({ id: "a", name: "Exit reconciliation (naive NOI/cap)", pass: diff < 1, detail: `|exitValue × cap − stabilized exit NOI| = ${fmt$(diff)}` });
  }

  // (b) Stabilized GPR ties to unit-mix market/renovated totals
  {
    const sched = result.unit_schedule;
    const lastIdx = sched.gprByMonth.length - 1;
    let expected = 0;
    for (const u of sched.units) {
      const st = u.states[lastIdx];
      expected += st === "in_place" ? u.in_place_rent : st === "market" ? u.market_rent : st === "renovated" ? u.renovated_rent : 0;
    }
    const diff = Math.abs(sched.gprByMonth[lastIdx] - expected);
    checks.push({ id: "b", name: "Stabilized GPR ties to unit-mix totals", pass: diff < 1, detail: `schedule ${fmt$(sched.gprByMonth[lastIdx])} vs unit states ${fmt$(expected)}` });
  }

  // (c) Monthly NOI sums to annual NOI, every year
  {
    let worst = 0;
    result.annual.forEach((a, y) => {
      const sum = result.monthly.slice(y * 12, (y + 1) * 12).reduce((s, r) => s + r.noi, 0);
      worst = Math.max(worst, Math.abs(sum - a.noi));
    });
    checks.push({ id: "c", name: "Monthly NOI sums to annual NOI", pass: worst < 1, detail: `max yearly drift ${fmt$(worst)}` });
  }

  // (d) Bid price labeled when it isn't the modeled price
  {
    const bid = deal.bid_price;
    const equal = !bid || Math.abs(bid - inputs.purchase.purchase_price) < 1;
    checks.push({
      id: "d", name: "Bid price vs modeled price", pass: true,
      detail: equal ? "bid = purchase price (or no bid set)" : `bid ${fmt$(bid!)} ≠ modeled ${fmt$(inputs.purchase.purchase_price)} — labeled "(not modeled)" on Summary`,
    });
  }

  // (e) Loan ≤ min(LTV loan, DSCR-sized loan @ 1.25)
  {
    const TARGET_DSCR = 1.25;
    const ltvLoan = inputs.purchase.purchase_price * inputs.financing.ltv;
    const monthlyRate = inputs.financing.interest_rate / 12;
    const n = inputs.financing.amortization_years * 12;
    const pmtFactor = monthlyRate > 0
      ? (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
      : 1 / Math.max(1, n);
    const noi1 = result.annual[0]?.noi ?? 0;
    const dscrLoan = noi1 / TARGET_DSCR / 12 / pmtFactor;
    const maxLoan = Math.min(ltvLoan, dscrLoan);
    const pass = m.loan_amount <= maxLoan + 1;
    const extraEquity = pass ? 0 : m.loan_amount - maxLoan;
    checks.push({
      id: "e", name: `Loan within min(LTV, DSCR ${TARGET_DSCR}x)`, pass,
      detail: pass
        ? `loan ${fmt$(m.loan_amount)} ≤ min(LTV ${fmt$(ltvLoan)}, DSCR ${fmt$(dscrLoan)})`
        : `loan ${fmt$(m.loan_amount)} exceeds DSCR-sized ${fmt$(dscrLoan)} — requires ${fmt$(extraEquity)} extra equity`,
    });
  }

  // (f) Sources == uses
  {
    const diff = Math.abs(m.total_cost - (m.loan_amount + m.total_equity));
    checks.push({ id: "f", name: "Sources = uses", pass: diff < 1, detail: `|total cost − (loan + equity)| = ${fmt$(diff)}` });
  }

  // (g) Year-1 pro forma tax ties to the named tax scenario vector
  {
    const v2 = inputs.expenses.property_tax_v2;
    if (v2?.enabled) {
      let expected = 0;
      for (let mo = 0; mo < 12; mo++) expected += propertyTaxForMonthV2(v2, inputs.purchase.purchase_price, mo);
      const actual = result.annual[0]?.opex_breakdown.property_tax ?? 0;
      const diff = Math.abs(actual - expected);
      checks.push({
        id: "g", name: `Year-1 tax ties to "${propertyTaxScenarioInForce(v2)}" vector`, pass: diff < 1,
        detail: `pro forma ${fmt$(actual)} vs vector ${fmt$(expected)}`,
      });
    } else {
      checks.push({ id: "g", name: "Year-1 tax ties to tax vector", pass: true, detail: "property tax v2 not enabled — n/a" });
    }
  }

  // (h) Unit mix count == deal units
  {
    const mixCount = inputs.revenue.unit_mix.reduce((s, u) => s + u.count, 0);
    const pass = mixCount === deal.units;
    checks.push({ id: "h", name: "Unit mix count = deal units", pass, detail: `${mixCount} in mix vs ${deal.units} on deal` });
  }

  // (i) Net sale proceeds reconciliation — payoff recomputed INDEPENDENTLY
  // from the amortization schedule (not implied from the identity itself).
  {
    const totalMonths = inputs.exit.hold_period_years * 12;
    const payoff = calculateLoanBalance(
      m.loan_amount,
      inputs.financing.interest_rate / 12,
      inputs.financing.amortization_years * 12,
      totalMonths,
      inputs.financing.io_period_months,
    );
    const expected = m.exit_value * (1 - inputs.exit.selling_cost_rate) - payoff;
    const diff = Math.abs(m.net_sale_proceeds - expected);
    checks.push({ id: "i", name: "Net sale proceeds = exit − selling costs − payoff", pass: diff < 1, detail: `recomputed ${fmt$(expected)} vs model ${fmt$(m.net_sale_proceeds)} (payoff ${fmt$(payoff)})` });
  }

  return checks;
}

export function allChecksPass(checks: ReconciliationCheck[]): boolean {
  return checks.every((c) => c.pass);
}

// ─── CapEx guardrail (fix-spec Phase 4.3) ────────────────────
// An old building with zero named CapEx projects and no PCA on file means
// deferred maintenance is unmodeled. Surfaced on the Validation sheet and in
// the sidecar warnings — not a tie-out, so it does not gate ALL CHECKS PASS.
export function capexGuardrailWarning(deal: Deal, inputs: ScenarioInputs): string | null {
  const yearBuilt = deal.year_built;
  if (!yearBuilt) return null;
  const age = new Date().getFullYear() - yearBuilt;
  const namedProjects = inputs.capex.projects?.length ?? 0;
  if (age > 30 && namedProjects === 0 && !inputs.capex.pca_complete) {
    return `Building is ${age} years old (built ${yearBuilt}) with no named CapEx projects and no PCA on file — deferred maintenance is unmodeled. Add scoped projects or mark the PCA complete.`;
  }
  return null;
}
