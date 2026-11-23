/**
 * Engine v5 — loan sizing on documented in-place NOI (Manny Lou feedback, Nov 20 2026).
 *
 * Lincoln Terrace: seller T12 NOI $67,542 at 7.5% / 30-yr / 1.30x sizes ~$619K, while
 * the app had sized on Year-1 PROJECTED NOI at a 1.25x default. These are the four
 * acceptance tests from the fix spec, plus the floor default and the sensitivity grid.
 * Fixtures are the two stored Lincoln scenarios' inputs, verbatim.
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
  it("AT-1: Lincoln Base, floor 1.25 + year1_projected → loan $702,154 (unchanged)", () => {
    const r = calculateUnderwriting(inputs("lincoln-base", { floor: 1.25, basis: "year1_projected" }));
    expect(r.metrics.loan_amount).toBe(702154.3988689644); // value served by the live app on Nov 20
    expect(r.metrics.irr).toBe(-0.04803550379895935);
    expect(r.metrics.dscr_binding_constraint).toBe("dscr_year1");
    // The stored scenario (basis unset) also reproduces byte-for-byte.
    const stored = calculateUnderwriting(inputs("lincoln-base"));
    expect(stored.metrics.loan_amount).toBe(702154.3988689644);
  });

  // Acceptance 2
  it("AT-2: Lincoln Base, floor 1.30 + documented ($67,542) → ~$619,211", () => {
    const r = calculateUnderwriting(inputs("lincoln-base", { floor: 1.3, basis: "documented" }));
    expect(r.metrics.dscr_sizing_noi).toBe(67542);
    expect(r.metrics.documented_noi_source).toBe("seller_proforma_noi");
    expect(r.metrics.loan_amount).toBeGreaterThan(619_100);
    expect(r.metrics.loan_amount).toBeLessThan(619_300);
    expect(r.metrics.dscr_binding_constraint).toBe("dscr_documented");
    expect(r.metrics.year1_dscr).toBeGreaterThan(1.3); // Y1 NOI $73.6K > documented $67.5K
    expect(r.warnings[0]).toMatch(/^Loan sized by DSCR 1\.30x on documented in-place NOI \$67,542: \$619,2\d\d vs LTV proceeds \$1,225,000/);
  });

  // Acceptance 3
  it("AT-3: Lincoln Offer $950K, documented at 1.30 → DSCR binds ~$619K vs LTV $665K; equity +~$45.8K", () => {
    const before = calculateUnderwriting(inputs("lincoln-offer-950k"));
    expect(before.metrics.loan_amount).toBe(665000); // LTV binds today
    const r = calculateUnderwriting(inputs("lincoln-offer-950k", { basis: "documented" }));
    expect(r.metrics.ltv_loan_amount).toBe(665000);
    expect(r.metrics.loan_amount).toBeGreaterThan(619_100);
    expect(r.metrics.loan_amount).toBeLessThan(619_300);
    expect(r.metrics.dscr_binding_constraint).toBe("dscr_documented");
    expect(r.metrics.dscr_loan_amount_documented).toBeCloseTo(r.metrics.loan_amount, 6);
    expect(r.metrics.dscr_loan_amount_year1).toBeCloseTo(dscrLoanForNOI(87272.3984, 1.3, RATE, N), 4);
    const extraEquity = r.metrics.total_equity - before.metrics.total_equity;
    // Loan falls ~$45,789; origination (1%) falls with it, so equity rises ~$45.3K.
    expect(extraEquity).toBeGreaterThan(45_000);
    expect(extraEquity).toBeLessThan(46_000);
    // lesser_of picks documented here too (documented $67.5K < Y1 $87.3K).
    const lesser = calculateUnderwriting(inputs("lincoln-offer-950k", { basis: "lesser_of" }));
    expect(lesser.metrics.loan_amount).toBeCloseTo(r.metrics.loan_amount, 6);
  });

  // Acceptance 4
  it("AT-4: no documented NOI → falls back to year-1 with a warning, no crash", () => {
    for (const basis of ["documented", "lesser_of"] as const) {
      const r = calculateUnderwriting(inputs("lincoln-base", { floor: 1.3, basis }, undefined, true));
      expect(r.metrics.documented_noi).toBeNull();
      expect(r.metrics.dscr_sizing_basis_applied).toBe("year1_projected");
      expect(r.metrics.dscr_sizing_noi).toBeCloseTo(73643.48143999996, 6);
      expect(r.warnings.some((w) => /has no documented NOI/.test(w))).toBe(true);
      expect(Number.isFinite(r.metrics.loan_amount)).toBe(true);
    }
  });

  it("deal current NOI wins over Pricing Views seller NOI (Bryan, Nov 23)", () => {
    const r = calculateUnderwriting(inputs("lincoln-base", { floor: 1.3, basis: "documented" }, { current_noi: 60000 }));
    expect(r.metrics.documented_noi).toBe(60000);
    expect(r.metrics.documented_noi_source).toBe("deal_current_noi");
    // No current NOI → Pricing Views seller NOI is the fallback.
    const pv = calculateUnderwriting(inputs("lincoln-base", { floor: 1.3, basis: "documented" }, {}));
    expect(pv.metrics.documented_noi).toBe(67542);
    expect(pv.metrics.documented_noi_source).toBe("seller_proforma_noi");
  });

  it("unset floor resolves to 1.30 (Bryan, Nov 2026); explicit floor wins", () => {
    expect(DEFAULT_DSCR_FLOOR).toBe(1.3);
    expect(resolveDscrFloor({})).toEqual({ floor: 1.3, source: "default" });
    expect(resolveDscrFloor({ dscr_floor: 1.25 })).toEqual({ floor: 1.25, source: "explicit" });
    const r = calculateUnderwriting(inputs("lincoln-base", { floor: null, basis: "year1_projected" }));
    expect(r.metrics.dscr_floor_source).toBe("default");
    expect(r.metrics.year1_dscr).toBeCloseTo(1.3, 6);
  });

  it("sensitivity grid center cell sizes with the same basis as the headline", () => {
    // Center cell ties to the headline IRR (anchor), and the off-center cells move
    // with the documented-basis loan: a cheaper price can't raise proceeds above the
    // documented-NOI DSCR loan, so IRR at −10% price must differ from year-1 sizing.
    const doc = calculateUnderwriting(inputs("lincoln-offer-950k", { basis: "documented" }));
    const y1 = calculateUnderwriting(inputs("lincoln-offer-950k", { basis: "year1_projected" }));
    const center = (r: typeof doc) => r.sensitivity.find((c) => c.purchase_price_delta === 0 && Math.abs(c.exit_cap_rate - 0.09) < 1e-9)!;
    expect(center(doc).irr).toBeCloseTo(doc.metrics.irr!, 9);
    expect(doc.sensitivity.map((c) => c.irr)).not.toEqual(y1.sensitivity.map((c) => c.irr));
  });
});
