import { describe, it, expect } from "vitest";
import { checkInputPlausibility } from "../input-checks";
import type { ScenarioInputs } from "../underwriting";

/** A clean, plausible deal that should raise no flags. */
function clean(): ScenarioInputs {
  return {
    purchase: { purchase_price: 1_200_000, closing_cost_rate: 0.02 },
    financing: { ltv: 0.7, interest_rate: 0.06, amortization_years: 30, io_period_months: 0, origination_fee_rate: 0.01 },
    revenue: {
      unit_mix: [{ type: "1BR/1BA", count: 12, current_rent: 1_000, market_rent: 1_150, renovated_rent_premium: 100 }],
      vacancy_rate: 0.05, bad_debt_rate: 0.01, concessions_rate: 0, rent_growth_rate: 0.03, other_income_monthly: 0,
    },
    expenses: {
      management_fee_rate: 0.05, expense_escalation_rate: 0.03, tax_escalation_rate: 0.03,
      property_tax_total: 15_000, insurance_per_unit: 300,
    },
    capex: { projects: [] },
    exit: { hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.02 },
  } as unknown as ScenarioInputs;
}
const has = (flags: ReturnType<typeof checkInputPlausibility>, field: string) => flags.find((f) => f.field === field);

describe("input plausibility — clean deal", () => {
  it("raises no flags for a plausible deal", () => {
    expect(checkInputPlausibility(clean(), { units: 12 })).toEqual([]);
  });
});

describe("input plausibility — percent-vs-decimal typos (the big one)", () => {
  it("flags an interest rate typed as a percent", () => {
    const inp = clean(); (inp.financing as { interest_rate: number }).interest_rate = 6.5;
    const f = has(checkInputPlausibility(inp), "financing.interest_rate");
    expect(f?.severity).toBe("error");
    expect(f?.message).toContain("0.065");
  });
  it("flags vacancy, rent growth, exit cap, closing costs typed as percents", () => {
    const inp = clean();
    (inp.revenue as { vacancy_rate: number }).vacancy_rate = 5;
    (inp.revenue as { rent_growth_rate: number }).rent_growth_rate = 3;
    (inp.exit as { exit_cap_rate: number }).exit_cap_rate = 6.5;
    (inp.purchase as { closing_cost_rate: number }).closing_cost_rate = 2;
    const flags = checkInputPlausibility(inp);
    for (const field of ["revenue.vacancy_rate", "revenue.rent_growth_rate", "exit.exit_cap_rate", "purchase.closing_cost_rate"]) {
      expect(has(flags, field)?.severity).toBe("error");
    }
  });
  it("accepts LTV of exactly 1.0 but flags LTV of 70", () => {
    const ok = clean(); (ok.financing as { ltv: number }).ltv = 1.0;
    expect(has(checkInputPlausibility(ok), "financing.ltv")).toBeUndefined();
    const bad = clean(); (bad.financing as { ltv: number }).ltv = 70;
    expect(has(checkInputPlausibility(bad), "financing.ltv")?.severity).toBe("error");
  });
});

describe("input plausibility — rents", () => {
  it("flags a rent that looks annual", () => {
    const inp = clean(); (inp.revenue as { unit_mix: Array<{ current_rent: number }> }).unit_mix[0].current_rent = 12_000;
    expect(has(checkInputPlausibility(inp), "revenue.unit_mix[0].current_rent")?.message).toContain("annual");
  });
  it("flags a suspiciously low rent", () => {
    const inp = clean(); (inp.revenue as { unit_mix: Array<{ market_rent: number }> }).unit_mix[0].market_rent = 50;
    expect(has(checkInputPlausibility(inp), "revenue.unit_mix[0].market_rent")).toBeTruthy();
  });
  it("flags market rent below current rent and a negative renovated premium", () => {
    const inp = clean();
    const u = (inp.revenue as { unit_mix: Array<{ market_rent: number; renovated_rent_premium: number }> }).unit_mix[0];
    u.market_rent = 900; u.renovated_rent_premium = -50;
    const flags = checkInputPlausibility(inp);
    expect(has(flags, "revenue.unit_mix[0].market_rent")?.message).toContain("below current");
    expect(has(flags, "revenue.unit_mix[0].renovated_rent_premium")).toBeTruthy();
  });
});

