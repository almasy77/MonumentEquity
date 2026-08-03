/**
 * Property-tax risk flags — advisory warnings that never change the computed tax.
 */
import { describe, it, expect } from "vitest";
import { computeTaxFlags } from "../tax-flags";
import type { Deal } from "../validations";

function deal(overrides: Partial<Deal>): Deal {
  return { id: "d1", address: "1 Main", city: "Columbus", state: "OH", units: 10, source: "broker", asking_price: 1_000_000, ...overrides } as Deal;
}

const ids = (d: Deal, price?: number) => computeTaxFlags(d, price).map((f) => f.id);

describe("computeTaxFlags", () => {
  it("no flags on a clean deal", () => {
    expect(computeTaxFlags(deal({}))).toEqual([]);
  });

  it("flags an abatement (explicit flag or incentive_type)", () => {
    expect(ids(deal({ tax_abatement_present: true }))).toContain("abatement");
    expect(ids(deal({ incentive_type: "CRA" }))).toContain("abatement");
  });

  it("flags a purchase >15% above the auditor's appraised value", () => {
    // appraised 800k, purchase 1.0M = +25% → fires
    expect(ids(deal({ tax_market_value: 800_000 }), 1_000_000)).toContain("gap");
    // appraised 950k, purchase 1.0M = +5.3% → no flag
    expect(ids(deal({ tax_market_value: 950_000 }), 1_000_000)).not.toContain("gap");
  });

  it("flags CAUV and a reappraisal cycle", () => {
    expect(ids(deal({ tax_cauv: true }))).toContain("cauv");
    expect(ids(deal({ tax_reappraisal_in_progress: true }))).toContain("reappraisal");
  });

  it("flags a land-use / unit-count mismatch but not a match", () => {
    // "R-2F" (two-family) vs 10 marketed units → mismatch
    expect(ids(deal({ tax_land_use_code: "R-2F TWO FAMILY", units: 10 }))).toContain("landuse");
    // "401 - APARTMENTS 4 TO 19 FAMILY" with 10 units → in range, no flag
    expect(ids(deal({ tax_land_use_code: "401 - APARTMENTS 4 TO 19 FAMILY", units: 10 }))).not.toContain("landuse");
    // unparseable code → no false flag
    expect(ids(deal({ tax_land_use_code: "COMMERCIAL MIXED", units: 10 }))).not.toContain("landuse");
  });

  it("falls back to asking_price when no scenario price is given", () => {
    expect(ids(deal({ tax_market_value: 700_000, asking_price: 1_000_000 }))).toContain("gap");
  });
});
