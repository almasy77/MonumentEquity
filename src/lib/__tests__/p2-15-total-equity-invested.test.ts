/**
 * P2-15: cash-on-cash and equity multiple on TOTAL equity invested (equity at close +
 * every capital call), per industry best practice. Capital-call years contribute $0 to
 * the CoC yield (money in, not a negative return). IRR is unchanged (XIRR already
 * time-weighted the calls).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

function withCapex(capitalTotal: number) {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  (s.capex as unknown as Record<string, unknown>).capital_reserve_total = capitalTotal;
  return calculateUnderwriting(s).metrics;
}

describe("P2-15: total equity invested drives CoC / EM", () => {
  it("total invested includes capital calls and is at least closing equity; peak >= closing", () => {
    const m = withCapex(0);
    expect(m.total_equity_invested).toBeGreaterThanOrEqual(m.total_equity - 1);
    expect(m.peak_equity).toBeGreaterThanOrEqual(m.total_equity - 1);
    // This lease-up golden has negative early years -> real capital calls.
    expect(m.total_equity_invested).toBeGreaterThan(m.total_equity);
  });

  it("more capex funded from cash flow raises total invested and lowers the equity multiple", () => {
    const light = withCapex(0);
    const heavy = withCapex(600000);
    expect(heavy.total_equity_invested).toBeGreaterThan(light.total_equity_invested);
    expect(heavy.equity_multiple).toBeLessThan(light.equity_multiple);
    expect(heavy.irr!).toBeLessThan(light.irr!); // spending more cannot raise IRR
  });

  it("average cash-on-cash is never a blended negative (capital-call years are $0 yield)", () => {
    expect(withCapex(0).average_cash_on_cash).toBeGreaterThanOrEqual(0);
    expect(withCapex(600000).average_cash_on_cash).toBeGreaterThanOrEqual(0);
  });

  it("a deal with no capital calls invests exactly its closing equity (no change)", () => {
    const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
    // Stabilized at market, no lease-up, no capex -> positive operating CF every year.
    (s.revenue as unknown as { rent_ramp?: unknown }).rent_ramp = { enabled: false };
    (s.revenue as unknown as { unit_mix: Array<Record<string, number>> }).unit_mix.forEach((u) => {
      if ((u.current_rent as number) <= 0) u.current_rent = u.market_rent;
    });
    const ex = s.exit as unknown as Record<string, unknown>;
    ex.proforma_unrenovated_basis = "market";
    ex.proforma_renovated_basis = "market_plus_premium";
    (s.capex as unknown as Record<string, unknown>).capital_reserve_total = 0;
    (s.capex as unknown as Record<string, unknown>).per_unit_enabled = false;
    const m = calculateUnderwriting(s).metrics;
    expect(m.total_equity_invested).toBeCloseTo(m.total_equity, 0);
    expect(m.peak_equity).toBeCloseTo(m.total_equity, 0);
  });
});
