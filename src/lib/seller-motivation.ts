/**
 * Change E (lender review, Nov 2026): structured seller-motivation signals.
 *
 * Stored on the deal: listed_date, original_asking_price, price_cut_count,
 * tax_delinquent (+ note). Derived here, never stored: days on market, total price
 * cut, out-of-state owner (owner mailing-address state vs property state) and owner
 * hold years (from owner_since).
 *
 * Display only: chips on the deal card and detail page. No scoring, no gates.
 */

export interface SellerSignalInputs {
  state?: string | null; // property state
  asking_price?: number | null;
  listed_date?: string | null;
  original_asking_price?: number | null;
  price_cut_count?: number | null;
  tax_delinquent?: boolean | null;
  tax_delinquent_note?: string | null;
  owner_mailing_address?: string | null;
  owner_since?: string | null;
}

export interface SellerSignals {
  days_on_market: number | null;
  price_cut_count: number | null;
  price_cut_pct: number | null; // (original − asking) / original, > 0 when cut
  tax_delinquent: boolean | null;
  tax_delinquent_note: string | null;
  owner_state: string | null; // parsed from the mailing address
  out_of_state_owner: boolean | null; // null = can't tell
  owner_hold_years: number | null;
}

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));

/** "PA", "pa", "Pennsylvania" → "PA"; anything else → null. */
export function normalizeState(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (CODES.has(t.toUpperCase()) && t.length === 2) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? null;
}

/**
 * State from a US mailing address: the state just before the ZIP ("…, PA 15233"),
 * else a trailing state ("…, Ohio"). Returns null when it can't be read.
 */
export function stateFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const a = addr.trim().replace(/\s+/g, " ").replace(/,?\s*(USA|United States)\.?$/i, "");
  const beforeZip = a.match(/(?:,|\s)\s*([A-Za-z]{2}|[A-Za-z][A-Za-z ]+?)\.?,?\s+\d{5}(?:-\d{4})?$/);
  if (beforeZip) {
    const s = normalizeState(beforeZip[1]);
    if (s) return s;
    // "Harrisburg PA" captured as one chunk: try its last word.
    const last = beforeZip[1].trim().split(" ").pop();
    const s2 = normalizeState(last);
    if (s2) return s2;
  }
  const trailing = a.match(/,\s*([A-Za-z][A-Za-z ]*)$/);
  return trailing ? normalizeState(trailing[1]) : null;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return isNaN(d.getTime()) ? null : d;
}

export function deriveSellerSignals(d: SellerSignalInputs, now: Date = new Date()): SellerSignals {
  const listed = parseDate(d.listed_date);
  const days = listed ? Math.floor((now.getTime() - listed.getTime()) / 86_400_000) : null;
  const orig = d.original_asking_price;
  const ask = d.asking_price;
  const cutPct = orig && orig > 0 && ask && ask > 0 && ask !== orig ? (orig - ask) / orig : null;
  const ownerState = stateFromAddress(d.owner_mailing_address);
  const propState = normalizeState(d.state);
  const since = parseDate(d.owner_since);
  const hold = since ? (now.getTime() - since.getTime()) / (365.25 * 86_400_000) : null;
  return {
    days_on_market: days != null && days >= 0 ? days : null,
    price_cut_count: typeof d.price_cut_count === "number" && d.price_cut_count >= 0 ? d.price_cut_count : null,
    price_cut_pct: cutPct,
    tax_delinquent: typeof d.tax_delinquent === "boolean" ? d.tax_delinquent : null,
    tax_delinquent_note: d.tax_delinquent_note?.trim() || null,
    owner_state: ownerState,
    out_of_state_owner: ownerState && propState ? ownerState !== propState : null,
    owner_hold_years: hold != null && hold >= 0 ? hold : null,
  };
}

export interface SignalChip {
  key: string;
  label: string;
  title?: string;
}

/** Chips to show, in a fixed order. Only signals that are known and notable. */
export function sellerSignalChips(s: SellerSignals): SignalChip[] {
  const chips: SignalChip[] = [];
  if (s.days_on_market != null) chips.push({ key: "dom", label: `${s.days_on_market} DOM`, title: "Days on market since the listed date" });
  if (s.price_cut_count != null && s.price_cut_count > 0) {
    chips.push({
      key: "cuts",
      label: `${s.price_cut_count} price cut${s.price_cut_count === 1 ? "" : "s"}${s.price_cut_pct != null && s.price_cut_pct > 0 ? ` (−${(s.price_cut_pct * 100).toFixed(0)}%)` : ""}`,
      title: "Versus the original asking price",
    });
  } else if (s.price_cut_count === 0) {
    chips.push({ key: "cuts", label: "No price cuts" });
  }
  if (s.tax_delinquent) chips.push({ key: "taxdel", label: "Tax delinquent", title: s.tax_delinquent_note ?? undefined });
  if (s.out_of_state_owner) chips.push({ key: "oos", label: `Out-of-state owner (${s.owner_state})`, title: "Owner mailing address is in a different state" });
  if (s.owner_hold_years != null) chips.push({ key: "hold", label: `Held ${s.owner_hold_years.toFixed(1)} yrs`, title: "Since the owner's acquisition date" });
  return chips;
}
