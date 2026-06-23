/**
 * CapEx enable/disable toggles: a turned-off per-unit renovation program or
 * named project drops OUT of the model entirely (no cost, and for the per-unit
 * program no rent premium or downtime) so the impact can be A/B'd without
 * deleting the inputs. A missing `enabled` flag is treated as ON (back-compat).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs, CapexProject } from "../underwriting";
import { capexGuardrailWarning } from "../checks";
import type { Deal } from "../validations";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

const holdCapex = (r: ReturnType<typeof calculateUnderwriting>) =>
  r.annual.reduce((s, a) => s + a.capex, 0);

const irr = (r: ReturnType<typeof calculateUnderwriting>): number => {
  expect(r.metrics.irr).not.toBeNull();
  return r.metrics.irr as number;
};

describe("CapEx toggles", () => {
  it("disabling a named project removes its cost from the model", () => {
    const proj: CapexProject = { name: "Roof", cost: 50_000, start_month: 6, duration_months: 1 };
    const on = brydenInputs();
    on.capex.projects = [proj];
    const off = brydenInputs();
    off.capex.projects = [{ ...proj, enabled: false }];

    // The disabled project's $50K drops out of modeled capex over the hold.
    expect(holdCapex(calculateUnderwriting(on)) - holdCapex(calculateUnderwriting(off))).toBeCloseTo(50_000, 0);

    // A disabled project is equivalent to no project at all.
    const none = brydenInputs();
    none.capex.projects = [];
    expect(irr(calculateUnderwriting(off))).toBeCloseTo(irr(calculateUnderwriting(none)), 10);
  });

  it("disabling the per-unit program removes cost, premium, and downtime", () => {
    const base = calculateUnderwriting(brydenInputs()); // 6 units × $8K = $48K reno
    const offInputs = brydenInputs();
    offInputs.capex.per_unit_enabled = false;
    const off = calculateUnderwriting(offInputs);

    // The $48K per-unit spend leaves the model.
    expect(holdCapex(base) - holdCapex(off)).toBeCloseTo(48_000, 0);

    // No renovation premium → lower exit value (and a different IRR).
    expect(off.metrics.exit_value).toBeLessThan(base.metrics.exit_value);
    expect(irr(off)).not.toBeCloseTo(irr(base), 6);

    // Equivalent to zeroing the per-unit inputs outright.
    const manual = brydenInputs();
    manual.capex.units_to_renovate = 0;
    manual.capex.per_unit_cost = 0;
    expect(irr(off)).toBeCloseTo(irr(calculateUnderwriting(manual)), 10);
  });

  it("a missing enabled flag is treated as ON (back-compat)", () => {
    const base = calculateUnderwriting(brydenInputs());
    const explicit = brydenInputs();
    explicit.capex.per_unit_enabled = true;
    explicit.capex.projects = (explicit.capex.projects ?? []).map((p) => ({ ...p, enabled: true }));
    expect(irr(calculateUnderwriting(explicit))).toBeCloseTo(irr(base), 10);
  });

  it("the CapEx guardrail does not count a disabled project as coverage", () => {
    const oldDeal = { year_built: 1940 } as unknown as Deal;
    const proj: CapexProject = { name: "Roof", cost: 50_000, start_month: 6, duration_months: 1 };

    const disabled = brydenInputs();
    disabled.capex.projects = [{ ...proj, enabled: false }];
    disabled.capex.pca_complete = undefined;
    disabled.capex.capital_reserve_total = 0;
    expect(capexGuardrailWarning(oldDeal, disabled)).toMatch(/deferred maintenance/);

    const enabled = brydenInputs();
    enabled.capex.projects = [proj];
    enabled.capex.pca_complete = undefined;
    enabled.capex.capital_reserve_total = 0;
    expect(capexGuardrailWarning(oldDeal, enabled)).toBeNull();
  });
});
