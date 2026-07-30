/**
 * Seller-facing pricing one-pager: renders the offer + triangulation methods,
 * and must NOT leak internal metrics (IRR, after-tax, DSCR, the reverse-solve).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPricingOnePager } from "../pricing-onepager";
import type { Deal, Scenario } from "../validations";

function fixture() {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"));
  const scenario = {
    id: "s1", deal_id: "d1", name: "Base", type: "base", version: 1, is_active: true,
    purchase_assumptions: inp.purchase, financing_assumptions: inp.financing,
    revenue_assumptions: inp.revenue, expense_assumptions: inp.expenses,
    capex_assumptions: inp.capex, exit_assumptions: inp.exit,
    tax_assumptions: inp.tax, depreciation_assumptions: inp.depreciation,
    pricing_views: { target_cap: 0.065, seller_proforma_noi: 92_000, seller_cap: 0.06, price_per_unit: 130_000, market_cagr: 0.03, target_irr: 0.15 },
  } as unknown as Scenario;
  const deal = {
    id: "d1", address: "3677 Indianola Ave", city: "Columbus", state: "OH", units: 12, asking_price: 1_550_000, source: "broker",
    owner_acquisition_price: 640_000, owner_since: "2013-05-01",
  } as unknown as Deal;
  return { deal, scenario };
}

describe("pricing one-pager", () => {
  it("shows the offer and the triangulation methods", () => {
    const { deal, scenario } = fixture();
    const html = buildPricingOnePager(deal, scenario);
    expect(html).toContain("Monument Equity");
    expect(html).toContain("3677 Indianola Ave");
    expect(html).toContain("Our Proposed Purchase Price");
    expect(html).toContain("Cap rate — seller's pro-forma NOI");
    expect(html).toContain("Appreciation on owner's basis");
  });

  it("does NOT leak internal metrics to the seller", () => {
    const { deal, scenario } = fixture();
    const html = buildPricingOnePager(deal, scenario);
    for (const term of ["IRR", "After-Tax", "after-tax", "DSCR", "Buyer's max", "reverse"]) {
      expect(html).not.toContain(term);
    }
  });
});
