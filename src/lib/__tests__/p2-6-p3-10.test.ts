/**
 * P2-6: warn when the loan matures at or before the sale.
 * P3-10: new scenarios default selling_cost_rate to 4%.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, buildDefaultInputs, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

const MATURITY = "Loan matures at or before the modeled sale";

function withLoanTerm(term: number, hold: number): string[] {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  (s.financing as unknown as Record<string, unknown>).loan_term_years = term;
  (s.exit as unknown as Record<string, unknown>).hold_period_years = hold;
  return calculateUnderwriting(s).warnings;
}

describe("P2-6: loan-maturity warning", () => {
  it("warns when the term is at or before the hold", () => {
    expect(withLoanTerm(5, 5).some((w) => w.includes(MATURITY))).toBe(true);
    expect(withLoanTerm(3, 5).some((w) => w.includes(MATURITY))).toBe(true);
  });
  it("does not warn when the term outlasts the hold", () => {
    expect(withLoanTerm(10, 5).some((w) => w.includes(MATURITY))).toBe(false);
  });
  it("treats loan_term_years = 0 as no maturity (no warning)", () => {
    expect(withLoanTerm(0, 5).some((w) => w.includes(MATURITY))).toBe(false);
  });
});

describe("P3-10: 4% selling-cost default for new scenarios", () => {
  const deal = { asking_price: 1_000_000, units: 10 } as Parameters<typeof buildDefaultInputs>[0];
  it("buildDefaultInputs defaults selling_cost_rate to 0.04", () => {
    expect(buildDefaultInputs(deal, {}).exit.selling_cost_rate).toBe(0.04);
  });
  it("still honors a deal-level selling_cost_rate when provided", () => {
    expect(buildDefaultInputs(deal, { selling_cost_rate: 0.03 }).exit.selling_cost_rate).toBe(0.03);
  });
});
