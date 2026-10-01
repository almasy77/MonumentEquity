/**
 * P2-5: set a unit's lease status from its lease end date. A future lease_end (vs the
 * ramp's analysis start) is "occupied" until that date; expired/blank is "mtm"; a $0
 * current rent is "vacant". Flows into the per-unit units[] on a rent-roll sync.
 */
import { describe, it, expect } from "vitest";
import { deriveUnitStatusFromLease, buildUnitMixFromRentRoll } from "../underwriting";

const START = "2026-07-01";

describe("P2-5: deriveUnitStatusFromLease", () => {
  it("future lease -> occupied with its end date", () => {
    expect(deriveUnitStatusFromLease("2027-06-30", START, 1500)).toEqual({ status: "occupied", lease_end: "2027-06-30" });
  });
  it("expired lease -> mtm", () => {
    expect(deriveUnitStatusFromLease("2025-01-01", START, 1500).status).toBe("mtm");
  });
  it("blank lease -> mtm", () => {
    expect(deriveUnitStatusFromLease(undefined, START, 1500).status).toBe("mtm");
  });
  it("zero rent -> vacant regardless of lease", () => {
    expect(deriveUnitStatusFromLease("2027-06-30", START, 0).status).toBe("vacant");
  });
});

describe("P2-5: buildUnitMixFromRentRoll emits per-unit status", () => {
  it("marks future-lease units leased and expired/blank units mtm", () => {
    const rr = [
      { unit_number: "1", unit_type: "2BR/1BA", current_rent: 1500, market_rent: 1800, lease_end: "2027-06-30" }, // leased
      { unit_number: "2", unit_type: "2BR/1BA", current_rent: 1450, market_rent: 1800, lease_end: "2027-03-31" }, // leased
      { unit_number: "3", unit_type: "2BR/1BA", current_rent: 1400, market_rent: 1800, lease_end: "2025-01-01" }, // mtm (expired)
      { unit_number: "5", unit_type: "2BR/1BA", current_rent: 1400, market_rent: 1800 }, // mtm (blank)
      { unit_number: "8", unit_type: "2BR/1BA", current_rent: 0, market_rent: 1800 }, // vacant
    ];
    const mix = buildUnitMixFromRentRoll(rr, 5, START);
    const units = mix[0].units!;
    const byId = Object.fromEntries(units.map((u) => [u.unit_id, u.status]));
    expect(byId["1"]).toBe("occupied");
    expect(byId["2"]).toBe("occupied");
    expect(byId["3"]).toBe("mtm");
    expect(byId["5"]).toBe("mtm");
    expect(byId["8"]).toBe("vacant");
    // leased units carry their end date; row current_rent averages occupied only.
    expect(units.find((u) => u.unit_id === "1")!.lease_end).toBe("2027-06-30");
    expect(mix[0].current_rent).toBe(Math.round((1500 + 1450 + 1400 + 1400) / 4)); // 4 occupied, vacant excluded
  });
});
