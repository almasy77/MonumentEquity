"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MonthlyRow, AnnualSummary, OpexBreakdown, UnrenovatedBasis, RenovatedBasis } from "@/lib/underwriting";
import type { TaxYearRow } from "@/lib/tax";

const UNRENOVATED_BASIS_LABELS: Record<UnrenovatedBasis, string> = {
  current: "Current",
  market: "Market",
};

const RENOVATED_BASIS_LABELS: Record<RenovatedBasis, string> = {
  current_plus_premium: "Current + Premium",
  market_plus_premium: "Market + Premium",
};

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtDetailed(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

type ViewMode = "annual" | "monthly";

// Row definition with optional children for expandable sections
interface RowDef {
  key: string;
  label: string;
  negative?: boolean;
  bold?: boolean;
  highlight?: boolean;
  indent?: boolean; // indented sub-row
  pct?: boolean; // render value as a percentage (e.g. cap rate, CoC)
  children?: RowDef[];
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

// Get value from annual summary, including opex_breakdown fields
function getAnnualValue(a: AnnualSummary, key: string): number {
  if (key in a) return a[key as keyof AnnualSummary] as number;
  // Check opex_breakdown
  if (a.opex_breakdown && key in a.opex_breakdown) {
    return a.opex_breakdown[key as keyof OpexBreakdown];
  }
  return 0;
}

// Get value from monthly row, including opex_breakdown fields
function getMonthlyValue(m: MonthlyRow, key: string): number {
  if (key in m) return m[key as keyof MonthlyRow] as number;
  if (m.opex_breakdown && key in m.opex_breakdown) {
    return m.opex_breakdown[key as keyof OpexBreakdown];
  }
  return 0;
}

export function ProFormaTable({
  monthly,
  annual,
  unrenovatedBasis,
  renovatedBasis,
  taxYears,
  taxView = "household",
  onUnrenovatedBasisChange,
  onRenovatedBasisChange,
}: {
  monthly: MonthlyRow[];
  annual: AnnualSummary[];
  unrenovatedBasis?: UnrenovatedBasis;
  renovatedBasis?: RenovatedBasis;
  taxYears?: TaxYearRow[]; // per-year tax detail — rows shown only when present (annual view)
  taxView?: "propco" | "household"; // which after-tax CF is the headline
  onUnrenovatedBasisChange?: (basis: UnrenovatedBasis) => void;
  onRenovatedBasisChange?: (basis: RenovatedBasis) => void;
}) {
  const [view, setView] = useState<ViewMode>("annual");
  const [selectedYear, setSelectedYear] = useState(1);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  function toggleSection(key: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const rows: RowDef[] = [
    {
      key: "egi",
      label: "Revenue (EGI)",
      bold: true,
      children: [
        { key: "gpr", label: "Gross Potential Rent" },
        { key: "vacancy_loss", label: "Less: Vacancy", negative: true },
        { key: "bad_debt", label: "Less: Bad Debt", negative: true },
        { key: "concessions", label: "Less: Concessions", negative: true },
        { key: "other_income", label: "Plus: Other Income" },
      ],
    },
    {
      key: "total_opex",
      label: "Less: Operating Expenses",
      negative: true,
      children: [
        { key: "management_fees", label: "Management Fees", negative: true, indent: true },
        { key: "payroll", label: "Payroll", negative: true, indent: true },
        { key: "repairs_maintenance", label: "Repairs & Maintenance", negative: true, indent: true },
        { key: "turnover", label: "Turnover", negative: true, indent: true },
        { key: "insurance", label: "Insurance", negative: true, indent: true },
        { key: "property_tax", label: "Property Tax", negative: true, indent: true },
        { key: "utilities", label: "Utilities", negative: true, indent: true },
        { key: "admin_legal_marketing", label: "Admin / Legal / Mktg", negative: true, indent: true },
        { key: "contract_services", label: "Contract Services", negative: true, indent: true },
      ],
    },
    { key: "noi", label: "Net Operating Income", bold: true, highlight: true },
    { key: "debt_service", label: "Less: Debt Service", negative: true },
    { key: "cash_flow_before_capex_and_reserves", label: "Cash Flow before CapEx & Reserves", bold: true },
    { key: "reserves", label: "Less: Reserves", negative: true },
    { key: "capex", label: "Less: CapEx", negative: true },
    { key: "cash_flow", label: "Cash Flow", bold: true, highlight: true },
    // Key per-period metrics (rendered as percentages)
    { key: "cap_rate", label: "Cap Rate", pct: true },
    { key: "cash_on_cash", label: "Cash-on-Cash Return", pct: true },
    // Rent ramp visibility — shows the absorption curve. Zero when ramp is disabled.
    { key: "pct_marked_to_market", label: "% Marked-to-Market", pct: true },
  ];

  // Flatten rows based on expanded state
  function flattenRows(): (RowDef & { expandable?: boolean; expanded?: boolean })[] {
    const result: (RowDef & { expandable?: boolean; expanded?: boolean })[] = [];
    for (const row of rows) {
      if (row.children) {
        const expanded = expandedSections.has(row.key);
        result.push({ ...row, expandable: true, expanded });
        if (expanded) {
          for (const child of row.children) {
            result.push({ ...child, indent: true });
          }
        }
      } else {
        result.push(row);
      }
    }
    return result;
  }

  const visibleRows = flattenRows();

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-white text-base">Pro Forma</CardTitle>
          <div className="flex items-center gap-3">
            {(onUnrenovatedBasisChange || onRenovatedBasisChange) && (
              <div className="flex items-center gap-3">
                {onUnrenovatedBasisChange && (
                  <div className="flex items-center gap-1.5" title="Rent for unrenovated units">
                    <span className="text-xs text-slate-500">Unrenovated:</span>
                    <select
                      value={unrenovatedBasis || "current"}
                      onChange={(ev) => onUnrenovatedBasisChange(ev.target.value as UnrenovatedBasis)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-xs h-7 rounded-md px-2 outline-none hover:border-slate-500 focus:border-blue-500 transition-colors appearance-none pr-6"
                      style={{
                        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 20 20'><path fill='%2394a3b8' d='M5 7l5 6 5-6z'/></svg>\")",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 6px center",
                        backgroundSize: "10px",
                      }}
                    >
                      {(Object.keys(UNRENOVATED_BASIS_LABELS) as UnrenovatedBasis[]).map((k) => (
                        <option key={k} value={k}>{UNRENOVATED_BASIS_LABELS[k]}</option>
                      ))}
                    </select>
                  </div>
                )}
                {onRenovatedBasisChange && (
                  <div className="flex items-center gap-1.5" title="Rent for renovated units (per the CapEx renovation schedule)">
                    <span className="text-xs text-slate-500">Renovated:</span>
                    <select
                      value={renovatedBasis || "current_plus_premium"}
                      onChange={(ev) => onRenovatedBasisChange(ev.target.value as RenovatedBasis)}
                      className="bg-slate-800 border border-slate-700 text-slate-300 text-xs h-7 rounded-md px-2 outline-none hover:border-slate-500 focus:border-blue-500 transition-colors appearance-none pr-6"
                      style={{
                        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 20 20'><path fill='%2394a3b8' d='M5 7l5 6 5-6z'/></svg>\")",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 6px center",
                        backgroundSize: "10px",
                      }}
                    >
                      {(Object.keys(RENOVATED_BASIS_LABELS) as RenovatedBasis[]).map((k) => (
                        <option key={k} value={k}>{RENOVATED_BASIS_LABELS[k]}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-1">
              <Button
                variant={view === "annual" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("annual")}
                className={
                  view === "annual"
                    ? "bg-blue-600 text-white h-7 text-xs"
                    : "border-slate-700 text-slate-400 h-7 text-xs"
                }
              >
                Annual
              </Button>
              <Button
                variant={view === "monthly" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("monthly")}
                className={
                  view === "monthly"
                    ? "bg-blue-600 text-white h-7 text-xs"
                    : "border-slate-700 text-slate-400 h-7 text-xs"
                }
              >
                Monthly
              </Button>
            </div>
          </div>
        </div>

        {/* Year selector for monthly view */}
        {view === "monthly" && annual.length > 0 && (
          <div className="flex gap-1 mt-2">
            {annual.map((a) => (
              <button
                key={a.year}
                onClick={() => setSelectedYear(a.year)}
                className={`px-2 py-0.5 text-xs rounded ${
                  selectedYear === a.year
                    ? "bg-slate-700 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Year {a.year}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {view === "annual" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-800">
                <th className="text-left py-2 pr-4 font-medium">Line Item</th>
                {annual.map((a) => (
                  <th key={a.year} className="text-right py-2 px-2 font-medium">
                    Year {a.year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors ${
                    row.highlight ? "bg-slate-800/30" : ""
                  } ${row.expandable ? "cursor-pointer" : ""}`}
                  onClick={row.expandable ? () => toggleSection(row.key) : undefined}
                >
                  <td
                    className={`py-1.5 pr-4 ${
                      row.bold ? "font-semibold text-white" : "text-slate-300"
                    } ${row.indent ? "pl-5 text-slate-400 text-xs" : ""}`}
                  >
                    <span className="flex items-center gap-1">
                      {row.expandable && (
                        row.expanded
                          ? <ChevronDown className="h-3 w-3 text-slate-500 flex-shrink-0" />
                          : <ChevronRight className="h-3 w-3 text-slate-500 flex-shrink-0" />
                      )}
                      {row.label}
                    </span>
                  </td>
                  {annual.map((a) => {
                    const val = getAnnualValue(a, row.key);
                    const display = row.pct ? fmtPct(val) : (row.negative ? `(${fmt(val)})` : fmt(val));
                    return (
                      <td
                        key={a.year}
                        className={`text-right py-1.5 px-2 tabular-nums ${
                          row.bold ? "font-semibold text-white" : "text-slate-300"
                        } ${row.negative ? "text-slate-400" : ""} ${
                          row.indent ? "text-xs" : ""
                        } ${
                          row.key === "cash_flow" && val < 0 ? "text-red-400" : ""
                        }`}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Modeled tax impact (TAX_TREATMENT_SPEC) — annual view only,
                  rendered only when the scenario has Tax Treatment enabled.
                  Tax/(Shield) = federal + NY + NIIT, net; green = net shield. */}
              {taxYears && taxYears.length > 0 && (
                <>
                  <tr className="border-t-2 border-slate-600">
                    <td className="py-1.5 pr-4 text-slate-300">
                      Tax / (Shield)
                      <span className="text-slate-600 text-[10px] ml-1.5">fed + NY + NIIT · est.</span>
                    </td>
                    {annual.map((a) => {
                      const ty = taxYears[a.year - 1];
                      const net = ty ? ty.federal_tax + ty.state_tax + ty.niit : 0;
                      return (
                        <td
                          key={a.year}
                          className={`text-right py-1.5 px-2 tabular-nums ${net < 0 ? "text-emerald-400" : "text-slate-300"}`}
                          title={ty ? `Federal: ${fmt(ty.federal_tax)} · NY: ${fmt(ty.state_tax)} · NIIT: ${fmt(ty.niit)} · REPS ${ty.reps_on ? "ON" : "off"}` : undefined}
                        >
                          {net < 0 ? `(${fmt(-net)})` : fmt(net)}
                        </td>
                      );
                    })}
                  </tr>
                  <tr className="bg-slate-800/30">
                    <td className="py-1.5 pr-4 font-semibold text-white">
                      After-Tax Cash Flow
                      <span className="text-slate-500 text-[10px] ml-1.5 font-normal">
                        {taxView === "household" ? "household view" : "PropCo view"}
                      </span>
                    </td>
                    {annual.map((a) => {
                      const ty = taxYears[a.year - 1];
                      const atcf = ty
                        ? (taxView === "household" ? ty.after_tax_cash_flow_household : ty.after_tax_cash_flow_propco)
                        : 0;
                      return (
                        <td
                          key={a.year}
                          className={`text-right py-1.5 px-2 tabular-nums font-semibold ${atcf < 0 ? "text-red-400" : "text-white"}`}
                        >
                          {fmt(atcf)}
                        </td>
                      );
                    })}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-800">
                <th className="text-left py-2 pr-4 font-medium">Line Item</th>
                {Array.from({ length: 12 }, (_, i) => {
                  const m = (selectedYear - 1) * 12 + i + 1;
                  return (
                    <th key={m} className="text-right py-2 px-1 font-medium">
                      M{m}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors ${
                    row.highlight ? "bg-slate-800/30" : ""
                  } ${row.expandable ? "cursor-pointer" : ""}`}
                  onClick={row.expandable ? () => toggleSection(row.key) : undefined}
                >
                  <td
                    className={`py-1 pr-4 text-xs ${
                      row.bold ? "font-semibold text-white" : "text-slate-300"
                    } ${row.indent ? "pl-5 text-slate-400" : ""}`}
                  >
                    <span className="flex items-center gap-1">
                      {row.expandable && (
                        row.expanded
                          ? <ChevronDown className="h-3 w-3 text-slate-500 flex-shrink-0" />
                          : <ChevronRight className="h-3 w-3 text-slate-500 flex-shrink-0" />
                      )}
                      {row.label}
                    </span>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const mIdx = (selectedYear - 1) * 12 + i;
                    const m = monthly[mIdx];
                    if (!m) return <td key={i} />;
                    const val = getMonthlyValue(m, row.key);
                    const display = row.pct ? fmtPct(val) : (row.negative ? `(${fmtDetailed(val)})` : fmtDetailed(val));
                    return (
                      <td
                        key={i}
                        className={`text-right py-1 px-1 tabular-nums text-xs ${
                          row.bold ? "font-semibold text-white" : "text-slate-300"
                        } ${row.negative ? "text-slate-400" : ""} ${
                          row.key === "cash_flow" && val < 0 ? "text-red-400" : ""
                        }`}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
