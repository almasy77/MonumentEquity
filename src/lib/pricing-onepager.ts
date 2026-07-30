import type { Deal, Scenario } from "./validations";
import { calculateUnderwriting } from "./underwriting";
import { scenarioToInputs } from "./scenario-inputs";
import { computePricingViews, type PricingViewInputs } from "./pricing-views";

// Seller-facing pricing one-pager (pure HTML builder). Renders the offer + the
// valuation triangulation; deliberately excludes internal metrics (IRR,
// after-tax, DSCR, the buyer's-max reverse-solve). Kept free of server-only
// imports so it's unit-testable.

const usd = (n: number | null | undefined) =>
  n === null || n === undefined || !isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function yearsSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return undefined;
  const y = (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
  return y > 0 ? y : undefined;
}

export function buildPricingOnePager(deal: Deal, scenario: Scenario): string {
  const d = deal as unknown as Record<string, number | string | undefined>;
  const result = calculateUnderwriting(scenarioToInputs(scenario));
  const a0 = result.annual[0];
  const aN = result.annual[result.annual.length - 1];
  const purchase = (scenario.purchase_assumptions ?? {}) as Record<string, number | undefined>;
  const offer = purchase.bid_price || purchase.loi_amount || purchase.purchase_price;

  const views = computePricingViews(
    {
      ownerAcquisitionPrice: d.owner_acquisition_price as number | undefined,
      yearsSincePurchase: yearsSince(d.owner_since as string | undefined),
      units: deal.units,
      squareFootage: (d.square_footage as number | undefined) ?? (d.sqft as number | undefined),
      assessedValue: d.assessed_value as number | undefined,
      year1NOI: a0?.noi,
      stabilizedNOI: aN?.noi,
      grossRentAnnual: a0?.gpr,
      askingPrice: deal.asking_price,
      offerPrice: offer,
    },
    (scenario.pricing_views ?? {}) as PricingViewInputs,
    // The stabilized-NOI cap method leans on a fully built-out stabilized pro
    // forma; hide it from the seller-facing doc rather than defend a soft number.
    { exclude: ["cap_my_stab"] },
  );

  const rows = views.rows
    .filter((r) => r.impliedValue !== null)
    .map(
      (r) => `<tr>
        <td class="method">${esc(r.label)}</td>
        <td class="basis">${esc(r.basis)}</td>
        <td class="num">${usd(r.impliedValue)}</td>
        <td class="num muted">${usd(r.perUnit)}</td>
      </tr>`,
    )
    .join("");

  const range = views.range;
  // Extend the scale to include the offer + asking so nothing clamps to the edge;
  // the "supported range" (methods low..high) is drawn as a band inside it.
  let scaleMin = 0, scaleMax = 0, bandL = 0, bandW = 0;
  let offerPos: number | null = null, askPos: number | null = null;
  if (range) {
    const pts = [range.low, range.high, views.offer, views.asking].filter((v): v is number => v !== null);
    scaleMin = Math.min(...pts);
    scaleMax = Math.max(...pts);
    const span = scaleMax - scaleMin || 1;
    const pct = (v: number) => ((v - scaleMin) / span) * 100;
    bandL = pct(range.low);
    bandW = Math.max(0, pct(range.high) - bandL);
    offerPos = views.offer !== null ? pct(views.offer) : null;
    askPos = views.asking !== null ? pct(views.asking) : null;
  }
  const offerNote = range && views.offer !== null
    ? (views.offer < range.low ? " · below the supported range" : views.offer > range.high ? " · above the supported range" : " · within the supported range")
    : "";

  const addr = `${deal.address}, ${deal.city}, ${deal.state} ${d.zip ?? ""}`.trim();
  const sub = [deal.units ? `${deal.units} units` : null, d.year_built ? `Built ${d.year_built}` : null, d.square_footage ? `${Number(d.square_footage).toLocaleString()} SF` : null]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Pricing Summary — ${esc(deal.address)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { --green:#1F3B2E; --cream:#F1ECDE; --ink:#1a1a1a; --muted:#6b7280; --line:#e5e1d6; }
  * { box-sizing:border-box; }
  body { font-family:'DM Sans',system-ui,sans-serif; color:var(--ink); margin:0; background:#fff; }
  .page { max-width:820px; margin:0 auto; padding:48px 56px; }
  header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid var(--green); padding-bottom:16px; }
  .brand { font-family:'DM Serif Display',serif; color:var(--green); font-size:24px; }
  .brand small { display:block; font-family:'DM Sans'; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-top:2px; }
  h1 { font-family:'DM Serif Display',serif; color:var(--green); font-size:26px; margin:24px 0 2px; }
  .sub { color:var(--muted); font-size:13px; }
  .offer { background:var(--cream); border-radius:10px; padding:18px 22px; margin:22px 0; display:flex; justify-content:space-between; align-items:center; }
  .offer .label { font-size:12px; text-transform:uppercase; letter-spacing:.1em; color:var(--green); font-weight:700; }
  .offer .val { font-family:'DM Mono',monospace; font-size:30px; font-weight:500; color:var(--green); }
  h2 { font-family:'DM Serif Display',serif; color:var(--green); font-size:16px; margin:26px 0 8px; }
  p.lead { font-size:13px; color:#374151; line-height:1.6; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); border-bottom:1px solid var(--line); padding:6px 8px; }
  td { padding:8px; border-bottom:1px solid var(--line); font-size:13px; }
  td.method { font-weight:500; }
  td.basis { color:var(--muted); font-size:12px; }
  td.num { font-family:'DM Mono',monospace; text-align:right; }
  td.muted { color:var(--muted); }
  .rangewrap { margin:22px 0 6px; }
  .track { position:relative; height:12px; border-radius:6px; background:#efe9db; }
  .band { position:absolute; top:0; height:12px; border-radius:6px; background:linear-gradient(90deg,#cde3d3,#bcd8c4); }
  .mk { position:absolute; top:-4px; width:3px; height:20px; border-radius:2px; }
  .mk-offer { background:var(--green); }
  .mk-ask { background:#b45309; }
  .ends { display:flex; justify-content:space-between; font-size:10px; color:var(--muted); margin-top:9px; }
  .legend { display:flex; gap:22px; margin-top:12px; font-size:12px; }
  .lg { display:flex; align-items:center; gap:6px; }
  .lg-offer { color:var(--green); font-weight:700; }
  .lg-ask { color:#b45309; font-weight:700; }
  .sw { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .sw-offer { background:var(--green); }
  .sw-ask { background:#b45309; }
  footer { margin-top:34px; border-top:1px solid var(--line); padding-top:12px; font-size:10px; color:var(--muted); display:flex; justify-content:space-between; }
  @media print { .page { padding:24px; } @page { margin:12mm; } }
</style></head>
<body><div class="page">
  <header>
    <div class="brand">Monument Equity<small>Multifamily Acquisitions</small></div>
    <div style="text-align:right;font-size:11px;color:var(--muted)">Pricing Summary<br>Prepared for discussion</div>
  </header>

  <h1>${esc(addr)}</h1>
  <div class="sub">${esc(sub)}${deal.county ? ` · ${esc(String(deal.county))} County` : ""}</div>

  <div class="offer">
    <div><div class="label">Our Proposed Purchase Price</div></div>
    <div class="val">${usd(offer)}</div>
  </div>

  <h2>How we arrived at our offer</h2>
  <p class="lead">We evaluate price several independent ways rather than a single headline number. The methods below reflect current market conditions and the property's in-place performance; our offer is shown against the range they support.</p>

  ${rows
      ? `<table><thead><tr><th>Method</th><th>Basis</th><th style="text-align:right">Implied Price</th><th style="text-align:right">$/Unit</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="lead"><em>Add market inputs (target cap, comp $/unit, GRM, market CAGR, etc.) to populate the pricing methods.</em></p>`}

  ${range
      ? `<div class="rangewrap">
      <div class="track">
        <div class="band" style="left:${bandL}%;width:${bandW}%"></div>
        ${offerPos !== null ? `<div class="mk mk-offer" style="left:${offerPos}%"></div>` : ""}
        ${askPos !== null ? `<div class="mk mk-ask" style="left:${askPos}%"></div>` : ""}
      </div>
      <div class="ends">
        <span>${usd(scaleMin)}</span>
        <span>Supported range ${usd(range.low)} – ${usd(range.high)}</span>
        <span>${usd(scaleMax)}</span>
      </div>
      <div class="legend">
        ${views.offer !== null ? `<span class="lg lg-offer"><span class="sw sw-offer"></span>Our offer ${usd(views.offer)}${offerNote}</span>` : ""}
        ${views.asking !== null ? `<span class="lg lg-ask"><span class="sw sw-ask"></span>Asking ${usd(views.asking)}</span>` : ""}
      </div>
    </div>`
      : ""}

  <footer>
    <span>Monument Equity LLC · Prepared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
    <span>Non-binding · for discussion purposes only</span>
  </footer>
</div></body></html>`;
}
