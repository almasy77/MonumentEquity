/**
 * IRR / XIRR — Newton's method with a bracketing-bisection fallback.
 * The fallback exists so near-total-loss deals (IRR just above −100%) and
 * multi-sign-change flows (a mid-hold refinance cash-out) still return a rate
 * instead of null when Newton diverges.
 */
import { describe, it, expect } from "vitest";
import { calculateIRR, calculateAnnualXIRR, calculateNPV } from "../irr";

const closeTo = (v: number | null, target: number, eps = 1e-4) => {
  expect(v).not.toBeNull();
  expect(Math.abs((v as number) - target)).toBeLessThan(eps);
};

describe("calculateIRR — standard flows (Newton path)", () => {
  it("solves a simple double-your-money-in-1-year flow (100% IRR)", () => {
    closeTo(calculateIRR([-100, 200]), 1.0);
  });

  it("solves a plausible 5-year real-estate flow", () => {
    // NPV at the returned rate must be ~0.
    const flows = [-1_000_000, 60_000, 65_000, 70_000, 75_000, 1_400_000];
    const irr = calculateIRR(flows);
    expect(irr).not.toBeNull();
    expect(Math.abs(calculateNPV(flows, irr as number))).toBeLessThan(1e-2);
  });
});

describe("calculateIRR — fallback path (Newton diverges)", () => {
  it("returns a deeply negative IRR on a near-total-loss deal", () => {
    // Invest 1,000,000; recover only 10,000 at year 5 → IRR ≈ −60%.
    const flows = [-1_000_000, 0, 0, 0, 0, 10_000];
    const irr = calculateIRR(flows);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeLessThan(-0.5);
    expect(irr as number).toBeGreaterThan(-1);
    expect(Math.abs(calculateNPV(flows, irr as number))).toBeLessThan(1e-2);
  });

  it("solves a multi-sign-change flow (refi cash-out mid-hold)", () => {
    // −equity, small op distributions, a big refi return (positive), then more
    // op cash and a sale. Two sign changes — Newton is prone to diverge here.
    const flows = [-1_000_000, 50_000, 900_000, -100_000, 50_000, 700_000];
    const irr = calculateIRR(flows);
    expect(irr).not.toBeNull();
    // Whatever root it returns must zero the NPV.
    expect(Math.abs(calculateNPV(flows, irr as number))).toBeLessThan(1);
  });

  it("returns null when no sign change exists (all outflows)", () => {
    expect(calculateIRR([-100, -50, -50])).toBeNull();
  });
});

describe("calculateAnnualXIRR — matches calculateIRR for annual flows", () => {
  it("agrees with the periodic solver on a standard flow", () => {
    const flows = [-1_000_000, 60_000, 65_000, 70_000, 75_000, 1_400_000];
    const periodic = calculateIRR(flows) as number;
    const dated = calculateAnnualXIRR(flows) as number;
    expect(Math.abs(periodic - dated)).toBeLessThan(1e-3);
  });

  it("recovers a deeply negative IRR via its own fallback", () => {
    const flows = [-1_000_000, 0, 0, 0, 0, 10_000];
    const irr = calculateAnnualXIRR(flows);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeLessThan(-0.5);
    expect(irr as number).toBeGreaterThan(-1);
  });
});
