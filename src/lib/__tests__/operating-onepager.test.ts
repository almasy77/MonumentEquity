/**
 * Operating summary one-pager: renders the Year-1 pro forma line items with a
 * basis for each cost, explains the property-tax reassessment, and doesn't leak
 * internal return metrics (IRR/after-tax) to the seller.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOperatingOnePager } from "../operating-onepager";
import type { Deal, Scenario } from "../validations";

function fixture() {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"));
  inp.expenses.tax_reassessment = { enabled: true, effective_tax_rate: 0.0315, assessment_ratio: 0.35, mill_rate: 90, phase_in_month: 1 };
  const scenario = {
    id: "s1", deal_id: "d1", name: "Base", type: "base", version: 1, is_active: true,
    purchase_assumptions: inp.purchase, financing_assumptions: inp.financing,
    revenue_assumptions: inp.revenue, expense_assumptions: inp.expenses,
    capex_assumptions: inp.capex, exit_assumptions: inp.exit,
    tax_assumptions: inp.tax, depreciation_assumptions: inp.depreciation,
  } as unknown as Scenario;
  const deal = {
    id: "d1", address: "934 E Gay St", city: "Columbus", state: "OH", units: 12, source: "broker",
    t12: { total_egi: 200_000, total_opex: 90_000, total_noi: 110_000 },
  } as unknown as Deal;
  return { deal, scenario };
}

describe("operating one-pager", () => {
  it("renders the pro forma lines, the tax reassessment basis, and the T12 comparison", () => {
    const { deal, scenario } = fixture();
    const html = buildOperatingOnePager(deal, scenario);
    expect(html).toContain("Net Operating Income");
    expect(html).toContain("Property Tax");
    expect(html).toContain("Insurance");
    // Reassessment explanation (mills + ratio).
    expect(html).toContain("Reassessed to the sale price");
    expect(html).toContain("mills");
    // Seller T12 comparison present.
    expect(html).toContain("Seller's T12 vs our underwriting");
  });

  it("basis notes reflect the BILLED figure, not stale legacy fields", () => {
    // Enter management + R&M through the structured opex line (what the engine
    // bills), while the legacy fields hold different, stale values. The basis
    // notes must describe what's billed (8.0% / $750), not the stale 8.5% / $680.
    const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"));
    inp.expenses.management_fee_rate = 0.085; // stale legacy
    inp.expenses.repairs_maintenance_per_unit = 680; // stale legacy
    inp.expenses.opex_inputs = {
      ...(inp.expenses.opex_inputs ?? {}),
      management_fees: { value: 0.08, mode: "pct_egi" }, // what the engine bills
      repairs_maintenance: { value: 750, mode: "per_unit_annual" },
    };
    const scenario = {
      id: "s1", deal_id: "d1", name: "Base", type: "base", version: 1, is_active: true,
      purchase_assumptions: inp.purchase, financing_assumptions: inp.financing,
      revenue_assumptions: inp.revenue, expense_assumptions: inp.expenses,
      capex_assumptions: inp.capex, exit_assumptions: inp.exit,
      tax_assumptions: inp.tax, depreciation_assumptions: inp.depreciation,
    } as unknown as Scenario;
    const deal = { id: "d1", address: "934 E Gay St", city: "Columbus", state: "OH", units: 12, source: "broker" } as unknown as Deal;

    const html = buildOperatingOnePager(deal, scenario);
    expect(html).toContain("8.0% of EGI"); // billed rate, not 8.5%
    expect(html).toContain("750/unit/yr"); // billed per-unit, not 680
    expect(html).not.toContain("8.5%");
    expect(html).not.toContain("680");
  });

  it("tax basis narrative reconciles to the billed dollar even when mill_rate is stale", () => {
    // Reproduces the 295 Thurman bug: the engine bills off effective_tax_rate
    // (2.198% → ~62.8 eff. mills), but mill_rate holds a stale 75. The basis text
    // must show the effective mills that tie to the dollar, NOT the stale 75.
    const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"));
    inp.expenses.property_tax_v2 = undefined;
    inp.expenses.tax_escalation_rate = 0;
    inp.expenses.tax_reassessment = {
      enabled: true,
      effective_tax_rate: 0.02198, // what the engine bills
      assessment_ratio: 0.35,
      mill_rate: 75, // STALE — 35% × 75 mills would be 2.625%, not 2.198%
      phase_in_month: 1,
    };
    const scenario = {
      id: "s1", deal_id: "d1", name: "Base", type: "base", version: 1, is_active: true,
      purchase_assumptions: inp.purchase, financing_assumptions: inp.financing,
      revenue_assumptions: inp.revenue, expense_assumptions: inp.expenses,
      capex_assumptions: inp.capex, exit_assumptions: inp.exit,
      tax_assumptions: inp.tax, depreciation_assumptions: inp.depreciation,
    } as unknown as Scenario;
    const deal = { id: "d1", address: "295 Thurman Ave", city: "Columbus", state: "OH", units: 12, source: "broker" } as unknown as Deal;

    const html = buildOperatingOnePager(deal, scenario);
    expect(html).toContain("62.8 eff. mills"); // reconciles to the billed rate
    expect(html).not.toContain("75.0 mills"); // the stale input is not shown
  });

  it("does NOT leak internal return metrics", () => {
    const { deal, scenario } = fixture();
    const html = buildOperatingOnePager(deal, scenario);
    for (const term of ["IRR", "After-Tax", "after-tax", "Equity Multiple", "reverse"]) {
      expect(html).not.toContain(term);
    }
  });
});
