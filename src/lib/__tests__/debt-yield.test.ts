/**
 * Debt Yield KPI (NOI / outstanding loan balance).
 *  - year1_debt_yield = year-1 NOI / origination loan amount.
 *  - min_debt_yield tracks the amortizing balance year by year, and resets to the
 *    new loan after a mid-hold cash-out refi (the critical case).
 *  - Fallback: min_debt_yield is never Infinity/NaN (single year / zero debt).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function base(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

const REFI = {
  refi_enabled: true,
  refi_year: 3,
  refi_cap_rate: 0.06,
  refi_ltv: 0.7,
  refi_interest_rate: 0.055,
  refi_amortization_years: 30,
  refi_io_months: 0,
  refi_cost_rate: 0.01,
  refi_prepayment_penalty_rate: 0.01,
};

describe("debt yield", () => {
  it("year1_debt_yield == year-1 NOI / origination loan (simple amortizing, no refi)", () => {
    const r = calculateUnderwriting(base());
    const expected = r.annual[0].noi / r.metrics.loan_amount;
    expect(r.metrics.loan_amount).toBeGreaterThan(0);
    expect(r.metrics.year1_debt_yield).toBeCloseTo(expected, 9);
    // No refi → the hold minimum is at least as tight as year 1 but still finite.
    expect(Number.isFinite(r.metrics.min_debt_yield)).toBe(true);
    expect(r.metrics.min_debt_yield).toBeLessThanOrEqual(r.metrics.year1_debt_yield + 1e-9);
  });

  it("min_debt_yield resets to the post-refi balance on a mid-hold cash-out refi", () => {
    const inp = base();
    inp.exit = { ...inp.exit, ...REFI };
    const r = calculateUnderwriting(inp);

    // Independently reconstruct the new loan amount (value at the trailing refi-year
    // NOI ÷ refi cap, times refi LTV) — the engine sizes it the same way.
    const refiYearNOI = r.annual[REFI.refi_year - 1].noi;
    const newLoan = (refiYearNOI / REFI.refi_cap_rate) * REFI.refi_ltv;

    // Rebuild the running-balance series WITH the reset at the first year the new
    // loan governs (annual index === refi_year, 0-based), and confirm the engine's
    // min matches it.
    const withReset = (() => {
      let bal = r.metrics.loan_amount;
      let min = Infinity;
      for (let i = 0; i < r.annual.length; i++) {
        if (i === REFI.refi_year) bal = newLoan;
        const dy = bal > 0 ? r.annual[i].noi / bal : Infinity;
        bal -= r.annual[i].principal_paid;
        min = Math.min(min, dy);
      }
      return min;
    })();

    // The same series WITHOUT the reset (keep amortizing the original loan) — the
    // cash-out raises the balance, so the reset must produce a strictly lower min.
    const noReset = (() => {
      let bal = r.metrics.loan_amount;
      let min = Infinity;
      for (let i = 0; i < r.annual.length; i++) {
        const dy = bal > 0 ? r.annual[i].noi / bal : Infinity;
        bal -= r.annual[i].principal_paid;
        min = Math.min(min, dy);
      }
      return min;
    })();

    // Sanity: a cash-out refi enlarges the balance vs. the amortized original.
    expect(newLoan).toBeGreaterThan(r.metrics.loan_amount);
    expect(r.metrics.refi_net_proceeds).toBeGreaterThan(0);

    expect(r.metrics.min_debt_yield).toBeCloseTo(withReset, 9);
    // The reset genuinely bites — ignoring it would overstate the minimum.
    expect(r.metrics.min_debt_yield).toBeLessThan(noReset);
  });

  it("min_debt_yield is never Infinity/NaN — single-year hold and zero debt service", () => {
    // Single-year hold: reduce sees exactly one year.
    const oneYear = base();
    oneYear.exit = { ...oneYear.exit, hold_period_years: 1 };
    const r1 = calculateUnderwriting(oneYear);
    expect(Number.isFinite(r1.metrics.min_debt_yield)).toBe(true);
    expect(Number.isNaN(r1.metrics.min_debt_yield)).toBe(false);

    // Zero debt: no loan → running balance 0 → every-year yield is Infinity, so the
    // fallback pins min_debt_yield to year1_debt_yield (0 here).
    const noDebt = base();
    noDebt.financing = { ...noDebt.financing, ltv: 0, size_to_dscr: false };
    const r0 = calculateUnderwriting(noDebt);
    expect(r0.metrics.loan_amount).toBe(0);
    expect(Number.isFinite(r0.metrics.min_debt_yield)).toBe(true);
    expect(Number.isNaN(r0.metrics.min_debt_yield)).toBe(false);
    expect(r0.metrics.min_debt_yield).toBe(r0.metrics.year1_debt_yield);
  });
});
