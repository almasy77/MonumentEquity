/**
 * Lease-up carry surfacing (spec OUT-3 / financing reality). A conversion deal
 * that leases up from vacant runs a sub-1.0x coverage year, and a permanent
 * amortizing loan cannot fund it — the cash burn must come from an interest /
 * operating reserve or bridge debt. The engine now reports the trough DSCR and
 * its year, the cumulative operating shortfall, and whether the funded reserve
 * covers it, and warns with the bridge-financing implication.
 *
 * 4443 Mobile Drive, Likely (Plan A: convert 15 STR units to market LTR, lease
 * up from vacant): Year-1 NOI $28,672 vs debt service $108,842 → −$80,170.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const LIKELY = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

describe("lease-up carry (OUT-3): trough DSCR, operating shortfall, reserve adequacy", () => {
  const res = calculateUnderwriting(LIKELY);
  const m = res.metrics;

  it("reports the trough DSCR in Year 1 (the lease-up bottom), well below 1.0", () => {
    expect(m.min_dscr_year).toBe(1);
    expect(m.min_dscr).toBeLessThan(0.5);
  });

  it("quantifies the Year-1 operating shortfall (~$80,170) over one year", () => {
    expect(m.operating_shortfall_total).toBeCloseTo(80170, -2); // within ~$100
    expect(m.operating_shortfall_years).toBe(1);
  });

  it("confirms the funded operating reserve covers the shortfall", () => {
    // capex_reserve $143,940 ≥ $80,170 shortfall.
    expect(m.operating_reserve_covers_shortfall).toBe(true);
    expect(m.capex_reserve).toBeGreaterThanOrEqual(m.operating_shortfall_total);
  });

  it("warns with the bridge-financing implication and the reserve verdict", () => {
    const w = res.warnings.find((x) => x.startsWith("Lease-up carry"));
    expect(w).toBeTruthy();
    expect(w).toContain("bridge financing");
    expect(w).toContain("covers");
  });

  it("a stabilized deal (covers debt every year) reports no shortfall and no carry warning", () => {
    const stable = JSON.parse(JSON.stringify(LIKELY)) as ScenarioInputs;
    // Remove the ramp and the $0 units → stabilized market from day 1.
    (stable.revenue as unknown as { rent_ramp?: unknown }).rent_ramp = { enabled: false };
    (stable.revenue as unknown as { unit_mix: Array<Record<string, unknown>> }).unit_mix.forEach((r) => {
      if ((r.current_rent as number) === 0) r.current_rent = r.market_rent;
    });
    const r2 = calculateUnderwriting(stable);
    expect(r2.metrics.operating_shortfall_total).toBe(0);
    expect(r2.metrics.operating_shortfall_years).toBe(0);
    expect(r2.warnings.some((x) => x.startsWith("Lease-up carry"))).toBe(false);
  });
});
