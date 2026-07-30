"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Deal, Scenario } from "@/lib/validations";
import type { UnderwritingResult } from "@/lib/underwriting";
import { computePricingViews, type PricingViewInputs } from "@/lib/pricing-views";
import { solvePriceForIRR } from "@/lib/price-solve";
import { scenarioToInputs } from "@/lib/scenario-inputs";

const usd = (n: number | null) =>
  n === null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

// Years between an ISO date and now (client-side; Pricing Views is display-only).
function yearsSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return undefined;
  const yrs = (Date.now() - then) / (365.25 * 24 * 3600 * 1000);
  return yrs > 0 ? yrs : undefined;
}

type FieldKind = "pct" | "usd" | "num";

function Field({
  label,
  kind,
  value,
  onCommit,
}: {
  label: string;
  kind: FieldKind;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
}) {
  const display = value === undefined ? "" : kind === "pct" ? String(+(value * 100).toFixed(4)) : String(value);
  const [draft, setDraft] = useState(display);
  const [editing, setEditing] = useState(false);

  const commit = (raw: string) => {
    setEditing(false);
    const t = raw.trim();
    if (t === "") return onCommit(undefined);
    const n = parseFloat(t.replace(/[$,%\s]/g, ""));
    if (!isFinite(n)) return onCommit(undefined);
    onCommit(kind === "pct" ? n / 100 : n);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <div className="relative">
        {kind === "usd" && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>}
        <Input
          value={editing ? draft : display}
          onChange={(e) => { setDraft(e.target.value); setEditing(true); }}
          onFocus={() => { setDraft(display); setEditing(true); }}
          onBlur={(e) => commit(e.target.value)}
          inputMode="decimal"
          className={`h-8 bg-slate-800 border-slate-700 text-white text-sm ${kind === "usd" ? "pl-5" : ""} ${kind === "pct" ? "pr-6" : ""}`}
        />
        {kind === "pct" && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>}
      </div>
    </label>
  );
}

