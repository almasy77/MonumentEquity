/**
 * The sensitivity grid's "no change" center cell (0% price delta, base exit cap)
 * must reconcile to the headline IRR. It used to silently default to in-place
 * "current" rents while the headline pro forma ran on the deal's actual
 * proforma_*_basis — so for any value-add deal underwritten to market rents the
 * whole grid contradicted the headline. When sensitivity_rent_basis is unset the
 * grid now inherits the pro-forma bases via resolveProformaBases.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  const inp = JSON.parse(
    readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")
  ) as ScenarioInputs;
  inp.revenue.rent_ramp = { ...inp.revenue.rent_ramp!, enabled: false };
  return inp;
}

describe("sensitivity grid rent basis", () => {
  it("center cell reconciles to headline IRR on a market-rent value-add deal (basis unset)", () => {
    const inp = bryden();
    // Underwrite to market / renovated-market rents, the normal value-add case.
    inp.exit = {
      ...inp.exit,
      proforma_unrenovated_basis: "market",
      proforma_renovated_basis: "market_plus_premium",
      sensitivity_rent_basis: undefined, // the common case — no explicit override
    };

    const r = calculateUnderwriting(inp);
    const center = r.sensitivity.find(
      (c) => c.purchase_price_delta === 0 && Math.abs(c.exit_cap_rate - inp.exit.exit_cap_rate) < 1e-9
    );
    expect(center).toBeDefined();
    expect(center!.irr).not.toBeNull();

    // Simplified path is an approximation of the full monthly calc, so allow a
    // small tolerance — but the pre-fix bug produced a >20-point divergence here.
    expect(Math.abs((center!.irr ?? 0) - (r.metrics.irr ?? 0))).toBeLessThan(0.02);
  });

  it("an explicit sensitivity_rent_basis still overrides the pro-forma bases", () => {
    const inp = bryden();
    inp.exit = {
      ...inp.exit,
      proforma_unrenovated_basis: "market",
      proforma_renovated_basis: "market_plus_premium",
      sensitivity_rent_basis: "current", // deliberately force in-place rents
    };
    const r = calculateUnderwriting(inp);
    const center = r.sensitivity.find(
      (c) => c.purchase_price_delta === 0 && Math.abs(c.exit_cap_rate - inp.exit.exit_cap_rate) < 1e-9
    );
    // Forcing "current" rents against a market-rent headline should diverge — the
    // override is honored, not silently replaced by the pro-forma bases.
    expect(Math.abs((center!.irr ?? 0) - (r.metrics.irr ?? 0))).toBeGreaterThan(0.05);
  });
});
