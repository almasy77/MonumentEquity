/**
 * Concessions are a transitional lease-up incentive ("first month free"), so they
 * apply only in operating years 1..concession_years (default 1) and are excluded
 * from the stabilized exit value — not a flat rate across the whole hold.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function inputs(): ScenarioInputs {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
  inp.revenue.concessions_rate = 0.05; // 5% concession
  inp.revenue.rent_growth_rate = 0; // isolate the concession effect from growth
  return inp;
}

// Annualized concession = the "Less: Concessions" line summed over the year.
const concFor = (r: ReturnType<typeof calculateUnderwriting>, year: number) => r.annual[year].concessions;

describe("concession year-gating", () => {
  it("defaults to Year 1 only — later years bill $0 concession", () => {
    const inp = inputs();
    delete inp.revenue.concession_years; // absent → default 1
    const r = calculateUnderwriting(inp);
    expect(concFor(r, 0)).toBeGreaterThan(0); // Year 1 has the concession
    for (let y = 1; y < r.annual.length; y++) {
      expect(concFor(r, y)).toBe(0); // Years 2+ are concession-free
    }
  });

  it("respects an explicit N-year window (years 1..N have it, N+1.. do not)", () => {
    const inp = inputs();
    inp.revenue.concession_years = 2;
    const r = calculateUnderwriting(inp);
    expect(concFor(r, 0)).toBeGreaterThan(0);
    expect(concFor(r, 1)).toBeGreaterThan(0); // Year 2 still in-window
    expect(concFor(r, 2)).toBe(0); // Year 3 out
  });

  it("excludes the Year-1 concession from the stabilized exit value", () => {
    // Two runs identical except the concession; with concession_years=1 and a multi-
    // year hold, the last (exit) year is concession-free either way, so the exit
    // value must be IDENTICAL — the concession must not depress the sale price.
    const withConc = inputs();
    withConc.revenue.concession_years = 1;
    const noConc = inputs();
    noConc.revenue.concessions_rate = 0;

    const a = calculateUnderwriting(withConc);
    const b = calculateUnderwriting(noConc);
    expect(a.metrics.exit_value).toBeCloseTo(b.metrics.exit_value, 2);
    // But Year-1 cash flow IS lower with the concession (it's a real Year-1 cost).
    expect(a.annual[0].noi).toBeLessThan(b.annual[0].noi);
  });

  it("a perpetual concession (N = hold) does load the exit value", () => {
    const inp = inputs();
    inp.revenue.concession_years = inp.exit.hold_period_years; // every year incl. exit
    const noConc = inputs();
    noConc.revenue.concessions_rate = 0;
    const a = calculateUnderwriting(inp);
    const b = calculateUnderwriting(noConc);
    expect(concFor(a, a.annual.length - 1)).toBeGreaterThan(0); // last year still has it
    expect(a.metrics.exit_value).toBeLessThan(b.metrics.exit_value); // and it depresses exit
  });
});
