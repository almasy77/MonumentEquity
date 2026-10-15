/**
 * GRM denominator fix: the Gross Rent Multiplier valuation must multiply by CURRENT
 * in-place gross rent, not the market/renovated pro-forma rent. currentGrossScheduledRentAnnual
 * reads the rent roll's current rents only — it ignores market_rent and the renovation
 * premium, and is independent of the pro-forma rent-basis dropdown.
 */
import { describe, it, expect } from "vitest";
import { currentGrossScheduledRentAnnual, type UnitMix } from "../underwriting";

describe("currentGrossScheduledRentAnnual", () => {
  it("sums current rents on aggregate rows (× 12), ignoring market + reno premium", () => {
    const mix: UnitMix[] = [
      { type: "1BR", count: 10, current_rent: 1000, market_rent: 1400, renovated_rent_premium: 250 },
      { type: "2BR", count: 5, current_rent: 1300, market_rent: 1800, renovated_rent_premium: 300 },
    ];
    // (10×1000 + 5×1300) × 12 = (10000 + 6500) × 12 = 198,000
    expect(currentGrossScheduledRentAnnual(mix)).toBe(198_000);
  });

  it("uses per-unit current rents when the row is expanded, imputing the row rate for vacant units", () => {
    const mix: UnitMix[] = [
      {
        type: "1BR", count: 3, current_rent: 1000, market_rent: 1400, renovated_rent_premium: 250,
        units: [
          { unit_id: "A", status: "occupied", current_rent: 950 },
          { unit_id: "B", status: "mtm", current_rent: 1050 },
          { unit_id: "C", status: "vacant", current_rent: 0 }, // vacant → imputed at row current_rent (1000)
        ],
      },
    ];
    // (950 + 1050 + 1000) × 12 = 3000 × 12 = 36,000
    expect(currentGrossScheduledRentAnnual(mix)).toBe(36_000);
  });

  it("does not change when market/renovated rents change (basis-independent)", () => {
    const base: UnitMix[] = [{ type: "1BR", count: 4, current_rent: 1100, market_rent: 1500, renovated_rent_premium: 200 }];
    const bumped: UnitMix[] = [{ type: "1BR", count: 4, current_rent: 1100, market_rent: 2500, renovated_rent_premium: 900 }];
    expect(currentGrossScheduledRentAnnual(bumped)).toBe(currentGrossScheduledRentAnnual(base));
    expect(currentGrossScheduledRentAnnual(base)).toBe(4 * 1100 * 12); // 52,800
  });
});
