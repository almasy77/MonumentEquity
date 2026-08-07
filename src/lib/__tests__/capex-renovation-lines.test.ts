/**
 * Multiple renovation lines (e.g. full-reno units + partial-reno units): each line
 * has its own cost/unit, unit count, and schedule; capex and renovated-unit pacing
 * sum across the lines. A single line reduces to the legacy per_unit_cost path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
  inp.revenue.rent_ramp = { ...inp.revenue.rent_ramp!, enabled: false };
  inp.exit.hold_period_years = 5; // plenty of room for the reno windows
  return inp;
}

const sumReno = (r: ReturnType<typeof calculateUnderwriting>) =>
  r.annual.reduce((s, a) => s + (a.capex_renovation ?? 0), 0);

describe("renovation lines", () => {
  it("sums capex across lines (full + partial tiers)", () => {
    const inp = bryden();
    inp.capex.renovation_lines = [
      { id: "full", label: "Full", per_unit_cost: 20_000, units_to_renovate: 6, renovation_start_month: 1, renovation_end_month: 6 },
      { id: "partial", label: "Partial", per_unit_cost: 8_000, units_to_renovate: 4, renovation_start_month: 1, renovation_end_month: 6 },
    ];
    const r = calculateUnderwriting(inp);
    // 20k×6 + 8k×4 = 152k, all inside the hold → fully booked.
    expect(sumReno(r)).toBeCloseTo(152_000, 0);
  });

  it("a single renovation_line equals the legacy single-line path", () => {
    // Downtime off on BOTH so the synth (legacy) line and the explicit line match
    // exactly — the fixture has downtime on, which a bare explicit line wouldn't carry.
    const legacy = bryden();
    legacy.capex = { ...legacy.capex, per_unit_cost: 15_000, units_to_renovate: 8, renovation_start_month: 1, renovation_end_month: 8, renovation_downtime_enabled: false };
    const lined = bryden();
    lined.capex = {
      ...lined.capex,
      per_unit_cost: 15_000, units_to_renovate: 8, renovation_start_month: 1, renovation_end_month: 8, renovation_downtime_enabled: false,
      renovation_lines: [{ id: "x", per_unit_cost: 15_000, units_to_renovate: 8, renovation_start_month: 1, renovation_end_month: 8 }],
    };
    const a = calculateUnderwriting(legacy);
    const b = calculateUnderwriting(lined);
    expect(sumReno(b)).toBeCloseTo(sumReno(a), 2);
    expect(b.metrics.irr ?? 0).toBeCloseTo(a.metrics.irr ?? 0, 6);
  });

  it("renovates more units with two lines than either alone (pacing sums)", () => {
    const inp = bryden();
    inp.capex.renovation_lines = [
      { id: "full", per_unit_cost: 20_000, units_to_renovate: 6, renovation_start_month: 1, renovation_end_month: 6 },
      { id: "partial", per_unit_cost: 8_000, units_to_renovate: 4, renovation_start_month: 1, renovation_end_month: 6 },
    ];
    const both = calculateUnderwriting(inp);
    const onlyFull = calculateUnderwriting({ ...inp, capex: { ...inp.capex, renovation_lines: [inp.capex.renovation_lines![0]] } });
    // The exit GPR is higher with both tiers renovated than with only the full tier.
    expect(both.annual[both.annual.length - 1].gpr).toBeGreaterThan(onlyFull.annual[onlyFull.annual.length - 1].gpr);
  });

  it("program off (per_unit_enabled false) spends no renovation capex even with lines", () => {
    const inp = bryden();
    inp.capex.per_unit_enabled = false;
    inp.capex.renovation_lines = [{ id: "full", per_unit_cost: 20_000, units_to_renovate: 6, renovation_start_month: 1, renovation_end_month: 6 }];
    expect(sumReno(calculateUnderwriting(inp))).toBe(0);
  });

  it("warns when reno tiers over-spec the unit count (phantom capex)", () => {
    const inp = bryden(); // Bryden is a 12-unit property
    inp.capex.renovation_lines = [
      { id: "full", per_unit_cost: 20_000, units_to_renovate: 8, renovation_start_month: 1, renovation_end_month: 6 },
      { id: "partial", per_unit_cost: 8_000, units_to_renovate: 8, renovation_start_month: 1, renovation_end_month: 6 },
    ]; // 16 units of reno on a 12-unit property
    const r = calculateUnderwriting(inp);
    expect(r.warnings.some((w) => w.includes("Renovation tiers cover 16 units"))).toBe(true);
    // Well-partitioned tiers (sum ≤ units) do not warn.
    const ok = bryden();
    ok.capex.renovation_lines = [
      { id: "full", per_unit_cost: 20_000, units_to_renovate: 6, renovation_start_month: 1, renovation_end_month: 6 },
      { id: "partial", per_unit_cost: 8_000, units_to_renovate: 4, renovation_start_month: 1, renovation_end_month: 6 },
    ];
    expect(calculateUnderwriting(ok).warnings.some((w) => w.includes("Renovation tiers cover"))).toBe(false);
  });
});
