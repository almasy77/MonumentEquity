/**
 * Phase 4 unit tests: DSCR-aware loan sizing, structured RUBS, and the
 * CapEx guardrail (fix-spec 2026-06-12, Phase 4).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { capexGuardrailWarning } from "../checks";
import type { Deal } from "../validations";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

describe("Phase 4.1: DSCR-aware loan sizing", () => {
  it("names the binding constraint and resizes to the DSCR loan", () => {
    const r = calculateUnderwriting(brydenInputs());
    const m = r.metrics;
    expect(m.loan_sizing_constraint).toBe("dscr");
    expect(m.dscr_loan_amount).not.toBeNull();
    expect(m.loan_amount).toBeCloseTo(m.dscr_loan_amount!, 0);
    expect(m.loan_amount).toBeLessThan(m.ltv_loan_amount);
    // Resized loan lands exactly on the floor.
    expect(m.year1_dscr).toBeCloseTo(1.25, 4);
    // Surfaced to the user, not silent.
    expect(r.warnings.some((w) => w.includes("Loan sized by DSCR"))).toBe(true);
  });

  it("size_to_dscr=false restores pure LTV proceeds", () => {
    const inputs = brydenInputs();
    inputs.financing.size_to_dscr = false;
    const r = calculateUnderwriting(inputs);
    expect(r.metrics.loan_sizing_constraint).toBe("ltv");
    expect(r.metrics.loan_amount).toBeCloseTo(inputs.purchase.purchase_price * inputs.financing.ltv, 0);
    expect(r.metrics.dscr_loan_amount).toBeNull();
  });

  it("custom dscr_floor shifts proceeds inversely", () => {
    const lo = brydenInputs();
    lo.financing.dscr_floor = 1.20;
    const hi = brydenInputs();
    hi.financing.dscr_floor = 1.40;
    const rLo = calculateUnderwriting(lo);
    const rHi = calculateUnderwriting(hi);
    expect(rLo.metrics.loan_amount).toBeGreaterThan(rHi.metrics.loan_amount);
  });
});

describe("Phase 4.2: structured RUBS", () => {
  it("structured mode derives reimbursement from utilities × recovery × occupancy", () => {
    const base = brydenInputs();
    base.revenue.rubs = undefined;
    const structured = brydenInputs();
    structured.revenue.rubs = { mode: "structured", recovery_pct: 0.80 };
    const rBase = calculateUnderwriting(base);
    const rStr = calculateUnderwriting(structured);
    const added = rStr.annual[0].other_income - rBase.annual[0].other_income;
    const utilitiesY1 = rStr.annual[0].opex_breakdown.utilities;
    // Recovery ratio of the added income over billed utilities sits at or
    // below 80% (occupancy < 100% during the ramp drags it down).
    expect(added).toBeGreaterThan(0);
    expect(added / utilitiesY1).toBeLessThanOrEqual(0.80 + 1e-9);
    expect(added / utilitiesY1).toBeGreaterThan(0.5);
  });

  it("recovery above 85% without a source note warns; with a note it does not", () => {
    const noNote = brydenInputs();
    noNote.revenue.rubs = { mode: "structured", recovery_pct: 0.90 };
    expect(calculateUnderwriting(noNote).warnings.some((w) => w.includes("RUBS recovery"))).toBe(true);

    const withNote = brydenInputs();
    withNote.revenue.rubs = { mode: "structured", recovery_pct: 0.90, source_note: "Lease audit 2026-05: 100% RUBS billback in place" };
    expect(calculateUnderwriting(withNote).warnings.some((w) => w.includes("RUBS recovery"))).toBe(false);
  });

  it("manual reimbursement implying >85% recovery warns", () => {
    const inputs = brydenInputs();
    const r0 = calculateUnderwriting(inputs);
    const utilitiesY1 = r0.annual[0].opex_breakdown.utilities;
    inputs.revenue.other_income_sublines = { utility_reimbursement: (utilitiesY1 * 0.95) / 12 };
    inputs.revenue.other_income_monthly += (utilitiesY1 * 0.95) / 12;
    const r = calculateUnderwriting(inputs);
    expect(r.warnings.some((w) => w.includes("Manual RUBS implies"))).toBe(true);
  });
});

describe("Phase 4.3: CapEx guardrail", () => {
  const oldDeal = { year_built: 1940 } as unknown as Deal;
  const newDeal = { year_built: 2015 } as unknown as Deal;

  it("warns for an old building with no projects and no PCA", () => {
    const inputs = brydenInputs();
    inputs.capex.projects = [];
    inputs.capex.pca_complete = undefined;
    expect(capexGuardrailWarning(oldDeal, inputs)).toMatch(/deferred maintenance/);
  });

  it("silent when PCA complete, projects named, or building is young", () => {
    const inputs = brydenInputs();
    inputs.capex.projects = [];
    inputs.capex.pca_complete = true;
    expect(capexGuardrailWarning(oldDeal, inputs)).toBeNull();

    const withProjects = brydenInputs();
    withProjects.capex.projects = [{ name: "Roof", cost: 40000, month: 3 } as never];
    withProjects.capex.pca_complete = undefined;
    expect(capexGuardrailWarning(oldDeal, withProjects)).toBeNull();

    const young = brydenInputs();
    young.capex.projects = [];
    expect(capexGuardrailWarning(newDeal, young)).toBeNull();
  });
});
