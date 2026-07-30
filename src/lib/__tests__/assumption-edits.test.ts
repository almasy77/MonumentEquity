/**
 * AI-assistant path edits. The assistant now returns a small list of { path, value }
 * ops instead of rewriting the whole assumptions object (which timed out for large
 * rent rolls). These verify the ops apply correctly — including "set ALL reno
 * premiums", the case that was timing out — and that bad/hostile paths are inert.
 */
import { describe, it, expect } from "vitest";
import { applyAssumptionEdits, applyEdit, parsePath } from "../assumption-edits";

function sampleAssumptions() {
  return {
    purchase_assumptions: { purchase_price: 1_000_000 },
    financing_assumptions: { ltv: 0.7, io_period_months: 0 },
    revenue_assumptions: {
      vacancy_rate: 0.07,
      unit_mix: [
        { type: "1BR", count: 10, current_rent: 900, market_rent: 1100, renovated_rent_premium: 150 },
        { type: "2BR", count: 6, current_rent: 1200, market_rent: 1450, renovated_rent_premium: 200 },
      ],
    },
    exit_assumptions: { exit_cap_rate: 0.06, hold_period_years: 5 },
  };
}

describe("applyAssumptionEdits", () => {
  it("sets ALL unit-mix reno premiums via [*] (the case that was timing out)", () => {
    const a = sampleAssumptions();
    const n = applyAssumptionEdits(a as unknown as Record<string, unknown>, [
      { path: "revenue_assumptions.unit_mix[*].renovated_rent_premium", value: 0 },
    ]);
    expect(n).toBe(2); // one per row
    expect(a.revenue_assumptions.unit_mix.every((u) => u.renovated_rent_premium === 0)).toBe(true);
    // Untouched fields survive.
    expect(a.revenue_assumptions.unit_mix[0].current_rent).toBe(900);
  });

  it("sets a scalar and a specific array index", () => {
    const a = sampleAssumptions();
    applyAssumptionEdits(a as unknown as Record<string, unknown>, [
      { path: "exit_assumptions.exit_cap_rate", value: 0.065 },
      { path: "revenue_assumptions.unit_mix[1].market_rent", value: 1500 },
    ]);
    expect(a.exit_assumptions.exit_cap_rate).toBe(0.065);
    expect(a.revenue_assumptions.unit_mix[1].market_rent).toBe(1500);
    expect(a.revenue_assumptions.unit_mix[0].market_rent).toBe(1100); // row 0 untouched
  });

  it("can add a field that didn't exist on an existing object", () => {
    const a = sampleAssumptions();
    const n = applyEdit(a as unknown as Record<string, unknown>, {
      path: "financing_assumptions.interest_rate",
      value: 0.07,
    });
    expect(n).toBe(1);
    expect((a.financing_assumptions as Record<string, number>).interest_rate).toBe(0.07);
  });

  it("is inert on nonexistent, out-of-range, or malformed paths (changes nothing)", () => {
    const a = sampleAssumptions();
    const before = JSON.stringify(a);
    const n = applyAssumptionEdits(a as unknown as Record<string, unknown>, [
      { path: "revenue_assumptions.nope.deep.value", value: 1 }, // missing intermediate
      { path: "revenue_assumptions.unit_mix[9].current_rent", value: 1 }, // out of range
      { path: "revenue_assumptions..vacancy_rate", value: 1 }, // malformed (empty segment)
      { path: "", value: 1 },
    ]);
    expect(n).toBe(0);
    expect(JSON.stringify(a)).toBe(before);
  });

  it("refuses prototype-pollution keys", () => {
    expect(parsePath("__proto__.polluted")).toBeNull();
    expect(parsePath("revenue_assumptions.constructor.x")).toBeNull();
    const obj = {};
    applyEdit({ a: obj } as unknown as Record<string, unknown>, { path: "a.__proto__.polluted", value: true });
    expect((({}) as Record<string, unknown>).polluted).toBeUndefined();
  });
});
