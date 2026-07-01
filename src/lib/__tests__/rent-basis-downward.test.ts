/**
 * Pro-forma unrenovated basis must be honored even when the rent ramp is ON,
 * INCLUDING the downward case (market < current) — e.g. a short-term-rental
 * building whose in-place "current" rents are far above the long-term market
 * rent, underwritten as long-term only. Regression for the 595 E Broad bug
 * where enabling the ramp forced in-place = current and ignored market rents.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

// Three occupied units whose CURRENT rent ($2,000) sits far above the long-term
// MARKET rent ($950), ramp ON, no renovation.
function strInputs(basis: "current" | "market"): ScenarioInputs {
  const inputs = brydenInputs();
  inputs.revenue.unit_mix = [
    { type: "1BR/1BA", count: 3, current_rent: 2000, market_rent: 950, renovated_rent_premium: 0 },
  ];
  inputs.revenue.rent_ramp = {
    enabled: true,
    mode: "linear",
    absorption_months: 12,
    turn_downtime_months: 1,
    max_turns_per_month: 2,
    initial_vacant_units: 0,
    vacant_leaseup_months: 2,
  };
  inputs.capex = { ...inputs.capex, units_to_renovate: 0, per_unit_cost: 0, projects: [] };
  inputs.exit = {
    ...inputs.exit,
    proforma_unrenovated_basis: basis,
    proforma_renovated_basis: "market_plus_premium",
    proforma_rent_basis: undefined,
  };
  return inputs;
}

describe("pro-forma unrenovated basis honored with ramp on (downward market)", () => {
  it("market basis values in-place units at MARKET even when market < current", () => {
    const r = calculateUnderwriting(strInputs("market"));
    // 3 units × $950 × 12 = $34,200 — no mark-up turns, no downtime (already at market).
    expect(r.annual[0].gpr).toBeCloseTo(34_200, 0);
  });

  it("current basis still values in-place units at CURRENT (unchanged)", () => {
    const r = calculateUnderwriting(strInputs("current"));
    // 3 units × $2,000 × 12 = $72,000 — over-market units are never marked down.
    expect(r.annual[0].gpr).toBeCloseTo(72_000, 0);
  });

  it("switching to market basis materially lowers GPR / EGI (the reported bug)", () => {
    const cur = calculateUnderwriting(strInputs("current"));
    const mkt = calculateUnderwriting(strInputs("market"));
    expect(mkt.annual[0].gpr).toBeLessThan(cur.annual[0].gpr);
    expect(mkt.annual[0].egi).toBeLessThan(cur.annual[0].egi);
    // ~$950/$2,000 ≈ 0.475 of the current-basis GPR.
    expect(mkt.annual[0].gpr / cur.annual[0].gpr).toBeCloseTo(0.475, 2);
  });
});
