/**
 * FIX: bid-price desync. The export and reconciliation check (d) must read the
 * SCENARIO bid (the one that drove this scenario's purchase price), not the
 * stale deal-level default.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { computeReconciliationChecks } from "../checks";
import type { Deal } from "../validations";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

// Deal-level bid is deliberately stale ($750K) vs the scenario's modeled price.
function dealWith(bid?: number): Deal {
  return { id: "d1", address: "738 Bryden", city: "Columbus", state: "OH", units: 12, asking_price: 1_200_000, bid_price: bid } as unknown as Deal;
}

describe("FIX: bid-price desync — reconciliation check (d)", () => {
  it("uses the scenario bid, not the stale deal bid (normal flow: bid = purchase)", () => {
    const inputs = brydenInputs();
    inputs.purchase.purchase_price = 850_000;
    inputs.purchase.bid_price = 850_000; // bid drove the price (normal Bid & LOI flow)
    const result = calculateUnderwriting(inputs);
    const checks = computeReconciliationChecks(dealWith(750_000), inputs, result);
    const d = checks.find((c) => c.id === "d")!;
    // Deal bid is stale 750K, but the scenario bid (850K) equals the modeled
    // price → no contradictory "not the modeled price" label.
    expect(d.detail).toContain("bid = purchase price");
    expect(d.detail).not.toContain("750");
  });

  it("flags a genuine bid-below-purchase as not the modeled price", () => {
    const inputs = brydenInputs();
    inputs.purchase.purchase_price = 850_000;
    inputs.purchase.bid_price = 800_000; // deliberately lower bid than modeled price
    const result = calculateUnderwriting(inputs);
    const checks = computeReconciliationChecks(dealWith(750_000), inputs, result);
    const d = checks.find((c) => c.id === "d")!;
    expect(d.detail).toContain("not the modeled price");
    expect(d.detail).toContain("800,000");
    expect(d.detail).toContain("850,000");
  });

  it("falls back to the deal bid only when the scenario never set one (legacy)", () => {
    const inputs = brydenInputs();
    inputs.purchase.purchase_price = 850_000;
    inputs.purchase.bid_price = undefined; // legacy scenario
    const result = calculateUnderwriting(inputs);
    const checks = computeReconciliationChecks(dealWith(750_000), inputs, result);
    const d = checks.find((c) => c.id === "d")!;
    // Legacy: deal bid (750K) differs from modeled 850K → labeled.
    expect(d.detail).toContain("750,000");
    expect(d.detail).toContain("not the modeled price");
  });
});
