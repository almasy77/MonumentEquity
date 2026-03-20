"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SensitivityCell } from "@/lib/underwriting";

function irrColor(irr: number | null): string {
  if (irr == null) return "text-slate-500";
  if (irr >= 0.15) return "text-green-400 bg-green-900/20";
  if (irr >= 0.08) return "text-yellow-400 bg-yellow-900/20";
  return "text-red-400 bg-red-900/20";
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtPrice(base: number, delta: number): string {
  const price = base * (1 + delta);
  if (price >= 1_000_000) {
    const m = price / 1_000_000;
    // Use enough precision to distinguish adjacent rows
    return m % 1 === 0 ? `$${m.toFixed(0)}M` : `$${m.toFixed(2)}M`;
  }
  return `$${(price / 1_000).toFixed(0)}K`;
}

export function SensitivityGrid({
  sensitivity,
  basePurchasePrice,
}: {
  sensitivity: SensitivityCell[];
  basePurchasePrice: number;
}) {
  if (sensitivity.length === 0) return null;

  // Extract unique axes
  const priceDeltas = [...new Set(sensitivity.map((s) => s.purchase_price_delta))].sort(
    (a, b) => a - b
  );
  const capRates = [...new Set(sensitivity.map((s) => s.exit_cap_rate))].sort(
    (a, b) => a - b
  );

  function getCell(priceDelta: number, capRate: number): SensitivityCell | undefined {
    return sensitivity.find(
      (s) =>
        Math.abs(s.purchase_price_delta - priceDelta) < 0.001 &&
        Math.abs(s.exit_cap_rate - capRate) < 0.001
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base">
          Sensitivity Analysis — IRR
        </CardTitle>
        <p className="text-xs text-slate-500">
          Purchase price (rows) vs. exit cap rate (columns)
        </p>
        <p className="text-[10px] text-slate-600 mt-0.5">
          Column percentages represent cap rates at exit.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800">
              <th className="text-left py-2 pr-4 font-medium">Price</th>
              {capRates.map((cap) => (
                <th key={cap} className="text-center py-2 px-2 font-medium">
                  <span className="block text-[10px] text-slate-600">Cap Rate</span>
                  {(cap * 100).toFixed(1)}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {priceDeltas.map((delta) => (
              <tr key={delta} className="border-b border-slate-800/50">
                <td className="py-1.5 pr-4 text-xs text-slate-300 whitespace-nowrap">
                  {fmtPrice(basePurchasePrice, delta)}
                  <span className="text-slate-600 ml-1">
                    ({delta >= 0 ? "+" : ""}
                    {(delta * 100).toFixed(0)}%)
                  </span>
                </td>
                {capRates.map((cap) => {
                  const cell = getCell(delta, cap);
                  const isBase = Math.abs(delta) < 0.001 && sensitivity.length > 0;
                  return (
                    <td
                      key={cap}
                      className={`text-center py-1.5 px-2 text-xs tabular-nums rounded ${irrColor(cell?.irr ?? null)} ${
                        isBase ? "font-semibold" : ""
                      }`}
                    >
                      {fmtPct(cell?.irr ?? null)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
