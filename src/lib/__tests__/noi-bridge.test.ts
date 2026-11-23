/**
 * Change C: documented vs plan NOI bridge (Manny Lou, Nov 2026).
 * Fixtures are the stored Lincoln Terrace inputs; the deal's 2026 tax bill is $39,170.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyBridgeTag, buildNoiBridge, tracesToDocuments } from "../noi-bridge";
import { calculateUnderwriting } from "../underwriting";
import { toEngineInputs } from "../engine-version";
import { solvePriceForIRR } from "../price-solve";
import type { Scenario } from "../validations";

const DEAL = { current_annual_taxes: 39170 };
const load = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8")) as Record<string, Record<string, unknown>>;
const inputsOf = (s: Record<string, unknown>, deal: object = DEAL) => toEngineInputs(s as unknown as Scenario, deal);

describe("NOI bridge (Change C)", () => {
  it("Lincoln Offer: itemizes the tax appeal, renovation premium and mark-to-market, and reconciles exactly", () => {
    const s = load("lincoln-offer-950k");
    const b = buildNoiBridge(inputsOf(s), { deal: DEAL, solvePrices: false });
    expect(b.documented_noi).toBe(67542);
    expect(b.items.map((i) => i.key)).toEqual(["property_tax", "renovation_premium", "rent_markup"]);
    expect(b.items[0].noi_delta).toBeCloseTo(39170 - 20731, 6); // $18,439 appeal
    expect(b.items.every((i) => i.tag === "untagged")).toBe(true);
    // Both T12 other-income lines trace to the T12 → inside documented NOI.
    expect(b.documented_items.map((i) => i.tag_source)).toEqual(["traced", "traced"]);
    const sum = b.items.reduce((t, i) => t + i.noi_delta, 0);
    expect(b.documented_model_noi + sum).toBeCloseTo(b.year1_noi, 6);
    expect(b.restatement).toBeCloseTo(b.documented_model_noi - 67542, 6);
    expect(b.year1_noi).toBeCloseTo(87272.3984, 4);
  });

  it("price with plan = the existing IRR solve; documented price is lower and excludes plan cost", () => {
    const s = load("lincoln-offer-950k");
    const inputs = inputsOf(s);
    const b = buildNoiBridge(inputs, { deal: DEAL, target_irr: 0.15 });
    expect(b.price_with_plan).toBe(solvePriceForIRR(inputs, 0.15));
    expect(b.price_documented!).toBeLessThan(b.price_with_plan!);
    // Bryan's ladder: $935K ≈ 15.1% with the plan.
    expect(Math.abs(b.price_with_plan! - 935_000)).toBeLessThan(5_000);
  });

  it("tagging an item documented keeps it in documented NOI and raises the documented price", () => {
    const s = load("lincoln-offer-950k");
    const before = buildNoiBridge(inputsOf(s), { deal: DEAL, target_irr: 0.15 });
    const patch = applyBridgeTag(s as unknown as Scenario, "property_tax", "documented");
    const tagged = { ...s, ...patch } as Record<string, Record<string, unknown>>;
    expect(tagged.expense_assumptions.property_tax_basis).toBe("documented");
    const after = buildNoiBridge(inputsOf(tagged), { deal: DEAL, target_irr: 0.15 });
    expect(after.items.map((i) => i.key)).not.toContain("property_tax");
    expect(after.documented_items.map((i) => i.key)).toContain("property_tax");
    expect(after.price_documented!).toBeGreaterThan(before.price_documented!);
    expect(after.price_with_plan).toBe(before.price_with_plan); // tags never move the plan price
    // Engine results are untouched by tags.
    expect(calculateUnderwriting(inputsOf(tagged)).metrics.irr).toBe(calculateUnderwriting(inputsOf(s)).metrics.irr);
  });

  it("applyBridgeTag writes and clears each storage location", () => {
    const s = load("lincoln-offer-950k") as unknown as Scenario;
    const r = applyBridgeTag(s, "other_income:1", "plan").revenue_assumptions as { other_income: { line_items: { basis?: string }[] } };
    expect(r.other_income.line_items[1].basis).toBe("plan");
    expect(r.other_income.line_items[0].basis).toBeUndefined();
    expect(applyBridgeTag(s, "rent_markup", "plan").revenue_assumptions!.rent_markup_basis).toBe("plan");
    expect(applyBridgeTag(s, "renovation_premium", "documented").revenue_assumptions!.renovation_premium_basis).toBe("documented");
    const ex = applyBridgeTag(s, "expense:repairs_maintenance", "plan").expense_assumptions!;
    expect((ex.expense_reset_basis as Record<string, string>).repairs_maintenance).toBe("plan");
    const cleared = applyBridgeTag({ ...s, revenue_assumptions: { rent_markup_basis: "plan" } } as unknown as Scenario, "rent_markup", "untagged");
    expect("rent_markup_basis" in cleared.revenue_assumptions!).toBe(false);
  });

  it("itemizes an expense cut below the T12 baseline", () => {
    const s = load("lincoln-offer-950k");
    (s.expense_assumptions as Record<string, unknown>).t12_baseline = { repairs_maintenance: 45968, property_taxes: 30970 };
    const b = buildNoiBridge(inputsOf(s), { deal: DEAL, solvePrices: false });
    const rm = b.items.find((i) => i.key === "expense:repairs_maintenance");
    expect(rm).toBeDefined();
    expect(rm!.noi_delta).toBeGreaterThan(15_000); // $26K modeled vs $46K T12, net of mgmt on EGI
    const sum = b.items.reduce((t, i) => t + i.noi_delta, 0);
    expect(b.documented_model_noi + sum).toBeCloseTo(b.year1_noi, 6);
  });

  it("Lincoln Base: T12 tax escrow below the actual bill shows as an untagged item", () => {
    const b = buildNoiBridge(inputsOf(load("lincoln-base")), { deal: DEAL, solvePrices: false });
    expect(b.items.map((i) => i.key)).toEqual(["property_tax"]); // zero-effect rent markup is skipped
    expect(b.items[0].noi_delta).toBeCloseTo(39170 - 30970, 6);
  });

  it("no documented NOI: no restatement line, and a note says so", () => {
    const s = load("lincoln-offer-950k");
    delete (s as Record<string, unknown>).pricing_views;
    const b = buildNoiBridge(inputsOf(s, {}), { deal: {}, solvePrices: false });
    expect(b.documented_noi).toBeNull();
    expect(b.restatement).toBeNull();
    expect(b.notes.some((n) => /No documented NOI/.test(n))).toBe(true);
  });

  it("tracesToDocuments: T12, rent roll and in-place leases trace; 'unverified' never does", () => {
    expect(tracesToDocuments("Utility billbacks (in place, T12)")).toBe(true);
    expect(tracesToDocuments("T-12 Jun25-May26 actual")).toBe(true);
    expect(tracesToDocuments("per 7/29 rent roll")).toBe(true);
    expect(tracesToDocuments("Storefront B rent (in place)")).toBe(true);
    expect(tracesToDocuments("Pet fees - 4 units x $35 (unverified)")).toBe(false);
    expect(tracesToDocuments("Laundry")).toBe(false);
    expect(tracesToDocuments(undefined)).toBe(false);
  });
});
