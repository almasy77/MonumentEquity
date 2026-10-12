import { describe, it, expect } from "vitest";
import { isEntityKey } from "../db";

// Regression: a `deal:*` SCAN also returns `deal:<id>:comps`, a Redis SET of pinned
// comp ids. A pipelined GET against that key fails the whole batch with WRONGTYPE,
// which took down /api/search, /api/deals/inactive and the Archived page as soon as
// any deal had a pinned comp. Every scan-then-GET must filter with isEntityKey.
describe("isEntityKey", () => {
  const id = "89bba38a-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

  it("accepts a top-level entity record key", () => {
    expect(isEntityKey(`deal:${id}`, "deal")).toBe(true);
    expect(isEntityKey(`scenario:${id}`, "scenario")).toBe(true);
  });

  it("rejects sub-keys hanging off an entity", () => {
    expect(isEntityKey(`deal:${id}:comps`, "deal")).toBe(false);
    expect(isEntityKey(`scenario:${id}:anything`, "scenario")).toBe(false);
  });

  it("rejects keys from a different or longer prefix", () => {
    expect(isEntityKey("deals:active", "deal")).toBe(false);
    expect(isEntityKey("deals:by_stage:lead", "deal")).toBe(false);
    expect(isEntityKey(`scenario_version:${id}:3`, "scenario")).toBe(false);
    expect(isEntityKey(`scenario:${id}`, "deal")).toBe(false);
  });

  it("rejects a bare prefix with no id", () => {
    expect(isEntityKey("deal:", "deal")).toBe(false);
    expect(isEntityKey("deal", "deal")).toBe(false);
  });

  it("keeps only record keys out of a mixed scan batch", () => {
    const scanned = [`deal:${id}`, `deal:${id}:comps`, "deals:active"];
    expect(scanned.filter((k) => isEntityKey(k, "deal"))).toEqual([`deal:${id}`]);
  });
});
