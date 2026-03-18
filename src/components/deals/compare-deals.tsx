"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { STAGE_LABELS } from "@/lib/constants";
import type { Deal } from "@/lib/validations";

const MAX_COMPARE = 4;

function formatCurrency(value: number | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number | undefined, decimals = 0): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatPercent(value: number | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function RecommendationBadge({ rec }: { rec: string | undefined }) {
  if (!rec) return <span className="text-slate-500">Not scored</span>;

  const colorMap: Record<string, string> = {
    PURSUE: "bg-green-900/50 text-green-400 border-green-700",
    MAYBE: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
    PASS: "bg-red-900/50 text-red-400 border-red-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${colorMap[rec] ?? "bg-slate-800 text-slate-400 border-slate-700"}`}
    >
      {rec}
    </span>
  );
}

type RowDef = {
  label: string;
  getValue: (deal: Deal) => React.ReactNode;
};

const sections: { title: string; rows: RowDef[] }[] = [
  {
    title: "Property",
    rows: [
      { label: "Address", getValue: (d) => d.address },
      { label: "City / State", getValue: (d) => `${d.city}, ${d.state}` },
      { label: "Units", getValue: (d) => formatNumber(d.units) },
      { label: "Year Built", getValue: (d) => d.year_built ?? "—" },
      { label: "Sq Ft", getValue: (d) => formatNumber(d.square_footage) },
    ],
  },
  {
    title: "Pricing",
    rows: [
      { label: "Asking Price", getValue: (d) => formatCurrency(d.asking_price) },
      {
        label: "Price / Unit",
        getValue: (d) =>
          d.asking_price && d.units
            ? formatCurrency(Math.round(d.asking_price / d.units))
            : "—",
      },
      { label: "Bid Price", getValue: (d) => formatCurrency(d.bid_price) },
    ],
  },
  {
    title: "Buy Box",
    rows: [
      {
        label: "Final Score",
        getValue: (d) =>
          d.buy_box_scores?.final_score != null
            ? formatNumber(d.buy_box_scores.final_score, 1)
            : "Not scored",
      },
      {
        label: "Recommendation",
        getValue: (d) => (
          <RecommendationBadge rec={d.buy_box_scores?.recommendation} />
        ),
      },
      {
        label: "Neighborhood Score",
        getValue: (d) =>
          d.buy_box_scores?.neighborhood_score != null
            ? formatNumber(d.buy_box_scores.neighborhood_score, 2)
            : "Not scored",
      },
      {
        label: "DSCR",
        getValue: (d) =>
          d.buy_box_scores?.dscr != null
            ? formatNumber(d.buy_box_scores.dscr, 2)
            : "Not scored",
      },
      {
        label: "Stabilized Yield",
        getValue: (d) =>
          d.buy_box_scores?.stabilized_yield != null
            ? formatPercent(d.buy_box_scores.stabilized_yield)
            : "Not scored",
      },
    ],
  },
  {
    title: "Source",
    rows: [
      { label: "Source", getValue: (d) => d.source },
      {
        label: "Stage",
        getValue: (d) => STAGE_LABELS[d.stage] ?? d.stage,
      },
    ],
  },
];

export function CompareDeals({ deals }: { deals: Deal[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleDeal(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_COMPARE) {
        next.add(id);
      }
      return next;
    });
  }

  const selectedDeals = deals.filter((d) => selectedIds.has(d.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/pipeline">
          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Compare Deals</h1>
          <p className="text-slate-400 text-sm mt-1">
            Select up to {MAX_COMPARE} deals to compare side-by-side
          </p>
        </div>
      </div>

      {/* Deal Selector */}
      <Card className="bg-slate-900 border-slate-800 p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">
          Select Deals ({selectedIds.size}/{MAX_COMPARE})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {deals.map((deal) => {
            const isSelected = selectedIds.has(deal.id);
            const isDisabled = !isSelected && selectedIds.size >= MAX_COMPARE;

            return (
              <label
                key={deal.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  isSelected
                    ? "border-blue-600 bg-blue-950/30"
                    : isDisabled
                      ? "border-slate-800 bg-slate-900/50 opacity-50 cursor-not-allowed"
                      : "border-slate-800 hover:border-slate-700 bg-slate-900/50"
                }`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => !isDisabled && toggleDeal(deal.id)}
                  disabled={isDisabled}
                  className="shrink-0"
                />
                <span className="text-sm text-white truncate">
                  {deal.address}
                  <span className="text-slate-400 ml-1">
                    — {deal.city}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {deals.length === 0 && (
          <p className="text-slate-500 text-sm">No active deals found.</p>
        )}
      </Card>

      {/* Comparison Table */}
      {selectedDeals.length > 0 && (
        <Card className="bg-slate-900 border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-slate-400 font-medium px-4 py-3 w-44 min-w-[11rem] sticky left-0 bg-slate-900 z-10">
                    Metric
                  </th>
                  {selectedDeals.map((deal) => (
                    <th
                      key={deal.id}
                      className="text-left text-white font-semibold px-4 py-3 min-w-[12rem]"
                    >
                      <div className="truncate">{deal.address}</div>
                      <div className="text-xs text-slate-400 font-normal truncate">
                        {deal.city}, {deal.state}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <>
                    <tr key={`section-${section.title}`} className="border-b border-slate-800/50">
                      <td
                        colSpan={selectedDeals.length + 1}
                        className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-950/50"
                      >
                        {section.title}
                      </td>
                    </tr>
                    {section.rows.map((row) => (
                      <tr
                        key={`${section.title}-${row.label}`}
                        className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-slate-400 font-medium sticky left-0 bg-slate-900 z-10">
                          {row.label}
                        </td>
                        {selectedDeals.map((deal) => (
                          <td key={deal.id} className="px-4 py-2.5 text-white">
                            {row.getValue(deal)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selectedDeals.length === 0 && deals.length > 0 && (
        <div className="text-center py-12 text-slate-500">
          Select deals above to start comparing
        </div>
      )}
    </div>
  );
}
