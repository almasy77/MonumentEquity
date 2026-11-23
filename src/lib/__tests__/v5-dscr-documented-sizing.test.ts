/**
 * Engine v5 — loan sizing on documented in-place NOI (lender feedback, Nov 2026).
 *
 * A lender sizes on documented in-place NOI at 1.30x; the app had sized on Year-1
 * PROJECTED NOI at a 1.25x default. These are the four acceptance tests from the fix
 * spec, plus the floor default and the sensitivity grid. Fixtures are anonymized
 * (a real Base/Offer pair's shape, dollar figures rescaled, names removed).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateUnderwriting,
  dscrLoanForNOI,
  resolveDscrFloor,
  DEFAULT_DSCR_FLOOR,
  type ScenarioInputs,
  type DscrSizingBasis,
} from "../underwriting";
import { toEngineInputs } from "../engine-version";
import type { Scenario } from "../validations";

function load(name: string): Scenario {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8")) as Scenario;
}

function inputs(
  name: string,
  patch: { floor?: number | null; basis?: DscrSizingBasis | null } = {},
  deal?: { current_noi?: number },
  dropSellerNoi = false,
): ScenarioInputs {
  const s = load(name) as unknown as Record<string, Record<string, unknown>>;
  if (patch.floor === null) delete s.financing_assumptions.dscr_floor;
  else if (patch.floor != null) s.financing_assumptions.dscr_floor = patch.floor;
  if (patch.basis === null) delete s.financing_assumptions.dscr_sizing_basis;
  else if (patch.basis != null) s.financing_assumptions.dscr_sizing_basis = patch.basis;
  if (dropSellerNoi) delete s.pricing_views;
  return toEngineInputs(s as unknown as Scenario, deal);
}

const RATE = 0.075 / 12;
const N = 360;

describe("engine v5 — DSCR sizing on documented in-place NOI", () => {
  it("loan constant at 7.5% / 30-yr monthly is 0.083906", () => {
    const loan = dscrLoanForNOI(0.083906 * 1.3 * 1_000_000, 1.3, RATE, N);
    expect(loan).toBeCloseTo(1_000_000, -2);
  });

  // Acceptance 1: reproduce today's stored Base result exactly.
  it("AT-1: Base, floor 1.25 + year1_projected → engine v4 loan reproduced exactly", () => {
    const r = calculateUnderwriting(inputs("sample-base", { floor: 1.25, basis: "year1_projected" }));
    // v4 sizing arithmetic (NOI ÷ floor ÷ 12 ÷ payment factor) is unchanged. On the
    // real scenario this matched the live app to the last digit; this is the
    // anonymized fixture's regression value.
    expect(r.metrics.loan_amount).toBe(798415.4357563594);
    expect(r.metrics.irr).toBe(-0.04803504145591639);
    expect(r.metrics.dscr_binding_constraint).toBe("dscr_year1");
    // The stored scenario (basis unset) also reproduces byte-for-byte.
    const stored = calculateUnderwriting(inputs("sample-base"));
    expect(stored.metrics.loan_amount).toBe(798415.4357563594);
  });

  // Acceptance 2
  it("AT-2: Base, floor 1.30 + documented NOI → documented NOI ÷ 1.30 ÷ loan constant", () => {
    const r = calculateUnderwriting(inputs("sample-base", { floor: 1.3, basis: "documented" }));
    expect(r.metrics.dscr_sizing_noi).toBe(76795);
    expect(r.metrics.documented_noi_source).toBe("seller_proforma_noi");
    // Hand check: 76,795 / 1.30 / 0.083906 loan constant (7.5% / 30-yr) ≈ 704,0xx.
    expect(Math.abs(r.metrics.loan_amount - 76795 / 1.3 / 0.083906)).toBeLessThan(25);
    expect(r.metrics.loan_amount).toBeCloseTo(704040.9416625889, 6);
    expect(r.metrics.dscr_binding_constraint).toBe("dscr_documented");
    expect(r.metrics.year1_dscr).toBeGreaterThan(1.3); // Y1 NOI above documented NOI
    expect(r.warnings[0]).toMatch(/^Loan sized by DSCR 1\.30x on documented in-place NOI \$76,795: \$704,041 vs LTV proceeds \$1,392,825/);
  });

  // Acceptance 3
  it("AT-3: Offer, documented at 1.30 → DSCR binds below LTV; equity rises by the loan cut net of fees", () => {
    const before = calculateUnderwriting(inputs("sample-offer"));
    expect(before.metrics.loan_amount).toBe(756105); // LTV binds today
    expect(before.metrics.loan_sizing_constraint).toBe("ltv");
    const r = calculateUnderwriting(inputs("sample-offer", { basis: "documented" }));
    expect(r.metrics.ltv_loan_amount).toBe(756105);
    expect(r.metrics.loan_amount).toBeCloseTo(704040.9416625889, 6);
    expect(r.metrics.dscr_binding_constraint).toBe("dscr_documented");
    expect(r.metrics.dscr_loan_amount_documented).toBeCloseTo(r.metrics.loan_amount, 6);
    expect(r.metrics.dscr_loan_amount_year1).toBeCloseTo(dscrLoanForNOI(before.annual[0].noi, 1.3, RATE, N), 4);
    const extraEquity = r.metrics.total_equity - before.metrics.total_equity;
    // Equity rises by the loan cut less the 1% origination fee on it.
    const loanCut = before.metrics.loan_amount - r.metrics.loan_amount;
    expect(extraEquity).toBeCloseTo(loanCut * (1 - 0.01), 2);
    // lesser_of picks documented here too (documented NOI < Y1 NOI).
    const lesser = calculateUnderwriting(inputs("sample-offer", { basis: "lesser_of" }));
    expect(lesser.metrics.loan_amount).toBeCloseTo(r.metrics.loan_amount, 6);
  });

  // Acceptance 4
  it("AT-4: no documented NOI → falls back to year-1 with a warning, no crash", () => {
    for (const basis of ["documented", "lesser_of"] as const) {
      const r = calculateUnderwriting(inputs("sample-base", { floor: 1.3, basis }, undefined, true));
      expect(r.metrics.documented_noi).toBeNull();
      expect(r.metrics.dscr_sizing_basis_applied).toBe("year1_projected");
      expect(r.metrics.dscr_sizing_noi).toBeCloseTo(83739.54848000004, 6);
      expect(r.warnings.some((w) => /has no documented NOI/.test(w))).toBe(true);
      expect(Number.isFinite(r.metrics.loan_amount)).toBe(true);
    }
  });

  it("deal current NOI wins over Pricing Views seller NOI (Bryan, Nov 23)", () => {
    const r = calculateUnderwriting(inputs("sample-base", { floor: 1.3, basis: "documented" }, { current_noi: 60000 }));
    expect(r.metrics.documented_noi).toBe(60000);
    expect(r.metrics.documented_noi_source).toBe("deal_current_noi");
    // No current NOI → Pricing Views seller NOI is the fallback.
    const pv = calculateUnderwriting(inputs("sample-base", { floor: 1.3, basis: "documented" }, {}));
    expect(pv.metrics.documented_noi).toBe(76795);
    expect(pv.metrics.documented_noi_source).toBe("seller_proforma_noi");
  });

  it("unset floor resolves to 1.30 (Bryan, Nov 2026); explicit floor wins", () => {
    expect(DEFAULT_DSCR_FLOOR).toBe(1.3);
    expect(resolveDscrFloor({})).toEqual({ floor: 1.3, source: "default" });
    expect(resolveDscrFloor({ dscr_floor: 1.25 })).toEqual({ floor: 1.25, source: "explicit" });
    const r = calculateUnderwriting(inputs("sample-base", { floor: null, basis: "year1_projected" }));
    expect(r.metrics.dscr_floor_source).toBe("default");
    expect(r.metrics.year1_dscr).toBeCloseTo(1.3, 6);
  });

  it("sensitivity grid center cell sizes with the same basis as the headline", () => {
    // Center cell ties to the headline IRR (anchor), and the off-center cells move
    // with the documented-basis loan: a cheaper price can't raise proceeds above the
    // documented-NOI DSCR loan, so IRR at −10% price must differ from year-1 sizing.
    const doc = calculateUnderwriting(inputs("sample-offer", { basis: "documented" }));
    const y1 = calculateUnderwriting(inputs("sample-offer", { basis: "year1_projected" }));
    const center = (r: typeof doc) => r.sensitivity.find((c) => c.purchase_price_delta === 0 && Math.abs(c.exit_cap_rate - 0.09) < 1e-9)!;
    expect(center(doc).irr).toBeCloseTo(doc.metrics.irr!, 9);
    expect(doc.sensitivity.map((c) => c.irr)).not.toEqual(y1.sensitivity.map((c) => c.irr));
  });
});
