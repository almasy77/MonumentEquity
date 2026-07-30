/**
 * Pricing Views (valuation triangulation): each method's implied value, the
 * seller-vs-buyer cap split, missing-input handling, and the low/mid/high range.
 */
import { describe, it, expect } from "vitest";
import { computePricingViews } from "../pricing-views";

const CTX = {
  ownerAcquisitionPrice: 500_000,
  yearsSincePurchase: 10,
  units: 10,
  squareFootage: 8_000,
  assessedValue: 700_000,
  year1NOI: 76_000,
  stabilizedNOI: 83_000,
  grossRentAnnual: 137_000,
  askingPrice: 1_400_000,
  offerPrice: 1_200_000,
};

function valueOf(rows: { key: string; impliedValue: number | null }[], key: string) {
  return rows.find((r) => r.key === key)!.impliedValue;
}

describe("computePricingViews", () => {
  it("computes each method and splits buyer vs seller cap", () => {
    const r = computePricingViews(CTX, {
      market_cagr: 0.03,
      target_cap: 0.065,
      seller_proforma_noi: 92_000,
      seller_cap: 0.06,
      price_per_unit: 130_000,
      grm: 9,
      price_per_sf: 175,
      assessment_ratio: 0.5,
    });

    // Income — my Yr-1 NOI at my cap.
    expect(valueOf(r.rows, "cap_my_y1")).toBeCloseTo(76_000 / 0.065, 2);
    // Income — my stabilized NOI at my cap.
    expect(valueOf(r.rows, "cap_my_stab")).toBeCloseTo(83_000 / 0.065, 2);
    // Income — the seller's rosier pro-forma NOI at the seller's cap (the anchor gap).
    expect(valueOf(r.rows, "cap_seller")).toBeCloseTo(92_000 / 0.06, 2);
    // CAGR on the owner's basis.
    expect(valueOf(r.rows, "cagr")).toBeCloseTo(500_000 * Math.pow(1.03, 10), 2);
    // $/unit, GRM, $/SF, assessed anchor.
    expect(valueOf(r.rows, "ppu")).toBeCloseTo(130_000 * 10, 2);
    expect(valueOf(r.rows, "grm")).toBeCloseTo(9 * 137_000, 2);
    expect(valueOf(r.rows, "ppsf")).toBeCloseTo(175 * 8_000, 2);
    expect(valueOf(r.rows, "assessed")).toBeCloseTo(700_000 / 0.5, 2);

    // Per-unit is derived from units.
    const ppu = r.rows.find((x) => x.key === "ppu")!;
    expect(ppu.perUnit).toBeCloseTo(130_000, 2);

    // Range spans the produced values; asking/offer passed through.
    expect(r.range).not.toBeNull();
    expect(r.range!.low).toBeLessThan(r.range!.high);
    expect(r.asking).toBe(1_400_000);
    expect(r.offer).toBe(1_200_000);
    // The seller-cap value ($1.533M) should be the top of the range here.
    expect(r.range!.high).toBeCloseTo(92_000 / 0.06, 0);
  });

  it("returns null (with a prompt) for methods missing inputs, and excludes them from the range", () => {
    const r = computePricingViews(CTX, { target_cap: 0.065 }); // only the cap inputs
    expect(valueOf(r.rows, "cap_my_y1")).not.toBeNull();
    expect(valueOf(r.rows, "cagr")).toBeNull();
    expect(r.rows.find((x) => x.key === "cagr")!.missing).toMatch(/CAGR/);
    expect(valueOf(r.rows, "ppu")).toBeNull();
    // Range built only from the two cap rows that resolved (Yr-1 + stabilized).
    expect(r.range).not.toBeNull();
    expect(r.range!.low).toBeCloseTo(76_000 / 0.065, 0);
    expect(r.range!.high).toBeCloseTo(83_000 / 0.065, 0);
  });

  it("always shows the $/SF row, prompting for the building SF when it's unknown", () => {
    const r = computePricingViews({ ...CTX, squareFootage: undefined }, { price_per_sf: 175 });
    const ppsf = r.rows.find((x) => x.key === "ppsf");
    expect(ppsf).toBeDefined();
    expect(ppsf!.impliedValue).toBeNull();
    expect(ppsf!.missing).toMatch(/building SF/);
  });

  it("computes $/SF when both the comp and the building SF are present", () => {
    const r = computePricingViews(CTX, { price_per_sf: 175 });
    expect(valueOf(r.rows, "ppsf")).toBeCloseTo(175 * 8_000, 2);
  });

  it("excludes a method entirely (rows and range) when asked", () => {
    const full = computePricingViews(CTX, { target_cap: 0.065 });
    const excl = computePricingViews(CTX, { target_cap: 0.065 }, { exclude: ["cap_my_stab"] });
    // The stabilized-NOI cap method is gone from the rows...
    expect(full.rows.find((x) => x.key === "cap_my_stab")).toBeDefined();
    expect(excl.rows.find((x) => x.key === "cap_my_stab")).toBeUndefined();
    // ...and no longer contributes to the range (its $83k/6.5% high is dropped).
    expect(excl.range!.high).toBeLessThan(full.range!.high);
  });
});
