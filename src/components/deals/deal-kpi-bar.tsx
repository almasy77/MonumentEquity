"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ChevronDown } from "lucide-react";
import type { DealMetrics } from "@/lib/underwriting";
import type { Scenario } from "@/lib/validations";

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

export function DealKPIBar({ scenarios }: { scenarios: Scenario[] }) {
  const [selectedId, setSelectedId] = useState<string>(scenarios[0]?.id ?? "");
  const [metrics, setMetrics] = useState<DealMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (!selectedId) return;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/scenarios/${selectedId}`);
        if (res.ok) {
          const data: ScenarioWithResult = await res.json();
          setMetrics(data.underwriting.metrics);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedId]);

  if (scenarios.length === 0) return null;

  const selectedScenario = scenarios.find((s) => s.id === selectedId);

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
      {/* Scenario selector */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">KPIs from:</span>
        {scenarios.length === 1 ? (
          <span className="text-xs text-slate-400">{selectedScenario?.name}</span>
        ) : (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              {selectedScenario?.name || "Select scenario"}
              <ChevronDown className="h-3 w-3" />
            </button>
            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-40 bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[160px]">
                  {scenarios.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setSelectedId(s.id); setDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                        s.id === selectedId
                          ? "bg-blue-600/20 text-blue-400"
                          : "text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
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
