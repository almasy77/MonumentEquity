/**
 * P1-1: on the rent-ramp path the engine read turnover cost from the flat
 * `turnover_cost_per_unit` field and ignored `opex_inputs.turnover` (the field the
 * UI edits), while every other OpEx line — including reserves — already reads
 * opex_inputs first. A lease-up deal (ramp on) therefore charged the flat value even
 * when the screen showed a different opex_inputs value. This asserts turnover now
 * follows opex_inputs on the ramp path too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

function withTurnover(opexValue: number): ScenarioInputs {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  const e = s.expenses as unknown as Record<string, unknown>;
  // Flat field held at a sentinel that differs from opex_inputs, so the test can
  // tell which source the engine used. The UI edits opex_inputs.turnover.
  e.turnover_cost_per_unit = 400;
  e.opex_inputs = {
    ...(e.opex_inputs as Record<string, unknown> | undefined),
    turnover: { value: opexValue, mode: "per_unit_annual" },
  };
  return s;
}

describe("P1-1: ramp-path turnover reads opex_inputs, not the flat field", () => {
  it("scales turnover with opex_inputs.turnover in a stabilized month", () => {
    // ramp is enabled on this fixture, so this exercises the ramp branch.
    expect((GOLDEN.revenue as unknown as { rent_ramp?: { enabled?: boolean } }).rent_ramp?.enabled).toBe(true);

    const control = calculateUnderwriting(withTurnover(400)); // opex_inputs == flat
    const higher = calculateUnderwriting(withTurnover(2500)); // opex_inputs 6.25x the flat

    // A late, stabilized month: ongoing churn only (no make-ready spikes), so the
    // turnover expense is linear in per-unit cost and the ratio is exactly the
    // opex_inputs ratio — escalation and occupancy cancel between the two runs.
    const m = 59; // month 60 (0-indexed), year 5
    const ctrl = control.monthly[m].opex_breakdown.turnover;
    const high = higher.monthly[m].opex_breakdown.turnover;

    expect(ctrl).toBeGreaterThan(0);
    // Pre-fix the ramp path used the flat 400 for BOTH runs -> ratio 1 (fails here).
    expect(high / ctrl).toBeCloseTo(2500 / 400, 4);
  });
});
