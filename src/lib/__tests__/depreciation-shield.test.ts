/**
 * Depreciation shield (the realized value of depreciation): computed as the
 * with-minus-without-depreciation tax delta per year, so it automatically
 * respects REPS/§461(l)/PAL usability. Surfaced on the pro forma (memo row) and
 * as a summary stat.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}

describe("depreciation shield", () => {
  it("is consistent, positive, and bounded by depreciation × the marginal rate", () => {
    const r = calculateUnderwriting(bryden());
    const s = r.tax!.depreciation_shield!;
    expect(s).toBeDefined();
    expect(s.by_year.length).toBe(r.tax!.years.length);
    // Summary fields derive from the per-year array.
    expect(s.year1).toBeCloseTo(s.by_year[0], 6);
    expect(s.total).toBeCloseTo(s.by_year.reduce((a, b) => a + b, 0), 4);
    // Depreciation saves tax over the hold.
    expect(s.total).toBeGreaterThan(0);
    // The CUMULATIVE realized shield cannot exceed total depreciation × a generous
    // combined marginal rate (fed + state + NIIT well under 50%). Per-year is NOT
    // bounded this way — a suspended-then-released PAL realizes in a later year.
    const totalDep = r.tax!.years.reduce((acc, ty) => acc + ty.federal_depreciation, 0);
    expect(s.total).toBeLessThanOrEqual(totalDep * 0.5 + 1);
  });

  it("more first-year depreciation (bonus) raises the realized shield", () => {
    const lo = bryden();
    lo.tax = { ...lo.tax!, federal_bonus_pct: 0, reps_status: [true] };
    const hi = bryden();
    hi.tax = { ...hi.tax!, federal_bonus_pct: 0.6, reps_status: [true] };
    const sLo = calculateUnderwriting(lo).tax!.depreciation_shield!;
    const sHi = calculateUnderwriting(hi).tax!.depreciation_shield!;
    // With REPS on in year 1, bonus depreciation is usable → a larger Year-1 shield.
    expect(sHi.year1).toBeGreaterThan(sLo.year1);
  });
});
