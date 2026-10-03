"use client";

import { useState, useEffect } from "react";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Building2, Home, ExternalLink, Pin, PinOff } from "lucide-react";
import { AddMarketCompDialog } from "@/components/comps/add-market-comp-dialog";
import { AddRentCompDialog } from "@/components/comps/add-rent-comp-dialog";
import type { MarketComp, RentComp } from "@/lib/validations";
import type { CompMatchReason } from "@/lib/api-helpers";

type WidenedComp = MarketComp & { match_reason?: CompMatchReason };

const MATCH_LABEL: Record<CompMatchReason, string> = {
  city: "Same city",
  zip3: "Same ZIP area",
  state: "Same state",
};
const MATCH_STYLE: Record<CompMatchReason, string> = {
  city: "border-blue-600 text-blue-300",
  zip3: "border-teal-600 text-teal-300",
  state: "border-slate-600 text-slate-400",
};

function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

interface DealCompsCardProps {
  dealId: string;
  dealCity: string;
  dealState: string;
  askingPrice: number;
  units: number;
  dealAddress?: string;
  dealZip?: string;
}

export function DealCompsCard({ dealId, dealCity, dealState, askingPrice, units, dealAddress, dealZip }: DealCompsCardProps) {
  const [tab, setTab] = useState<"market" | "rent" | "crexi">("market");
  const [marketComps, setMarketComps] = useState<WidenedComp[]>([]);
  const [pinnedComps, setPinnedComps] = useState<MarketComp[]>([]);
  const [rentComps, setRentComps] = useState<RentComp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // P3-11: widen beyond the exact city (city, then same ZIP area, then state).
        const q = new URLSearchParams({ city: dealCity, widen: "1" });
        if (dealState) q.set("state", dealState);
        if (dealZip) q.set("zip", dealZip);
        const [mRes, pRes, rRes] = await Promise.all([
          fetch(`/api/comps?${q.toString()}`),
          fetch(`/api/deals/${dealId}/comps`),
          fetch(`/api/rent-comps`),
        ]);
        if (mRes.ok) setMarketComps(await mRes.json());
        if (pRes.ok) setPinnedComps(await pRes.json());
        if (rRes.ok) {
          const all: RentComp[] = await rRes.json();
          setRentComps(all.filter((c) => c.city.toLowerCase() === dealCity.toLowerCase()));
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dealId, dealCity, dealState, dealZip]);

  const pinnedIds = new Set(pinnedComps.map((c) => c.id));

  async function pinComp(comp: MarketComp) {
    setPinnedComps((prev) => (prev.some((c) => c.id === comp.id) ? prev : [...prev, comp]));
    try {
      const res = await fetch(`/api/deals/${dealId}/comps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comp_id: comp.id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPinnedComps((prev) => prev.filter((c) => c.id !== comp.id)); // revert on failure
    }
  }

  async function unpinComp(compId: string) {
    const prevList = pinnedComps;
    setPinnedComps((prev) => prev.filter((c) => c.id !== compId));
    try {
      const res = await fetch(`/api/deals/${dealId}/comps?comp_id=${encodeURIComponent(compId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setPinnedComps(prevList); // revert on failure
    }
  }

  // Display list: pinned comps first (always shown, even if they wouldn't match the
  // widening), then the widened comps that aren't already pinned.
  const displayComps: WidenedComp[] = [
    ...pinnedComps,
    ...marketComps.filter((c) => !pinnedIds.has(c.id)),
  ];

  // How many comps came from each widening tier (for the legend).
  const tierCounts = marketComps.reduce(
    (acc, c) => { if (c.match_reason) acc[c.match_reason] = (acc[c.match_reason] ?? 0) + 1; return acc; },
    {} as Record<CompMatchReason, number>,
  );

  // Averages span the displayed set (pinned + widened), i.e. the comps actually in view.
  const pricePerUnit = units > 0 ? askingPrice / units : 0;
  const avgCompPPU = displayComps.length > 0
    ? displayComps.reduce((s, c) => s + c.price_per_unit, 0) / displayComps.length
    : 0;
  const avgCapRate = displayComps.filter((c) => c.cap_rate).length > 0
    ? displayComps.reduce((s, c) => s + (c.cap_rate || 0), 0) / displayComps.filter((c) => c.cap_rate).length
    : 0;
  const avgRent = rentComps.length > 0
    ? rentComps.reduce((s, c) => s + c.rent, 0) / rentComps.length
    : 0;

  return (
    <CollapsibleCard
      title="Comps"
      icon={<BarChart3 className="h-4 w-4 text-yellow-400" />}
      headerRight={
        <div className="flex items-center gap-2">
          <AddMarketCompDialog />
          <AddRentCompDialog />
        </div>
      }
    >
      {/* Tab toggle */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab("market")}
          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
            tab === "market" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-300"
          }`}
        >
          Market Sales ({displayComps.length})
        </button>
        <button
          onClick={() => setTab("rent")}
          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
            tab === "rent" ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-300"
          }`}
        >
          Rent Comps ({rentComps.length})
        </button>
        <button
          onClick={() => setTab("crexi")}
          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
            tab === "crexi" ? "bg-purple-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-300"
          }`}
        >
          Crexi Search
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500 text-center py-4">Loading comps...</p>}

      {/* Summary bar */}
      {!loading && tab === "market" && displayComps.length > 0 && (
        <div className="grid grid-cols-3 gap-3 text-xs mb-4">
          <div className="bg-slate-800 rounded p-2">
            <span className="text-slate-500">This Deal $/Unit</span>
            <p className="text-white font-medium">{fmtPrice(pricePerUnit)}</p>
          </div>
          <div className="bg-slate-800 rounded p-2">
            <span className="text-slate-500">Avg Comp $/Unit</span>
            <p className={`font-medium ${avgCompPPU > pricePerUnit ? "text-green-400" : "text-red-400"}`}>
              {fmtPrice(avgCompPPU)}
            </p>
          </div>
          {avgCapRate > 0 && (
            <div className="bg-slate-800 rounded p-2">
              <span className="text-slate-500">Avg Cap Rate</span>
              <p className="text-white font-medium">{(avgCapRate * 100).toFixed(1)}%</p>
            </div>
          )}
        </div>
      )}

      {!loading && tab === "rent" && rentComps.length > 0 && (
        <div className="grid grid-cols-2 gap-3 text-xs mb-4">
          <div className="bg-slate-800 rounded p-2">
            <span className="text-slate-500">Avg Rent</span>
            <p className="text-white font-medium">${Math.round(avgRent).toLocaleString()}/mo</p>
          </div>
          <div className="bg-slate-800 rounded p-2">
            <span className="text-slate-500">Comps in {dealCity}</span>
            <p className="text-white font-medium">{rentComps.length}</p>
          </div>
        </div>
      )}

      {/* Market comps list */}
      {!loading && tab === "market" && (
        <>
          {displayComps.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No market comps in {dealCity}{dealState ? `, ${dealState}` : ""} or nearby yet.
            </p>
          ) : (
            <>
              {/* Widening legend — how far out the comp set reaches. */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 mb-2">
                <span>Comps near {dealCity}:</span>
                {pinnedComps.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded border border-amber-600 text-amber-300">
                    Pinned {pinnedComps.length}
                  </span>
                )}
                {(["city", "zip3", "state"] as CompMatchReason[])
                  .filter((r) => tierCounts[r])
                  .map((r) => (
                    <span key={r} className={`px-1.5 py-0.5 rounded border ${MATCH_STYLE[r]}`}>
                      {MATCH_LABEL[r]} {tierCounts[r]}
                    </span>
                  ))}
              </div>
              <div className="space-y-2">
              {displayComps.map((comp) => {
                const isPinned = pinnedIds.has(comp.id);
                return (
                <div key={comp.id} className="flex items-start justify-between gap-3 p-2 rounded bg-slate-800/50 hover:bg-slate-800 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Building2 className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      <span className="text-white font-medium truncate">{comp.address}</span>
                      {isPinned ? (
                        <Badge variant="outline" className="text-[10px] shrink-0 border-amber-600 text-amber-300">
                          Pinned
                        </Badge>
                      ) : comp.match_reason && comp.match_reason !== "city" ? (
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${MATCH_STYLE[comp.match_reason]}`}>
                          {MATCH_LABEL[comp.match_reason]}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span>{comp.city}, {comp.state}</span>
                      <span>{comp.units} units</span>
                      {comp.year_built && <span>Built {comp.year_built}</span>}
                      <span>{fmtDate(comp.sale_date)}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-blue-400">{fmtPrice(comp.sale_price)}</p>
                      <p className="text-xs text-slate-400">{fmtPrice(comp.price_per_unit)}/unit</p>
                      {comp.cap_rate && (
                        <span className="text-xs text-slate-500">{(comp.cap_rate * 100).toFixed(1)}% cap</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => (isPinned ? unpinComp(comp.id) : pinComp(comp))}
                      title={isPinned ? "Unpin from this deal" : "Pin to this deal"}
                      className={`mt-0.5 ${isPinned ? "text-amber-400 hover:text-amber-300" : "text-slate-600 hover:text-slate-300"}`}
                    >
                      {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                );
              })}
              </div>
            </>
          )}
        </>
      )}

      {/* Rent comps list */}
      {!loading && tab === "rent" && (
        <>
          {rentComps.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No rent comps in {dealCity} yet.
            </p>
          ) : (
            <div className="space-y-2">
              {rentComps.map((comp) => (
                <div key={comp.id} className="flex items-start justify-between gap-3 p-2 rounded bg-slate-800/50 hover:bg-slate-800 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Home className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      <span className="text-white font-medium truncate">
                        {comp.property_name || comp.address}
                      </span>
                      {comp.unit_type && (
                        <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-500 shrink-0">
                          {comp.unit_type}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      {comp.bedrooms != null && <span>{comp.bedrooms}BR/{comp.bathrooms || "?"}BA</span>}
                      {comp.square_footage && <span>{comp.square_footage} SF</span>}
                      <span>{fmtDate(comp.date_observed)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-green-400">${comp.rent.toLocaleString()}</p>
                    <p className="text-xs text-slate-500">/mo</p>
                    {comp.rent_per_sqft && (
                      <p className="text-xs text-slate-400">${comp.rent_per_sqft.toFixed(2)}/SF</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Crexi Search */}
      {tab === "crexi" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Search Crexi for comparable multifamily properties near this deal.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <a
              href={`https://www.crexi.com/properties?propertyTypes=multifamily&locations=${encodeURIComponent(`${dealCity}, ${dealState}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 rounded bg-slate-800 hover:bg-slate-700 transition-colors text-sm text-purple-400 hover:text-purple-300"
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              Multifamily in {dealCity}
            </a>
            <a
              href={`https://www.crexi.com/properties?propertyTypes=multifamily&locations=${encodeURIComponent(`${dealCity}, ${dealState}`)}&listingTypes=recentlySold`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 rounded bg-slate-800 hover:bg-slate-700 transition-colors text-sm text-purple-400 hover:text-purple-300"
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              Recently Sold in {dealCity}
            </a>
            <a
              href={`https://www.crexi.com/properties?propertyTypes=multifamily&locations=${encodeURIComponent(`${dealCity}, ${dealState}`)}&maxUnits=${Math.ceil(units * 1.5)}&minUnits=${Math.max(1, Math.floor(units * 0.5))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-3 rounded bg-slate-800 hover:bg-slate-700 transition-colors text-sm text-purple-400 hover:text-purple-300"
            >
              <ExternalLink className="h-4 w-4 shrink-0" />
              Similar Size ({Math.max(1, Math.floor(units * 0.5))}–{Math.ceil(units * 1.5)} units)
            </a>
            {dealAddress && (
              <a
                href={`https://www.crexi.com/properties?propertyTypes=multifamily&locations=${encodeURIComponent(dealAddress + ', ' + dealCity + ', ' + dealState)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 rounded bg-slate-800 hover:bg-slate-700 transition-colors text-sm text-purple-400 hover:text-purple-300"
              >
                <ExternalLink className="h-4 w-4 shrink-0" />
                Near This Property
              </a>
            )}
          </div>
          <p className="text-xs text-slate-600">
            Found a comp on Crexi? Add it using the Market Sales or Rent Comps tabs above.
          </p>
        </div>
      )}
    </CollapsibleCard>
  );
}
