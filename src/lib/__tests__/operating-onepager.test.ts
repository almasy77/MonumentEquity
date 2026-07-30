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

  it("does NOT leak internal return metrics", () => {
    const { deal, scenario } = fixture();
    const html = buildOperatingOnePager(deal, scenario);
    for (const term of ["IRR", "After-Tax", "after-tax", "Equity Multiple", "reverse"]) {
      expect(html).not.toContain(term);
    }
  });
});
