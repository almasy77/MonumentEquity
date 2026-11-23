/** Change E: derived seller-motivation signals (display only, no scoring). */
import { describe, it, expect } from "vitest";
import { deriveSellerSignals, normalizeState, sellerSignalChips, stateFromAddress } from "../seller-motivation";

const NOW = new Date("2026-11-23T12:00:00Z");

describe("seller-motivation signals (Change E)", () => {
  it("parses the owner's state from common mailing-address shapes", () => {
    expect(stateFromAddress("PO Box 1234, Harrisburg, PA 17101")).toBe("PA");
    expect(stateFromAddress("123 Main St, Columbus, OH 43215-1234")).toBe("OH");
    expect(stateFromAddress("55 Water St New York NY 10041")).toBe("NY");
    expect(stateFromAddress("9 Elm Rd, Naples, Florida 34102")).toBe("FL");
    expect(stateFromAddress("1 Ocean Dr, Miami, FL 33139, USA")).toBe("FL");
    expect(stateFromAddress("PO Box 12, Boise, Idaho")).toBe("ID");
    expect(stateFromAddress("unknown")).toBeNull();
    expect(stateFromAddress(undefined)).toBeNull();
    expect(normalizeState("pennsylvania")).toBe("PA");
    expect(normalizeState("XX")).toBeNull();
  });

  it("derives DOM, cut %, out-of-state and hold years", () => {
    const s = deriveSellerSignals(
      {
        state: "PA",
        asking_price: 1_080_000,
        listed_date: "2026-06-01",
        original_asking_price: 1_200_000,
        price_cut_count: 1,
        tax_delinquent: true,
        tax_delinquent_note: " 2025 school tax unpaid ",
        owner_mailing_address: "88 Bay St, Tampa, FL 33602",
        owner_since: "2014-03-10",
      },
      NOW,
    );
    expect(s.days_on_market).toBe(175);
    expect(s.price_cut_pct).toBeCloseTo(0.1, 10);
    expect(s.out_of_state_owner).toBe(true);
    expect(s.owner_state).toBe("FL");
    expect(s.owner_hold_years).toBeCloseTo(12.71, 2);
    expect(s.tax_delinquent_note).toBe("2025 school tax unpaid");
    expect(sellerSignalChips(s).map((c) => c.label)).toEqual([
      "175 DOM",
      "1 price cut (−10%)",
      "Tax delinquent",
      "Out-of-state owner (FL)",
      "Held 12.7 yrs",
    ]);
  });

  it("in-state owner and unknowns produce no false signals", () => {
    const s = deriveSellerSignals({ state: "Pennsylvania", owner_mailing_address: "PO Box 1234, Harrisburg, PA 17101" }, NOW);
    expect(s.out_of_state_owner).toBe(false);
    expect(s.days_on_market).toBeNull();
    expect(s.tax_delinquent).toBeNull();
    expect(sellerSignalChips(s)).toEqual([]);
    // Unreadable address → can't tell (null), not "in state".
    expect(deriveSellerSignals({ state: "PA", owner_mailing_address: "c/o manager" }, NOW).out_of_state_owner).toBeNull();
    // A future listed date or bad date is ignored, not negative.
    expect(deriveSellerSignals({ listed_date: "2027-01-01" }, NOW).days_on_market).toBeNull();
    expect(deriveSellerSignals({ listed_date: "not a date" }, NOW).days_on_market).toBeNull();
  });

  it("zero price cuts shows a 'No price cuts' chip; a price raise isn't a cut", () => {
    const s = deriveSellerSignals({ price_cut_count: 0, original_asking_price: 1_000_000, asking_price: 1_100_000 }, NOW);
    expect(s.price_cut_pct).toBeCloseTo(-0.1, 10);
    expect(sellerSignalChips(s).map((c) => c.label)).toEqual(["No price cuts"]);
  });
});
