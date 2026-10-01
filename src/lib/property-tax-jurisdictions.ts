// Jurisdiction-aware property-tax mechanics.
//
// The v2 property-tax engine (src/lib/underwriting.ts) was originally built for
// Franklin County, Ohio's "welcome stranger" model, where a sale reassesses the
// parcel toward the purchase price. That mechanic is NOT universal — most states
// reassess only on a county/state revaluation cycle, and the sale price does not
// directly change the bill. This module maps a jurisdiction to its reassessment
// method so the engine can stop assuming Ohio's rules everywhere.
//
// Design rule: an UNMAPPED state must never silently fall back to sale-price
// reassessment. Callers get `method: "unknown"` and are expected to force an
// explicit user choice rather than compute a misleading number.

export type ReassessmentMethod =
  | "sale_price" // reassesses toward the sale/purchase price at or near closing
  | "periodic_cycle" // reassesses only on a county/state revaluation cycle; sale price does NOT directly change the bill
  | "unknown"; // no rule mapped yet — caller must not silently pick a default

export interface JurisdictionTaxRules {
  state: string; // 2-letter
  method: ReassessmentMethod;
  typical_cycle_years?: number; // for "periodic_cycle" states — informational default, county-overridable
  default_assessment_ratio?: number; // assessed value ÷ market value (P2-2); county-overridable
  notes: string;
  source?: string;
}

export const JURISDICTION_TAX_RULES: Record<string, JurisdictionTaxRules> = {
  OH: {
    state: "OH",
    method: "periodic_cycle", // triennial update / sexennial reappraisal; sale prices feed the NEXT cycle, not an instant reassessment
    typical_cycle_years: 3,
    default_assessment_ratio: 0.35, // Ohio assesses at 35% of market value
    notes:
      "County auditor triennial update (sexennial full reappraisal). Recent sale prices are used as evidence in that cycle, not an instant reassessment at closing. HB 920 caps how much of the bill floats with valuation between reappraisals.",
  },
  NC: {
    state: "NC",
    method: "periodic_cycle",
    typical_cycle_years: 4, // county-set; confirm the specific county's schedule per deal — this is a default only
    default_assessment_ratio: 1.0, // NC assesses at 100% of appraised market value
    notes:
      "No sale-triggered reassessment. Counties revalue on their own set cycle (commonly 4-8 years). Verify the specific county's cycle and last/next revaluation year per deal.",
  },
  CT: {
    state: "CT",
    method: "periodic_cycle",
    typical_cycle_years: 5, // statutory quinquennial revaluation
    default_assessment_ratio: 0.70, // Connecticut assesses at 70% of market value
    notes:
      "Statutory 5-year revaluation. Assessed value is 70% of market value; the sale does not trigger an instant reassessment, but a scheduled revaluation (e.g. Norwalk effective 10/1/2028) re-marks the base. Verify the town's next revaluation date.",
  },
  PA: {
    state: "PA",
    method: "periodic_cycle",
    default_assessment_ratio: 0.493, // Allegheny County common level ratio (CLR) — county-specific, changes yearly
    notes:
      "No statewide cycle; each county sets a base year and a Common Level Ratio (CLR) that converts market value to assessed value. 0.493 is Allegheny County's CLR (confirm the current year's CLR and the specific county). Post-sale assessment appeals by school districts are common and re-mark the base.",
  },
  // Add states as deals come in. DO NOT default an unmapped state to "sale_price" —
  // see jurisdictionRulesFor's fallback below.
};

export function jurisdictionRulesFor(state: string | undefined): JurisdictionTaxRules {
  if (!state) return { state: "", method: "unknown", notes: "No state on file for this parcel." };
  return (
    JURISDICTION_TAX_RULES[state.toUpperCase()] ?? {
      state: state.toUpperCase(),
      method: "unknown",
      notes: `No tax-reassessment rule mapped for ${state.toUpperCase()} yet. Do not assume sale-price reassessment — confirm the county's actual mechanics before enabling reassessment.`,
    }
  );
}

/**
 * Default assessed-value ÷ market-value ratio for a state (P2-2 reassessment
 * schedule). Used to prefill the schedule editor and as a fallback when a step
 * doesn't set its own ratio. Returns undefined for unmapped states so the caller
 * must supply one rather than guess.
 */
export function defaultAssessmentRatioFor(state: string | undefined): number | undefined {
  return jurisdictionRulesFor(state).default_assessment_ratio;
}

/**
 * Strict resolver for contexts that must not proceed on an unmapped jurisdiction
 * (e.g. tests, or a validation gate). Throws rather than returning a method the
 * caller might silently act on. The engine itself uses the graceful
 * jurisdictionRulesFor + a warning path instead of this.
 */
export function assertJurisdictionResolved(state: string | undefined): JurisdictionTaxRules {
  const rules = jurisdictionRulesFor(state);
  if (rules.method === "unknown") {
    throw new Error(
      state
        ? `No property-tax reassessment rule mapped for ${state.toUpperCase()}. Map the state in property-tax-jurisdictions.ts or set the tax assumption manually.`
        : "No state on file — cannot resolve property-tax reassessment method."
    );
  }
  return rules;
}
