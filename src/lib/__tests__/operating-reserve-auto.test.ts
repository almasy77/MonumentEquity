/**
 * Auto operating reserve determinism.
 *
 * In "auto" mode the operating reserve is sized to N months of year-1 carry (debt
 * service + operating expenses) and DERIVED by the engine. Previously the engine read
 * only the stored capex_reserve, which the UI synced as a side effect — so the same
 * inputs produced different IRRs depending on whether a value had been saved. The IRR
 * must now be a pure function of the inputs, independent of any stored capex_reserve.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, resolveOperatingReserve, type ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  return JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8"),
  ) as ScenarioInputs;
}

describe("auto operating reserve", () => {
  it("IRR is independent of the stored capex_reserve in auto mode (the bug)", () => {
    const base = bryden();
    base.purchase.operating_reserve_mode = "auto";
    base.purchase.operating_reserve_months = 6;

    // Same inputs, three different stored capex_reserve values (as if saved at
    // different times, or never synced). All must give the SAME IRR and equity.
    const variants = [0, 50_000, 999_999].map((stored) => {
      const s = bryden();
      s.purchase.operating_reserve_mode = "auto";
      s.purchase.operating_reserve_months = 6;
      s.purchase.capex_reserve = stored;
      return calculateUnderwriting(s).metrics;
    });

    for (const m of variants) {
      expect(m.irr).toBeCloseTo(variants[0].irr as number, 12);
      expect(m.total_equity).toBeCloseTo(variants[0].total_equity, 6);
      expect(m.return_of_operating_reserve).toBeCloseTo(variants[0].return_of_operating_reserve, 6);
    }
  });

  it("the derived reserve equals N months of year-1 carry (DS + opex)", () => {
    const s = bryden();
    s.purchase.operating_reserve_mode = "auto";
    s.purchase.operating_reserve_months = 6;
    s.purchase.capex_reserve = 0; // ignored in auto mode
    const r = calculateUnderwriting(s);
    const expected = resolveOperatingReserve(
      s.purchase,
      r.annual[0].debt_service,
      r.annual[0].total_opex,
    );
    expect(expected).toBeGreaterThan(0);
    // The reserve is funded at close (in equity) and returned at exit.
    expect(r.metrics.return_of_operating_reserve).toBeCloseTo(expected, 2);
    // Equity at close vs. a zero-reserve run differs by exactly the derived reserve.
    const zero = bryden();
    zero.purchase.capex_reserve = 0; // manual, no reserve
    const zeroEq = calculateUnderwriting(zero).metrics.total_equity;
    expect(r.metrics.total_equity - zeroEq).toBeCloseTo(expected, 2);
  });

  it("manual mode is unchanged (uses the entered capex_reserve)", () => {
    const s = bryden();
    s.purchase.capex_reserve = 135_000; // mode unset ⇒ manual
    const r = calculateUnderwriting(s);
    expect(r.metrics.return_of_operating_reserve).toBeCloseTo(135_000, 2);
    expect(resolveOperatingReserve(s.purchase, 999, 999)).toBe(135_000);
  });

  it("more months of carry ⇒ a larger reserve and (slightly) lower IRR", () => {
    const six = bryden();
    six.purchase.operating_reserve_mode = "auto";
    six.purchase.operating_reserve_months = 6;
    const twelve = bryden();
    twelve.purchase.operating_reserve_mode = "auto";
    twelve.purchase.operating_reserve_months = 12;
    const r6 = calculateUnderwriting(six).metrics;
    const r12 = calculateUnderwriting(twelve).metrics;
    expect(r12.return_of_operating_reserve).toBeGreaterThan(r6.return_of_operating_reserve);
    expect(r12.total_equity).toBeGreaterThan(r6.total_equity);
    expect(r12.irr as number).toBeLessThan(r6.irr as number); // parking more equity drags IRR
  });
});
