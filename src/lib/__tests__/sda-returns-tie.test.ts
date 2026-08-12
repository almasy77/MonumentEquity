/**
 * SDA input-cell regression (SDA-1 + SDA-2). The 08-12 export's SDA overstated
 * Likely-Case returns vs the engine (~2x CoC, +175bps IRR) because two input
 * cells were wrong:
 *   - Scenarios!AE42 (replacement/capital reserve $/unit) was written $0, so the
 *     SDA's cash-flow-for-distribution never deducted the reserves the engine
 *     deducts below NOI.
 *   - Exit Strategy!I9 (cap-rate escalator) was clamped to ≥ 0, so a value-add
 *     deal underwritten to a LOWER exit cap than its going-in cap (compression)
 *     silently exited at the going-in cap.
 * The SDA's returns are Excel formulas we can't recalc headlessly, so we assert
 * the input cells that drive them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { buildSdaWrites, sdaExportBlockers } from "../sda-fill-mapping";

const LIKELY = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

function cellsFor(sheet: string) {
  const result = calculateUnderwriting(LIKELY);
  const writes = buildSdaWrites([{ name: "Likely", type: "base", inputs: LIKELY, result, units: 24 }], 0);
  return { cells: writes.find((w) => w.sheet === sheet)?.cells ?? {}, result };
}

describe("SDA-2: reserves reach the SDA distribution line", () => {
  it("AE42 carries the engine's per-unit annual reserve (replacement + capital), not $0", () => {
    const { cells, result } = cellsFor("Scenarios");
    // Engine reserves for the SDA's stabilized base year, per unit.
    const base = result.annual.find((a) => (a.loss_to_lease ?? 0) <= 0.005 && a.cash_flow_before_capex_and_reserves >= 0)
      ?? result.annual[result.annual.length - 1];
    const expectedPerUnit = ((base.reserves ?? 0) + (base.capital_reserve ?? 0)) / 24;
    expect(expectedPerUnit).toBeGreaterThan(0);
    expect(cells["AE42"]).toBeCloseTo(expectedPerUnit, 6);
  });
});

describe("SDA-9: a broken scenario is flagged and its numbers are not written", () => {
  function brokenDeal(): ScenarioInputs {
    return {
      purchase: { purchase_price: 3_450_000, closing_cost_rate: 0.02, capex_reserve: 0, cost_seg_study_cost: 0 },
      financing: { ltv: 0, interest_rate: 0.06, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0, size_to_dscr: false },
      revenue: { unit_mix: [{ type: "1BR/1BA", count: 24, current_rent: 400, market_rent: 400, renovated_rent_premium: 0 }], other_income_monthly: 0, vacancy_rate: 0.05, bad_debt_rate: 0, concessions_rate: 0, rent_growth_rate: 0.02 },
      expenses: { management_fee_rate: 0.05, payroll_annual: 40_000, repairs_maintenance_per_unit: 1_000, turnover_cost_per_unit: 500, turnover_rate: 0.5, insurance_per_unit: 800, property_tax_total: 60_000, tax_escalation_rate: 0.03, expense_escalation_rate: 0.03, utilities_per_unit: 1_200, admin_legal_marketing: 6_000, contract_services: 4_000, reserves_per_unit: 0 },
      capex: { per_unit_cost: 0, units_to_renovate: 0, per_unit_enabled: false, renovation_start_month: 1, projects: [] },
      exit: { hold_period_years: 5, exit_cap_rate: 0.07, selling_cost_rate: 0.02 },
      tax: null,
    } as unknown as ScenarioInputs;
  }

  it("sdaExportBlockers flags a negative-NOI scenario", () => {
    const res = calculateUnderwriting(brokenDeal());
    expect(sdaExportBlockers(res).length).toBeGreaterThan(0);
  });

  it("the column header is marked NOT SDA-SAFE and the income cells are not written", () => {
    const res = calculateUnderwriting(brokenDeal());
    const writes = buildSdaWrites([{ name: "Base Case", type: "base", inputs: brokenDeal(), result: res, units: 24 }], 0);
    const cells = writes.find((w) => w.sheet === "Scenarios")?.cells ?? {};
    expect(String(cells["D3"])).toContain("NOT SDA-SAFE");
    expect(cells["D21"]).toBeUndefined(); // GPR not written for the broken column
  });
});

describe("SDA-1: the SDA exits at the true exit cap, including compression", () => {
  it("I9 escalator is negative when the exit cap is below the stabilized cap", () => {
    const { cells, result } = cellsFor("Exit Strategy");
    const sdaCap = result.metrics.stabilized_cap; // row 60 basis
    const exitCap = (LIKELY.exit as { exit_cap_rate: number }).exit_cap_rate;
    const hold = (LIKELY.exit as { hold_period_years: number }).hold_period_years;
    expect(exitCap).toBeLessThan(sdaCap); // compression vs the stabilized cap
    // exit cap at disposition = stabilized + I9 × hold  ⇒  I9 = (exit − stabilized)/hold  (negative)
    expect(cells["I9"]).toBeLessThan(0);
    expect(cells["I9"]).toBeCloseTo((exitCap - sdaCap) / hold, 9);
    // The reconstructed exit cap ties to the assumption.
    expect(sdaCap + (cells["I9"] as number) * hold).toBeCloseTo(exitCap, 9);
  });
});
