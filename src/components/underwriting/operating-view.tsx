"use client";

import { Card, CardContent } from "@/components/ui/card";
import { computeOperatingMetrics } from "@/lib/operating-metrics";
import type { UnderwritingResult } from "@/lib/underwriting";

const pct = (v: number, dp = 2) => `${(v * 100).toFixed(dp)}%`;
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

/**
 * Operations (hold-forever) view — how the deal performs on OPERATIONS alone,
 * with no sale assumption. For a long-term hold, IRR is dominated by a
 * speculative terminal value; these are the figures a perpetual holder tracks.
 */
export function OperatingView({
  result,
  marketCapRate,
}: {
  result: UnderwritingResult;
  marketCapRate: number;
}) {
  const op = computeOperatingMetrics(result, marketCapRate);
  if (op.rows.length === 0) return null;

  const spreadPositive = op.yield_spread_bps >= 0;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-white text-base font-semibold">Operations (Hold-Forever)</h3>
          <span className="text-[10px] text-slate-500 italic">operating return only — no sale assumed</span>
        </div>

        {/* Headline tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-slate-800/60 rounded p-2.5 text-center ring-1 ring-blue-500/50">
            <div className="text-xs text-blue-300 mb-0.5 font-medium">Stabilized Yield-on-Cost</div>
            <div className="text-sm text-white font-bold tabular-nums">{pct(op.stabilized_yield_on_cost)}</div>
            <div className="text-[10px] text-blue-400/70 mt-0.5">going-in {pct(op.going_in_yield_on_cost)}</div>
          </div>
          <div className={`bg-slate-800/50 rounded p-2.5 text-center ring-1 ${spreadPositive ? "ring-emerald-500/40" : "ring-red-500/40"}`}>
            <div className="text-xs text-slate-400 mb-0.5">Spread vs Market Cap</div>
            <div className={`text-sm font-bold tabular-nums ${spreadPositive ? "text-emerald-400" : "text-red-400"}`}>
              {spreadPositive ? "+" : ""}{op.yield_spread_bps} bps
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">vs {pct(op.market_cap_rate)} exit cap</div>
          </div>
          <div className="bg-slate-800/50 rounded p-2.5 text-center">
            <div className="text-xs text-slate-400 mb-0.5">Avg Cash-on-Cash</div>
            <div className="text-sm text-white font-semibold tabular-nums">{pct(op.avg_cash_on_cash)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">yr1 {pct(op.rows[0].cash_on_cash)}</div>
          </div>
          <div className="bg-slate-800/50 rounded p-2.5 text-center">
            <div className="text-xs text-slate-400 mb-0.5">Yrs to Return Capital</div>
            <div className="text-sm text-white font-semibold tabular-nums">
              {op.years_to_return_capital != null ? `${op.years_to_return_capital} yr` : "beyond hold"}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">from operations only</div>
          </div>
          <div className="bg-slate-800/50 rounded p-2.5 text-center">
            <div className="text-xs text-slate-400 mb-0.5">All-in Basis</div>
            <div className="text-sm text-white font-semibold tabular-nums">{money(op.total_cost)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">equity {money(op.invested_equity)}</div>
          </div>
        </div>

        {/* Per-year operating table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="text-left font-medium py-1.5 pr-3">Year</th>
                <th className="text-right font-medium py-1.5 px-2">NOI</th>
                <th className="text-right font-medium py-1.5 px-2">Yield-on-Cost</th>
                <th className="text-right font-medium py-1.5 px-2">Cash-on-Cash</th>
                <th className="text-right font-medium py-1.5 px-2">Debt Yield</th>
                <th className="text-right font-medium py-1.5 px-2">DSCR</th>
                <th className="text-right font-medium py-1.5 px-2">ROE</th>
                <th className="text-right font-medium py-1.5 px-2">Cum. Op. Multiple</th>
                <th className="text-right font-medium py-1.5 pl-2">Break-even Occ.</th>
              </tr>
            </thead>
            <tbody>
              {op.rows.map((r) => (
                <tr key={r.year} className="border-b border-slate-800/50 text-slate-200">
                  <td className="text-left py-1.5 pr-3 text-slate-400">Yr {r.year}</td>
                  <td className="text-right py-1.5 px-2">{money(r.noi)}</td>
                  <td className="text-right py-1.5 px-2">{pct(r.yield_on_cost)}</td>
                  <td className="text-right py-1.5 px-2">{pct(r.cash_on_cash)}</td>
                  <td className="text-right py-1.5 px-2">{pct(r.debt_yield)}</td>
                  <td className={`text-right py-1.5 px-2 ${r.dscr < 1 ? "text-red-400" : ""}`}>{r.dscr.toFixed(2)}x</td>
                  <td className="text-right py-1.5 px-2">{r.equity_value > 0 ? pct(r.return_on_equity) : "—"}</td>
                  <td className="text-right py-1.5 px-2">{r.cumulative_operating_multiple.toFixed(2)}x</td>
                  <td className="text-right py-1.5 pl-2">{r.breakeven_occupancy > 0 ? pct(r.breakeven_occupancy, 0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-slate-500 leading-relaxed">
          Yield-on-cost is stabilized NOI over all-in basis; the spread over the market (exit) cap is your margin,
          independent of any sale. Return-on-equity marks equity to market at the exit cap (property value = NOI ÷ cap
          − loan balance), so it drifts down as equity builds — the classic refi/sell signal. Cumulative operating
          multiple is distributions from operations only (no sale). Debt yield uses the amortizing balance; a mid-hold
          refinance re-bases it.
        </p>
      </CardContent>
    </Card>
  );
}
