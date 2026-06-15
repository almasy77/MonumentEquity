/**
 * Phase 4.3: the three-tier capital structure. The capital reserve spreads a
 * total pool evenly across the FULL hold (so the whole amount lands inside it),
 * distinct from the replacement reserve and from dated named projects (which
 * truncate when they run past the hold).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { capexGuardrailWarning } from "../checks";
import type { Deal } from "../validations";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

describe("Phase 4.3: capital reserve", () => {
  it("spreads the full total across the hold — no truncation", () => {
    const inputs = brydenInputs(); // 5-year hold = 60 months
    inputs.capex.capital_reserve_total = 100_000;
    const r = calculateUnderwriting(inputs);

    // Every month carries an equal slice; the full $100K lands inside the hold.
    const totalReserve = r.annual.reduce((s, a) => s + a.capital_reserve, 0);
    expect(totalReserve).toBeCloseTo(100_000, 0);
    // Even per-year: $100K / 5 = $20K.
    for (const a of r.annual) expect(a.capital_reserve).toBeCloseTo(20_000, 0);
    expect(r.monthly[0].capital_reserve).toBeCloseTo(100_000 / 60, 4);
  });

  it("per-unit/yr capital reserve is additive", () => {
    const inputs = brydenInputs(); // 12 units
    inputs.capex.capital_reserve_per_unit = 300;
    const r = calculateUnderwriting(inputs);
    // 12 units × $300/yr = $3,600/yr.
    for (const a of r.annual) expect(a.capital_reserve).toBeCloseTo(3_600, 0);
  });

  it("reduces cash flow below NOI without touching NOI", () => {
    const base = calculateUnderwriting(brydenInputs());
    const withRes = brydenInputs();
    withRes.capex.capital_reserve_total = 60_000; // $1,000/mo over 60 months
    const r = calculateUnderwriting(withRes);

    // NOI unchanged (capital reserve is below NOI).
    expect(r.annual[0].noi).toBeCloseTo(base.annual[0].noi, 2);
    // Year-1 cash flow drops by ~$12,000 ($1,000/mo).
    expect(base.annual[0].cash_flow - r.annual[0].cash_flow).toBeCloseTo(12_000, 0);
  });

  it("warns when a named project runs past the hold (truncation)", () => {
    const inputs = brydenInputs(); // 60-month hold
    inputs.capex.projects = [{ name: "Roof", cost: 100_000, start_month: 36, duration_months: 84 }];
    const r = calculateUnderwriting(inputs);
    const w = r.warnings.find((x) => x.includes('"Roof"') && x.includes("hold ends"));
    expect(w).toBeDefined();
    // Captured ≈ (60-36+1)/84 × 100,000 ≈ $29,762.
    expect(w).toMatch(/\$29,7\d\d/);
  });

  it("clears the CapEx guardrail when a capital reserve is set", () => {
    const oldDeal = { year_built: 1940 } as unknown as Deal;
    const noReserve = brydenInputs();
    noReserve.capex.projects = [];
    noReserve.capex.pca_complete = undefined;
    noReserve.capex.capital_reserve_total = 0;
    expect(capexGuardrailWarning(oldDeal, noReserve)).toMatch(/deferred maintenance/);

    const withReserve = brydenInputs();
    withReserve.capex.projects = [];
    withReserve.capex.pca_complete = undefined;
    withReserve.capex.capital_reserve_total = 50_000;
    expect(capexGuardrailWarning(oldDeal, withReserve)).toBeNull();
  });
});
