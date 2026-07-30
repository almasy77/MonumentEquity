/**
 * Reverse price-solve: bisect the purchase price to a target return metric.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { solvePriceForIRR } from "../price-solve";

function bryden(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}

const irrAt = (inputs: ScenarioInputs, price: number) =>
  calculateUnderwriting({ ...inputs, purchase: { ...inputs.purchase, purchase_price: price } }).metrics.irr!;

describe("solvePriceForIRR", () => {
  it("finds the price at which the deal hits a target IRR", () => {
    const inputs = bryden();
    const baseIRR = calculateUnderwriting(inputs).metrics.irr!;
    const target = baseIRR + 0.03; // a higher required return → a lower price

    const price = solvePriceForIRR(inputs, target);
    expect(price).not.toBeNull();
    // The engine's IRR at the solved price equals the target.
    expect(irrAt(inputs, price!)).toBeCloseTo(target, 3);
    // Paying less than the current price is what lifts the return.
    expect(price!).toBeLessThan(inputs.purchase.purchase_price);
  });

  it("moves monotonically — a lower target IRR allows a higher price", () => {
    const inputs = bryden();
    const base = calculateUnderwriting(inputs).metrics.irr!;
    const pHigh = solvePriceForIRR(inputs, base + 0.02)!;
    const pLow = solvePriceForIRR(inputs, base + 0.05)!;
    expect(pHigh).toBeGreaterThan(pLow);
  });

  it("returns null when the target can't be bracketed", () => {
    const inputs = bryden();
    expect(solvePriceForIRR(inputs, 5.0)).toBeNull(); // 500% IRR — unreachable
  });
});
