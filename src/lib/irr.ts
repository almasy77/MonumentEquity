/**
 * IRR / XIRR calculation using Newton's method.
 *
 * Cash flows are signed: negative = outflow (investment), positive = inflow (distribution/sale).
 */

/**
 * Calculate IRR for evenly-spaced periodic cash flows.
 * @param cashFlows Array of cash flows (first is typically negative)
 * @param guess Initial guess (default 0.1 = 10%)
 * @param maxIterations Maximum Newton iterations
 * @param tolerance Convergence threshold
 * @returns Annual IRR as a decimal (e.g. 0.18 = 18%), or null if no convergence
 */
export function calculateIRR(
  cashFlows: number[],
  guess: number = 0.1,
  maxIterations: number = 100,
  tolerance: number = 1e-7
): number | null {
  if (cashFlows.length < 2) return null;

  // Check there's at least one positive and one negative
  const hasPositive = cashFlows.some((cf) => cf > 0);
  const hasNegative = cashFlows.some((cf) => cf < 0);
  if (!hasPositive || !hasNegative) return null;

  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0; // derivative

    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashFlows[t] / denom;
      dnpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }

    if (Math.abs(dnpv) < 1e-12) {
      // Derivative too small — try a different guess
      rate += 0.01;
      break;
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;

    // Newton wandered outside the plausible band — hand off to bisection, which
    // brackets the root reliably even for near-total-loss or multi-sign flows.
    if (rate < -0.99 || rate > 10) {
      break;
    }
  }

  // Newton didn't converge — fall back to a bracketing bisection over the NPV curve.
  return bracketRoot((r) => calculateNPV(cashFlows, r), tolerance);
}

/**
 * Calculate XIRR for irregularly-spaced cash flows with dates.
 * @param cashFlows Array of { amount, date } where date is a Date object
 * @param guess Initial guess (default 0.1)
 * @returns Annual IRR as a decimal, or null if no convergence
 */
export function calculateXIRR(
  cashFlows: Array<{ amount: number; date: Date }>,
  guess: number = 0.1,
  maxIterations: number = 100,
  tolerance: number = 1e-7
): number | null {
  if (cashFlows.length < 2) return null;

  const hasPositive = cashFlows.some((cf) => cf.amount > 0);
  const hasNegative = cashFlows.some((cf) => cf.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  // Sort by date
  const sorted = [...cashFlows].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
  const d0 = sorted[0].date.getTime();

  // NPV of the dated flows at a given annual rate (shared by Newton + bisection).
  const npvAt = (r: number): number => {
    let npv = 0;
    for (const cf of sorted) {
      const years = (cf.date.getTime() - d0) / (365.25 * 86400000);
      npv += cf.amount / Math.pow(1 + r, years);
    }
    return npv;
  };

  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;

    for (const cf of sorted) {
      const years = (cf.date.getTime() - d0) / (365.25 * 86400000);
      const denom = Math.pow(1 + rate, years);
      npv += cf.amount / denom;
      if (years > 0) {
        dnpv -= (years * cf.amount) / Math.pow(1 + rate, years + 1);
      }
    }

    if (Math.abs(dnpv) < 1e-12) {
      rate += 0.01;
      break;
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;

    if (rate < -0.99 || rate > 10) {
      break;
    }
  }

  // Newton didn't converge — fall back to a bracketing bisection over the NPV curve.
  return bracketRoot(npvAt, tolerance);
}

/**
 * Bracketing + bisection root finder for the NPV curve — the robust fallback for
 * flows Newton's method can't solve: near-total-loss deals whose IRR sits just
 * above −100%, and multi-sign-change flows (e.g. a mid-hold refinance cash-out)
 * where a bad Newton step diverges. Scans a coarse grid from just above −100% up
 * to 1000% for the first sign change in NPV, then bisects that bracket. Returns
 * the first (lowest-rate) root, which is the economically meaningful IRR for the
 * standard "outflow then inflows" shape. Returns null only when no sign change
 * exists on the grid (no real IRR in range).
 */
function bracketRoot(
  npv: (r: number) => number,
  tolerance: number,
  lo: number = -0.9999,
  hi: number = 10,
  step: number = 0.01
): number | null {
  let aRate = lo;
  let aVal = npv(aRate);
  if (isFinite(aVal) && Math.abs(aVal) < tolerance) return aRate;

  for (let r = lo + step; r <= hi + 1e-9; r += step) {
    const bVal = npv(r);
    if (isFinite(aVal) && isFinite(bVal) && aVal * bVal <= 0) {
      // Root bracketed in [aRate, r] — bisect.
      let x0 = aRate;
      let x1 = r;
      let f0 = aVal;
      for (let i = 0; i < 200; i++) {
        const mid = (x0 + x1) / 2;
        const fm = npv(mid);
        if (Math.abs(fm) < tolerance || x1 - x0 < 1e-12) return mid;
        if (f0 * fm <= 0) {
          x1 = mid;
        } else {
          x0 = mid;
          f0 = fm;
        }
      }
      return (x0 + x1) / 2;
    }
    aRate = r;
    aVal = bVal;
  }

  return null;
}

// Year length used by calculateXIRR's day-count. Exposed so annual flows can be
// dated on exact 1-year spacing (years_i = i exactly).
export const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * IRR for a plain annual cash-flow array [t0, t1, …, tN] via the dated XIRR
 * engine, with each flow placed on exact 1-year spacing. Numerically identical
 * to calculateIRR for annual flows, but routes through calculateXIRR so callers
 * can later interleave genuinely dated events (e.g. a mid-hold refinance) by
 * building {amount, date}[] directly and calling calculateXIRR.
 */
export function calculateAnnualXIRR(flows: number[]): number | null {
  return calculateXIRR(flows.map((amount, i) => ({ amount, date: new Date(i * MS_PER_YEAR) })));
}

/**
 * Calculate NPV at a given discount rate.
 */
export function calculateNPV(
  cashFlows: number[],
  discountRate: number
): number {
  let npv = 0;
  for (let t = 0; t < cashFlows.length; t++) {
    npv += cashFlows[t] / Math.pow(1 + discountRate, t);
  }
  return npv;
}
