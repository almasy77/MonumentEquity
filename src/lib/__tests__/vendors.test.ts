import { describe, it, expect } from "vitest";
import {
  offeringEligibility,
  dealPurchasePrice,
  renovationSpendFromCapex,
  suggestedVendorsForStage,
  vendorInputSchema,
  SEED_VENDORS,
  type Vendor,
} from "../vendors";

const ez = SEED_VENDORS.find((v) => v.seed_key === "cost-seg-ez")!;
const tier = (name: string) => ez.offerings.find((o) => o.name === name)!;

describe("offeringEligibility", () => {
  it("Cost Seg EZ DIY: eligible under $1M price and $10K reno", () => {
    expect(offeringEligibility(tier("DIY"), { purchasePrice: 850_000, renovationSpend: 5_000 }).verdict).toBe("eligible");
  });

  it("caps are exclusive: a deal AT the cap is ineligible", () => {
    const e = offeringEligibility(tier("Engineer Reviewed"), { purchasePrice: 1_000_000, renovationSpend: 0 });
    expect(e.verdict).toBe("ineligible");
    expect(e.reasons[0]).toMatch(/purchase price/);
  });

  it("a typical Monument deal ($1.6M) fails the cheap tiers but clears Fully Engineered", () => {
    const deal = { purchasePrice: 1_600_000, renovationSpend: 120_000 };
    expect(offeringEligibility(tier("DIY"), deal).verdict).toBe("ineligible");
    expect(offeringEligibility(tier("Engineer Reviewed"), deal).verdict).toBe("ineligible");
    expect(offeringEligibility(tier("Fully Engineered"), deal).verdict).toBe("eligible");
  });

  it("unknown deal figure against a set cap → unknown, not eligible", () => {
    expect(offeringEligibility(tier("DIY"), { purchasePrice: 500_000, renovationSpend: null }).verdict).toBe("unknown");
  });

  it("ineligible wins over unknown", () => {
    expect(offeringEligibility(tier("DIY"), { purchasePrice: 2_000_000, renovationSpend: null }).verdict).toBe("ineligible");
  });

  it("no caps → always eligible, even with unknown figures", () => {
    expect(offeringEligibility({ max_purchase_price: null, max_renovation_spend: null }, {}).verdict).toBe("eligible");
  });
});

describe("dealPurchasePrice", () => {
  it("prefers final, then bid, then asking", () => {
    expect(dealPurchasePrice({ final_purchase_price: 1, bid_price: 2, asking_price: 3 })).toBe(1);
    expect(dealPurchasePrice({ bid_price: 2, asking_price: 3 })).toBe(2);
    expect(dealPurchasePrice({ asking_price: 3 })).toBe(3);
    expect(dealPurchasePrice({})).toBeNull();
  });
});

describe("renovationSpendFromCapex", () => {
  it("legacy single line plus enabled projects", () => {
    expect(
      renovationSpendFromCapex({
        per_unit_cost: 8_000,
        units_to_renovate: 6,
        projects: [{ cost: 20_000 }, { cost: 99_000, enabled: false }],
      }),
    ).toBe(68_000);
  });

  it("renovation_lines replace the legacy line", () => {
    expect(
      renovationSpendFromCapex({
        per_unit_cost: 1_000_000,
        units_to_renovate: 1,
        renovation_lines: [
          { per_unit_cost: 10_000, units_to_renovate: 4 },
          { per_unit_cost: 3_000, units_to_renovate: 2 },
        ],
      }),
    ).toBe(46_000);
  });

  it("program switched off counts projects only; no capex → null", () => {
    expect(renovationSpendFromCapex({ per_unit_enabled: false, per_unit_cost: 9_000, units_to_renovate: 9, projects: [{ cost: 5_000 }] })).toBe(5_000);
    expect(renovationSpendFromCapex(undefined)).toBeNull();
  });
});

describe("suggestedVendorsForStage", () => {
  const mk = (id: string, patch: Partial<Vendor>): Vendor => ({
    id, name: id, category: "cost_segregation", markets: [], stage_triggers: ["closing"],
    status: "untested", offerings: [], created_at: "", updated_at: "", ...patch,
  });
  const vendors = [mk("a", {}), mk("b", { status: "do_not_use" }), mk("c", { stage_triggers: ["loi"] }), mk("d", {})];

  it("matches stage, skips do-not-use and already-linked vendors", () => {
    expect(suggestedVendorsForStage(vendors, "closing", ["d"]).map((v) => v.id)).toEqual(["a"]);
  });
});

describe("seed data + validation", () => {
  it("every starter vendor passes the API schema and surfaces post-close", () => {
    for (const seed of SEED_VENDORS) {
      expect(vendorInputSchema.safeParse(seed).success).toBe(true);
      expect(seed.stage_triggers).toEqual(expect.arrayContaining(["closing", "onboarding"]));
      for (const o of seed.offerings) expect(o.source_checked_date).toBe("2026-10-30");
    }
  });

  it("starter vendors carry no phone or email (contact details are entered in the UI)", () => {
    for (const seed of SEED_VENDORS) {
      expect(seed.phone).toBeUndefined();
      expect(seed.email).toBeUndefined();
    }
  });

  it("rejects non-http website (no javascript: links)", () => {
    const r = vendorInputSchema.safeParse({ name: "x", category: "other", website: "javascript:alert(1)" });
    expect(r.success).toBe(false);
  });
});