export function PricingViewsCard({
  deal,
  result,
  scenario,
  onUpdate,
}: {
  deal: Deal;
  result: UnderwritingResult;
  scenario: Scenario;
  onUpdate: (updates: Partial<Scenario>) => void;
}) {
  const saved = (scenario.pricing_views ?? {}) as PricingViewInputs;
  const [inputs, setInputs] = useState<PricingViewInputs>(saved);

  const setField = (key: keyof PricingViewInputs) => (v: number | undefined) => {
    const next = { ...inputs, [key]: v };
    setInputs(next);
    onUpdate({ pricing_views: next as Record<string, unknown> });
  };

  const views = useMemo(() => {
    const purchase = (scenario.purchase_assumptions ?? {}) as Record<string, number | undefined>;
    const dealRec = deal as unknown as Record<string, number | string | undefined>;
    const a0 = result.annual[0];
    const aN = result.annual[result.annual.length - 1];
    return computePricingViews(
      {
        ownerAcquisitionPrice: dealRec.owner_acquisition_price as number | undefined,
        yearsSincePurchase: yearsSince(dealRec.owner_since as string | undefined),
        units: deal.units,
        squareFootage: (dealRec.square_footage as number | undefined) ?? (dealRec.sqft as number | undefined),
        assessedValue: dealRec.assessed_value as number | undefined,
        year1NOI: a0?.noi,
        stabilizedNOI: aN?.noi,
        grossRentAnnual: a0?.gpr,
        askingPrice: deal.asking_price,
        offerPrice: purchase.bid_price || purchase.loi_amount || purchase.purchase_price,
      },
      inputs,
    );
  }, [deal, result, scenario, inputs]);

  // Reverse-solve: highest price at which the deal still hits the target IRR.
  const solved = useMemo(() => {
    const t = inputs.target_irr;
    if (!(typeof t === "number" && isFinite(t) && t > 0)) return { target: null as number | null, price: null as number | null };
    return { target: t, price: solvePriceForIRR(scenarioToInputs(scenario), t) };
  }, [scenario, inputs.target_irr]);

  const marker = (v: number | null) => {
    if (v === null || !views.range) return null;
    const { low, high } = views.range;
    const span = high - low || 1;
    return Math.max(0, Math.min(100, ((v - low) / span) * 100));
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-white text-base font-semibold">Pricing Views</h3>
            <p className="text-[11px] text-slate-500">Triangulate the price several ways — for the seller conversation.</p>
          </div>
          {views.range && (
            <div className="text-right text-xs">
              <div className="text-slate-400">
                Range <span className="text-white font-semibold tabular-nums">{usd(views.range.low)}</span>
                {" – "}
                <span className="text-white font-semibold tabular-nums">{usd(views.range.high)}</span>
              </div>
              <div className="text-slate-500">midpoint <span className="text-slate-300 tabular-nums">{usd(views.range.mid)}</span></div>
            </div>
          )}
        </div>

        {/* Market inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="My target cap" kind="pct" value={inputs.target_cap} onCommit={setField("target_cap")} />
          <Field label="Seller pro-forma NOI" kind="usd" value={inputs.seller_proforma_noi} onCommit={setField("seller_proforma_noi")} />
          <Field label="Seller cap" kind="pct" value={inputs.seller_cap} onCommit={setField("seller_cap")} />
          <Field label="Market CAGR" kind="pct" value={inputs.market_cagr} onCommit={setField("market_cagr")} />
          <Field label="Comp $/unit" kind="usd" value={inputs.price_per_unit} onCommit={setField("price_per_unit")} />
          <Field label="Market GRM" kind="num" value={inputs.grm} onCommit={setField("grm")} />
          <Field label="Comp $/SF" kind="usd" value={inputs.price_per_sf} onCommit={setField("price_per_sf")} />
          <Field label="Assessment ratio" kind="pct" value={inputs.assessment_ratio} onCommit={setField("assessment_ratio")} />
          <Field label="Target IRR (max-price solve)" kind="pct" value={inputs.target_irr} onCommit={setField("target_irr")} />
        </div>

        {/* Reverse-solve: buyer's max price for the target IRR */}
        <div className="rounded-md bg-blue-950/30 ring-1 ring-blue-500/30 px-3 py-2 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-300">
            Buyer&apos;s max{solved.target !== null ? ` at ${(solved.target * 100).toFixed(1)}% IRR` : ""}
            <span className="text-slate-500"> — highest price the deal still clears your target</span>
          </span>
          <span className="text-sm font-bold tabular-nums text-blue-300">
            {solved.target === null
              ? <span className="text-slate-500 font-normal">set a target IRR</span>
              : solved.price === null
                ? <span className="text-amber-400 font-normal">out of range</span>
                : usd(solved.price)}
          </span>
        </div>

        {/* Methods table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-800">
                <th className="text-left py-2 pr-4 font-medium">Method</th>
                <th className="text-left py-2 pr-4 font-medium">Basis</th>
                <th className="text-right py-2 px-2 font-medium">Implied Price</th>
                <th className="text-right py-2 pl-2 font-medium">$/Unit</th>
              </tr>
            </thead>
            <tbody>
              {views.rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-800/50">
                  <td className="py-1.5 pr-4 text-slate-200">{row.label}</td>
                  <td className="py-1.5 pr-4 text-slate-500 text-xs">
                    {row.impliedValue !== null ? row.basis : <span className="italic">{row.missing}</span>}
                  </td>
                  <td className={`text-right py-1.5 px-2 tabular-nums font-semibold ${row.impliedValue !== null ? "text-white" : "text-slate-600"}`}>
                    {usd(row.impliedValue)}
                  </td>
                  <td className="text-right py-1.5 pl-2 tabular-nums text-slate-400">{usd(row.perUnit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Range bar with asking / offer markers */}
        {views.range && (
          <div className="pt-1">
            <div className="relative h-2 rounded bg-gradient-to-r from-emerald-700/40 via-slate-600/40 to-amber-700/40">
              {[
                { v: views.offer, color: "bg-blue-400", label: "Offer" },
                { v: views.asking, color: "bg-amber-400", label: "Asking" },
              ].map((m, i) => {
                const pos = marker(m.v);
                return pos === null ? null : (
                  <div key={i} className="absolute -top-1 flex flex-col items-center" style={{ left: `${pos}%`, transform: "translateX(-50%)" }}>
                    <div className={`w-1 h-4 ${m.color} rounded`} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
              <span>{usd(views.range.low)}</span>
              {views.offer !== null && <span className="text-blue-400">Offer {usd(views.offer)}</span>}
              {views.asking !== null && <span className="text-amber-400">Asking {usd(views.asking)}</span>}
              <span>{usd(views.range.high)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
