"use client";

import { useState } from "react";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { Home, RefreshCw, Download, ExternalLink } from "lucide-react";
import type { RentCastComp, RentCastRentEstimate } from "@/lib/rentcast";

interface Props {
  dealId: string;
  dealCity: string;
}

interface ApiResult {
  configured?: boolean;
  cached?: boolean;
  message?: string;
  estimate?: RentCastRentEstimate;
  bedrooms?: number | null;
  address?: string;
  fetched_at?: string;
  error?: string;
}

const money = (n: number | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function RentCastRentCard({ dealId, dealCity }: Props) {
  const [bedrooms, setBedrooms] = useState<string>("2");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load(refresh: boolean) {
    setLoading(true);
    setSaved(false);
    try {
      const q = new URLSearchParams();
      if (bedrooms !== "") q.set("bedrooms", bedrooms);
      if (refresh) q.set("refresh", "1");
      const res = await fetch(`/api/deals/${dealId}/rentcast?${q.toString()}`);
      setResult(await res.json());
    } catch {
      setResult({ error: "Request failed" });
    } finally {
      setLoading(false);
    }
  }

  async function saveComps(comps: RentCastComp[]) {
    setSaving(true);
    try {
      await Promise.all(
        comps
          .filter((c) => (c.price ?? 0) > 0 && !!c.formattedAddress)
          .map((c) =>
            fetch(`/api/rent-comps`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                address: c.formattedAddress,
                city: c.city || dealCity,
                rent: c.price,
                date_observed: c.lastSeenDate || c.listedDate || new Date().toISOString(),
                bedrooms: c.bedrooms,
                bathrooms: c.bathrooms,
                square_footage: c.squareFootage,
                unit_type: c.bedrooms != null ? `${c.bedrooms}BR` : undefined,
                source: "RentCast",
                notes: [c.distance != null ? `${c.distance.toFixed(1)} mi` : null, c.correlation != null ? `corr ${(c.correlation * 100).toFixed(0)}%` : null].filter(Boolean).join(" · ") || undefined,
              }),
            }),
          ),
      );
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const est = result?.estimate;
  const comps = est?.comparables ?? [];

  return (
    <CollapsibleCard
      title="Rent Estimate (RentCast)"
      icon={<Home className="h-4 w-4 text-cyan-400" />}
      headerRight={
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-slate-400">Beds</label>
          <select
            value={bedrooms}
            onChange={(e) => setBedrooms(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white text-xs h-7 rounded px-1"
          >
            {["0", "1", "2", "3", "4", ""].map((b) => (
              <option key={b || "any"} value={b}>{b === "" ? "Any" : b === "0" ? "Studio" : b}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" className="h-7 border-slate-700 text-cyan-400 hover:bg-slate-800" disabled={loading} onClick={() => load(result ? true : false)}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            {result ? "Refresh" : "Fetch"}
          </Button>
        </div>
      }
    >
      {loading && !result && <p className="text-sm text-slate-500 text-center py-4">Fetching from RentCast…</p>}

      {result?.configured === false && (
        <p className="text-sm text-amber-400/90 py-2">
          RentCast isn&apos;t configured. Add <code className="text-amber-300">RENTCAST_API_KEY</code> to the environment to enable rent estimates.
        </p>
      )}
      {result?.error && <p className="text-sm text-red-400 py-2">{result.error}</p>}

      {est && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-800 rounded p-2">
              <span className="text-slate-500 text-xs">Est. Rent /unit</span>
              <p className="text-white font-semibold text-base">{money(est.rent)}<span className="text-slate-500 text-xs font-normal">/mo</span></p>
            </div>
            <div className="bg-slate-800 rounded p-2">
              <span className="text-slate-500 text-xs">Range</span>
              <p className="text-slate-300 font-medium">{money(est.rentRangeLow)}–{money(est.rentRangeHigh)}</p>
            </div>
            <div className="bg-slate-800 rounded p-2">
              <span className="text-slate-500 text-xs">Comps</span>
              <p className="text-slate-300 font-medium">{comps.length}</p>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            For multifamily, RentCast estimates a single unit of the selected bedroom count.
            {result?.fetched_at ? ` Fetched ${fmtDate(result.fetched_at)}${result.cached ? " (cached)" : ""}.` : ""}
          </p>

          {comps.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Rental comparables</span>
                <Button size="sm" variant="outline" className="h-7 border-slate-700 text-green-400 hover:bg-slate-800" disabled={saving || saved} onClick={() => saveComps(comps)}>
                  <Download className="h-3 w-3 mr-1" />{saved ? "Saved" : saving ? "Saving…" : "Save to Rent Comps"}
                </Button>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-auto">
                {comps.map((c, i) => (
                  <div key={c.id || i} className="flex items-start justify-between gap-3 p-2 rounded bg-slate-800/50 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="text-white truncate">{c.formattedAddress || "—"}</p>
                      <p className="text-slate-500 mt-0.5">
                        {c.bedrooms != null ? `${c.bedrooms}BR` : ""}{c.bathrooms != null ? `/${c.bathrooms}BA` : ""}
                        {c.squareFootage ? ` · ${c.squareFootage.toLocaleString()} SF` : ""}
                        {c.distance != null ? ` · ${c.distance.toFixed(1)} mi` : ""}
                        {c.correlation != null ? ` · ${(c.correlation * 100).toFixed(0)}% match` : ""}
                      </p>
                    </div>
                    <p className="text-cyan-400 font-semibold shrink-0">{money(c.price)}<span className="text-slate-500 font-normal">/mo</span></p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!result && !loading && (
        <p className="text-xs text-slate-500 py-2 flex items-center gap-1">
          <ExternalLink className="h-3 w-3" /> Pulls a long-term rent estimate and rental comps for this address from RentCast.
        </p>
      )}
    </CollapsibleCard>
  );
}
