"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { DealMetrics } from "@/lib/underwriting";

function fmt(n: number | null | undefined, type: "pct" | "money" | "mult"): string {
  if (n == null) return "—";
  if (type === "pct") return `${(n * 100).toFixed(2)}%`;
  if (type === "mult") return `${n.toFixed(2)}x`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function metricColor(value: number | null, thresholds?: { good: number; warn: number; reverse?: boolean }): string {
  if (value == null || !thresholds) return "text-white";
  if (thresholds.reverse) {
    if (value >= thresholds.good) return "text-green-400";
    if (value >= thresholds.warn) return "text-yellow-400";
    return "text-red-400";
  }
  if (value >= thresholds.good) return "text-green-400";
  if (value >= thresholds.warn) return "text-yellow-400";
  return "text-red-400";
}

export function MetricsBar({ metrics }: { metrics: DealMetrics }) {
  const items = [
    {
      label: "IRR",
      title: "Internal Rate of Return",
      value: fmt(metrics.irr, "pct"),
      color: metricColor(metrics.irr, { good: 0.15, warn: 0.08, reverse: true }),
    },
    {
      label: "Cash-on-Cash",
      title: "Average Annual Cash-on-Cash Return",
      value: fmt(metrics.average_cash_on_cash, "pct"),
      color: metricColor(metrics.average_cash_on_cash, { good: 0.08, warn: 0.05, reverse: true }),
    },
    {
      label: "DSCR (Yr 1)",
      title: "Debt Service Coverage Ratio — Year 1 NOI / Year 1 Debt Service",
      value: metrics.year1_dscr.toFixed(2),
      color: metricColor(metrics.year1_dscr, { good: 1.25, warn: 1.0, reverse: true }),
    },
    {
      label: "Equity Multiple",
      title: "Total Distributions / Total Equity Invested",
      value: fmt(metrics.equity_multiple, "mult"),
      color: metricColor(metrics.equity_multiple, { good: 1.8, warn: 1.3, reverse: true }),
    },
    {
      label: "Going-In Cap",
      title: "Year 1 NOI / Purchase Price",
      value: fmt(metrics.going_in_cap, "pct"),
      color: "text-white",
    },
    {
      label: "Stabilized Cap",
      title: "Stabilized NOI / Purchase Price",
      value: fmt(metrics.stabilized_cap, "pct"),
      color: "text-white",
    },
    {
      label: "Total Equity",
      title: "Total equity required at closing",
      value: fmt(metrics.total_equity, "money"),
      color: "text-white",
    },
    {
      label: "Net Proceeds",
      title: "Net sale proceeds after selling costs and loan payoff",
      value: fmt(metrics.net_sale_proceeds, "money"),
      color: metrics.net_sale_proceeds > 0 ? "text-green-400" : "text-red-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {items.map((item) => (
        <Card key={item.label} className="bg-slate-900 border-slate-800 hover:border-slate-600 hover:bg-slate-800/50 transition-colors cursor-default">
          <CardContent className="p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1" title={item.title}>
              {item.label}
            </p>
            <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
