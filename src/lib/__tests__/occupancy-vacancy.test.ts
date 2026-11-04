import { describe, it, expect } from "vitest";
import { buildDefaultInputs, normalizeOccupancy } from "../underwriting";

// Regression: a new "Base Case" was created with vacancy_rate = -89 when the deal's
// current_occupancy was stored as a percent (90) instead of a 0-1 fraction, because
// the default vacancy was computed as 1 - current_occupancy.
const base = { asking_price: 1_000_000, units: 10 };
const vacancyFor = (current_occupancy: unknown) =>
  buildDefaultInputs({ ...base, current_occupancy: current_occupancy as number }, {}).revenue.vacancy_rate;

describe("normalizeOccupancy", () => {
  it.each([
    [0.92, 0.92],
    [1, 1],
    [92, 0.92],
    [90, 0.9],
    ["0.92", 0.92],
    ["92", 0.92],
    [100, 1],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeOccupancy(input)).toBeCloseTo(expected as number, 10);
  });

  it.each([[0], [-0.5], [101], [1000], [NaN], [Infinity], ["abc"], [null], [undefined], [{}]])(
    "%j is unusable",
    (input) => {
      expect(normalizeOccupancy(input)).toBeUndefined();
    }
  );
});

describe("default vacancy from deal occupancy", () => {
  it("fraction occupancy still gives 1 - occupancy (unchanged behaviour)", () => {
    expect(vacancyFor(0.92)).toBeCloseTo(0.08, 10);
    expect(vacancyFor("0.92")).toBeCloseTo(0.08, 10); // the UI saves a string
  });

  it("percent-style occupancy no longer yields a negative vacancy (was -89)", () => {
    expect(vacancyFor(90)).toBeCloseTo(0.1, 10);
    expect(vacancyFor(92)).toBeCloseTo(0.08, 10);
  });

  it("missing or nonsensical occupancy falls back to the default vacancy", () => {
    expect(vacancyFor(undefined)).toBe(0.07);
    expect(vacancyFor(0)).toBe(0.07);
    expect(vacancyFor(1000)).toBe(0.07);
    expect(buildDefaultInputs({ ...base, current_occupancy: 1000 }, { vacancy_rate: 0.05 }).revenue.vacancy_rate).toBe(0.05);
  });

  it("never produces a vacancy outside 0-1", () => {
    for (const occ of [0.01, 0.5, 0.99, 1, 50, 99, 100, 1000, -3]) {
      const v = vacancyFor(occ);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
