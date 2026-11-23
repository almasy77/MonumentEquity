/**
 * Change D: offer vs ask and offer vs value (value = in-place NOI ÷ target cap).
 * Lincoln Terrace figures: ask $1.75M, offer $950K, seller NOI $67,542, target cap 8.0%.
 */
import { describe, it, expect } from "vitest";
import { computeOfferVsValue, describeDelta, scenarioOffer } from "../offer-value";

const lincoln = {
  offer: 950_000,
  ask: 1_750_000,
  documented: { noi: 67_542, source: "seller_proforma_noi" as const },
  targetCap: 0.08,
};

describe("offer vs ask / offer vs value (Change D)", () => {
  it("Lincoln Offer: 45.7% below ask, 12.5% ABOVE value on in-place NOI", () => {
    const r = computeOfferVsValue(lincoln);
    expect(r.offer_vs_ask).toBeCloseTo(950 / 1750 - 1, 10);
    expect(r.value).toBeCloseTo(844_275, 6);
    expect(r.offer_vs_value).toBeCloseTo(950_000 / 844_275 - 1, 10);
    expect(describeDelta(r.offer_vs_ask)).toBe("45.7% below");
    expect(describeDelta(r.offer_vs_value)).toBe("12.5% above");
    // Manny's ~20% below value: context only.
    expect(r.rule_of_thumb_price).toBeCloseTo(675_420, 6);
    expect(r.missing).toEqual([]);
  });

  it("no target cap or no NOI → value is null and the gap is named", () => {
    expect(computeOfferVsValue({ ...lincoln, targetCap: undefined }).missing).toEqual(["target_cap"]);
    const noNoi = computeOfferVsValue({ ...lincoln, documented: null });
    expect(noNoi.value).toBeNull();
    expect(noNoi.offer_vs_value).toBeNull();
    expect(noNoi.offer_vs_ask).not.toBeNull(); // ask comparison still works
    expect(noNoi.missing).toEqual(["in_place_noi"]);
    // A cap entered as a whole number (8 instead of 0.08) is rejected, not used.
    expect(computeOfferVsValue({ ...lincoln, targetCap: 8 }).value).toBeNull();
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
