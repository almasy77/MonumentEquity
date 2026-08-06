/**
 * State-aware property tax (Colony Pointe / NC scrutiny fix).
 *
 * The v2 engine used to default EVERY no-abatement deal to "reassessed_to_price"
 * (Ohio's welcome-stranger mechanic). It's now jurisdiction-driven:
 *  - no state on file  → reassessed_to_price  (backward compat — unchanged)
 *  - sale_price state  → reassessed_to_price
 *  - periodic_cycle / unmapped state → periodic_hold: bill does NOT grow toward
 *    the purchase price.
 */
import { describe, it, expect } from "vitest";
import {
  jurisdictionRulesFor,
  assertJurisdictionResolved,
} from "../property-tax-jurisdictions";
import {
  propertyTaxScenarioInForce,
  propertyTaxBillForTaxYear,
  type PropertyTaxAssumptions,
} from "../underwriting";

const base = (over: Partial<PropertyTaxAssumptions> = {}): PropertyTaxAssumptions => ({
  enabled: true,
  effective_tax_rate: 0.02,
  closing_date: "2025-01-01",
  ...over,
});

describe("jurisdictionRulesFor", () => {
  it("maps OH and NC to periodic_cycle, leaves unknowns unmapped", () => {
    expect(jurisdictionRulesFor("OH").method).toBe("periodic_cycle");
    expect(jurisdictionRulesFor("nc").method).toBe("periodic_cycle"); // case-insensitive
    expect(jurisdictionRulesFor("TX").method).toBe("unknown");
    expect(jurisdictionRulesFor(undefined).method).toBe("unknown");
  });

  it("assertJurisdictionResolved throws for unmapped/missing, returns for mapped", () => {
    expect(() => assertJurisdictionResolved("TX")).toThrow();
    expect(() => assertJurisdictionResolved(undefined)).toThrow();
    expect(assertJurisdictionResolved("NC").method).toBe("periodic_cycle");
  });
});

describe("propertyTaxScenarioInForce (jurisdiction-aware default)", () => {
  it("no state → reassessed_to_price (backward compatible)", () => {
    expect(propertyTaxScenarioInForce(base())).toBe("reassessed_to_price");
  });

  it("NC (periodic_cycle) → periodic_hold", () => {
    expect(propertyTaxScenarioInForce(base({ parcel: { state: "NC" } }))).toBe("periodic_hold");
  });

  it("unmapped state (TX) fails SAFE to periodic_hold, never reassessed_to_price", () => {
    const s = propertyTaxScenarioInForce(base({ parcel: { state: "TX" } }));
    expect(s).toBe("periodic_hold");
    expect(s).not.toBe("reassessed_to_price");
  });

  it("an explicit scenario or abatement still wins over the jurisdiction default", () => {
    expect(propertyTaxScenarioInForce(base({ parcel: { state: "NC" }, scenario: "reassessed_to_price" }))).toBe("reassessed_to_price");
    expect(
      propertyTaxScenarioInForce(
        base({ parcel: { state: "NC" }, abatement: { abated_annual_tax: 1000, unabated_annual_tax: 5000, final_abated_tax_year: 2030, transferable: "confirmed" } })
      )
    ).toBe("abated_transfers");
  });
});

describe("periodic_hold does not reassess toward the purchase price", () => {
  const price = 2_500_000;

  it("NC deal holds the entered assessed-value bill flat, far below the price-reassessed bill", () => {
    // Colony Pointe shape: seller's current assessed value ($900k) is well below
    // the $2.5M purchase price. reassessed_value carries the CURRENT assessed value.
    const nc = base({ parcel: { state: "NC" }, reassessed_value: 900_000, effective_tax_rate: 0.012 });
    const ncYear1 = propertyTaxBillForTaxYear(nc, price, "periodic_hold", 2025);
    const ncYear5 = propertyTaxBillForTaxYear(nc, price, "periodic_hold", 2029);

    // Bill is based on the entered assessed value, not the sale price.
    expect(ncYear1).toBeCloseTo(900_000 * 0.012, 0);
    // Held roughly flat (levy drift only) — nowhere near the price-based bill.
    const priceBill = price * 0.012;
    expect(ncYear5).toBeLessThan(priceBill * 0.6);

    // The sale-price path (no entered assessed value → defaults to the $2.5M
    // price) bills far more than the periodic hold on the $900k assessment.
    const salePricePt = base({ effective_tax_rate: 0.012 }); // no reassessed_value → uses price
    const reassessed = propertyTaxBillForTaxYear(salePricePt, price, "reassessed_to_price", 2025);
    expect(reassessed).toBeGreaterThan(ncYear1 * 2); // price ($2.5M) >> assessed ($900k)
  });

  it("periodic_hold grows far slower than reassessed_to_price over the hold", () => {
    const pt = base({ parcel: { state: "NC" }, reassessed_value: price });
    const holdFlatY1 = propertyTaxBillForTaxYear(pt, price, "periodic_hold", 2025);
    const holdFlatY5 = propertyTaxBillForTaxYear(pt, price, "periodic_hold", 2029);
    const reassessY5 = propertyTaxBillForTaxYear(pt, price, "reassessed_to_price", 2029);
    // Same starting base (reassessed_value == price here) but periodic_hold has no
    // HB920 reappraisal bumps, so it ends the hold below the reassessed path.
    expect(holdFlatY5).toBeGreaterThan(holdFlatY1); // small levy drift
    expect(holdFlatY5).toBeLessThan(reassessY5);
  });
});
