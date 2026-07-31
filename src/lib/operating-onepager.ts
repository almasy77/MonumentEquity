import type { Deal, Scenario } from "./validations";
import { calculateUnderwriting } from "./underwriting";
import { scenarioToInputs } from "./scenario-inputs";

// Seller-facing "how we underwrite operations" one-pager: our Year-1 pro forma
// line-by-line with a plain-English basis for each cost estimate (reassessed
// taxes, market insurance, management, etc.), plus a seller-T12-vs-our-NOI
// comparison when a T12 is present. Pure (no server imports) → unit-testable.

const usd = (n: number | null | undefined) =>
  n === null || n === undefined || !isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

interface Row {
  label: string;
  amount: number;
  perUnit?: boolean; // show a $/unit cell
  basis?: string; // plain-English note
  bold?: boolean;
  neg?: boolean; // display in parentheses
  band?: boolean; // subtotal shading
}

export function buildOperatingOnePager(deal: Deal, scenario: Scenario): string {
  const inputs = scenarioToInputs(scenario);
  const result = calculateUnderwriting(inputs);
  const a0 = result.annual[0];
  const units = deal.units || 0;
  const ox = a0?.opex_breakdown;
  const exp = (inputs.expenses ?? {}) as unknown as Record<string, number | undefined | Record<string, unknown>>;
  const rev = (inputs.revenue ?? {}) as unknown as Record<string, number | undefined>;
  const perUnitNote = (annual: number) => (units ? `${usd(annual / units)}/unit` : "");

  // ── Property-tax basis (the headline explanation) ──
  const tr = (exp.tax_reassessment ?? undefined) as
    | { enabled?: boolean; effective_tax_rate?: number; assessment_ratio?: number; mill_rate?: number; mill_reduction_rate?: number; reassessed_value?: number }
    | undefined;
  const price = inputs.purchase.purchase_price || 0;
  let taxBasis = "Entered operating bill.";
  if (tr?.enabled) {
    const eff = tr.effective_tax_rate ?? 0;
    if (tr.assessment_ratio && tr.mill_rate) {
      const assessed = price * tr.assessment_ratio;
      const reduction = tr.mill_reduction_rate ?? 0;
      const millText = reduction > 0
        ? `${tr.mill_rate.toFixed(1)} mills less ${pct1(reduction)} reduction (${(tr.mill_rate * (1 - reduction)).toFixed(1)} eff.)`
        : `${tr.mill_rate.toFixed(1)} mills`;
      taxBasis = `Reassessed to the sale price on transfer: assessed ${usd(assessed)} (${pct1(tr.assessment_ratio)} of ${usd(price)}) × ${millText}. The seller's current bill reflects a lower prior assessment.`;
    } else {
      taxBasis = `Reassessed to the sale price on transfer at ${pct1(eff)} effective — counties reassess toward the purchase price, so the seller's current (lower) bill is not the buyer's bill.`;
    }
  }

  // Basis notes derive from the ENGINE's actually-billed figure (ox.*), NOT the
  // legacy input fields (management_fee_rate / *_per_unit). Those legacy fields go
  // stale the moment an expense is entered through the structured opex line, which
  // made the note contradict the billed column (e.g. "8.5% of EGI" next to a figure
  // that is exactly 8% of EGI). Deriving from the bill keeps them consistent.
  const insPerUnit = units && ox && ox.insurance > 0 ? ox.insurance / units : undefined;
  const mgmtRate = ox && a0.egi > 0 && ox.management_fees > 0 ? ox.management_fees / a0.egi : undefined;
  const rmPerUnit = units && ox && ox.repairs_maintenance > 0 ? ox.repairs_maintenance / units : undefined;

  const rows: Row[] = ox
    ? [
        { label: "Gross Potential Rent", amount: a0.gpr, basis: "Unit-mix rents rolled to the pro forma basis." },
        { label: "Less: Vacancy", amount: a0.vacancy_loss, neg: true, basis: rev.vacancy_rate ? `${pct1(rev.vacancy_rate)} of GPR` : "" },
        { label: "Plus: Other Income", amount: a0.other_income, basis: "Fees, RUBS, and ancillary income." },
        { label: "Effective Gross Income", amount: a0.egi, bold: true, band: true },
        { label: "Management", amount: ox.management_fees, perUnit: true, basis: mgmtRate ? `${pct1(mgmtRate)} of EGI (third-party market fee)` : "Market management fee." },
        { label: "Payroll", amount: ox.payroll, perUnit: true },
        { label: "Repairs & Maintenance", amount: ox.repairs_maintenance, perUnit: true, basis: rmPerUnit ? `${usd(rmPerUnit)}/unit/yr` : "" },
        { label: "Turnover", amount: ox.turnover, perUnit: true },
        { label: "Insurance", amount: ox.insurance, perUnit: true, basis: insPerUnit ? `${usd(insPerUnit)}/unit at current market quotes` : "Current market premium." },
        { label: "Property Tax", amount: ox.property_tax, perUnit: true, basis: taxBasis },
        { label: "Utilities", amount: ox.utilities, perUnit: true },
        { label: "Admin / Legal / Marketing", amount: ox.admin_legal_marketing, perUnit: true },
        { label: "Contract Services", amount: ox.contract_services, perUnit: true },
        { label: "Total Operating Expenses", amount: a0.total_opex, bold: true, band: true, basis: a0.egi ? `${pct1(a0.total_opex / a0.egi)} expense ratio` : "" },
        { label: "Net Operating Income", amount: a0.noi, bold: true, band: true },
      ]
    : [];

  const tableRows = rows
    .map((r) => {
      const amt = r.neg ? `(${usd(r.amount)})` : usd(r.amount);
      const pu = r.perUnit ? perUnitNote(r.amount) : "";
      return `<tr class="${r.band ? "band" : ""}">
        <td class="${r.bold ? "b" : ""}">${esc(r.label)}</td>
        <td class="num ${r.bold ? "b" : ""}">${amt}</td>
        <td class="num muted">${pu}</td>
        <td class="basis">${r.basis ? esc(r.basis) : ""}</td>
      </tr>`;
    })
    .join("");

  // ── Seller T12 comparison (when present) ──
  const t12 = (deal as unknown as Record<string, { total_egi?: number; total_opex?: number; total_noi?: number; source?: string } | undefined>).t12;
  let compare = "";
  if (t12 && (t12.total_noi != null || t12.total_opex != null || t12.total_egi != null) && a0) {
    const sEgi = t12.total_egi ?? null;
    const sOpex = t12.total_opex ?? null;
    const sNoi = t12.total_noi ?? (sEgi != null && sOpex != null ? sEgi - sOpex : null);
    const line = (label: string, seller: number | null, ours: number) => `<tr>
        <td>${label}</td>
        <td class="num muted">${usd(seller)}</td>
        <td class="num b">${usd(ours)}</td>
        <td class="num ${seller != null && ours - seller !== 0 ? (label === "Operating Expenses" ? "up" : ours - seller < 0 ? "down" : "up") : "muted"}">${seller != null ? `${ours - seller >= 0 ? "+" : "−"}${usd(Math.abs(ours - seller))}` : "—"}</td>
      </tr>`;
    compare = `
    <h2>Seller's T12 vs our underwriting</h2>
    <table class="cmp"><thead><tr><th></th><th style="text-align:right">Seller T12</th><th style="text-align:right">Our Yr-1</th><th style="text-align:right">Δ</th></tr></thead><tbody>
      ${line("Effective Gross Income", sEgi, a0.egi)}
      ${line("Operating Expenses", sOpex, a0.total_opex)}
      ${line("Net Operating Income", sNoi, a0.noi)}
    </tbody></table>
    <p class="lead" style="margin-top:8px">The NOI gap is driven mainly by expenses that reset at acquisition — chiefly the property-tax reassessment and insurance to current market — not by cutting the property's income.</p>`;
  }

  const addr = `${deal.address}, ${deal.city}, ${deal.state} ${(deal as unknown as Record<string, string | undefined>).zip ?? ""}`.trim();
  const dd = deal as unknown as Record<string, number | string | undefined>;
  const sub = [deal.units ? `${deal.units} units` : null, dd.year_built ? `Built ${dd.year_built}` : null, dd.square_footage ? `${Number(dd.square_footage).toLocaleString()} SF` : null]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Operating Summary — ${esc(deal.address)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { --green:#1F3B2E; --cream:#F1ECDE; --ink:#1a1a1a; --muted:#6b7280; --line:#e5e1d6; }
  * { box-sizing:border-box; }
  body { font-family:'DM Sans',system-ui,sans-serif; color:var(--ink); margin:0; background:#fff; }
  .page { max-width:820px; margin:0 auto; padding:44px 56px; }
  header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid var(--green); padding-bottom:16px; }
  .brand { font-family:'DM Serif Display',serif; color:var(--green); font-size:24px; }
  .brand small { display:block; font-family:'DM Sans'; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-top:2px; }
  h1 { font-family:'DM Serif Display',serif; color:var(--green); font-size:24px; margin:22px 0 2px; }
  .sub { color:var(--muted); font-size:13px; }
  h2 { font-family:'DM Serif Display',serif; color:var(--green); font-size:16px; margin:24px 0 6px; }
  p.lead { font-size:13px; color:#374151; line-height:1.55; }
  table { width:100%; border-collapse:collapse; margin-top:6px; }
  th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); border-bottom:1px solid var(--line); padding:6px 8px; }
  td { padding:6px 8px; border-bottom:1px solid var(--line); font-size:12.5px; vertical-align:top; }
  td.num { font-family:'DM Mono',monospace; text-align:right; white-space:nowrap; }
  td.muted { color:var(--muted); }
  td.b, .b { font-weight:700; color:var(--green); }
  tr.band td { background:var(--cream); }
  td.basis { color:var(--muted); font-size:11.5px; line-height:1.4; }
  td.up { color:#b45309; } td.down { color:var(--green); }
  table.cmp td:first-child { font-weight:500; }
  footer { margin-top:30px; border-top:1px solid var(--line); padding-top:12px; font-size:10px; color:var(--muted); display:flex; justify-content:space-between; }
  @media print { .page { padding:22px; } @page { margin:12mm; } }
</style></head>
<body><div class="page">
  <header>
    <div class="brand">Monument Equity<small>Multifamily Acquisitions</small></div>
    <div style="text-align:right;font-size:11px;color:var(--muted)">Operating Summary<br>Prepared for discussion</div>
  </header>

  <h1>${esc(addr)}</h1>
  <div class="sub">${esc(sub)}${deal.county ? ` · ${esc(String(deal.county))} County` : ""}</div>

  <h2>Year-1 operating estimate — and how we got there</h2>
  <p class="lead">Our Year-1 pro forma below, with the basis for each cost line. Several expenses reset at acquisition (taxes, insurance, third-party management), so our figures differ from the seller's operating history by design — not to understate the property.</p>
  ${tableRows
      ? `<table><thead><tr><th>Line item</th><th style="text-align:right">Annual</th><th style="text-align:right">$/Unit</th><th>Basis</th></tr></thead><tbody>${tableRows}</tbody></table>`
      : `<p class="lead"><em>No pro forma available for this scenario.</em></p>`}
  ${compare}

  <footer>
    <span>Monument Equity LLC · Prepared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
    <span>Estimates · non-binding · for discussion purposes only</span>
  </footer>
</div></body></html>`;
}
