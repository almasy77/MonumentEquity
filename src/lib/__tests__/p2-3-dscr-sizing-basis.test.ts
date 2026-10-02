/**
 * P2-3: size the DSCR loan on a chosen NOI basis. A lease-up deal has a depressed
 * year-1 NOI, so sizing on in-place NOI (current rents at stated vacancy, current
 * expenses) yields a larger loan and less equity than sizing on year-1 projected.
 * Unset = year-1 projected (back-compat).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, "golden", "mobile_drive_likely.input.json"), "utf8"),
) as ScenarioInputs;

function run(
  basis?: "in_place" | "year1_projected" | "manual",
  manualNoi?: number,
  proforma?: "current" | "market",
) {
  const s = JSON.parse(JSON.stringify(GOLDEN)) as ScenarioInputs;
  const f = s.financing as unknown as Record<string, unknown>;
  f.size_to_dscr = true;
  if (basis) f.dscr_sizing_basis = basis;
  if (manualNoi != null) f.manual_sizing_noi = manualNoi;
  if (proforma) {
    const ex = s.exit as unknown as Record<string, unknown>;
    ex.proforma_unrenovated_basis = proforma;
    ex.proforma_renovated_basis = proforma === "market" ? "market_plus_premium" : "current_plus_premium";
    ex.proforma_rent_basis = undefined;
  }
  return calculateUnderwriting(s).metrics;
}

describe("P2-3: DSCR sizing basis", () => {
  it("in-place respects the pro-forma basis drop-down: market (as-is stabilized) > current (strict)", () => {
    const current = run("in_place", undefined, "current");
    const market = run("in_place", undefined, "market");
    expect(current.dscr_sizing_basis).toBe("in_place");
    expect(market.dscr_sizing_noi!).toBeGreaterThan(current.dscr_sizing_noi!);
    // as-is stabilized sizes a loan at least as large (less equity).
    expect(market.loan_amount).toBeGreaterThanOrEqual(current.loan_amount - 1);
  });

  it("reports the basis used", () => {
    expect(run("year1_projected").dscr_sizing_basis).toBe("year1_projected");
    expect(run("in_place").dscr_sizing_basis).toBe("in_place");
  });

  it("unset basis matches year1_projected (back-compat, no silent change)", () => {
    expect(run(undefined).loan_amount).toBeCloseTo(run("year1_projected").loan_amount, 0);
    expect(run(undefined).dscr_sizing_basis).toBe("year1_projected");
  });

  it("manual basis sizes on the entered NOI, monotonically", () => {
    const m = run("manual", 250000);
    expect(m.dscr_sizing_basis).toBe("manual");
    expect(m.dscr_sizing_noi).toBe(250000);
    expect(run("manual", 300000).loan_amount).toBeGreaterThanOrEqual(run("manual", 150000).loan_amount - 1);
  });
});
