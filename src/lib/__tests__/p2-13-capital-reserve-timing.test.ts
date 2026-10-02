/**
 * P2-13: the capital_reserve_total bucket can be timed (start_month + duration)
 * instead of spread evenly over the whole hold. Deferred maintenance done in year 1
 * costs more in IRR terms than the same dollars spread flat. Total spent is conserved.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

function run(start?: number, duration?: number) {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  const c = s.capex as unknown as Record<string, unknown>;
  c.capital_reserve_total = 90000;
  c.capital_reserve_per_unit = 0; // isolate the total bucket
  if (start != null) c.capital_reserve_start_month = start;
  if (duration != null) c.capital_reserve_duration_months = duration;
  const r = calculateUnderwriting(s);
  const total = r.annual.reduce((sum, a) => sum + (a.capital_reserve ?? 0), 0);
  return { irr: r.metrics.irr as number, total, y1: r.annual[0].capital_reserve ?? 0 };
}

describe("P2-13: capital reserve timing", () => {
  it("default spreads the total evenly over the hold (prior behavior)", () => {
    const d = run();
    expect(d.total).toBeCloseTo(90000, 0); // conserved
    const holdYears = GOLDEN.exit.hold_period_years;
    expect(d.y1).toBeCloseTo(90000 / holdYears, 0); // flat per year
  });

  it("front-loading (months 1-9) conserves the total but lands it all in year 1", () => {
    const w = run(1, 9);
    expect(w.total).toBeCloseTo(90000, 0); // still conserved
    expect(w.y1).toBeCloseTo(90000, 0); // all spent in year 1
  });

  it("spending the same dollars earlier lowers IRR", () => {
    expect(run(1, 9).irr).toBeLessThan(run().irr);
  });

  it("a window running past the hold is clamped so the full total is still spent", () => {
    const totalMonths = GOLDEN.exit.hold_period_years * 12;
    const w = run(totalMonths - 2, 24); // only 3 months left in the hold
    expect(w.total).toBeCloseTo(90000, 0);
  });
});
