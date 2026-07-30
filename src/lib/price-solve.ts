import { calculateUnderwriting, type ScenarioInputs, type DealMetrics } from "./underwriting";

/**
 * Reverse price-solve: the purchase price at which a return metric hits a target.
 *
 * IRR, equity multiple, average cash-on-cash, and going-in cap all decrease
 * monotonically as the purchase price rises (NOI and the cap-rate exit value
 * don't depend on price, but equity in does), so a bisection is exact. Returns
 * null if the target isn't bracketed within [0.2×, 5×] the current price (e.g. a
 * deal so strong even 5× still clears the target, or so weak even 0.2× can't).
 */
export function solvePriceForMetricTarget(
  inputs: ScenarioInputs,
  target: number,
  metric: (m: DealMetrics) => number | null,
): number | null {
  const current = inputs.purchase.purchase_price || 1_000_000;

  // A null metric at a high price means a catastrophic return (IRR past the
  // engine's −99% divergence guard) — treat it as −∞ ("worse than any target")
  // so it still brackets, rather than aborting the solve.
  const at = (price: number): number => {
    const r = calculateUnderwriting({
      ...inputs,
      purchase: { ...inputs.purchase, purchase_price: price },
    });
    const v = metric(r.metrics);
    return v === null ? -Infinity : v;
  };

  let lo = Math.max(10_000, current * 0.2); // low price → high return
  let hi = current * 5; // high price → low return
  // Monotonic decreasing: need fLo ≥ target ≥ fHi to bracket the root.
  if (at(lo) < target || at(hi) > target) return null;

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > target) lo = mid; // return too high → price too low → raise the floor
    else hi = mid;
    if (hi - lo < 1) break;
  }
  return Math.round((lo + hi) / 2);
}

export const solvePriceForIRR = (inputs: ScenarioInputs, target: number) =>
  solvePriceForMetricTarget(inputs, target, (m) => m.irr);
