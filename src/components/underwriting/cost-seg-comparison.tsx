"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { scenarioToInputs } from "@/lib/scenario-inputs";
import { compareCostSegScenarios } from "@/lib/tax-comparison";
import type { Scenario } from "@/lib/validations";

const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const usd = (n: number | null) => (n === null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

/**
 * Side-by-side: no cost seg / cost seg with REPS / cost seg without REPS.
 * Read-only lens over the saved scenario; hurdles stay on pre-tax IRR.
 */
export function CostSegComparison({ scenario }: { scenario: Scenario }) {
  const comparison = useMemo(() => {
    try {
      return compareCostSegScenarios(scenarioToInputs(scenario));
    } catch {
      return null;
    }
  }, [scenario]);

  if (!comparison) return null;
  const { rows, exit_via_1031 } = comparison;
  const asModeled = rows[0];
  const noSeg = rows.find((r) => r.key === "no_cost_seg")!;
  const reps = rows.find((r) => r.key === "cost_seg_reps")!;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-white text-base font-semibold">Cost Seg vs. REPS</h3>
          <span className="text-[10px] text-slate-500 italic">Estimate only. Not tax advice. Review with CPA.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left py-1.5 pr-3 font-medium">Case</th>
                <th className="text-right py-1.5 px-2 font-medium">Pre-Tax IRR</th>
                <th className="text-right py-1.5 px-2 font-medium">After-Tax IRR</th>
                <th className="text-right py-1.5 px-2 font-medium">Yr-1 Dep. Shield</th>
                <th className="text-right py-1.5 px-2 font-medium">Hold Dep. Shield</th>
                <th className="text-right py-1.5 px-2 font-medium">{exit_via_1031 ? "Deferred Gain" : "Exit Tax"}</th>
                <th className="text-right py-1.5 px-2 font-medium">Suspended PAL at Exit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`border-b border-slate-800/50 tabular-nums ${r.key === "as_modeled" ? "text-white font-medium" : "text-slate-300"}`}>
                  <td className="py-1 pr-3">{r.label}</td>
                  <td className="py-1 px-2 text-right">{pct(r.pre_tax_irr)}</td>
                  <td className="py-1 px-2 text-right">{pct(r.after_tax_irr_household)}</td>
                  <td className="py-1 px-2 text-right text-emerald-400">{usd(r.year1_depreciation_shield)}</td>
                  <td className="py-1 px-2 text-right text-emerald-400">{usd(r.total_depreciation_shield)}</td>
                  <td className="py-1 px-2 text-right text-amber-400">{usd(exit_via_1031 ? r.deferred_gain : r.exit_tax)}</td>
                  <td className="py-1 px-2 text-right text-slate-400">{usd(r.pal_at_exit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">
          Cost seg cases use {(comparison.costseg_5yr_pct * 100).toFixed(0)}% 5-yr and {(comparison.costseg_15yr_pct * 100).toFixed(0)}% 15-yr reclass
          {comparison.used_default_pcts ? " (app defaults, since this scenario has none set)" : ""}. &quot;No cost seg&quot; also drops the study fee
          ({usd(asModeled.cost_seg_study_cost)} as modeled). With REPS, the study adds {usd(reps.year1_depreciation_shield - noSeg.year1_depreciation_shield)} of
          Year-1 shield over no study. Without REPS, losses are suspended as passive{exit_via_1031 ? " and a 1031 does not release them" : " until sale"}.
          Return hurdles are still tested on pre-tax IRR.
        </p>
      </CardContent>
    </Card>
  );
}
