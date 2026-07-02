/**
 * §461(l) excess-business-loss cap regression. A capped loss year must only
 * shield up to `ebl_cap_mfj` in the CURRENT year; the excess becomes an NOL that
 * releases the FOLLOWING year (one-year lag). The bug: the release fired in the
 * same year the excess was created, fully defeating the cap for every year > 1.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

// REPS on every year, a tiny EBL cap, and a large renovation placed in YEAR 2 so
// depreciation drives a big Year-2 loss (~$2.1M) — the exact shape that exposed
// the bug (a loss in a year > 1 that far exceeds the cap).
function eblScenario(): ScenarioInputs {
  const inputs = brydenInputs();
  inputs.tax = {
    ...inputs.tax!,
    reps_status: Array(10).fill(true),
    ebl_cap_mfj: 5000,
    federal_bonus_pct: 1.0,
    reno_5yr_pct: 0.9,
  };
  inputs.capex = {
    ...inputs.capex,
    units_to_renovate: 12,
    per_unit_cost: 200_000,
    renovation_start_month: 13,
    renovation_end_month: 14,
    renovation_downtime_enabled: false,
    projects: [],
  };
  return inputs;
}

const shield = (fedTax: number) => (fedTax < 0 ? -fedTax : 0);

describe("§461(l) EBL cap holds in years after Year 1", () => {
  it("caps a large Year-2 loss instead of shielding it in full", () => {
    const r = calculateUnderwriting(eblScenario());
    const y = r.tax!.years;

    const tiY1 = y[0].federal_taxable_income;
    const tiY2 = y[1].federal_taxable_income;
    expect(tiY1).toBeLessThan(0); // Year-1 loss
    expect(tiY2).toBeLessThan(-1_000_000); // large Year-2 loss

    // Year 1 is capped (shield ≪ full-loss shield).
    expect(shield(y[0].federal_tax)).toBeLessThan(10_000);

    // Year 2's own multi-million loss must NOT be fully shielded this year — the
    // cap holds, so the Year-2 shield stays far below ~0.37 × the loss. The bug
    // released the whole NOL same-year (shield ≈ $900K); the fix keeps it capped.
    expect(shield(y[1].federal_tax)).toBeLessThan(Math.abs(tiY2) * 0.15);
    expect(shield(y[1].federal_tax)).toBeGreaterThan(0); // prior-year excess DOES release

    // The deferred excess is not lost — it releases the following year.
    expect(shield(y[2].federal_tax)).toBeGreaterThan(0);
  });
});
