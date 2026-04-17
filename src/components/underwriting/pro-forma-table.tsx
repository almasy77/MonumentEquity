"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MonthlyRow, AnnualSummary, OpexBreakdown, RentBasis } from "@/lib/underwriting";

const RENT_BASIS_LABELS: Record<RentBasis, string> = {
  current: "Current Rents",
  market: "Market Rents",
  current_plus_reno: "Current + Reno Premium",
  market_plus_reno: "Market + Reno Premium",
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
  children?: RowDef[];
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
  rentBasis,
  onRentBasisChange,
}: {
  monthly: MonthlyRow[];
  annual: AnnualSummary[];
  rentBasis?: RentBasis;
  onRentBasisChange?: (basis: RentBasis) => void;
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
        { key: "reserves", label: "Reserves", negative: true, indent: true },
      ],
    },
    { key: "noi", label: "Net Operating Income", bold: true, highlight: true },
    { key: "debt_service", label: "Less: Debt Service", negative: true },
    { key: "capex", label: "Less: CapEx", negative: true },
    { key: "cash_flow", label: "Cash Flow", bold: true, highlight: true },
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
            {onRentBasisChange && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Rents:</span>
                <select
                  value={rentBasis || "current"}
                  onChange={(ev) => onRentBasisChange(ev.target.value as RentBasis)}
                  className="bg-slate-800 border border-slate-700 text-slate-300 text-xs h-7 rounded-md px-2 outline-none hover:border-slate-500 focus:border-blue-500 transition-colors appearance-none pr-6"
                  style={{
                    backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 20 20'><path fill='%2394a3b8' d='M5 7l5 6 5-6z'/></svg>\")",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 6px center",
                    backgroundSize: "10px",
                  }}
                >
                  {(Object.keys(RENT_BASIS_LABELS) as RentBasis[]).map((k) => (
                    <option key={k} value={k}>{RENT_BASIS_LABELS[k]}</option>
                  ))}
                </select>
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
                        {row.negative ? `(${fmt(val)})` : fmt(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Cash on Cash row */}
              <tr className="border-t border-slate-700">
                <td className="py-1.5 pr-4 text-slate-400 text-xs">
                  Cash-on-Cash Return
                </td>
                {annual.map((a) => (
                  <td
                    key={a.year}
                    className="text-right py-1.5 px-2 text-xs text-slate-400 tabular-nums"
                  >
                    {(a.cash_on_cash * 100).toFixed(1)}%
                  </td>
                ))}
              </tr>
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
                    return (
                      <td
                        key={i}
                        className={`text-right py-1 px-1 tabular-nums text-xs ${
                          row.bold ? "font-semibold text-white" : "text-slate-300"
                        } ${row.negative ? "text-slate-400" : ""} ${
                          row.key === "cash_flow" && val < 0 ? "text-red-400" : ""
                        }`}
                      >
                        {row.negative ? `(${fmtDetailed(val)})` : fmtDetailed(val)}
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
