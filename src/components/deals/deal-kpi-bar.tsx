"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { DealMetrics } from "@/lib/underwriting";

function fmt(n: number | null | undefined, type: "pct" | "money" | "mult"): string {
  if (n == null) return "—";
  if (type === "pct") return `${(n * 100).toFixed(1)}%`;
  if (type === "mult") return `${n.toFixed(2)}x`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function metricColor(value: number | null, thresholds?: { good: number; warn: number }): string {
  if (value == null || !thresholds) return "text-white";
  if (value >= thresholds.good) return "text-green-400";
  if (value >= thresholds.warn) return "text-yellow-400";
  return "text-red-400";
}

interface ScenarioWithResult {
  scenario: { id: string };
  underwriting: { metrics: DealMetrics };
}

export function DealKPIBar({ scenarioIds }: { scenarioIds: string[] }) {
  const [metrics, setMetrics] = useState<DealMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [scenarioName, setScenarioName] = useState<string>("");

  useEffect(() => {
    if (scenarioIds.length === 0) return;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/scenarios/${scenarioIds[0]}`);
        if (res.ok) {
          const data: ScenarioWithResult & { scenario: { name: string } } = await res.json();
          setMetrics(data.underwriting.metrics);
          setScenarioName(data.scenario.name);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [scenarioIds]);

  if (scenarioIds.length === 0) return null;

  if (loading || !metrics) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading KPIs...
      </div>
    );
  }

  const items = [
    {
      label: "IRR",
      value: fmt(metrics.irr, "pct"),
      color: metricColor(metrics.irr, { good: 0.15, warn: 0.08 }),
    },
    {
      label: "Cash-on-Cash",
      value: fmt(metrics.average_cash_on_cash, "pct"),
      color: metricColor(metrics.average_cash_on_cash, { good: 0.08, warn: 0.05 }),
    },
    {
      label: "DSCR",
      value: metrics.year1_dscr.toFixed(2),
      color: metricColor(metrics.year1_dscr, { good: 1.25, warn: 1.0 }),
    },
    {
      label: "Equity Multiple",
      value: fmt(metrics.equity_multiple, "mult"),
      color: metricColor(metrics.equity_multiple, { good: 1.8, warn: 1.3 }),
    },
    {
      label: "Going-In Cap",
      value: fmt(metrics.going_in_cap, "pct"),
      color: "text-white",
    },
    {
      label: "Total Equity",
      value: fmt(metrics.total_equity, "money"),
      color: "text-white",
    },
    {
      label: "NOI (Yr 1)",
      value: fmt(metrics.going_in_cap && metrics.total_cost ? metrics.going_in_cap * metrics.total_cost : null, "money"),
      color: "text-white",
    },
    {
      label: "Net Proceeds",
      value: fmt(metrics.net_sale_proceeds, "money"),
      color: metrics.net_sale_proceeds > 0 ? "text-green-400" : "text-red-400",
    },
  ];

  return (
    <div>
      {scenarioName && (
        <p className="text-[10px] text-slate-500 mb-1.5">
          KPIs from scenario: <span className="text-slate-400">{scenarioName}</span>
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {items.map((item) => (
          <Card key={item.label} className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-2.5">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">
                {item.label}
              </p>
              <p className={`text-base font-bold ${item.color}`}>{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
