/**
 * Sensitivity grid — reconciliation + shape.
 *
 * The grid uses a fast annual approximation, which left its "no change" center cell
 * disagreeing with the headline IRR shown right above it (0.2pp on a value-add deal,
 * >1pp on a tax-phase-in deal). The grid is now anchored to the headline IRR. This
 * test locks that in — the center cell must equal the headline — and checks the grid's
 * SHAPE is economically sane (IRR falls as you pay more or exit at a higher cap).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";

const GOLDEN = ["bryden_base", "fifth_st_tax_phasein"];

describe.each(GOLDEN)("sensitivity grid — %s", (name) => {
  const inp = JSON.parse(readFileSync(join(__dirname, "golden", name + ".input.json"), "utf8")) as ScenarioInputs;
  const res = calculateUnderwriting(inp);
  const baseCap = (inp as unknown as { exit: { exit_cap_rate: number } }).exit.exit_cap_rate;
  const cell = (dPrice: number, cap: number) => res.sensitivity.find((c) => Math.abs(c.purchase_price_delta - dPrice) < 1e-9 && Math.abs(c.exit_cap_rate - cap) < 1e-9);

  it("center cell reconciles exactly to the headline IRR", () => {
    expect(cell(0, baseCap)?.irr ?? NaN).toBeCloseTo(res.metrics.irr ?? NaN, 6);
  });

  it("IRR falls as purchase price rises (at the base exit cap)", () => {
    const lo = cell(-0.1, baseCap)!.irr!, mid = cell(0, baseCap)!.irr!, hi = cell(0.1, baseCap)!.irr!;
    expect(lo).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(hi);
  });

  it("IRR falls as the exit cap rises (at no price change)", () => {
    const tight = cell(0, baseCap - 0.01)!.irr!, mid = cell(0, baseCap)!.irr!, wide = cell(0, baseCap + 0.01)!.irr!;
    expect(tight).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(wide);
  });
});
