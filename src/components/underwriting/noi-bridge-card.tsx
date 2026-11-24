"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { NoiBridgeTable } from "./noi-bridge-table";
import { applyBridgeTag, buildNoiBridge, type BridgeTag, type NoiBridge } from "@/lib/noi-bridge";
import { scenarioToInputs } from "@/lib/scenario-inputs";
import type { Deal, Scenario } from "@/lib/validations";

/**
 * Change C: documented vs plan NOI bridge on the Underwrite page. The bridge rows are
 * cheap (a handful of engine runs) and render at once; the two price solves (~100
 * runs) are deferred so the page paints first.
 */
export function NoiBridgeCard({
  deal,
  scenario,
  onUpdate,
}: {
  deal: Deal;
  scenario: Scenario;
  onUpdate: (updates: Partial<Scenario>) => void;
}) {
  const targetIrr = ((scenario.pricing_views ?? {}) as { target_irr?: number }).target_irr;
  const bridge = useMemo<NoiBridge | null>(() => {
    try {
      return buildNoiBridge(scenarioToInputs(scenario, deal), { deal, target_irr: targetIrr, solvePrices: false });
    } catch {
      return null;
    }
  }, [scenario, deal, targetIrr]);

  const [prices, setPrices] = useState<{ for: NoiBridge; documented: number | null; plan: number | null } | null>(null);
  useEffect(() => {
    if (!bridge) return;
    const t = setTimeout(() => {
      try {
        const full = buildNoiBridge(scenarioToInputs(scenario, deal), { deal, target_irr: targetIrr });
        setPrices({ for: bridge, documented: full.price_documented, plan: full.price_with_plan });
      } catch {
        setPrices({ for: bridge, documented: null, plan: null });
      }
    }, 50);
    return () => clearTimeout(t);
  }, [bridge, scenario, deal, targetIrr]);

  if (!bridge) return null;
  const pending = prices?.for !== bridge;
  const shown: NoiBridge = pending ? bridge : { ...bridge, price_documented: prices!.documented, price_with_plan: prices!.plan };

  const onTag = (key: string, tag: BridgeTag) => onUpdate(applyBridgeTag(scenario, key, tag) as Partial<Scenario>);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="text-white text-base font-semibold">NOI Bridge: documented vs plan</h3>
          <p className="text-xs text-slate-500">
            Pay for what is documented today; what the plan adds is our profit. Each plan line is its Year-1 NOI effect,
            removed one at a time. Tag every purple line.
          </p>
        </div>
        <NoiBridgeTable bridge={shown} onTag={onTag} pricesPending={pending} />
      </CardContent>
    </Card>
  );
}
