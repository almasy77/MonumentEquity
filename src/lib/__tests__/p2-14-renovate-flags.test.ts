/**
 * P2-14: per-unit `renovate` flags + optional `renovated_rent` target on the rent roll.
 *
 * When the rent roll carries explicit per-unit `renovate: true` flags, those flags
 * (not the auto deepest-below-market ranking, nor the renovation line's unit count)
 * decide WHICH and HOW MANY units renovate. Total renovation cost = per-unit cost ×
 * flagged count. An optional per-unit `renovated_rent` is the post-reno target rent,
 * overriding the base+premium formula for that unit. With no flags set, behavior is
 * byte-identical (opt-in).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
) as ScenarioInputs;

const PER_UNIT_COST = 8000; // bryden capex: 6 units × $8,000, start m3 end m14, downtime 1

function clone(): ScenarioInputs {
  return JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
}

function renoSpend(r: ReturnType<typeof calculateUnderwriting>): number {
  return r.monthly.reduce((s, m) => s + (m.capex_renovation ?? 0), 0);
}

/** unit_ids that reach the renovated state at any month. */
function renovatedIds(r: ReturnType<typeof calculateUnderwriting>): string[] {
  return r.unit_schedule.units
    .filter((u) => u.states.includes("renovated"))
    .map((u) => u.unit_id)
    .sort();
}

type Detail = NonNullable<ScenarioInputs["revenue"]["unit_mix"][number]["units"]>[number];

/** Flat list of every per-unit detail with its below-market gap. */
function flatUnits(s: ScenarioInputs) {
  const out: Array<{ u: Detail; gap: number }> = [];
  for (const row of s.revenue.unit_mix) {
    for (const u of row.units ?? []) {
      const mkt = u.market_rent ?? row.market_rent;
      out.push({ u, gap: mkt - (u.current_rent || 0) });
    }
  }
  return out;
}

describe("P2-14: per-unit renovate flags", () => {
  it("no flags → renovation spend and selection are unchanged (opt-in)", () => {
    const base = calculateUnderwriting(GOLDEN);
    expect(renoSpend(base)).toBeCloseTo(6 * PER_UNIT_COST, 0); // 48,000 from the line
    expect(renovatedIds(base).length).toBe(6); // auto deepest-gap picks 6
  });

  it("total cost = per-unit cost × flagged count (not the line's unit count)", () => {
    const s = clone();
    let n = 0;
    for (const f of flatUnits(s)) {
      if (n < 3) { f.u.renovate = true; n++; }
    }
    const r = calculateUnderwriting(s);
    expect(renoSpend(r)).toBeCloseTo(3 * PER_UNIT_COST, 0); // 24,000 — flags drive the count
    expect(renovatedIds(r).length).toBe(3);
  });

  it("flags select exactly those units, overriding the auto deepest-gap ranking", () => {
    const s = clone();
    // Flag the two SMALLEST-gap units — the ones the auto-ranker renovates LAST
    // (and never, since only 6 of 12 renovate). If flags win, exactly these two
    // reach the renovated state.
    const flat = flatUnits(s).sort((a, b) => a.gap - b.gap);
    flat[0].u.renovate = true;
    flat[1].u.renovate = true;
    const targetIds = [flat[0].u.unit_id, flat[1].u.unit_id].sort();

    const r = calculateUnderwriting(s);
    expect(renovatedIds(r)).toEqual(targetIds);

    // And prove the override: these smallest-gap units are NOT in the auto baseline.
    const base = calculateUnderwriting(GOLDEN);
    for (const id of targetIds) expect(renovatedIds(base)).not.toContain(id);
  });

  it("per-unit renovated_rent is the post-reno target, overriding base+premium", () => {
    const s = clone();
    const flat = flatUnits(s).sort((a, b) => a.gap - b.gap);
    const target = flat[0].u;
    target.renovate = true;
    target.renovated_rent = 9999; // explicit target, not current/market + premium
    const r = calculateUnderwriting(s);
    const tl = r.unit_schedule.units.find((u) => u.unit_id === target.unit_id)!;
    expect(tl.renovated_rent).toBe(9999);
    expect(tl.states).toContain("renovated");
  });

  it("the per-unit renovation A/B toggle still wins over flags", () => {
    const s = clone();
    (s.capex as unknown as Record<string, unknown>).per_unit_enabled = false; // program OFF
    for (const f of flatUnits(s)) f.u.renovate = true; // flag everything
    const r = calculateUnderwriting(s);
    expect(renoSpend(r)).toBeCloseTo(0, 0); // no cost — toggle off beats flags
    expect(renovatedIds(r).length).toBe(0);
  });
});