describe("input plausibility — missing costs, price/unit, hold, exit", () => {
  it("flags $0 property tax (unless reassessment is on) and $0 insurance", () => {
    const inp = clean();
    (inp.expenses as { property_tax_total: number; insurance_per_unit: number }).property_tax_total = 0;
    (inp.expenses as { insurance_per_unit: number }).insurance_per_unit = 0;
    const flags = checkInputPlausibility(inp);
    expect(has(flags, "expenses.property_tax_total")).toBeTruthy();
    expect(has(flags, "expenses.insurance_per_unit")).toBeTruthy();
    // reassessment on ⇒ no property-tax flag
    (inp.expenses as { tax_reassessment?: object }).tax_reassessment = { enabled: true };
    expect(has(checkInputPlausibility(inp), "expenses.property_tax_total")).toBeUndefined();
  });
  it("flags an implausible price per unit", () => {
    const low = clean(); (low.purchase as { purchase_price: number }).purchase_price = 60_000; // $5k/unit
    expect(has(checkInputPlausibility(low, { units: 12 }), "purchase.purchase_price")).toBeTruthy();
  });
  it("flags a bad hold and a missing exit basis", () => {
    const inp = clean();
    (inp.exit as { hold_period_years: number }).hold_period_years = 0;
    (inp.exit as { exit_cap_rate: number }).exit_cap_rate = 0;
    const flags = checkInputPlausibility(inp);
    expect(has(flags, "exit.hold_period_years")?.severity).toBe("error");
    expect(has(flags, "exit.exit_cap_rate")?.severity).toBe("error");
  });
});

describe("input plausibility — VAL-4 $0-rent classification", () => {
  it("warns about undeclared $0 units and reports the count (by row count)", () => {
    const inp = clean();
    (inp.revenue as { unit_mix: unknown[] }).unit_mix = [
      { type: "1BR/1BA", count: 12, current_rent: 1_000, market_rent: 1_150, renovated_rent_premium: 0 },
      { type: "2BR/1BA", count: 5, current_rent: 0, market_rent: 1_300, renovated_rent_premium: 0 }, // undeclared $0
    ];
    const f = has(checkInputPlausibility(inp), "revenue.unit_mix.zero_rent_treatment");
    expect(f?.severity).toBe("warning");
    expect(f?.message).toContain("5 units");
  });

  it("is silent once every $0 unit is declared vacant or STR", () => {
    const inp = clean();
    (inp.revenue as { unit_mix: unknown[] }).unit_mix = [
      { type: "1BR/1BA", count: 12, current_rent: 1_000, market_rent: 1_150, renovated_rent_premium: 0 },
      { type: "2BR/1BA", count: 5, current_rent: 0, market_rent: 1_300, renovated_rent_premium: 0, zero_rent_treatment: "str" },
      { type: "Studio", count: 3, current_rent: 0, market_rent: 900, renovated_rent_premium: 0, zero_rent_treatment: "vacant" },
    ];
    expect(has(checkInputPlausibility(inp), "revenue.unit_mix.zero_rent_treatment")).toBeUndefined();
  });

  it("counts undeclared $0 units from per-unit detail too", () => {
    const inp = clean();
    (inp.revenue as { unit_mix: unknown[] }).unit_mix = [
      { type: "2BR/1BA", count: 2, current_rent: 0, market_rent: 1_300, renovated_rent_premium: 0, units: [
        { unit_id: "A", status: "vacant", current_rent: 0, zero_rent_treatment: "vacant" },
        { unit_id: "B", status: "vacant", current_rent: 0 }, // undeclared
      ] },
    ];
    const f = has(checkInputPlausibility(inp), "revenue.unit_mix.zero_rent_treatment");
    expect(f?.message).toContain("1 unit ");
  });
});
