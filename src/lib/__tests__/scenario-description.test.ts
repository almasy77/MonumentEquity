import { describe, it, expect } from "vitest";
import { describeScenario } from "../scenario-description";
import type { Scenario } from "../validations";

function scn(type: string, over: Record<string, Record<string, unknown>> = {}): Scenario {
  return {
    id: type,
    type,
    name: type === "base" ? "Base Case" : type,
    revenue_assumptions: { rent_growth_rate: 0.03, vacancy_rate: 0.07, ...(over.revenue_assumptions ?? {}) },
    exit_assumptions: { exit_cap_rate: 0.055, hold_period_years: 5, ...(over.exit_assumptions ?? {}) },
    financing_assumptions: { ltv: 0.7, interest_rate: 0.065, ...(over.financing_assumptions ?? {}) },
    purchase_assumptions: { purchase_price: 1_000_000, ...(over.purchase_assumptions ?? {}) },
    expense_assumptions: { ...(over.expense_assumptions ?? {}) },
    capex_assumptions: { ...(over.capex_assumptions ?? {}) },
  } as unknown as Scenario;
}

describe("describeScenario", () => {
  it("summarizes the base case itself", () => {
    const d = describeScenario(scn("base"));
    expect(d).toContain("Base case");
    expect(d).toContain("3% rent growth");
    expect(d).toContain("5-yr hold");
  });

  it("lists the diffs vs the base case", () => {
    const base = scn("base");
    const up = scn("upside", { revenue_assumptions: { rent_growth_rate: 0.05, vacancy_rate: 0.05 } });
    const d = describeScenario(up, base);
    expect(d).toContain("vs Base Case:");
    expect(d).toContain("rent growth 5% (vs 3%)");
    expect(d).toContain("vacancy 5% (vs 7%)");
    expect(d).not.toContain("exit cap"); // unchanged → omitted
  });

  it("notes a renovation program in the diff", () => {
    const base = scn("base");
    const reno = scn("renovation", { capex_assumptions: { per_unit_cost: 15000, units_to_renovate: 20 } });
    expect(describeScenario(reno, base)).toContain("reno $15k/unit × 20");
  });

  it("says when a scenario matches the base", () => {
    const base = scn("base");
    expect(describeScenario(scn("custom"), base)).toBe("Same key inputs as Base Case");
  });

  it("self-summarizes when there is no base to compare to", () => {
    const d = describeScenario(scn("current"));
    expect(d).toContain("3% rent growth");
    expect(d).not.toContain("vs");
  });
});
