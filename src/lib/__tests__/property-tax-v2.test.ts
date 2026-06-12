/**
 * Phase 2 acceptance tests (fix-spec): HB 920 bill shape, abatement vectors,
 * calendar anchoring. The xlsx tie-out activates when the reference workbook
 * lands in fixtures/.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  propertyTaxBillForTaxYear,
  propertyTaxForMonthV2,
  propertyTaxScenarioInForce,
  computePropertyTaxVectors,
} from "../underwriting";
import type { PropertyTaxAssumptions } from "../underwriting";

const BRYDEN: PropertyTaxAssumptions = {
  enabled: true,
  closing_date: "2026-08-01",
  effective_tax_rate: 0.02375,
  apply_at_exit: true,
  abatement: {
    program: "CRA residential",
    abated_annual_tax: 7100,
    unabated_annual_tax: 28500,
    final_abated_tax_year: 2028,
    transferable: "confirmed",
  },
};

describe("property tax v2 (Phase 2)", () => {
  it("abated_transfers: ~$7.1-7.3K through TY2028, stepping to ~$30.7K at TY2029", () => {
    for (const [ty, lo, hi] of [
      [2026, 7000, 7200],
      [2027, 7100, 7350],
      [2028, 7200, 7500],
    ] as const) {
      const bill = propertyTaxBillForTaxYear(BRYDEN, 1_200_000, "abated_transfers", ty);
      expect(bill, `TY${ty}`).toBeGreaterThanOrEqual(lo);
      expect(bill, `TY${ty}`).toBeLessThanOrEqual(hi);
    }
    const ty29 = propertyTaxBillForTaxYear(BRYDEN, 1_200_000, "abated_transfers", 2029);
    expect(ty29).toBeGreaterThanOrEqual(30_000);
    expect(ty29).toBeLessThanOrEqual(31_000);
  });

  it("abatement_lost: full unabated bill from day 1 (today's behavior)", () => {
    expect(propertyTaxBillForTaxYear(BRYDEN, 1_200_000, "abatement_lost", 2026)).toBeCloseTo(28_500, 0);
  });

  it("scenario defaults: abatement_lost unless transfer is CONFIRMED", () => {
    expect(propertyTaxScenarioInForce(BRYDEN)).toBe("abated_transfers");
    expect(
      propertyTaxScenarioInForce({ ...BRYDEN, abatement: { ...BRYDEN.abatement!, transferable: "unconfirmed" } })
    ).toBe("abatement_lost");
    expect(propertyTaxScenarioInForce({ ...BRYDEN, abatement: undefined })).toBe("reassessed_to_price");
  });

  it("5th St: the step lands at the tax-year boundary from final_abated_tax_year + closing date", () => {
    const fifth: PropertyTaxAssumptions = {
      ...BRYDEN,
      closing_date: "2026-06-01",
      abatement: { ...BRYDEN.abatement!, final_abated_tax_year: 2030, abated_annual_tax: 2400, unabated_annual_tax: 14200 },
      scenario: "abated_transfers",
    };
    // Closing Jun 2026 → pro forma month index for Dec 2030 = 54, Jan 2031 = 55.
    const dec2030 = propertyTaxForMonthV2(fifth, 640_000, 54) * 12;
    const jan2031 = propertyTaxForMonthV2(fifth, 640_000, 55) * 12;
    expect(dec2030).toBeLessThan(3_500); // still abated
    expect(jan2031).toBeGreaterThan(14_000); // full bill — step exactly at Jan 1
    expect(jan2031 / dec2030).toBeGreaterThan(2);
  });

  it("vectors cover every tax year in the hold, all three scenarios", () => {
    const v = computePropertyTaxVectors(BRYDEN, 1_200_000, 5);
    expect(v.scenario_in_force).toBe("abated_transfers");
    expect(v.rows[0].tax_year).toBe(2026);
    expect(v.rows[v.rows.length - 1].tax_year).toBe(2031); // Aug 2026 + 60mo → Jul 2031
    for (const r of v.rows) {
      expect(r.abatement_lost).toBeGreaterThan(0);
      expect(r.reassessed_to_price).toBeGreaterThan(0);
      expect(r.abated_transfers).toBeGreaterThan(0);
    }
  });

  const XLSX_FIXTURE = "fixtures/Bryden___Fifth_St_-_Tax___Abatement_Analysis.xlsx";
  it.skipIf(!existsSync(XLSX_FIXTURE))(
    "reproduces the reference 6-Yr Projection Bryden row within $5 (activates when the xlsx lands in fixtures/)",
    () => {
      // PENDING: map the workbook's "6-Yr Projection" sheet layout once the
      // file is provided, then assert |model - sheet| < $5 per tax year.
      expect.fail(
        "fixtures xlsx found — wire the 6-Yr Projection row mapping in this test before relying on it"
      );
    }
  );
});
