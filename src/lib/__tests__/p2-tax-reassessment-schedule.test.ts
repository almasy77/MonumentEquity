/**
 * P2-2: explicit property-tax reassessment schedule. The entered base bill escalates
 * until a step's effective month, then re-marks to the step amount and escalates from
 * there. Acceptance (6 Elm): base $30,184, a step at month 30 to $45,000 → annual tax
 * ~$30.2K, ~$30.8K, then ~$45K+ from the step year.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateUnderwriting,
  steppedTaxForMonth,
  resolveStepAnnual,
  type ScenarioInputs,
} from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

function withSchedule(enabled: boolean): ScenarioInputs {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  const e = s.expenses as unknown as Record<string, unknown>;
  e.property_tax_total = 30184;
  e.tax_escalation_rate = 0.02;
  (s.exit as unknown as Record<string, unknown>).hold_period_years = 6;
  e.property_tax_v2 = {
    enabled,
    effective_tax_rate: 0.0185,
    reassessment_schedule: [{ effective_month: 30, basis: "manual", manual_amount: 45000 }],
  };
  return s;
}

function annualTax(r: ReturnType<typeof calculateUnderwriting>, year1: number): number {
  let sum = 0;
  for (let m = (year1 - 1) * 12; m < year1 * 12; m++) sum += r.monthly[m]?.opex_breakdown.property_tax ?? 0;
  return sum;
}

describe("P2-2: property-tax reassessment schedule", () => {
  it("escalates the base until the step month, then re-marks and grows from there", () => {
    const r = calculateUnderwriting(withSchedule(true));
    expect(annualTax(r, 1)).toBeCloseTo(30184, 0); // base, year 1
    expect(annualTax(r, 2)).toBeCloseTo(30184 * 1.02, 0); // base escalated 1 yr
    // Step lands at month 30 (mid year 3); year 4 is fully post-step (~$45K, escalating).
    expect(annualTax(r, 4)).toBeGreaterThanOrEqual(45000);
    expect(annualTax(r, 4)).toBeLessThan(46000);
    expect(annualTax(r, 5)).toBeGreaterThan(annualTax(r, 4)); // escalates from the step
  });

  it("is opt-in: a schedule present but with v2 disabled has zero effect", () => {
    const off = withSchedule(false);
    const noSched = JSON.parse(JSON.stringify(off)) as ScenarioInputs;
    delete (noSched.expenses as unknown as { property_tax_v2: { reassessment_schedule?: unknown } }).property_tax_v2
      .reassessment_schedule;
    // Same inputs minus the schedule field → identical tax, so an unenabled schedule
    // never changes existing results.
    const a = annualTax(calculateUnderwriting(off), 4);
    const b = annualTax(calculateUnderwriting(noSched), 4);
    expect(a).toBeCloseTo(b, 2);
    // And enabling it DOES change year 4 (the step applies only when enabled).
    expect(annualTax(calculateUnderwriting(withSchedule(true)), 4)).not.toBeCloseTo(a, 0);
  });

  it("resolveStepAnnual computes assessed-value basis with the state ratio", () => {
    // $1M market × CT 0.70 ratio × 40 mills / 1000 = $28,000
    expect(resolveStepAnnual({ effective_month: 0, basis: "market_value", market_value: 1_000_000, mill_rate: 40 }, 2_000_000, "CT")).toBeCloseTo(28000, 0);
    // purchase_price basis falls back to purchase price; manual passes through.
    expect(resolveStepAnnual({ effective_month: 0, basis: "manual", manual_amount: 51234 }, 2_000_000, "OH")).toBe(51234);
  });

  it("steppedTaxForMonth re-marks exactly at the step month", () => {
    const sched = [{ effective_month: 30, basis: "manual" as const, manual_amount: 45000 }];
    expect(steppedTaxForMonth(sched, 0, 29, 30184, 0.02, undefined) * 12).toBeCloseTo(30184 * 1.02 ** 2, 0);
    expect(steppedTaxForMonth(sched, 0, 30, 30184, 0.02, undefined) * 12).toBeCloseTo(45000, 0);
  });
});
