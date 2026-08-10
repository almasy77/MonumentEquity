/**
 * Syndication waterfall — verified against hand-derived SDA math.
 */
import { describe, it, expect } from "vitest";
import { computeSyndication, type SyndicationInput } from "../syndication";

const ASSUMPTIONS = {
  lp_equity_pct: 0.8,
  preferred_return_rate: 0.08,
  acquisition_fee_pct: 0.02,
  asset_management_fee_pct: 0.02,
  capital_transaction_fee_pct: 0,
  lp_excess_split: 0.8,
};

function baseDeal(cf = 120_000, egi = 500_000): SyndicationInput {
  return {
    assumptions: ASSUMPTIONS,
    initial_lp_capital: 1_000_000,
    purchase_price: 4_000_000,
    sale_year: 5,
    net_sale_equity: 2_000_000,
    years: Array.from({ length: 5 }, (_, i) => ({ year: i + 1, egi, distributable_cash_flow: cf })),
  };
}

describe("computeSyndication — pref covered every year", () => {
  const r = computeSyndication(baseDeal());

  it("year 1 waterfall: AM fee, full pref, 80/20 excess split", () => {
    const y1 = r.years[0];
    expect(y1.asset_mgmt_fee).toBeCloseTo(10_000, 0); // 2% × 500k EGI
    expect(y1.pref_due).toBeCloseTo(80_000, 0); // 8% × 1M
    expect(y1.pref_paid).toBeCloseTo(80_000, 0); // fully covered
    expect(y1.pref_deficiency).toBe(0);
    // excess = 120k − 10k − 80k = 30k → LP 24k / GP 6k
    expect(y1.excess_to_lp).toBeCloseTo(24_000, 0);
    expect(y1.excess_to_gp).toBeCloseTo(6_000, 0);
    expect(y1.lp_operating_distributions).toBeCloseTo(104_000, 0);
    expect(y1.lp_cash_on_cash).toBeCloseTo(0.104, 5);
  });

  it("sale year: return of capital, then 80/20 profit split", () => {
    expect(r.sale_return_of_capital).toBeCloseTo(1_000_000, 0);
    expect(r.sale_pref_deficiency_paid).toBe(0);
    expect(r.sale_net_profit).toBeCloseTo(1_000_000, 0); // 2M − 1M cap − 0 pref
    expect(r.sale_profit_to_lp).toBeCloseTo(800_000, 0);
    expect(r.sale_profit_to_gp).toBeCloseTo(200_000, 0);
    // Year-5 LP cash = 104k operating + (1M cap + 800k profit) = 1,904k
    expect(r.years[4].lp_total_cash).toBeCloseTo(1_904_000, 0);
  });

  it("LP headline returns", () => {
    // flows: [−1M, 104k, 104k, 104k, 104k, 1,904k]
    expect(r.lp_equity_multiple).toBeCloseTo(2.32, 2); // 2,320k / 1,000k
    expect(r.lp_average_cash_on_cash).toBeCloseTo(0.104, 4);
    expect(r.lp_average_annual_return).toBeCloseTo(0.264, 3); // 1,320k / 1M / 5
    expect(r.lp_irr).not.toBeNull();
    expect(r.lp_irr!).toBeGreaterThan(0.18);
    expect(r.lp_irr!).toBeLessThan(0.24);
  });

  it("GP compensation", () => {
    expect(r.gp_acquisition_fee).toBeCloseTo(80_000, 0); // 2% × 4M
    expect(r.gp_asset_mgmt_fees_total).toBeCloseTo(50_000, 0); // 10k × 5
    expect(r.gp_promote_total).toBeCloseTo(230_000, 0); // 6k×5 excess + 200k sale profit
    expect(r.gp_total_compensation).toBeCloseTo(360_000, 0);
  });
});

describe("computeSyndication — pref deficiency accrues and is paid at sale", () => {
  // CF (50k) below the 80k pref → deficiency accrues each year, paid from sale proceeds.
  const deal = baseDeal(50_000);
  const r = computeSyndication(deal);

  it("accrues a deficiency when cash flow can't cover the pref", () => {
    const y1 = r.years[0];
    // AM fee: 10k < 50k CF → charged. pref paid = CF − AM = 40k (pref+AM 90k > 50k CF).
    expect(y1.asset_mgmt_fee).toBeCloseTo(10_000, 0);
    expect(y1.pref_paid).toBeCloseTo(40_000, 0);
    expect(y1.pref_deficiency).toBeCloseTo(40_000, 0); // 80k due − 40k paid
    expect(y1.excess_to_lp).toBe(0); // nothing left to split
  });

  it("pays the CUMULATIVE unpaid pref from sale proceeds before profit split (no double-count)", () => {
    // Each year 80k due, 40k paid → 40k shortfall; the running deficiency compounds:
    // 40k, 80k, 120k, 160k, 200k. Year-2 due = 1M×8% + 40k prior = 120k.
    expect(r.years[1].pref_due).toBeCloseTo(120_000, 0);
    expect(r.years[4].pref_deficiency).toBeCloseTo(200_000, 0); // cumulative unpaid at sale
    // Sale pays exactly the cumulative 200k (NOT the old bug's summed 600k) before profit.
    expect(r.sale_return_of_capital).toBeCloseTo(1_000_000, 0);
    expect(r.sale_pref_deficiency_paid).toBeCloseTo(200_000, 0);
    // Remaining profit splits 80/20: net 2M − 1M cap − 200k pref = 800k → GP 160k.
    expect(r.sale_net_profit).toBeCloseTo(800_000, 0);
    expect(r.sale_profit_to_gp).toBeCloseTo(160_000, 0);
  });
});

describe("computeSyndication — refinance returns capital mid-hold", () => {
  const deal = baseDeal();
  deal.refi = { year: 3, net_refi_proceeds: 700_000 };
  const r = computeSyndication(deal);

  it("returns LP capital at the refi year and reduces the capital account", () => {
    const y3 = r.years[2];
    expect(y3.lp_capital_returned).toBeCloseTo(700_000, 0); // min(700k, 1M)
    expect(y3.lp_capital_end).toBeCloseTo(300_000, 0);
    // Year-4 pref is now on the reduced 300k balance.
    expect(r.years[3].lp_capital_begin).toBeCloseTo(300_000, 0);
    expect(r.years[3].pref_due).toBeCloseTo(24_000, 0); // 8% × 300k
  });
});
