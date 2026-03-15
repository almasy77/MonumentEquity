"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { MonthlyRow, AnnualSummary } from "@/lib/underwriting";

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtDetailed(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

type ViewMode = "annual" | "monthly";

export function ProFormaTable({
  monthly,
  annual,
}: {
  monthly: MonthlyRow[];
  annual: AnnualSummary[];
}) {
  const [view, setView] = useState<ViewMode>("annual");
  const [selectedYear, setSelectedYear] = useState(1);

  const rows = [
    { key: "gpr", label: "Gross Potential Rent" },
    { key: "vacancy_loss", label: "Less: Vacancy", negative: true },
    { key: "bad_debt", label: "Less: Bad Debt", negative: true },
    { key: "concessions", label: "Less: Concessions", negative: true },
    { key: "other_income", label: "Plus: Other Income" },
    { key: "egi", label: "Effective Gross Income", bold: true },
    { key: "total_opex", label: "Less: Operating Expenses", negative: true },
    { key: "noi", label: "Net Operating Income", bold: true, highlight: true },
    { key: "debt_service", label: "Less: Debt Service", negative: true },
    { key: "capex", label: "Less: CapEx", negative: true },
    { key: "cash_flow", label: "Cash Flow", bold: true, highlight: true },
  ];

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">Pro Forma</CardTitle>
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
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-b border-slate-800/50 ${
                    row.highlight ? "bg-slate-800/30" : ""
                  }`}
                >
                  <td
                    className={`py-1.5 pr-4 ${
                      row.bold ? "font-semibold text-white" : "text-slate-300"
                    }`}
                  >
                    {row.label}
                  </td>
                  {annual.map((a) => {
                    const val = a[row.key as keyof AnnualSummary] as number;
                    return (
                      <td
                        key={a.year}
                        className={`text-right py-1.5 px-2 tabular-nums ${
                          row.bold ? "font-semibold text-white" : "text-slate-300"
                        } ${row.negative ? "text-slate-400" : ""} ${
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
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-b border-slate-800/50 ${
                    row.highlight ? "bg-slate-800/30" : ""
                  }`}
                >
                  <td
                    className={`py-1 pr-4 text-xs ${
                      row.bold ? "font-semibold text-white" : "text-slate-300"
                    }`}
                  >
                    {row.label}
                  </td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const mIdx = (selectedYear - 1) * 12 + i;
                    const m = monthly[mIdx];
                    if (!m) return <td key={i} />;
                    const val = m[row.key as keyof MonthlyRow] as number;
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
