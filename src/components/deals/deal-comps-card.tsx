"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Building2, Home, MapPin, Calendar, Plus } from "lucide-react";
import { AddMarketCompDialog } from "@/components/comps/add-market-comp-dialog";
import { AddRentCompDialog } from "@/components/comps/add-rent-comp-dialog";
import type { MarketComp, RentComp } from "@/lib/validations";

function fmtPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

interface DealCompsCardProps {
  dealCity: string;
  dealState: string;
  askingPrice: number;
  units: number;
}

export function DealCompsCard({ dealCity, dealState, askingPrice, units }: DealCompsCardProps) {
  const [tab, setTab] = useState<"market" | "rent">("market");
  const [marketComps, setMarketComps] = useState<MarketComp[]>([]);
  const [rentComps, setRentComps] = useState<RentComp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [mRes, rRes] = await Promise.all([
          fetch(`/api/comps?city=${encodeURIComponent(dealCity)}`),
          fetch(`/api/rent-comps`),
        ]);
        if (mRes.ok) setMarketComps(await mRes.json());
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
  }, [dealCity]);

  const pricePerUnit = units > 0 ? askingPrice / units : 0;
  const avgCompPPU = marketComps.length > 0
    ? marketComps.reduce((s, c) => s + c.price_per_unit, 0) / marketComps.length
    : 0;
  const avgCapRate = marketComps.filter((c) => c.cap_rate).length > 0
    ? marketComps.reduce((s, c) => s + (c.cap_rate || 0), 0) / marketComps.filter((c) => c.cap_rate).length
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
          Market Sales ({marketComps.length})
        </button>
        <button
          onClick={() => setTab("rent")}
          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
            tab === "rent" ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-300"
          }`}
        >
          Rent Comps ({rentComps.length})
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500 text-center py-4">Loading comps...</p>}

      {/* Summary bar */}
      {!loading && tab === "market" && marketComps.length > 0 && (
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
          {marketComps.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No market comps in {dealCity} yet.
            </p>
          ) : (
            <div className="space-y-2">
              {marketComps.map((comp) => (
                <div key={comp.id} className="flex items-start justify-between gap-3 p-2 rounded bg-slate-800/50 hover:bg-slate-800 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <Building2 className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      <span className="text-white font-medium truncate">{comp.address}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span>{comp.units} units</span>
                      {comp.year_built && <span>Built {comp.year_built}</span>}
                      <span>{fmtDate(comp.sale_date)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-blue-400">{fmtPrice(comp.sale_price)}</p>
                    <p className="text-xs text-slate-400">{fmtPrice(comp.price_per_unit)}/unit</p>
                    {comp.cap_rate && (
                      <span className="text-xs text-slate-500">{(comp.cap_rate * 100).toFixed(1)}% cap</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
    </CollapsibleCard>
  );
}
