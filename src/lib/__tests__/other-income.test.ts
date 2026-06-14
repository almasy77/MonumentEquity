/**
 * FIX: itemized-other-income. Structured line-item other income (flat + RUBS),
 * non-recurring exclusion from exit, sub-basis fallback, and legacy parity.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs, OtherIncomeLineItem } from "../underwriting";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

// Ramp off + no renovation downtime ⇒ every unit is in_place all hold ⇒
// physical occupancy = 1, so RUBS income reproduces recovery × utilities
// exactly (no turn/reno vacancy drag).
function stabilizedRubsScenario(lines: OtherIncomeLineItem[], utilitiesAnnual: number): ScenarioInputs {
  const inputs = brydenInputs();
  inputs.revenue.rent_ramp = { ...inputs.revenue.rent_ramp!, enabled: false };
  inputs.capex = { ...inputs.capex, units_to_renovate: 0, renovation_downtime_enabled: false };
  inputs.expenses.utilities_per_unit = 0;
  inputs.expenses.opex_inputs = { ...(inputs.expenses.opex_inputs ?? {}), utilities: { value: utilitiesAnnual, mode: "total_annual" } };
  inputs.revenue.other_income = { line_items: lines };
  return inputs;
}

describe("FIX: itemized other income — RUBS rows", () => {
  it("reproduces the 738 Bryden RUBS structure ($25,915, 137% recovery) and surfaces the ratio", () => {
    const utilities = 18909; // T-12 actual utility expense
    const inputs = stabilizedRubsScenario(
      [
        { label: "RUBS - Electric", kind: "rubs", rubs_recovery_pct: 14294 / utilities, rubs_basis: "utilities_total", recurring: true, source_note: "T-12 actual" },
        { label: "RUBS - Water/Other", kind: "rubs", rubs_recovery_pct: 11621 / utilities, rubs_basis: "utilities_total", recurring: true, source_note: "T-12 actual" },
      ],
      utilities,
    );
    const r = calculateUnderwriting(inputs);
    const d = r.other_income_detail!;
    expect(d).toBeDefined();
    expect(d.total_annual).toBeCloseTo(25915, 0);
    expect(d.rubs_total_annual).toBeCloseTo(25915, 0);
    expect(d.utilities_annual).toBeCloseTo(18909, 0);
    expect(d.aggregate_recovery_ratio!).toBeCloseTo(1.37, 2); // 137%, visibly above 100%
    // A >100% aggregate gross-up is surfaced as a warning, not hidden.
    expect(r.warnings.some((w) => w.includes("Aggregate RUBS recovery"))).toBe(true);
  });

  it("detail ties to the modeled year-1 other income (sum of monthly)", () => {
    const utilities = 18909;
    const inputs = stabilizedRubsScenario(
      [{ label: "RUBS", kind: "rubs", rubs_recovery_pct: 0.8, rubs_basis: "utilities_total", recurring: true, source_note: "lease audit" }],
      utilities,
    );
    const r = calculateUnderwriting(inputs);
    expect(r.other_income_detail!.total_annual).toBeCloseTo(r.annual[0].other_income, 2);
    expect(r.annual[0].other_income).toBeCloseTo(0.8 * utilities, 0); // physOcc = 1
  });

  it("warns and falls back to total utilities when a sub-basis subline is absent", () => {
    const inputs = stabilizedRubsScenario(
      [{ label: "RUBS - Electric", kind: "rubs", rubs_recovery_pct: 0.9, rubs_basis: "utilities_electric", recurring: true }],
      18909,
    );
    const r = calculateUnderwriting(inputs);
    expect(r.warnings.some((w) => w.includes("not itemized") && w.includes("falling back"))).toBe(true);
    // Falls back to total utilities (18909), not zero.
    expect(r.other_income_detail!.rubs_total_annual).toBeCloseTo(0.9 * 18909, 0);
  });

  it("gross-up (>100%) on a single line without a source note warns", () => {
    const inputs = stabilizedRubsScenario(
      [{ label: "RUBS", kind: "rubs", rubs_recovery_pct: 1.2, rubs_basis: "utilities_total", recurring: true }],
      18909,
    );
    const r = calculateUnderwriting(inputs);
    expect(r.warnings.some((w) => w.includes("gross-up") && w.includes("source note"))).toBe(true);
  });
});

describe("FIX: itemized other income — recurring vs non-recurring", () => {
  it("non-recurring income is received in-period but excluded from exit value", () => {
    // Zero the %EGI management fee so the only difference between the two runs
    // is the non-recurring income itself (no variable-opex confound).
    const base = brydenInputs();
    base.revenue.rent_ramp = { ...base.revenue.rent_ramp!, enabled: false };
    base.expenses.management_fee_rate = 0;
    base.revenue.other_income = { line_items: [{ label: "Laundry", kind: "flat", monthly_amount: 1000, recurring: true }] };

    const withNonRec = brydenInputs();
    withNonRec.revenue.rent_ramp = { ...withNonRec.revenue.rent_ramp!, enabled: false };
    withNonRec.expenses.management_fee_rate = 0;
    withNonRec.revenue.other_income = { line_items: [
      { label: "Laundry", kind: "flat", monthly_amount: 1000, recurring: true },
      { label: "Deposit forfeiture", kind: "flat", monthly_amount: 500, recurring: false },
    ]};

    const rBase = calculateUnderwriting(base);
    const rNon = calculateUnderwriting(withNonRec);

    // In-period: the non-recurring income IS collected (higher other income).
    const lastIdx = rNon.annual.length - 1;
    expect(rNon.annual[lastIdx].other_income).toBeGreaterThan(rBase.annual[lastIdx].other_income);
    expect(rNon.other_income_detail!.total_annual - rNon.other_income_detail!.stabilized_annual).toBeCloseTo(6000, 0);

    // Exit value is driven by the stabilized NOI — unchanged by non-recurring income.
    expect(rNon.metrics.exit_value).toBeCloseTo(rBase.metrics.exit_value, 0);
    expect(rNon.metrics.exit_noi).toBeCloseTo(rBase.metrics.exit_noi, 0);
  });
});

describe("FIX: itemized other income — flat lines & precedence", () => {
  it("flat line items sum without growth and supersede the flat field", () => {
    const inputs = brydenInputs();
    inputs.revenue.rent_ramp = { ...inputs.revenue.rent_ramp!, enabled: false };
    inputs.revenue.other_income_monthly = 350; // legacy value should be ignored
    inputs.revenue.other_income = { line_items: [
      { label: "Laundry", kind: "flat", monthly_amount: 200, recurring: true },
      { label: "Parking", kind: "flat", monthly_amount: 100, recurring: true },
    ]};
    const r = calculateUnderwriting(inputs);
    // Year-1 other income = (200 + 100) × 12 = 3600 (NOT the legacy 350×12).
    expect(r.annual[0].other_income).toBeCloseTo(3600, 0);
    // Flat does not grow: last year equals year 1.
    expect(r.annual[r.annual.length - 1].other_income).toBeCloseTo(3600, 0);
    expect(r.other_income_detail!.total_annual).toBeCloseTo(3600, 0);
  });

  it("line items take precedence over the Phase 4 structured RUBS knob", () => {
    const inputs = stabilizedRubsScenario(
      [{ label: "Parking", kind: "flat", monthly_amount: 250, recurring: true }],
      18909,
    );
    inputs.revenue.rubs = { mode: "structured", recovery_pct: 0.8 }; // should be ignored
    const r = calculateUnderwriting(inputs);
    expect(r.annual[0].other_income).toBeCloseTo(3000, 0); // 250×12, RUBS knob ignored
    expect(r.other_income_detail).toBeDefined();
  });
});

describe("FIX: itemized other income — legacy parity", () => {
  it("no line items ⇒ no detail, flat field drives other income (byte-identical path)", () => {
    const inputs = brydenInputs();
    inputs.revenue.rent_ramp = { ...inputs.revenue.rent_ramp!, enabled: false };
    inputs.revenue.other_income_monthly = 350;
    const r = calculateUnderwriting(inputs);
    expect(r.other_income_detail).toBeUndefined();
    expect(r.annual[0].other_income).toBeCloseTo(350 * 12, 6);
  });
});
