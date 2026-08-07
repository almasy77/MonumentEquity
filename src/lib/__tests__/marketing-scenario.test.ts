/**
 * Marketing scenario mapping — OM pro forma → scenario inputs.
 *
 * Verifies the pure mapping (no Redis): the pro-forma detection guardrail, the
 * unit-mix mapping (market rents billed as the operating rent, no reno premium),
 * the per-unit expense conversions, the offering-price override, and that the
 * mapped inputs run cleanly through the underwriting engine.
 */
import { describe, it, expect } from "vitest";
import {
  hasMarketingProForma,
  buildMarketingScenarioInputs,
} from "../marketing-scenario";
import { calculateUnderwriting } from "../underwriting";
import type { Deal } from "../validations";
import type { OMExtractedData } from "../om-extract";

const DEAL = {
  id: "d1",
  address: "934 E Gay St",
  city: "Columbus",
  state: "OH",
  units: 10,
  asking_price: 1_000_000,
} as unknown as Deal;

function baseOM(overrides: Partial<OMExtractedData> = {}): OMExtractedData {
  return {
    document_type: "offering_memo",
    property: { units: 10 },
    financials: { asking_price: 1_000_000 },
    contacts: [],
    rent_roll: [],
    t12: { months: [] },
    ...overrides,
  };
}

const FULL_PRO_FORMA: NonNullable<OMExtractedData["marketing_pro_forma"]> = {
  offering_price: 1_250_000,
  unit_mix: [
    { unit_type: "1BR/1BA", count: 6, market_rent: 1_200, current_rent: 1_000 },
    { unit_type: "2BR/1BA", count: 4, market_rent: 1_600, current_rent: 1_350 },
  ],
  vacancy_rate: 0.05,
  other_income: 12_000,
  expenses: {
    property_taxes: 24_000,
    insurance: 8_000,
    management_fee_rate: 0.05,
    repairs_maintenance: 10_000,
    utilities: 15_000,
    admin_marketing: 4_000,
    contract_services: 6_000,
    reserves: 3_000,
  },
  net_operating_income: 120_000,
};

describe("hasMarketingProForma", () => {
  it("is false when no pro forma is present (facts-only OM)", () => {
    expect(hasMarketingProForma(baseOM())).toBe(false);
  });

  it("is false when only revenue is present (no expense lines)", () => {
    const om = baseOM({
      marketing_pro_forma: {
        unit_mix: [{ unit_type: "1BR", count: 10, market_rent: 1_200 }],
      },
    });
    expect(hasMarketingProForma(om)).toBe(false);
  });

  it("is false when only expenses are present (no revenue signal)", () => {
    const om = baseOM({
      marketing_pro_forma: { expenses: { property_taxes: 24_000 } },
    });
    expect(hasMarketingProForma(om)).toBe(false);
  });

  it("is true when both revenue and expense lines are present", () => {
    expect(hasMarketingProForma(baseOM({ marketing_pro_forma: FULL_PRO_FORMA }))).toBe(true);
  });
});

describe("buildMarketingScenarioInputs", () => {
  const inputs = buildMarketingScenarioInputs(DEAL, baseOM({ marketing_pro_forma: FULL_PRO_FORMA }));

  it("maps the pro-forma unit mix billing market rent with no reno premium", () => {
    expect(inputs.revenue.unit_mix).toHaveLength(2);
    const oneBr = inputs.revenue.unit_mix.find((u) => u.type === "1BR/1BA")!;
    expect(oneBr.count).toBe(6);
    expect(oneBr.current_rent).toBe(1_200); // market rent billed as operating rent
    expect(oneBr.market_rent).toBe(1_200);
    expect(oneBr.renovated_rent_premium).toBe(0);
  });

  it("overrides the purchase price with the offering price", () => {
    expect(inputs.purchase.purchase_price).toBe(1_250_000);
  });

  it("carries the pro-forma vacancy and other income", () => {
    expect(inputs.revenue.vacancy_rate).toBe(0.05);
    expect(inputs.revenue.other_income_monthly).toBe(1_000); // 12,000 / 12
  });

  it("converts per-unit expense lines against the unit count", () => {
    expect(inputs.expenses.property_tax_total).toBe(24_000);
    expect(inputs.expenses.insurance_per_unit).toBe(800); // 8,000 / 10
    expect(inputs.expenses.utilities_per_unit).toBe(1_500); // 15,000 / 10
    expect(inputs.expenses.repairs_maintenance_per_unit).toBe(1_000); // 10,000 / 10
    expect(inputs.expenses.reserves_per_unit).toBe(300); // 3,000 / 10
    expect(inputs.expenses.management_fee_rate).toBe(0.05);
    expect(inputs.expenses.admin_legal_marketing).toBe(4_000);
    expect(inputs.expenses.contract_services).toBe(6_000);
  });

  it("derives a management fee rate from a $ amount when no rate is stated", () => {
    const om = baseOM({
      marketing_pro_forma: {
        ...FULL_PRO_FORMA,
        gross_potential_rent: 168_000, // (6*1200 + 4*1600) * 12
        expenses: { ...FULL_PRO_FORMA.expenses, management_fee_rate: undefined, management_fees: 8_000 },
      },
    });
    const inp = buildMarketingScenarioInputs(DEAL, om);
    // EGI = 168,000 * 0.95 + 12,000 = 171,600 → 8,000 / 171,600 ≈ 0.047
    expect(inp.expenses.management_fee_rate).toBeCloseTo(0.047, 3);
  });

  it("produces inputs that run through the underwriting engine", () => {
    const result = calculateUnderwriting(inputs);
    expect(result.monthly.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.metrics.going_in_cap)).toBe(true);
  });

  it("derives per-unit rent from a stated GPR when the OM has no unit mix and the deal has no rent roll", () => {
    // Aggregate-only OM: totals but no unit_mix. Deal (10 units) has no rent roll.
    const om = baseOM({
      marketing_pro_forma: {
        offering_price: 1_000_000,
        gross_potential_rent: 240_000, // → $2,000/unit/mo across 10 units
        vacancy_rate: 0.05,
        expenses: { property_taxes: 20_000 },
      },
    });
    const inp = buildMarketingScenarioInputs(DEAL, om);
    const totalMarket = inp.revenue.unit_mix.reduce((s, u) => s + u.market_rent * u.count, 0);
    // Rent comes from the OM's $240k GPR (→ $2,000/unit), NOT the $1,000/$1,100 placeholder.
    expect(totalMarket).toBeCloseTo(20_000, 0); // 240,000 / 12
    expect(inp.revenue.unit_mix.every((u) => u.market_rent === 2_000)).toBe(true);
  });

  it("derives GPR from a stated NOI + expenses when neither GPR nor EGI is given", () => {
    const om = baseOM({
      marketing_pro_forma: {
        net_operating_income: 100_000,
        vacancy_rate: 0,
        expenses: { total_operating_expenses: 140_000 },
      },
    });
    const inp = buildMarketingScenarioInputs(DEAL, om);
    // EGI = NOI + opex = 240,000; GPR = 240,000 (vac 0, no other income) → $2,000/unit.
    const totalMarket = inp.revenue.unit_mix.reduce((s, u) => s + u.market_rent * u.count, 0);
    expect(totalMarket).toBeCloseTo(20_000, 0);
  });
});
