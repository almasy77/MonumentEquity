/**
 * P2-4: explicit exit valuation method. "tax_loaded" values the exit on the next
 * buyer's reset taxes: (exit NOI + exit-year tax) / (cap + effective tax rate).
 * "noi_over_cap" forces the plain exit NOI / cap. Unset keeps the prior automatic
 * behavior (tax-load for sale-price reassessment), so existing scenarios don't move.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

const CAP = 0.07;
const RATE = 0.018;

function run(method?: "noi_over_cap" | "tax_loaded") {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  (s.expenses as unknown as Record<string, unknown>).tax_reassessment = {
    enabled: true,
    effective_tax_rate: RATE,
    apply_at_exit: true,
  };
  const ex = s.exit as unknown as Record<string, unknown>;
  ex.exit_cap_rate = CAP;
  ex.sale_price = 0;
  if (method) ex.exit_method = method;
  const r = calculateUnderwriting(s);
  const exitTax = r.annual[r.annual.length - 1].opex_breakdown.property_tax;
  return { exitValue: r.metrics.exit_value, exitNoi: r.metrics.exit_noi, exitTax };
}

describe("P2-4: exit valuation method", () => {
  it("tax_loaded matches the hand calculation to the dollar", () => {
    const { exitValue, exitNoi, exitTax } = run("tax_loaded");
    const expected = (exitNoi + exitTax) / (CAP + RATE);
    expect(exitValue).toBeCloseTo(expected, 0);
  });

  it("noi_over_cap forces the plain NOI / cap", () => {
    const { exitValue, exitNoi } = run("noi_over_cap");
    expect(exitValue).toBeCloseTo(exitNoi / CAP, 0);
  });

  it("the two methods differ (tax-loaded values lower)", () => {
    expect(run("tax_loaded").exitValue).toBeLessThan(run("noi_over_cap").exitValue);
  });

  it("unset keeps the automatic behavior (tax-loaded here, since reassessment applies)", () => {
    expect(run(undefined).exitValue).toBeCloseTo(run("tax_loaded").exitValue, 0);
  });
});
