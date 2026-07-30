/**
 * Share-page scenario data (public read-only view). Verifies the recompute-and-map
 * path the /share/[token] page uses: assumptions, pro forma, and sensitivity all
 * come from calculateUnderwriting (source of truth), the metric strip ties to the
 * engine, and a broken scenario degrades to the stored strip instead of throwing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShareScenarioData } from "../share-scenario";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import type { Deal, Scenario } from "../validations";

function fixtureInputs(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}

function scenarioFrom(inp: ScenarioInputs): Scenario {
  return {
    id: "s1", deal_id: "d1", name: "Base", type: "base", version: 1, is_active: true,
    purchase_assumptions: inp.purchase, financing_assumptions: inp.financing,
    revenue_assumptions: inp.revenue, expense_assumptions: inp.expenses,
    capex_assumptions: inp.capex, exit_assumptions: inp.exit,
    tax_assumptions: inp.tax, depreciation_assumptions: inp.depreciation,
  } as unknown as Scenario;
}

const DEAL = { id: "d1", address: "934 E Gay St", city: "Columbus", state: "OH", units: 12 } as unknown as Deal;

describe("buildShareScenarioData", () => {
  it("maps assumptions, pro forma, sensitivity, and a metric strip that ties to the engine", () => {
    const inp = fixtureInputs();
    const engine = calculateUnderwriting(inp);
    const d = buildShareScenarioData(DEAL, scenarioFrom(inp));

    // Metric strip == engine metrics (recomputed, not a stale snapshot).
    expect(d.metrics.irr).toBe(engine.metrics.irr);
    expect(d.metrics.em).toBe(engine.metrics.equity_multiple);
    expect(d.metrics.dscr).toBe(engine.metrics.year1_dscr);
    expect(d.metrics.goingCap).toBe(engine.metrics.going_in_cap);

    // Pro forma has one row per hold year and ties to the engine's annual figures.
    expect(d.proforma).toHaveLength(engine.annual.length);
    expect(d.proforma[0].gpr).toBe(engine.annual[0].gpr);
    expect(d.proforma[0].noi).toBe(engine.annual[0].noi);
    expect(d.proforma[0].cashFlow).toBe(engine.annual[0].cash_flow);
    // NOI is below GPR (sanity — the waterfall is populated, not all zeros).
    expect(d.proforma[0].gpr).toBeGreaterThan(0);
    expect(d.proforma[0].noi).toBeLessThan(d.proforma[0].gpr);

    // Sensitivity grid carried through for the shared table.
    expect(d.sensitivity.length).toBeGreaterThan(0);
    expect(d.sensitivity).toEqual(engine.sensitivity);
    expect(d.basePurchasePrice).toBe(inp.purchase.purchase_price);

    // Assumptions are present and formatted (a partner-facing list).
    expect(d.assumptions.length).toBeGreaterThan(6);
    expect(d.assumptions.find((a) => a.label === "Purchase Price")?.value).toMatch(/^\$/);
    expect(d.assumptions.find((a) => a.label === "Exit Cap Rate")?.value).toMatch(/%$/);
  });

  it("does NOT leak seller-inappropriate internals into the shared assumptions list", () => {
    // The share view intentionally shows returns (per the owner's choice), but the
    // assumptions list should stay to deal/financing facts — no reverse-solve / target IRR.
    const inp = fixtureInputs();
    const d = buildShareScenarioData(DEAL, scenarioFrom(inp));
    const labels = d.assumptions.map((a) => a.label.toLowerCase()).join(" ");
    for (const banned of ["target irr", "reverse", "buyer's max", "buyers max"]) {
      expect(labels).not.toContain(banned);
    }
  });

  it("degrades to the stored metric strip (no throw, empty detail) when inputs are unusable", () => {
    // A scenario with no usable assumptions makes calculateUnderwriting throw; the
    // builder must catch and fall back rather than crash the public page.
    const broken = {
      id: "s2", deal_id: "d1", name: "Broken", type: "base",
      calculated_metrics: { irr: 0.12, equity_multiple: 2.1, dscr: 1.3 },
    } as unknown as Scenario;
    const d = buildShareScenarioData(DEAL, broken);
    expect(d.name).toBe("Broken");
    expect(d.proforma).toEqual([]);
    expect(d.sensitivity).toEqual([]);
    expect(d.assumptions).toEqual([]);
    // Stored strip used as the fallback.
    expect(d.metrics.irr).toBe(0.12);
    expect(d.metrics.em).toBe(2.1);
  });
});
