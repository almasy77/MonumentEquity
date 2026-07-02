/**
 * The sensitivity grid's tax-loaded exit closed form must add the exit-year
 * property tax back for property_tax_v2 deals (not just v1). The bug added back
 * 0 for v2 while the denominator still carried the rate, understating exit value
 * — so every v2 sensitivity cell (incl. the center) dropped far below the
 * headline. Guard: a v2 deal's center-vs-headline gap should be in the same
 * small band as a no-reassessment deal's (both are just the current-vs-market
 * rent-basis drift of the simplified path), not the large extra gap the bug added.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}

// |headline IRR − sensitivity center-cell IRR| (price delta 0, exit cap = base).
function centerGap(inputs: ScenarioInputs): number {
  const r = calculateUnderwriting(inputs);
  const cap = inputs.exit.exit_cap_rate;
  const c = r.sensitivity.find(
    (x) => Math.abs(x.purchase_price_delta) < 1e-9 && Math.abs(x.exit_cap_rate - cap) < 1e-9,
  );
  return Math.abs((r.metrics.irr ?? 0) - (c?.irr ?? 0));
}

describe("sensitivity grid — property_tax_v2 exit add-back", () => {
  it("v2 deal's center cell doesn't diverge more than a no-reassessment deal's", () => {
    const none = bryden();
    none.expenses.tax_reassessment = undefined;
    none.expenses.property_tax_v2 = undefined;

    const v2 = bryden();
    v2.expenses.tax_reassessment = undefined;
    v2.expenses.property_tax_v2 = { enabled: true, effective_tax_rate: 0.02, reassessed_value: 1_000_000, apply_at_exit: true };

    const gapNone = centerGap(none);
    const gapV2 = centerGap(v2);

    // The residual gap is the simplified path's rent-basis drift (~0.04). With the
    // bug, v2 added a large extra understatement on top; post-fix the two are close.
    expect(gapV2).toBeLessThan(gapNone + 0.02);
  });
});
