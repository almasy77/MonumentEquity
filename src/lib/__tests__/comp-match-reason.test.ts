/**
 * P3-11: widening a comp search beyond the exact city. compMatchReason classifies a
 * comp against a subject location into city / zip3 / state (or null), with zip3 ranked
 * ahead of state because a shared 3-digit ZIP prefix is a tighter, more comparable area.
 */
import { describe, it, expect } from "vitest";
import { compMatchReason, compMatchRank } from "../api-helpers";

describe("compMatchReason", () => {
  const subject = { city: "West View", state: "PA", zip: "15229" };

  it("matches the exact city (case- and space-insensitive) first", () => {
    expect(compMatchReason({ city: "west  view", state: "PA", zip: "15229" }, subject)).toBe("city");
    // city wins even if another tier would also match
    expect(compMatchReason({ city: "WEST VIEW", state: "OH", zip: "99999" }, subject)).toBe("city");
  });

  it("falls back to a shared 3-digit ZIP prefix before state", () => {
    // different city, same zip3 (152), different last digits
    expect(compMatchReason({ city: "Pittsburgh", state: "PA", zip: "15201" }, subject)).toBe("zip3");
    // zip3 is preferred over a plain state match
    expect(compMatchReason({ city: "Pittsburgh", state: "PA", zip: "15212" }, subject)).toBe("zip3");
  });

  it("falls back to the same state when city and zip3 do not match", () => {
    expect(compMatchReason({ city: "Erie", state: "PA", zip: "16501" }, subject)).toBe("state");
  });

  it("returns null when nothing matches", () => {
    expect(compMatchReason({ city: "Columbus", state: "OH", zip: "43004" }, subject)).toBeNull();
  });

  it("handles missing/short ZIPs without a false zip3 match", () => {
    expect(compMatchReason({ city: "Pittsburgh", state: "PA", zip: "15" }, subject)).toBe("state"); // zip too short
    expect(compMatchReason({ city: "Pittsburgh", state: "PA" }, subject)).toBe("state"); // no zip
    const noZipSubject = { city: "West View", state: "PA" };
    expect(compMatchReason({ city: "Pittsburgh", state: "PA", zip: "15201" }, noZipSubject)).toBe("state");
  });

  it("ranks city < zip3 < state", () => {
    expect(compMatchRank("city")).toBeLessThan(compMatchRank("zip3"));
    expect(compMatchRank("zip3")).toBeLessThan(compMatchRank("state"));
  });
});
