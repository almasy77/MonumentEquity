"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Home, MapPin, Calendar } from "lucide-react";
import type { RentComp } from "@/lib/validations";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function RentCompList({ comps }: { comps: RentComp[] }) {
  const [filter, setFilter] = useState("");

  const filtered = filter
    ? comps.filter(
        (c) =>
          c.city.toLowerCase().includes(filter.toLowerCase()) ||
          (c.submarket?.toLowerCase().includes(filter.toLowerCase()) ?? false) ||
          (c.property_name?.toLowerCase().includes(filter.toLowerCase()) ?? false)
      )
    : comps;

  // Averages
  const avgRent =
    filtered.length > 0
      ? filtered.reduce((s, c) => s + c.rent, 0) / filtered.length
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <Input
          placeholder="Filter by city, submarket, or property..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-slate-800 border-slate-700 text-white max-w-sm"
        />
        {filtered.length > 0 && (
          <div className="flex gap-4 text-xs text-slate-400">
            <span>
              Avg Rent: <strong className="text-white">${Math.round(avgRent).toLocaleString()}</strong>
            </span>
            <span>{filtered.length} comps</span>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          {comps.length === 0 ? "No rent comps yet." : "No comps match your filter."}
        </p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((comp) => (
            <Card key={comp.id} className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Home className="h-4 w-4 text-slate-500 shrink-0" />
                      <h3 className="text-sm font-medium text-white truncate">
                        {comp.property_name || comp.address}
                      </h3>
                      {comp.unit_type && (
                        <Badge variant="outline" className="text-xs border-slate-600 text-slate-400 shrink-0">
                          {comp.unit_type}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {comp.city}
                        {comp.submarket && ` — ${comp.submarket}`}
                      </span>
                      {comp.bedrooms != null && (
                        <span>
                          {comp.bedrooms}BR/{comp.bathrooms || "?"}BA
                        </span>
                      )}
                      {comp.square_footage && <span>{comp.square_footage} SF</span>}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(comp.date_observed)}
                      </span>
                    </div>
                    {comp.amenities && (
                      <p className="text-xs text-slate-500">{comp.amenities}</p>
                    )}
                    {comp.notes && (
                      <p className="text-xs text-slate-500 line-clamp-1 mt-1">{comp.notes}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-lg font-semibold text-green-400">
                      ${comp.rent.toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">/month</p>
                    {comp.rent_per_sqft && (
                      <p className="text-xs text-slate-400">
                        ${comp.rent_per_sqft.toFixed(2)}/SF
                      </p>
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
