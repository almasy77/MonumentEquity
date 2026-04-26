"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { STAGE_LABELS, type DealStage } from "@/lib/constants";
import type { Deal } from "@/lib/validations";

type SortKey = "address" | "city" | "state" | "units" | "asking_price" | "price_per_unit" | "stage" | "source" | "year_built" | "created_at";
type SortDir = "asc" | "desc";

function formatCurrency(n: number | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function daysSince(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

const STAGE_ORDER: Record<DealStage, number> = {
  lead: 0,
  screening: 1,
  analysis: 2,
  loi: 3,
  due_diligence: 4,
  closing: 5,
  onboarding: 6,
  stabilized: 7,
};

const STAGE_COLORS: Record<string, string> = {
  lead: "bg-slate-700 text-slate-300",
  screening: "bg-indigo-900/50 text-indigo-300",
  analysis: "bg-blue-900/50 text-blue-300",
  loi: "bg-purple-900/50 text-purple-300",
  due_diligence: "bg-amber-900/50 text-amber-300",
  closing: "bg-green-900/50 text-green-300",
  onboarding: "bg-teal-900/50 text-teal-300",
  stabilized: "bg-emerald-900/50 text-emerald-300",
};

interface Column {
  key: SortKey;
  label: string;
  align?: "left" | "right";
  width?: string;
}

const COLUMNS: Column[] = [
  { key: "address", label: "Address", width: "min-w-[200px]" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "units", label: "Units", align: "right" },
  { key: "asking_price", label: "Asking Price", align: "right" },
  { key: "price_per_unit", label: "$/Unit", align: "right" },
  { key: "stage", label: "Stage" },
  { key: "source", label: "Source" },
  { key: "year_built", label: "Built", align: "right" },
  { key: "created_at", label: "Added", align: "right" },
];

function getSortValue(deal: Deal, key: SortKey): string | number {
  switch (key) {
    case "address": return deal.address.toLowerCase();
    case "city": return deal.city.toLowerCase();
    case "state": return deal.state.toLowerCase();
    case "units": return deal.units;
    case "asking_price": return deal.asking_price;
    case "price_per_unit": return deal.units > 0 ? deal.asking_price / deal.units : 0;
    case "stage": return STAGE_ORDER[deal.stage] ?? 99;
    case "source": return deal.source.toLowerCase();
    case "year_built": return deal.year_built ?? 0;
    case "created_at": return new Date(deal.created_at).getTime();
  }
}

export function PipelineTable({ deals }: { deals: Deal[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "address" || key === "city" || key === "state" || key === "source" ? "asc" : "desc");
    }
  }

  const sorted = [...deals].sort((a, b) => {
    const av = getSortValue(a, sortKey);
    const bv = getSortValue(b, sortKey);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  if (deals.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        No deals to display
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/80">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 font-medium text-slate-400 cursor-pointer hover:text-white transition-colors select-none whitespace-nowrap ${col.width || ""} ${col.align === "right" ? "text-right" : "text-left"}`}
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3 text-blue-400" />
                      ) : (
                        <ArrowDown className="h-3 w-3 text-blue-400" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((deal) => {
              const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;
              return (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}`}
                  className="contents"
                >
                  <tr className="border-t border-slate-800/50 hover:bg-slate-800/40 transition-colors cursor-pointer">
                    <td className="px-3 py-2.5 text-white font-medium truncate max-w-[250px]">
                      {deal.address}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{deal.city}</td>
                    <td className="px-3 py-2.5 text-slate-300">{deal.state}</td>
                    <td className="px-3 py-2.5 text-slate-300 text-right">{deal.units}</td>
                    <td className="px-3 py-2.5 text-blue-400 font-medium text-right">
                      {formatCurrency(deal.asking_price)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 text-right">
                      {formatCurrency(pricePerUnit)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[deal.stage] || "bg-slate-700 text-slate-300"}`}>
                        {STAGE_LABELS[deal.stage] ?? deal.stage}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{deal.source}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-right">
                      {deal.year_built ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-right whitespace-nowrap">
                      {daysSince(deal.created_at)}
                    </td>
                  </tr>
                </Link>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
