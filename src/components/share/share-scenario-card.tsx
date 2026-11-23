"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SensitivityGrid } from "@/components/underwriting/sensitivity-grid";
import type { ShareScenarioData, ShareProFormaYear } from "@/lib/share-scenario";

// Read-only, seller/partner-facing scenario card for the public share page. The
// server precomputes everything (single source of truth via calculateUnderwriting);
// this component only handles the expand/collapse and rendering.

const pct = (n: number | null): string => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

// Compact currency for the wide pro-forma grid (parentheses for negatives).
function compactUsd(n: number): string {
  const neg = n < 0;
  const v = Math.abs(Math.round(n));
  const s = v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v}`;
  return neg ? `(${s})` : s;
}

const METRIC_DEFS: { key: keyof ShareScenarioData["metrics"]; label: string; fmt: (n: number) => string }[] = [
  { key: "irr", label: "IRR", fmt: (n) => pct(n) },
  { key: "coc", label: "CoC", fmt: (n) => pct(n) },
  { key: "em", label: "Eq Mult", fmt: (n) => `${n.toFixed(2)}x` },
  { key: "dscr", label: "DSCR", fmt: (n) => n.toFixed(2) },
  { key: "goingCap", label: "Going-In Cap", fmt: (n) => pct(n) },
  { key: "stabCap", label: "Stab Cap", fmt: (n) => pct(n) },
];

const PROFORMA_ROWS: { label: string; key: keyof ShareProFormaYear; less?: boolean; bold?: boolean }[] = [
  { label: "Gross Potential Rent", key: "gpr" },
  { label: "Less: Vacancy", key: "vacancy", less: true },
  { label: "Effective Gross Income", key: "egi", bold: true },
  { label: "Less: Operating Expenses", key: "opex", less: true },
  { label: "Net Operating Income", key: "noi", bold: true },
  { label: "Less: Debt Service", key: "debtService", less: true },
  { label: "Less: CapEx", key: "capex", less: true },
  { label: "Cash Flow", key: "cashFlow", bold: true },
];

export function ShareScenarioCard({ data }: { data: ShareScenarioData }) {
  const [open, setOpen] = useState(false);
  const { metrics: m, proforma, assumptions, sensitivity, basePurchasePrice } = data;

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
      {/* Header — click anywhere to expand */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left p-4 hover:bg-slate-800/70 transition-colors"
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
            <h4 className="text-sm font-medium text-white">{data.name}</h4>
          </div>
          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
            {data.type}
          </Badge>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-center">
          {METRIC_DEFS.map(({ key, label, fmt }) => {
            const v = m[key];
            if (v == null) return null;
            return (
              <div key={key}>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm font-bold text-white tabular-nums">{fmt(v)}</p>
              </div>
            );
          })}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-4 space-y-5 border-t border-slate-700/70 pt-4">
          {assumptions.length === 0 && proforma.length === 0 && sensitivity.length === 0 && (
            <p className="text-xs text-slate-500 italic">Detailed breakdown unavailable for this scenario.</p>
          )}
          {/* Assumptions */}
          {assumptions.length > 0 && (
            <section>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                Key Assumptions
              </h5>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                {assumptions.map((a) => (
                  <div key={a.label} className="flex justify-between gap-2 border-b border-slate-800/60 pb-1">
                    <span className="text-xs text-slate-500">{a.label}</span>
                    <span className="text-xs text-slate-200 tabular-nums text-right">{a.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Pro Forma */}
          {proforma.length > 0 && (
            <section>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                Pro Forma
              </h5>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-1.5 pr-3 font-medium whitespace-nowrap">Line Item</th>
                      {proforma.map((y) => (
                        <th key={y.year} className="text-right py-1.5 px-2 font-medium whitespace-nowrap">
                          Yr {y.year}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PROFORMA_ROWS.map((row) => (
                      <tr key={row.key} className="border-b border-slate-800/50">
                        <td className={`py-1.5 pr-3 whitespace-nowrap ${row.bold ? "font-semibold text-slate-200" : "text-slate-400"}`}>
                          {row.label}
                        </td>
                        {proforma.map((y) => {
                          const raw = y[row.key] as number;
                          const shown = row.less ? -Math.abs(raw) : raw;
                          return (
                            <td
                              key={y.year}
                              className={`text-right py-1.5 px-2 tabular-nums whitespace-nowrap ${row.bold ? "font-semibold text-white" : "text-slate-300"}`}
                            >
                              {compactUsd(shown)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Sensitivity */}
          {sensitivity.length > 0 && (
            <section>
              <SensitivityGrid sensitivity={sensitivity} basePurchasePrice={basePurchasePrice} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
