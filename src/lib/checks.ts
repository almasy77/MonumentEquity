/**
 * Reconciliation tie-outs (fix-spec Phase 3.2) — shared by the workbook's
 * Validation sheet and the JSON sidecar. Each check is a real reconciliation
 * (model output recomputed a second way), not a range sanity check.
 */
import type { Deal } from "./validations";
import type { ScenarioInputs, UnderwritingResult } from "./underwriting";
import { propertyTaxForMonthV2, propertyTaxScenarioInForce, calculateLoanBalance } from "./underwriting";
import { jurisdictionRulesFor } from "./property-tax-jurisdictions";

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
    // Informational, not a tie-out: an explicit sale price is a direct input, so
    // there is nothing to reconcile — labeled as such so a green banner isn't
    // read as having validated the exit value.
    checks.push({ id: "a", name: "Exit basis — explicit sale price (informational, not reconciled)", pass: true, detail: `Sale price input ${fmt$(m.exit_value)}` });
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

  // (d) Bid price labeled when it isn't the modeled price. Read the SCENARIO
  // bid (the one that drove this scenario's purchase price); the deal-level bid
  // is only a fallback for legacy scenarios that never set it.
  {
    const bid = inputs.purchase.bid_price ?? deal.bid_price;
    const equal = !bid || Math.abs(bid - inputs.purchase.purchase_price) < 1;
    checks.push({
      id: "d", name: "Bid vs modeled price (informational)", pass: true,
      detail: equal ? "bid = purchase price (or no bid set)" : `bid ${fmt$(bid!)} ≠ modeled ${fmt$(inputs.purchase.purchase_price)} — labeled "(not the modeled price)" on Summary`,
    });
  }

  // (e) Loan sizing — mirror the engine EXACTLY: DSCR sizing only applies when
  // size_to_dscr !== false, and the floor is financing.dscr_floor (default 1.25).
  // (Hardcoding 1.25 / always applying DSCR false-FAILed deals with a lower floor
  // or DSCR sizing turned off.)
  {
    const floor = inputs.financing.dscr_floor ?? 1.25;
    const dscrSizing = inputs.financing.size_to_dscr !== false;
    const ltvLoan = inputs.purchase.purchase_price * inputs.financing.ltv;
    const monthlyRate = inputs.financing.interest_rate / 12;
    const n = inputs.financing.amortization_years * 12;
    const pmtFactor = monthlyRate > 0
      ? (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
      : 1 / Math.max(1, n);
    const noi1 = result.annual[0]?.noi ?? 0;
    const dscrLoan = noi1 > 0 ? noi1 / floor / 12 / pmtFactor : 0;
    const maxLoan = dscrSizing ? Math.min(ltvLoan, dscrLoan) : ltvLoan;
    const pass = m.loan_amount <= maxLoan + 1;
    const extraEquity = pass ? 0 : m.loan_amount - maxLoan;
    const label = dscrSizing ? `Loan within min(LTV, DSCR ${floor}x)` : "Loan within LTV (DSCR sizing off)";
    checks.push({
      id: "e", name: label, pass,
      detail: pass
        ? (dscrSizing ? `loan ${fmt$(m.loan_amount)} ≤ min(LTV ${fmt$(ltvLoan)}, DSCR ${fmt$(dscrLoan)})` : `loan ${fmt$(m.loan_amount)} ≤ LTV ${fmt$(ltvLoan)}`)
        : `loan ${fmt$(m.loan_amount)} exceeds sized ${fmt$(maxLoan)} — requires ${fmt$(extraEquity)} extra equity`,
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
      for (let mo = 0; mo < 12; mo++) expected += propertyTaxForMonthV2(v2, inputs.purchase.purchase_price, mo, inputs.expenses.tax_escalation_rate);
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

  // (i) Net sale proceeds reconciliation — payoff recomputed INDEPENDENTLY from the
  // amortization schedule (not implied from the identity itself). Skipped for a
  // mid-hold cash-out refi: the engine pays off the REFINANCED loan at exit, which
  // this original-loan recompute can't reproduce without duplicating the refi sizing
  // — recomputing from the original loan here false-FAILed every refi deal.
  {
    const refiActive = !!(
      inputs.exit.refi_enabled &&
      (inputs.exit.refi_year ?? 0) >= 1 &&
      (inputs.exit.refi_year ?? 0) < inputs.exit.hold_period_years &&
      (inputs.exit.refi_cap_rate ?? 0) > 0
    );
    if (refiActive) {
      checks.push({
        id: "i",
        name: "Net sale proceeds reconciliation (informational — refinanced deal)",
        pass: true,
        detail: "exit pays off the refinanced loan; the refi folding is validated by the Distributions tie-out",
      });
    } else {
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
  }

  // (j) Reassessment decomposition ties to the billed rate. The engine bills off
  // effective_tax_rate, but the UI/exports narrate the decomposed mill_rate ×
  // assessment_ratio × (1 − reduction). If those drift apart, the "basis" text
  // (e.g. "75 mills") contradicts the dollar figure the engine bills (~62.8 mills)
  // and Year-1 NOI is silently mis-stated. This hard-FAILS on that drift — it does
  // NOT report n/a when reassessment is on (only when it's off / rate not decomposed).
  {
    const tr = inputs.expenses.tax_reassessment;
    if (tr?.enabled && tr.mill_rate != null && tr.assessment_ratio != null && tr.assessment_ratio > 0) {
      const millAssessed = tr.mill_assessed_rate ?? (tr.mill_reduction_rate != null ? 1 - tr.mill_reduction_rate : 1);
      const derived = tr.assessment_ratio * (tr.mill_rate / 1000) * millAssessed;
      const eff = tr.effective_tax_rate ?? 0;
      // Tolerate rounding: 0.5 basis points on the market-value rate.
      const pass = Math.abs(derived - eff) < 0.00005;
      const derivedMills = tr.assessment_ratio > 0 ? (eff / tr.assessment_ratio) * 1000 : 0;
      checks.push({
        id: "j",
        name: "Reassessment basis ties to billed rate",
        pass,
        detail: pass
          ? `mill × ratio (${(derived * 100).toFixed(3)}%) = effective (${(eff * 100).toFixed(3)}%)`
          : `basis says ${tr.mill_rate.toFixed(1)} mills but the billed effective rate is ${(eff * 100).toFixed(3)}% (≈ ${derivedMills.toFixed(1)} eff. mills) — narrative and bill disagree`,
      });
    } else {
      checks.push({ id: "j", name: "Reassessment basis ties to billed rate", pass: true, detail: "reassessment off or rate not decomposed — n/a" });
    }
  }

  // (k) Jurisdiction tax method is known. Property tax v2 defaults an unmapped
  // state to periodic_hold (fail-safe: it does NOT assume sale-price reassessment),
  // but the user still needs to confirm the county's real mechanics before the bill
  // can be trusted — so an explicitly-set-but-unmapped state hard-FAILS here and
  // blocks "all checks pass". A deal with NO state keeps the legacy behavior and is
  // not retroactively flagged.
  {
    const v2 = inputs.expenses.property_tax_v2;
    const state = v2?.parcel?.state;
    if (v2?.enabled && state && jurisdictionRulesFor(state).method === "unknown") {
      checks.push({
        id: "k",
        name: "Property-tax jurisdiction is mapped",
        pass: false,
        detail: `No reassessment rule mapped for ${state.toUpperCase()} — confirm the county's mechanics (sale-price vs periodic revaluation) or set the tax scenario manually before trusting the bill.`,
      });
    } else {
      checks.push({ id: "k", name: "Property-tax jurisdiction is mapped", pass: true, detail: v2?.enabled ? "jurisdiction mapped or state on file" : "property tax v2 not enabled — n/a" });
    }
  }

  return checks;
}

export function allChecksPass(checks: ReconciliationCheck[]): boolean {
  return checks.every((c) => c.pass);
}

// ─── Validation banner aggregation (VAL-1) ───────────────────
// The Summary banner used to read "ALL CHECKS PASS" off the reconciliation
// tie-outs ALONE, ignoring the range-sanity failures (negative cap, no IRR,
// equity multiple below 1, negative sale proceeds, negative NOI), the CapEx
// guardrail, and the engine's own sanity warnings. So a catastrophic deal
// (−0.23x equity multiple, IRR that never converged) still showed a green
// "ALL CHECKS PASS". The banner now aggregates EVERY block into three states.
export interface BannerStatus {
  state: "pass" | "warn" | "fail";
  failed: string[]; // hard failures — the deal is broken or loses capital
  warnings: string[]; // advisories — verify, but not disqualifying
  text: string; // banner label
}

export function computeBannerStatus(
  result: UnderwritingResult,
  reconChecks: ReconciliationCheck[],
  deal: Deal,
  inputs: ScenarioInputs,
): BannerStatus {
  const m = result.metrics;
  const failed: string[] = [];

  // Reconciliation tie-outs that don't foot.
  for (const c of reconChecks) if (!c.pass) failed.push(c.name);

  // Range-sanity hard failures (the block the old banner ignored).
  if (m.going_in_cap < 0) failed.push("Going-in cap rate is negative");
  if (m.irr === null) failed.push("IRR could not be computed (no return)");
  if (m.equity_multiple < 1) failed.push("Equity multiple below 1.0x (capital loss)");
  if (m.net_sale_proceeds < 0) failed.push("Net sale proceeds are negative");
  if ((result.annual[0]?.noi ?? 0) < 0) failed.push("Year-1 NOI is negative");

  // Advisories — engine sanity warnings + the CapEx guardrail.
  const warnings: string[] = [...result.warnings];
  const guardrail = capexGuardrailWarning(deal, inputs);
  if (guardrail) warnings.push(guardrail);

  if (failed.length > 0) {
    return { state: "fail", failed, warnings, text: `${failed.length} CHECK${failed.length === 1 ? "" : "S"} FAILED — ${failed[0]}` };
  }
  if (warnings.length > 0) {
    return { state: "warn", failed, warnings, text: `PASSES WITH ${warnings.length} WARNING${warnings.length === 1 ? "" : "S"} (see Validation sheet)` };
  }
  return { state: "pass", failed, warnings, text: "ALL CHECKS PASS" };
}

// ─── CapEx guardrail (fix-spec Phase 4.3/4.4) ────────────────
// An old building with zero named CapEx projects, a zero capital reserve, and
// no PCA on file means deferred maintenance is unmodeled. Surfaced on the
// Validation sheet and in the sidecar warnings — not a tie-out, so it does not
// gate ALL CHECKS PASS.
export function capexGuardrailWarning(deal: Deal, inputs: ScenarioInputs): string | null {
  const yearBuilt = deal.year_built;
  if (!yearBuilt) return null;
  const age = new Date().getFullYear() - yearBuilt;
  // Disabled projects are not modeled, so they don't count as coverage here.
  const namedProjects = (inputs.capex.projects ?? []).filter((p) => p.enabled !== false).length;
  const capitalReserve = (inputs.capex.capital_reserve_total ?? 0) + (inputs.capex.capital_reserve_per_unit ?? 0);
  if (age > 30 && namedProjects === 0 && capitalReserve === 0 && !inputs.capex.pca_complete) {
    return `Building is ${age} years old (built ${yearBuilt}) with no named CapEx projects, no capital reserve, and no PCA on file — deferred maintenance is unmodeled. Add scoped projects, set a capital reserve, or mark the PCA complete.`;
  }
  return null;
}
