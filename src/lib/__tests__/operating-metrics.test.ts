/**
 * Operating (hold-forever) metrics — derived from the engine's annual schedule,
 * no sale assumption.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import { computeOperatingMetrics } from "../operating-metrics";
import type { ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}

describe("computeOperatingMetrics", () => {
  const inp = bryden();
  const result = calculateUnderwriting(inp);
  const op = computeOperatingMetrics(result, inp.exit.exit_cap_rate);

  it("returns one row per hold year", () => {
    expect(op.rows).toHaveLength(result.annual.length);
    expect(op.rows[0].year).toBe(result.annual[0].year);
  });

  it("yield-on-cost is NOI ÷ all-in basis, and ties to the headline going-in figure", () => {
    const y1 = op.rows[0];
    expect(y1.yield_on_cost).toBeCloseTo(result.annual[0].noi / result.metrics.total_cost, 9);
    expect(op.going_in_yield_on_cost).toBeCloseTo(y1.yield_on_cost, 9);
    // Yield-on-cost (on total basis) is at or below the cap on price (NOI/price),
    // since total cost ≥ price.
    expect(op.going_in_yield_on_cost).toBeLessThanOrEqual(result.metrics.going_in_cap + 1e-9);
  });

  it("cash-on-cash equals annual cash flow ÷ invested equity", () => {
    const y1 = op.rows[0];
    expect(y1.cash_on_cash).toBeCloseTo(result.annual[0].cash_flow / result.metrics.total_equity, 9);
  });

  it("loan balance amortizes down and debt yield rises as NOI grows / balance falls", () => {
    const first = op.rows[0];
    const last = op.rows[op.rows.length - 1];
    expect(last.loan_balance).toBeLessThan(first.loan_balance); // amortization
    expect(last.debt_yield).toBeGreaterThan(first.debt_yield);
  });

  it("cumulative operating multiple is monotonic and excludes any sale", () => {
    for (let i = 1; i < op.rows.length; i++) {
      expect(op.rows[i].cumulative_operating_multiple).toBeGreaterThanOrEqual(
        op.rows[i - 1].cumulative_operating_multiple,
      );
    }
    // Last-year cumulative multiple = total operating cash ÷ equity (no exit).
    const totalCF = result.annual.reduce((s, a) => s + a.cash_flow, 0);
    expect(op.rows[op.rows.length - 1].cumulative_operating_multiple).toBeCloseTo(
      totalCF / result.metrics.total_equity,
      6,
    );
  });

  it("reports the yield-on-cost spread vs the market (exit) cap in basis points", () => {
    expect(op.market_cap_rate).toBe(inp.exit.exit_cap_rate);
    expect(op.yield_spread_bps).toBe(Math.round((op.stabilized_yield_on_cost - inp.exit.exit_cap_rate) * 10000));
  });

  it("DSCR ties to NOI ÷ debt service", () => {
    const y1 = op.rows[0];
    expect(y1.dscr).toBeCloseTo(result.annual[0].noi / result.annual[0].debt_service, 6);
  });
});
