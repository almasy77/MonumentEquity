/**
 * capex_funding: a renovation/project capex loan holdback.
 *
 * By default all modeled capex (renovation + named projects) is funded from
 * equity/operations as a monthly cash outflow. With capex_funding.mode =
 * "loan_holdback", a share of that capex is funded by a lender holdback instead:
 * an interest-only tranche that DRAWS as the capex is spent, accrues interest on the
 * drawn balance (raising debt service, lowering DSCR), is removed from the equity
 * outlay, and is paid off at exit (or rolled into a refi). Opt-in: unset = byte-identical.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
) as ScenarioInputs;

// bryden capex: 6 units × $8,000 = $48,000 of renovation, months 3–14, no projects.
const RENO_TOTAL = 48000;

type Funding = { mode?: "all_equity" | "loan_holdback"; holdback_pct?: number; holdback_interest_rate?: number };

function run(funding?: Funding) {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  if (funding) (s.capex as unknown as Record<string, unknown>).capex_funding = funding;
  return calculateUnderwriting(s);
}

describe("capex_funding: loan holdback", () => {
  const base = run(); // all equity (prior behavior)

  it("is opt-in: all_equity (any pct) matches the no-funding baseline", () => {
    const eq = run({ mode: "all_equity", holdback_pct: 0.5 });
    expect(eq.metrics.irr).toBeCloseTo(base.metrics.irr as number, 10);
    expect(eq.metrics.net_sale_proceeds).toBeCloseTo(base.metrics.net_sale_proceeds, 6);
    expect(eq.metrics.total_equity_invested).toBeCloseTo(base.metrics.total_equity_invested, 6);
  });

  it("100% holdback adds the drawn balance to the exit loan payoff (NOI/exit value unchanged)", () => {
    const hb = run({ mode: "loan_holdback", holdback_pct: 1 });
    // exit value is NOI/cap, unaffected by financing; only the payoff grows by the
    // IO holdback balance (= the full $48k drawn, never amortized).
    expect(base.metrics.net_sale_proceeds - hb.metrics.net_sale_proceeds).toBeCloseTo(RENO_TOTAL, 0);
    expect(hb.metrics.stabilized_cap).toBeCloseTo(base.metrics.stabilized_cap, 10); // NOI path untouched
  });

  it("holdback interest raises debt service and lowers DSCR during the draw", () => {
    const hb = run({ mode: "loan_holdback", holdback_pct: 1 });
    expect(hb.metrics.year1_dscr).toBeLessThan(base.metrics.year1_dscr);
    expect(hb.metrics.min_dscr).toBeLessThanOrEqual(base.metrics.min_dscr);
  });

  it("the holdback-funded capex leaves the equity outlay (less total equity invested)", () => {
    const hb = run({ mode: "loan_holdback", holdback_pct: 1 });
    expect(hb.metrics.total_equity_invested).toBeLessThan(base.metrics.total_equity_invested);
  });

  it("equity cash flow over the hold improves by the capex removed, net of holdback interest", () => {
    const hb = run({ mode: "loan_holdback", holdback_pct: 1 });
    const sumCF = (r: typeof base) => r.annual.reduce((s, a) => s + a.cash_flow, 0);
    const delta = sumCF(hb) - sumCF(base);
    // Equity no longer funds the $48k of capex, but now pays IO interest on the drawn
    // balance over the hold — so the improvement is positive but less than $48k.
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(RENO_TOTAL);
  });

  it("a partial holdback is between all-equity and a full holdback", () => {
    const half = run({ mode: "loan_holdback", holdback_pct: 0.5 });
    const full = run({ mode: "loan_holdback", holdback_pct: 1 });
    // net sale proceeds: base (highest) > half > full (payoff grows with the draw)
    expect(half.metrics.net_sale_proceeds).toBeLessThan(base.metrics.net_sale_proceeds);
    expect(half.metrics.net_sale_proceeds).toBeGreaterThan(full.metrics.net_sale_proceeds);
  });
});
