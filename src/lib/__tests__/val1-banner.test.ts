/**
 * VAL-1: the Summary banner must aggregate EVERY check block, not just the
 * reconciliation tie-outs. A catastrophic deal (negative NOI, no IRR, equity
 * multiple below 1) used to still show a green "ALL CHECKS PASS" because the
 * banner ignored the range-sanity block. computeBannerStatus now returns three
 * states — pass / warn / fail — off every block.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { computeReconciliationChecks, computeBannerStatus } from "../checks";
import type { Deal } from "../validations";

const DEAL = { year_built: 1973, units: 24 } as unknown as Deal;

function status(inp: ScenarioInputs) {
  const res = calculateUnderwriting(inp);
  const recon = computeReconciliationChecks(DEAL, inp, res);
  return computeBannerStatus(res, recon, DEAL, inp);
}

/** A catastrophically negative all-equity deal: negative NOI, no IRR. */
function brokenDeal(): ScenarioInputs {
  return {
    purchase: { purchase_price: 3_450_000, closing_cost_rate: 0.02, capex_reserve: 0, cost_seg_study_cost: 0 },
    financing: { ltv: 0, interest_rate: 0.06, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0, size_to_dscr: false },
    revenue: {
      unit_mix: [{ type: "1BR/1BA", count: 24, current_rent: 400, market_rent: 400, renovated_rent_premium: 0 }],
      other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0.02,
    },
    expenses: {
      management_fee_rate: 0.05, payroll_annual: 40_000, repairs_maintenance_per_unit: 1_000, turnover_cost_per_unit: 500,
      turnover_rate: 0.5, insurance_per_unit: 800, property_tax_total: 60_000, tax_escalation_rate: 0.03,
      expense_escalation_rate: 0.03, utilities_per_unit: 1_200, admin_legal_marketing: 6_000, contract_services: 4_000, reserves_per_unit: 0,
    },
    capex: { per_unit_cost: 0, units_to_renovate: 0, per_unit_enabled: false, renovation_start_month: 1, projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.07, selling_cost_rate: 0.02 },
    tax: null,
  } as unknown as ScenarioInputs;
}

describe("VAL-1: banner aggregates every block", () => {
  it("a catastrophic deal reads N CHECKS FAILED, never ALL CHECKS PASS", () => {
    const s = status(brokenDeal());
    expect(s.state).toBe("fail");
    expect(s.text).toMatch(/CHECKS? FAILED/);
    expect(s.text).not.toContain("ALL CHECKS PASS");
    expect(s.failed.length).toBeGreaterThan(0);
  });

  it("the 4443 lease-up deal reads PASSES WITH WARNINGS (viable, but flagged)", () => {
    const likely = JSON.parse(
      readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
    ) as ScenarioInputs;
    const s = status(likely);
    expect(s.state).toBe("warn"); // lease-up carry + cap compression warnings, but not broken
    expect(s.text).toContain("WARNING");
    expect(s.warnings.some((w) => w.startsWith("Lease-up carry"))).toBe(true);
  });
});
