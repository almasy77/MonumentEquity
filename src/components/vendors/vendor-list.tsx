"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Search, ExternalLink, Star } from "lucide-react";
import {
  VENDOR_CATEGORIES,
  VENDOR_CATEGORY_LABELS,
  VENDOR_STATUSES,
  VENDOR_STATUS_LABELS,
  type Vendor,
} from "@/lib/vendors";

const selectCls = "h-9 rounded-md bg-slate-800 border border-slate-700 text-white text-sm px-2";

export const STATUS_TONE: Record<string, string> = {
  untested: "bg-slate-700/50 text-slate-300",
  quoted: "bg-amber-500/15 text-amber-300",
  engaged: "bg-blue-500/15 text-blue-300",
  used: "bg-emerald-500/15 text-emerald-300",
  do_not_use: "bg-red-500/15 text-red-300",
};

export function formatPriceFrom(v: Vendor): string {
  const prices = v.offerings.map((o) => o.price_from).filter((p): p is number => typeof p === "number");
  if (prices.length === 0) return v.offerings.length > 0 ? "Quote only" : "—";
  return `from $${Math.min(...prices).toLocaleString("en-US")}`;
}

export function VendorList({ vendors }: { vendors: Vendor[] }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [market, setMarket] = useState("all");

  const markets = useMemo(
    () => Array.from(new Set(vendors.flatMap((v) => v.markets ?? []))).sort(),
    [vendors],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors
      .filter((v) => category === "all" || v.category === category)
      .filter((v) => status === "all" || v.status === status)
      .filter((v) => market === "all" || (v.markets ?? []).includes(market))
      .filter((v) => !needle || `${v.name} ${v.company ?? ""} ${v.contact_name ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors, q, category, status, market]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vendors..."
            className="pl-9 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-9 text-sm"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls} aria-label="Category">
          <option value="all">All categories</option>
          {VENDOR_CATEGORIES.map((c) => <option key={c} value={c}>{VENDOR_CATEGORY_LABELS[c]}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
          <option value="all">All statuses</option>
          {VENDOR_STATUSES.map((s) => <option key={s} value={s}>{VENDOR_STATUS_LABELS[s]}</option>)}
        </select>
        <select value={market} onChange={(e) => setMarket(e.target.value)} className={selectCls} aria-label="Market">
          <option value="all">All markets</option>
          {markets.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">No vendors match these filters.</p>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((v) => (
            <Link
              key={v.id}
              href={`/vendors/${v.id}`}
              className="block rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white font-medium truncate">{v.name}</p>
                  <p className="text-xs text-slate-500 truncate">{VENDOR_CATEGORY_LABELS[v.category]}{v.company ? ` · ${v.company}` : ""}</p>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_TONE[v.status]}`}>
                  {VENDOR_STATUS_LABELS[v.status]}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                <span>{formatPriceFrom(v)} · {v.offerings.length} offering{v.offerings.length === 1 ? "" : "s"}</span>
                <span className="flex items-center gap-2">
                  {v.rating ? <span className="flex items-center gap-0.5 text-amber-300"><Star className="h-3 w-3 fill-current" />{v.rating}</span> : null}
                  {v.website ? <ExternalLink className="h-3 w-3" /> : null}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 truncate">{(v.markets ?? []).join(", ") || "No markets set"}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
