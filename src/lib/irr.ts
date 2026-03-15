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
      continue;
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;

    // Guard against divergence
    if (rate < -0.99 || rate > 10) {
      return null;
    }
  }

  return null;
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
      continue;
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;

    if (rate < -0.99 || rate > 10) {
      return null;
    }
  }

  return null;
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
