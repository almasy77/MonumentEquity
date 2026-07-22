/**
 * Cash-out refinance (item 2). A mid-hold refi closes at the end of refi_year;
 * the new loan governs debt service afterward, and the net cash-out lands as a
 * dated distribution in the refi year. Guardrail: refi_enabled=false reproduces
 * the no-refi output exactly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, calculateLoanBalance } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function base(): ScenarioInputs {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
  inp.exit.hold_period_years = 5;
  return inp;
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

describe("refinance — item 2", () => {
  it("refi_enabled=false is byte-identical to no refi at all", () => {
    const off = calculateUnderwriting(base());
    const disabled = base();
    disabled.exit = { ...disabled.exit, ...REFI, refi_enabled: false };
    const r = calculateUnderwriting(disabled);
    expect(r.metrics.irr).toBe(off.metrics.irr);
    expect(r.metrics.equity_multiple).toBe(off.metrics.equity_multiple);
    expect(r.metrics.net_sale_proceeds).toBe(off.metrics.net_sale_proceeds);
  });

  it("the new loan governs debt service only AFTER the refi year", () => {
    const off = calculateUnderwriting(base());
    const on = base();
    on.exit = { ...on.exit, ...REFI };
    const r = calculateUnderwriting(on);
    // Refi year (index refi_year-1) still on the old loan → unchanged.
    expect(r.annual[REFI.refi_year - 1].debt_service).toBeCloseTo(off.annual[REFI.refi_year - 1].debt_service, 2);
    // Year after the refi (index refi_year) is on the new loan → changed.
    expect(Math.abs(r.annual[REFI.refi_year].debt_service - off.annual[REFI.refi_year].debt_service)).toBeGreaterThan(1);
    // Exit loan balance reflects the new loan → net sale proceeds differ.
    expect(r.metrics.net_sale_proceeds).not.toBe(off.metrics.net_sale_proceeds);
  });

  it("reconstructs the net cash-out and confirms it flows into distributions", () => {
    const inp = base();
    inp.exit = { ...inp.exit, ...REFI };
    const r = calculateUnderwriting(inp);

    // Independently reconstruct the refi proceeds (use the ACTUAL sized loan —
    // the engine may size to the DSCR floor, not LTV).
    const loanAmount = r.metrics.loan_amount;
    const oldBalance = calculateLoanBalance(
      loanAmount,
      inp.financing.interest_rate / 12,
      inp.financing.amortization_years * 12,
      REFI.refi_year * 12,
      inp.financing.io_period_months,
    );
    const refiYearNOI = r.annual[REFI.refi_year - 1].noi;
    const value = refiYearNOI / REFI.refi_cap_rate;
    const newLoan = value * REFI.refi_ltv;
    const proceeds = newLoan - oldBalance - oldBalance * REFI.refi_prepayment_penalty_rate - newLoan * REFI.refi_cost_rate;
    expect(proceeds).toBeGreaterThan(0); // cash-out

    // totalDistributions = Σ annual CF + refi proceeds + net sale proceeds + reserve return.
    const totalDistributions = r.metrics.equity_multiple * r.metrics.total_equity;
    const cumCF = r.annual.reduce((s, a) => s + a.cash_flow, 0);
    expect(totalDistributions).toBeCloseTo(
      cumCF + proceeds + r.metrics.net_sale_proceeds + r.metrics.return_of_operating_reserve,
      0,
    );
  });
});
