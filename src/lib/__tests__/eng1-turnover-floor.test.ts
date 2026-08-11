/**
 * ENG-1: turnover expense must never collapse to $0 while a positive turnover
 * rate and a positive per-unit cost are configured.
 *
 * Root cause (fixed in computeRampTurnoverCost): the ongoing-churn term keyed off
 * "stabilized" units — only those in the `market`/`renovated` states. Under a
 * MARKET pro-forma basis every occupied unit stays in the `in_place` state at
 * market rent and never migrates, so the stabilized count was 0 in all 120
 * months and turnover was booked as $0 for the whole hold — even though the
 * assumptions specified $2,500/unit at an 8% annual turnover rate. Natural
 * tenant churn happens on EVERY rent-paying unit, so ongoing churn is now based
 * on occupied units (in_place + market + renovated).
 *
 * The fixture is 4443 Mobile Drive, Likely Case, reconstructed to the cent from
 * MonumentEquity_Underwriter_Fix_Spec_20260811.md Section 5. The acceptance
 * numbers below are the spec's "after ENG-1 lands, before ENG-2 lands" block, so
 * ENG-1 is verified in isolation. Note every figure moves in the WORSE direction
 * (NOI, cap, DSCR all fall) — the spec's signal that the fix is real, not tuned.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateUnderwriting,
  computeRampTurnoverCost,
  type ScenarioInputs,
} from "../underwriting";

const LIKELY = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

describe("ENG-1: turnover is assumption-derived, never $0 under Market basis", () => {
  const res = calculateUnderwriting(LIKELY);
  const y1 = res.annual[0];

  it("Year 1 turnover = $2,500 × 24 units × 8% = $4,800.00 (was $0)", () => {
    expect(y1.opex_breakdown.turnover).toBeCloseTo(4800, 2);
  });

  it("Year 1 total opex = $183,837.33 (was $179,037.33)", () => {
    expect(y1.total_opex).toBeCloseTo(183837.33, 0);
  });

  it("Year 1 NOI = $175,708.67 (was $180,508.67 — the fix makes NOI worse)", () => {
    expect(y1.noi).toBeCloseTo(175708.67, 0);
  });

  it("Year 1 DSCR = 1.6143 (was 1.6584)", () => {
    expect(res.metrics.year1_dscr).toBeCloseTo(1.6143, 4);
  });

  it("Going-in cap = 8.571% (was 8.805%)", () => {
    expect(res.metrics.going_in_cap).toBeCloseTo(0.085711, 5);
  });

  it("EGI is unchanged at $359,546.00 (ENG-1 touches opex only, not revenue)", () => {
    expect(y1.egi).toBeCloseTo(359546, 0);
  });

  it("turnover exactly equals opex delta from the pre-fix baseline", () => {
    // Pre-fix opex was $179,037.33; the only line that moved is turnover.
    expect(y1.total_opex - 179037.33).toBeCloseTo(y1.opex_breakdown.turnover, 2);
  });

  it("every one of the 120 months books a positive turnover expense", () => {
    for (const mo of res.monthly) {
      expect(mo.opex_breakdown.turnover).toBeGreaterThan(0);
    }
  });
});

describe("ENG-1: computeRampTurnoverCost floor invariant", () => {
  it("returns > 0 whenever occupied units, rate and cost are all positive — even with zero turns", () => {
    const cost = computeRampTurnoverCost({
      perUnitCost: 2500,
      marketTurnsThisMonth: 0,
      renoTurnsThisMonth: 0,
      occupiedUnits: 24,
      turnoverRate: 0.08,
    });
    // 24 × (0.08 / 12) × 2500 = $400/mo → $4,800/yr.
    expect(cost).toBeCloseTo(400, 6);
  });

  it("is $0 only when there is no occupancy and no turns (a truly empty month)", () => {
    expect(
      computeRampTurnoverCost({ perUnitCost: 2500, marketTurnsThisMonth: 0, renoTurnsThisMonth: 0, occupiedUnits: 0, turnoverRate: 0.08 }),
    ).toBe(0);
  });

  it("adds ramp make-ready on top of ongoing churn during absorption turns", () => {
    const withTurns = computeRampTurnoverCost({ perUnitCost: 2500, marketTurnsThisMonth: 2, renoTurnsThisMonth: 0, occupiedUnits: 24, turnoverRate: 0.08 });
    const noTurns = computeRampTurnoverCost({ perUnitCost: 2500, marketTurnsThisMonth: 0, renoTurnsThisMonth: 0, occupiedUnits: 24, turnoverRate: 0.08 });
    expect(withTurns - noTurns).toBeCloseTo(2 * 2500, 6); // two non-reno turns × cost
  });
});
