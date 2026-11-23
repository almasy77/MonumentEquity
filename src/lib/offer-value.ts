/**
 * Change D (Manny Lou, Nov 2026): offer vs ask and offer vs value.
 *
 * Value on in-place NOI = documented in-place NOI ÷ the scenario's target cap
 * (Pricing Views `target_cap`). The documented NOI is the same one the loan sizes
 * on (deal current NOI, else Pricing Views seller NOI), so value and debt agree.
 *
 * Manny's rule of thumb (~20% below value on in-place income) is CONTEXT ONLY: it is
 * reported as a reference price, never used as a gate.
 */
import type { DocumentedNoiSource } from "./underwriting";

export const MANNY_DISCOUNT_TO_VALUE = 0.2;

export interface OfferVsValue {
  offer: number | null;
  ask: number | null;
  offer_vs_ask: number | null; // offer / ask − 1 (−0.457 = 45.7% below ask)
  in_place_noi: number | null;
  noi_source: DocumentedNoiSource | null;
  value_cap: number | null; // Pricing Views target cap
  value: number | null; // in_place_noi / value_cap
  offer_vs_value: number | null; // offer / value − 1
  rule_of_thumb_price: number | null; // value × (1 − 20%), context only
  missing: ("offer" | "ask" | "in_place_noi" | "target_cap")[];
}

const pos = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** The offer a scenario represents: bid, else LOI amount, else modeled purchase price. */
export function scenarioOffer(purchase: { bid_price?: number; loi_amount?: number; purchase_price?: number } | undefined): number | null {
  const p = purchase ?? {};
  return [p.bid_price, p.loi_amount, p.purchase_price].find(pos) ?? null;
}

export function computeOfferVsValue(args: {
  offer: number | null | undefined;
  ask: number | null | undefined;
  documented: { noi: number; source: DocumentedNoiSource } | null | undefined;
  targetCap: number | null | undefined;
}): OfferVsValue {
  const offer = pos(args.offer) ? args.offer : null;
  const ask = pos(args.ask) ? args.ask : null;
  const noi = args.documented && pos(args.documented.noi) ? args.documented.noi : null;
  const cap = pos(args.targetCap) && args.targetCap < 1 ? args.targetCap : null;
  const value = noi != null && cap != null ? noi / cap : null;
  const missing: OfferVsValue["missing"] = [];
  if (offer == null) missing.push("offer");
  if (ask == null) missing.push("ask");
  if (noi == null) missing.push("in_place_noi");
  if (cap == null) missing.push("target_cap");
  return {
    offer,
    ask,
    offer_vs_ask: offer != null && ask != null ? offer / ask - 1 : null,
    in_place_noi: noi,
    noi_source: noi != null ? args.documented!.source : null,
    value_cap: cap,
    value,
    offer_vs_value: offer != null && value != null ? offer / value - 1 : null,
    rule_of_thumb_price: value != null ? value * (1 - MANNY_DISCOUNT_TO_VALUE) : null,
    missing,
  };
}

/** "45.7% below" / "12.5% above" / "at". */
export function describeDelta(d: number | null): string {
  if (d == null) return "—";
  if (Math.abs(d) < 0.0005) return "at";
  return `${(Math.abs(d) * 100).toFixed(1)}% ${d < 0 ? "below" : "above"}`;
}
