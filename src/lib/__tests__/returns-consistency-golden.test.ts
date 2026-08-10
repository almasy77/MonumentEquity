/**
 * Engine internal-consistency verification on real, feature-combining deals.
 *
 * The first-principles tests (returns-first-principles.test.ts) verify each mechanic's
 * MATH in isolation. This file verifies, on the two golden deals — bryden_base (a
 * value-add renovation) and fifth_st_tax_phasein (a tax phase-in) — that the engine's
 * pro forma FOOTS and its headline metrics AGGREGATE correctly:
 *   - operating expenses sum to the breakdown; EGI, NOI, and cash flow foot to their
 *     definitions, every year;
 *   - DSCR and average cash-on-cash match their components;
 *   - IRR and equity multiple, recomputed independently from the engine's own
 *     multi-year cash flows + exit + refi (with an independent IRR solver), match.
 *
 * Isolation proves the parts; this proves the whole, on deals that combine features.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

function irrBisect(flows: number[]): number {
  const npv = (r: number) => flows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 10;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

const GOLDEN = ["bryden_base", "fifth_st_tax_phasein"];

describe.each(GOLDEN)("engine consistency — %s", (name) => {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", name + ".input.json"), "utf8")) as ScenarioInputs;
  const res = calculateUnderwriting(inp);
  const m = res.metrics;
  const A = res.annual as unknown as Array<Record<string, number> & { opex_breakdown: Record<string, number> }>;

  it("income statement foots every year (opex sum, EGI, NOI, cash flow)", () => {
    for (const a of A) {
      const opexSum = Object.values(a.opex_breakdown).reduce((s, v) => s + v, 0);
      expect(a.total_opex).toBeCloseTo(opexSum, 0);
      expect(a.egi).toBeCloseTo(a.gpr - a.vacancy_loss - a.concessions - a.bad_debt + a.other_income, 0);
      expect(a.noi).toBeCloseTo(a.egi - a.total_opex, 0);
      const capex = (a.capex ?? (a.capex_renovation ?? 0) + (a.capex_projects ?? 0)) as number;
      expect(a.cash_flow).toBeCloseTo(a.noi - a.debt_service - a.reserves - (a.capital_reserve ?? 0) - capex, 0);
    }
  });

  it("DSCR and average cash-on-cash match their components", () => {
    expect(m.year1_dscr).toBeCloseTo(A[0].noi / A[0].debt_service, 4);
    const avgCoC = A.reduce((s, a) => s + a.cash_on_cash, 0) / A.length;
    expect(m.average_cash_on_cash).toBeCloseTo(avgCoC, 6);
  });

  it("equity multiple = total distributions / equity", () => {
    const cumCF = A.reduce((s, a) => s + a.cash_flow, 0);
    const totalDist = cumCF + (m.refi_net_proceeds || 0) + m.net_sale_proceeds + (m.return_of_operating_reserve || 0);
    expect(m.equity_multiple).toBeCloseTo(totalDist / m.total_equity, 4);
  });

  it("IRR matches an independent solver on the engine's own cash flows", () => {
    const flows = [-m.total_equity];
    for (let y = 0; y < A.length; y++) {
      let cf = A[y].cash_flow;
      if (y === A.length - 1) cf += m.net_sale_proceeds + (m.return_of_operating_reserve || 0);
      flows.push(cf);
    }
    if (m.refi_year && m.refi_net_proceeds) flows[m.refi_year] += m.refi_net_proceeds;
    expect(m.irr ?? NaN).toBeCloseTo(irrBisect(flows), 4);
  });
});
