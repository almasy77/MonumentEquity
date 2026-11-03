import { describe, it, expect } from "vitest";
import { extractLoans } from "../attom";

// A fixed "today" so the amortization math is deterministic.
const ASOF = new Date("2026-11-03T00:00:00Z");

describe("ATTOM mortgage parser", () => {
  it("parses the FirstConcurrent / SecondConcurrent shape and amortizes the balance", () => {
    const prop = {
      mortgage: {
        FirstConcurrent: {
          amount: 1_000_000,
          interestRate: 6, // percent — normalized to 0.06
          date: "2021-11-03",
          term: 360, // months
          lender: "ACME BANK",
          loanType: "CNV",
        },
        SecondConcurrent: {
          amount: 200_000,
          interestRate: 8,
          date: "2021-11-03",
          term: 15, // years — normalized to 180 months
        },
      },
    };
    const loans = extractLoans(prop, ASOF);
    expect(loans).toHaveLength(2);

    const first = loans[0];
    expect(first.position).toBe("first");
    expect(first.originalAmount).toBe(1_000_000);
    expect(first.interestRate).toBeCloseTo(0.06, 6);
    expect(first.termMonths).toBe(360);
    expect(first.lender).toBe("ACME BANK");
    // 60 payments elapsed on a $1M / 6% / 30yr loan → ~$931.5k remaining.
    expect(first.monthsElapsed).toBe(60);
    expect(first.estimatedBalance).toBeGreaterThan(925_000);
    expect(first.estimatedBalance).toBeLessThan(935_000);

    const second = loans[1];
    expect(second.position).toBe("second");
    expect(second.termMonths).toBe(180); // 15yr → 180mo
    expect(second.estimatedBalance).toBeGreaterThan(0);
  });

  it("parses a flat mortgage object (no concurrent nesting)", () => {
    const prop = {
      mortgage: { amount: 500_000, interestRate: 0.05, date: "2016-11-03", term: 360, lender: "FLAT LENDER" },
    };
    const loans = extractLoans(prop, ASOF);
    expect(loans).toHaveLength(1);
    expect(loans[0].originalAmount).toBe(500_000);
    // 120 payments on a 30yr loan → well below principal.
    expect(loans[0].estimatedBalance).toBeGreaterThan(390_000);
    expect(loans[0].estimatedBalance).toBeLessThan(410_000);
  });

  it("reads a mortgage nested under sale.mortgage", () => {
    const prop = { sale: { mortgage: { FirstConcurrent: { amount: 300_000, interestRate: 7, date: "2020-01-01", term: 360 } } } };
    const loans = extractLoans(prop, ASOF);
    expect(loans).toHaveLength(1);
    expect(loans[0].originalAmount).toBe(300_000);
  });

  it("returns an estimate note (no balance) when rate or term is missing", () => {
    const prop = { mortgage: { FirstConcurrent: { amount: 400_000, date: "2019-05-01" } } };
    const loans = extractLoans(prop, ASOF);
    expect(loans).toHaveLength(1);
    expect(loans[0].estimatedBalance).toBeUndefined();
    expect(loans[0].estimateNote).toMatch(/interest rate/);
    expect(loans[0].estimateNote).toMatch(/term/);
  });

  it("rejects a bad interest rate (>25%) rather than producing a garbage estimate", () => {
    const prop = { mortgage: { FirstConcurrent: { amount: 100_000, interestRate: 99, date: "2020-01-01", term: 360 } } };
    const loans = extractLoans(prop, ASOF);
    expect(loans[0].interestRate).toBeUndefined();
    expect(loans[0].estimatedBalance).toBeUndefined();
  });

  it("treats a fully-elapsed term as paid off (balance 0)", () => {
    const prop = { mortgage: { FirstConcurrent: { amount: 250_000, interestRate: 5, date: "1990-01-01", term: 360 } } };
    const loans = extractLoans(prop, ASOF);
    expect(loans[0].estimatedBalance).toBe(0);
  });

  it("returns no loans when there is no mortgage object", () => {
    expect(extractLoans({ address: { oneLine: "x" } }, ASOF)).toHaveLength(0);
  });
});
