/**
 * The SDA is a stabilized model — it cannot represent a lease-up ramp. So the
 * SDA export must feed the STABILIZED year for a lease-up deal, not the Year-1
 * hole (which the SDA would otherwise grow into a fictional disaster). The
 * lease-up carry is funded separately by the operating reserve (SDA row 15,
 * already in uses of funds). A stabilized deal feeds Year 1 unchanged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { pickSdaBaseYear } from "../sda-fill-mapping";

const LIKELY = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

describe("SDA base year — stabilized-basis for a lease-up deal", () => {
  it("4443 (leases up from vacant) feeds a STABILIZED year, not the Year-1 hole", () => {
    const res = calculateUnderwriting(LIKELY);
    const { year, index } = pickSdaBaseYear(res);
    expect(index).toBeGreaterThan(0); // not Year 1
    expect(year.loss_to_lease).toBeCloseTo(0, 2); // ramp complete
    expect(year.cash_flow_before_capex_and_reserves).toBeGreaterThan(0); // covers debt
    // The stabilized NOI is many multiples of the Year-1 lease-up NOI.
    expect(year.noi).toBeGreaterThan(res.annual[0].noi * 3);
  });

  it("a stabilized deal (no lease-up) feeds Year 1 unchanged", () => {
    const stable = JSON.parse(JSON.stringify(LIKELY)) as ScenarioInputs;
    (stable.revenue as unknown as { rent_ramp?: unknown }).rent_ramp = { enabled: false };
    (stable.revenue as unknown as { unit_mix: Array<Record<string, unknown>> }).unit_mix.forEach((r) => {
      if ((r.current_rent as number) === 0) r.current_rent = r.market_rent;
    });
    const res = calculateUnderwriting(stable);
    expect(pickSdaBaseYear(res).index).toBe(0);
  });
});
