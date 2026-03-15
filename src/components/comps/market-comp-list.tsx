"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Calendar } from "lucide-react";
import type { MarketComp } from "@/lib/validations";

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function MarketCompList({ comps }: { comps: MarketComp[] }) {
  const [cityFilter, setCityFilter] = useState("");

  const filtered = cityFilter
    ? comps.filter((c) =>
        c.city.toLowerCase().includes(cityFilter.toLowerCase())
      )
    : comps;

  // Compute averages
  const avgPricePerUnit =
    filtered.length > 0
      ? filtered.reduce((s, c) => s + c.price_per_unit, 0) / filtered.length
      : 0;
  const avgCapRate =
    filtered.filter((c) => c.cap_rate).length > 0
      ? filtered.reduce((s, c) => s + (c.cap_rate || 0), 0) /
        filtered.filter((c) => c.cap_rate).length
      : 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Input
          placeholder="Filter by city..."
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white max-w-xs"
        />
        {filtered.length > 0 && (
          <div className="flex gap-4 text-xs text-slate-400">
            <span>
              Avg $/Unit: <strong className="text-white">{formatCurrency(avgPricePerUnit)}</strong>
            </span>
            {avgCapRate > 0 && (
              <span>
                Avg Cap: <strong className="text-white">{(avgCapRate * 100).toFixed(1)}%</strong>
              </span>
            )}
            <span>{filtered.length} comps</span>
          </div>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          {comps.length === 0 ? "No market comps yet." : "No comps match your filter."}
        </p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((comp) => (
            <Card key={comp.id} className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Building2 className="h-4 w-4 text-slate-500 shrink-0" />
                      <h3 className="text-sm font-medium text-white truncate">
                        {comp.address}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mb-2">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {comp.city}, {comp.state}
                      </span>
                      <span>{comp.units} units</span>
                      {comp.year_built && <span>Built {comp.year_built}</span>}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(comp.sale_date)}
                      </span>
                    </div>
                    {comp.notes && (
                      <p className="text-xs text-slate-500 line-clamp-1">{comp.notes}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-sm font-semibold text-blue-400">
                      {formatCurrency(comp.sale_price)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatCurrency(comp.price_per_unit)}/unit
                    </p>
                    {comp.cap_rate && (
                      <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                        {(comp.cap_rate * 100).toFixed(1)}% cap
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
