/**
 * Pricing Views — valuation triangulation. Compute an implied price several
 * independent ways so an offer can be justified to a seller from multiple angles.
 * Pure and deterministic: the caller supplies context (deal facts + model NOI)
 * and the market inputs; this returns one row per method plus a low/mid/high
 * range. A method with missing inputs returns impliedValue = null (the UI prompts
 * for what's needed) and is excluded from the range.
 */

export interface PricingViewInputs {
  market_cagr?: number; // annual appreciation for the CAGR method (e.g. 0.03)
  target_cap?: number; // buyer's cap rate for the income method
  seller_proforma_noi?: number; // seller's / OM stated NOI
  seller_cap?: number; // cap applied to the seller's pro-forma NOI
  price_per_unit?: number; // comp $/unit
  grm?: number; // gross rent multiplier
  price_per_sf?: number; // comp $/SF
  assessment_ratio?: number; // assessed value ÷ market value (e.g. 0.35)
}

export interface PricingViewContext {
  // Deal facts
  ownerAcquisitionPrice?: number;
  yearsSincePurchase?: number; // computed by the caller from owner_since
  units?: number;
  squareFootage?: number;
  assessedValue?: number;
  // Model outputs
  year1NOI?: number;
  stabilizedNOI?: number;
  grossRentAnnual?: number;
  // Reference prices
  askingPrice?: number;
  offerPrice?: number; // the scenario's current purchase/bid price
}

export interface PricingMethodRow {
  key: string;
  label: string;
  basis: string; // human-readable formula, e.g. "My Yr-1 NOI $76,000 ÷ 6.50%"
  impliedValue: number | null;
  perUnit: number | null;
  missing?: string; // what to enter when impliedValue is null
}

export interface PricingViewsResult {
  rows: PricingMethodRow[];
  range: { low: number; mid: number; high: number } | null;
  asking: number | null;
  offer: number | null;
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function positive(n: number | undefined | null): n is number {
  return typeof n === "number" && isFinite(n) && n > 0;
}

export function computePricingViews(
  ctx: PricingViewContext,
  inputs: PricingViewInputs,
): PricingViewsResult {
  const units = positive(ctx.units) ? ctx.units : null;
  const perUnit = (v: number | null): number | null => (v !== null && units ? v / units : null);

  const row = (
    key: string,
    label: string,
    value: number | null,
    basis: string,
    missing?: string,
  ): PricingMethodRow => ({ key, label, basis, impliedValue: value, perUnit: perUnit(value), missing });

  const rows: PricingMethodRow[] = [];

  // ── Income / cap rate — multiple NOI bases ──
  const targetCap = inputs.target_cap;
  rows.push(
    positive(ctx.year1NOI) && positive(targetCap)
      ? row("cap_my_y1", "Cap rate — my Yr-1 NOI", ctx.year1NOI! / targetCap!, `${usd(ctx.year1NOI!)} ÷ ${pct(targetCap!)}`)
      : row("cap_my_y1", "Cap rate — my Yr-1 NOI", null, "my Yr-1 NOI ÷ target cap", "enter a target cap rate"),
  );
  rows.push(
    positive(ctx.stabilizedNOI) && positive(targetCap)
      ? row("cap_my_stab", "Cap rate — my stabilized NOI", ctx.stabilizedNOI! / targetCap!, `${usd(ctx.stabilizedNOI!)} ÷ ${pct(targetCap!)}`)
      : row("cap_my_stab", "Cap rate — my stabilized NOI", null, "my stabilized NOI ÷ target cap", "enter a target cap rate"),
  );
  const sellerCap = positive(inputs.seller_cap) ? inputs.seller_cap : targetCap;
  rows.push(
    positive(inputs.seller_proforma_noi) && positive(sellerCap)
      ? row("cap_seller", "Cap rate — seller's pro-forma NOI", inputs.seller_proforma_noi! / sellerCap!, `${usd(inputs.seller_proforma_noi!)} ÷ ${pct(sellerCap!)}`)
      : row("cap_seller", "Cap rate — seller's pro-forma NOI", null, "seller NOI ÷ cap", "enter the seller's pro-forma NOI"),
  );

  // ── CAGR on the owner's basis ──
  rows.push(
    positive(ctx.ownerAcquisitionPrice) && positive(ctx.yearsSincePurchase) && positive(inputs.market_cagr)
      ? row(
          "cagr",
          "Appreciation on owner's basis",
          ctx.ownerAcquisitionPrice! * Math.pow(1 + inputs.market_cagr!, ctx.yearsSincePurchase!),
          `${usd(ctx.ownerAcquisitionPrice!)} × (1+${pct(inputs.market_cagr!)})^${ctx.yearsSincePurchase!.toFixed(1)}yr`,
        )
      : row(
          "cagr",
          "Appreciation on owner's basis",
          null,
          "owner basis × (1+CAGR)^years",
          positive(ctx.ownerAcquisitionPrice) ? "enter a market CAGR" : "need the owner's purchase price & date",
        ),
  );

  // ── Price per unit ──
  rows.push(
    positive(inputs.price_per_unit) && units
      ? row("ppu", "Price per unit", inputs.price_per_unit! * units, `${usd(inputs.price_per_unit!)} × ${units} units`)
      : row("ppu", "Price per unit", null, "$/unit × units", "enter a comp $/unit"),
  );

  // ── Gross rent multiplier ──
  rows.push(
    positive(inputs.grm) && positive(ctx.grossRentAnnual)
      ? row("grm", "Gross rent multiplier", inputs.grm! * ctx.grossRentAnnual!, `${inputs.grm!.toFixed(2)}× × ${usd(ctx.grossRentAnnual!)} gross rent`)
      : row("grm", "Gross rent multiplier", null, "GRM × gross rent", "enter a market GRM"),
  );

  // ── Price per SF (only when SF known) ──
  if (positive(ctx.squareFootage)) {
    rows.push(
      positive(inputs.price_per_sf)
        ? row("ppsf", "Price per SF", inputs.price_per_sf! * ctx.squareFootage!, `${usd(inputs.price_per_sf!)} × ${ctx.squareFootage!.toLocaleString()} SF`)
        : row("ppsf", "Price per SF", null, "$/SF × SF", "enter a comp $/SF"),
    );
  }

  // ── Assessed-value anchor ──
  rows.push(
    positive(ctx.assessedValue) && positive(inputs.assessment_ratio)
      ? row("assessed", "Assessed-value anchor", ctx.assessedValue! / inputs.assessment_ratio!, `${usd(ctx.assessedValue!)} ÷ ${pct(inputs.assessment_ratio!)} ratio`)
      : row(
          "assessed",
          "Assessed-value anchor",
          null,
          "assessed ÷ ratio",
          positive(ctx.assessedValue) ? "enter an assessment ratio" : "need the county assessed value",
        ),
  );

  // ── Range across the methods that produced a value ──
  const values = rows.map((r) => r.impliedValue).filter((v): v is number => v !== null).sort((a, b) => a - b);
  let range: PricingViewsResult["range"] = null;
  if (values.length > 0) {
    const mid =
      values.length % 2 === 1
        ? values[(values.length - 1) / 2]
        : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
    range = { low: values[0], mid, high: values[values.length - 1] };
  }

  return {
    rows,
    range,
    asking: positive(ctx.askingPrice) ? ctx.askingPrice! : null,
    offer: positive(ctx.offerPrice) ? ctx.offerPrice! : null,
  };
}
