// Property-tax risk flags surfaced in the UI and exports. These never change the
// computed tax — they warn a human that the parcel's record needs judgment before
// the reassessment formula can be trusted. Generic across markets.
import type { Deal } from "./validations";

export interface TaxFlag {
  id: string;
  severity: "warn" | "info";
  text: string;
}

// Best-effort parse of an implied unit range from a land-use/class code, e.g.
// "401 - APARTMENTS 4 TO 19 FAMILY" → {min:4,max:19}; "R-2F / TWO FAMILY" → {min:1,max:2}.
// Returns null when nothing parseable is found (no flag rather than a false one).
function unitRangeFromLandUse(code: string): { min: number; max: number } | null {
  const c = code.toUpperCase();
  let m = c.match(/(\d{1,3})\s*(?:TO|-|–)\s*(\d{1,3})\s*(?:FAMILY|UNIT)/); // "4 TO 19 FAMILY"
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const words: Record<string, number> = { SINGLE: 1, ONE: 1, TWO: 2, THREE: 3, FOUR: 4 };
  m = c.match(/(SINGLE|ONE|TWO|THREE|FOUR|\d{1,3})[\s-]*FAMILY/); // "TWO FAMILY" / "2 FAMILY"
  if (m) {
    const n = words[m[1]] ?? Number(m[1]);
    if (Number.isFinite(n)) return { min: 1, max: n };
  }
  m = c.match(/\bR-?(\d)F\b/); // "R-2F"
  if (m) return { min: 1, max: Number(m[1]) };
  return null;
}

/**
 * Risk flags for a deal's property-tax basis. `price` is the scenario purchase
 * price; falls back to the deal's asking price.
 */
export function computeTaxFlags(deal: Deal, price?: number): TaxFlag[] {
  const flags: TaxFlag[] = [];
  const purchase = price ?? deal.asking_price ?? 0;
  // Only the auditor's MARKET/appraised value is a valid basis for the "price is
  // above appraised" gap. assessed_value is the TAXABLE value (~35% of market in
  // Ohio-style jurisdictions); comparing price against it fired the flag on
  // essentially every deal with a bogus percentage.
  const appraised = deal.tax_market_value; // appraised/market value on record

  if (deal.tax_abatement_present || deal.incentive_type) {
    flags.push({
      id: "abatement",
      severity: "warn",
      text: "Abatement/exemption present — confirm transfer terms and remaining term before trusting the effective rate; it may understate what a new owner pays post-transfer or post-expiry.",
    });
  }
  if (appraised && appraised > 0 && purchase > appraised * 1.15) {
    const pct = ((purchase / appraised - 1) * 100).toFixed(0);
    flags.push({
      id: "gap",
      severity: "warn",
      text: `Purchase price is ${pct}% above the auditor's appraised value — likely due for a reassessment catch-up independent of the sale. Treat the reassessed tax as a floor, not a ceiling.`,
    });
  }
  if (deal.tax_cauv) {
    flags.push({
      id: "cauv",
      severity: "warn",
      text: "Parcel carries CAUV — a recoupment/conversion tax may apply on change of use. Verify before relying on the standard tax formula.",
    });
  }
  if (deal.tax_land_use_code) {
    const range = unitRangeFromLandUse(deal.tax_land_use_code);
    if (range && deal.units && (deal.units < range.min || deal.units > range.max)) {
      flags.push({
        id: "landuse",
        severity: "warn",
        text: `Land-use code on record (${deal.tax_land_use_code}) implies ${range.min}–${range.max} units but the deal is marketed as ${deal.units} — possible zoning/classification mismatch, not just a tax one.`,
      });
    }
  }
  if (deal.tax_reappraisal_in_progress) {
    flags.push({
      id: "reappraisal",
      severity: "info",
      text: "County reappraisal/update cycle in progress — check whether tentative values have posted before finalizing either tax figure.",
    });
  }
  return flags;
}
