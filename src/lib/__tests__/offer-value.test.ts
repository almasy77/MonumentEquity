/**
 * Change D: offer vs ask and offer vs value (value = in-place NOI ÷ target cap).
 * Anonymized figures (a real case's ratios, dollars rescaled): ask $1,989,750,
 * offer $1,080,150, documented NOI $76,795, target cap 8.0%.
 */
import { describe, it, expect } from "vitest";
import { computeOfferVsValue, describeDelta, scenarioOffer } from "../offer-value";

const sample = {
  offer: 1_080_150,
  ask: 1_989_750,
  documented: { noi: 76_795, source: "seller_proforma_noi" as const },
  targetCap: 0.08,
};

describe("offer vs ask / offer vs value (Change D)", () => {
  it("offer 45.7% below ask, 12.5% ABOVE value on in-place NOI", () => {
    const r = computeOfferVsValue(sample);
    expect(r.offer_vs_ask).toBeCloseTo(1_080_150 / 1_989_750 - 1, 10);
    expect(r.value).toBeCloseTo(959_937.5, 6);
    expect(r.offer_vs_value).toBeCloseTo(1_080_150 / 959_937.5 - 1, 10);
    expect(describeDelta(r.offer_vs_ask)).toBe("45.7% below");
    expect(describeDelta(r.offer_vs_value)).toBe("12.5% above");
    // ~20% below value rule of thumb: context only.
    expect(r.rule_of_thumb_price).toBeCloseTo(767_950, 6);
    expect(r.missing).toEqual([]);
  });

  it("no target cap or no NOI → value is null and the gap is named", () => {
    expect(computeOfferVsValue({ ...sample, targetCap: undefined }).missing).toEqual(["target_cap"]);
    const noNoi = computeOfferVsValue({ ...sample, documented: null });
    expect(noNoi.value).toBeNull();
    expect(noNoi.offer_vs_value).toBeNull();
    expect(noNoi.offer_vs_ask).not.toBeNull(); // ask comparison still works
    expect(noNoi.missing).toEqual(["in_place_noi"]);
    // A cap entered as a whole number (8 instead of 0.08) is rejected, not used.
    expect(computeOfferVsValue({ ...sample, targetCap: 8 }).value).toBeNull();
  });

  it("scenarioOffer prefers bid, then LOI, then purchase price", () => {
    expect(scenarioOffer({ bid_price: 950_000, loi_amount: 900_000, purchase_price: 1_000_000 })).toBe(950_000);
    expect(scenarioOffer({ loi_amount: 900_000, purchase_price: 1_000_000 })).toBe(900_000);
    expect(scenarioOffer({ purchase_price: 1_000_000 })).toBe(1_000_000);
    expect(scenarioOffer(undefined)).toBeNull();
  });

  it("describeDelta formats at / above / below", () => {
    expect(describeDelta(0)).toBe("at");
    expect(describeDelta(null)).toBe("—");
    expect(describeDelta(0.2)).toBe("20.0% above");
  });
});
