/**
 * SDA input-cell regression (SDA-1 + SDA-2). The 08-12 export's SDA overstated
 * Likely-Case returns vs the engine (~2x CoC, +175bps IRR) because two input
 * cells were wrong:
 *   - Scenarios!AE42 (replacement/capital reserve $/unit) was written $0, so the
 *     SDA's cash-flow-for-distribution never deducted the reserves the engine
 *     deducts below NOI.
 *   - Exit Strategy!I9 (cap-rate escalator) was clamped to ≥ 0, so a value-add
 *     deal underwritten to a LOWER exit cap than its going-in cap (compression)
 *     silently exited at the going-in cap.
 * The SDA's returns are Excel formulas we can't recalc headlessly, so we assert
 * the input cells that drive them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { buildSdaWrites } from "../sda-fill-mapping";

const LIKELY = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

function cellsFor(sheet: string) {
  const result = calculateUnderwriting(LIKELY);
  const writes = buildSdaWrites([{ name: "Likely", type: "base", inputs: LIKELY, result, units: 24 }], 0);
  return { cells: writes.find((w) => w.sheet === sheet)?.cells ?? {}, result };
}

describe("SDA-2: reserves reach the SDA distribution line", () => {
  it("AE42 carries the engine's per-unit annual reserve (replacement + capital), not $0", () => {
    const { cells, result } = cellsFor("Scenarios");
    // Engine reserves for the SDA's stabilized base year, per unit.
    const base = result.annual.find((a) => (a.loss_to_lease ?? 0) <= 0.005 && a.cash_flow_before_capex_and_reserves >= 0)
      ?? result.annual[result.annual.length - 1];
    const expectedPerUnit = ((base.reserves ?? 0) + (base.capital_reserve ?? 0)) / 24;
    expect(expectedPerUnit).toBeGreaterThan(0);
    expect(cells["AE42"]).toBeCloseTo(expectedPerUnit, 6);
  });
});

describe("SDA-1: the SDA exits at the true exit cap, including compression", () => {
  it("I9 escalator is negative when the exit cap is below the stabilized cap", () => {
    const { cells, result } = cellsFor("Exit Strategy");
    const sdaCap = result.metrics.stabilized_cap; // row 60 basis
    const exitCap = (LIKELY.exit as { exit_cap_rate: number }).exit_cap_rate;
    const hold = (LIKELY.exit as { hold_period_years: number }).hold_period_years;
    expect(exitCap).toBeLessThan(sdaCap); // compression vs the stabilized cap
    // exit cap at disposition = stabilized + I9 × hold  ⇒  I9 = (exit − stabilized)/hold  (negative)
    expect(cells["I9"]).toBeLessThan(0);
    expect(cells["I9"]).toBeCloseTo((exitCap - sdaCap) / hold, 9);
    // The reconstructed exit cap ties to the assumption.
    expect(sdaCap + (cells["I9"] as number) * hold).toBeCloseTo(exitCap, 9);
  });
});
