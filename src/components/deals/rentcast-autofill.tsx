"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Building2, Check } from "lucide-react";
import type { RentCastDealFields } from "@/lib/rentcast";

interface Props {
  dealId: string;
  current: Record<string, string | number | undefined>;
  onApply: (field: string, value: string) => Promise<void> | void;
}

interface ApiResult {
  configured?: boolean;
  cached?: boolean;
  not_found?: boolean;
  message?: string;
  error?: string;
  fields?: RentCastDealFields;
  fetched_at?: string;
}

// Field key -> label + formatter for display.
const ROWS: { key: keyof RentCastDealFields; label: string; fmt: (v: unknown) => string }[] = [
  { key: "units", label: "Units", fmt: (v) => String(v) },
  { key: "year_built", label: "Year Built", fmt: (v) => String(v) },
  { key: "square_footage", label: "Square Footage", fmt: (v) => `${Number(v).toLocaleString()} SF` },
  { key: "lot_size", label: "Lot Size", fmt: (v) => String(v) },
  { key: "property_type", label: "Property Type", fmt: (v) => String(v) },
  { key: "county", label: "County", fmt: (v) => String(v) },
  { key: "assessed_value", label: "Assessed Value", fmt: (v) => `$${Number(v).toLocaleString()}` },
  { key: "owner_acquisition_price", label: "Last Sale Price", fmt: (v) => `$${Number(v).toLocaleString()}` },
  { key: "owner_since", label: "Last Sale Date", fmt: (v) => new Date(String(v)).toLocaleDateString("en-US", { month: "short", year: "numeric" }) },
];

export function RentCastAutofill({ dealId, current, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  async function load(refresh = false) {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/rentcast-property${refresh ? "?refresh=1" : ""}`);
      setResult(await res.json());
      setOpen(true);
    } catch {
      setResult({ error: "Request failed" });
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  async function apply(key: string, value: string) {
    await onApply(key, value);
    setApplied((prev) => new Set(prev).add(key));
  }

  const fields = result?.fields ?? {};
  const rows = ROWS.filter((r) => fields[r.key] != null && fields[r.key] !== "");

  return (
    <div className="relative">
      <Button size="sm" variant="outline" className="h-7 border-slate-700 text-cyan-400 hover:bg-slate-800"
        disabled={loading} onClick={() => (open ? load(true) : load(false))}>
        <Building2 className="h-3 w-3 mr-1" />{loading ? "Loading…" : open ? "Refresh" : "Auto-fill from RentCast"}
      </Button>

      {open && result && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-300">RentCast property record</span>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300 text-xs">close</button>
          </div>

          {result.configured === false && <p className="text-[11px] text-amber-400/90">Add RENTCAST_API_KEY to enable.</p>}
          {result.error && <p className="text-[11px] text-red-400">{result.error}</p>}
          {result.not_found && <p className="text-[11px] text-slate-500">No record found for this address.</p>}

          {rows.length > 0 && (
            <>
              <div className="space-y-1.5 max-h-80 overflow-auto">
                {rows.map((r) => {
                  const fetched = String(r.fmt(fields[r.key]));
                  const cur = current[r.key];
                  const isApplied = applied.has(r.key);
                  return (
                    <div key={r.key} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <p className="text-slate-400">{r.label}</p>
                        <p className="text-white truncate">{fetched}{cur != null && cur !== "" ? <span className="text-slate-600"> (now {String(cur)})</span> : null}</p>
                      </div>
                      <button
                        onClick={() => apply(r.key, String(fields[r.key]))}
                        disabled={isApplied}
                        className={`shrink-0 px-2 py-0.5 rounded border text-[10px] ${isApplied ? "border-green-700 text-green-400" : "border-slate-600 text-cyan-400 hover:bg-slate-800"}`}
                      >
                        {isApplied ? <Check className="h-3 w-3" /> : "Apply"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <Button size="sm" variant="outline" className="h-7 w-full mt-2 border-slate-700 text-cyan-400 hover:bg-slate-800"
                onClick={async () => { for (const r of rows) await apply(r.key, String(fields[r.key])); }}>
                Apply all
              </Button>
              <p className="text-[10px] text-slate-500 mt-1">Review before applying. Assessed value is the county assessment, which may differ from market value.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
