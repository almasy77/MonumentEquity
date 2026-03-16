"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUY_BOX, DURHAM_NEIGHBORHOODS } from "@/lib/constants";
import type { Deal } from "@/lib/validations";

interface QualFactor {
  label: string;
  weight: number;
  score: number;
  hint: string;
}

interface NeighborhoodFactor {
  label: string;
  weight: number;
  score: number;
}

const DEFAULT_FACTORS: QualFactor[] = [
  { label: "Location fit for first deal", weight: 0.15, score: 3, hint: "Is the neighborhood a target area?" },
  { label: "Value-add clarity", weight: 0.15, score: 3, hint: "Is value-add plan visible within 12 months?" },
  { label: "Seller record quality", weight: 0.15, score: 3, hint: "Are seller records organized and truthful?" },
  { label: "Physical risk (reverse-scored)", weight: 0.15, score: 3, hint: "Major systems condition: roof, plumbing, electrical, HVAC" },
  { label: "Tenant stability", weight: 0.10, score: 3, hint: "Are collections stable? Manageable tenant profile?" },
  { label: "Management simplicity", weight: 0.10, score: 3, hint: "Can a 3rd-party PM take over immediately?" },
  { label: "Exit / liquidity", weight: 0.10, score: 3, hint: "Is there a plausible refinance or sale path?" },
  { label: "Broker / PM confidence", weight: 0.10, score: 3, hint: "Team assessment of deal quality" },
];

const DEFAULT_NEIGHBORHOOD_FACTORS: NeighborhoodFactor[] = [
  { label: "Basis attainability", weight: 0.20, score: 5 },
  { label: "Walkability / infill", weight: 0.15, score: 5 },
  { label: "Employer access (Duke, RTP, Healthcare)", weight: 0.15, score: 5 },
  { label: "Small MF deal availability (6-20 units)", weight: 0.20, score: 5 },
  { label: "Value-add potential", weight: 0.15, score: 5 },
  { label: "Execution ease", weight: 0.15, score: 5 },
];

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function BuyBoxScorecard({ deal }: { deal: Deal }) {
  const [factors, setFactors] = useState<QualFactor[]>(DEFAULT_FACTORS);
  const [rehabPerUnit, setRehabPerUnit] = useState(15000);
  const [inPlaceCap, setInPlaceCap] = useState(0.065);
  const [stabilizedYield, setStabilizedYield] = useState(0.078);
  const [dscr, setDscr] = useState(1.28);
  const [showNeighborhood, setShowNeighborhood] = useState(false);

  // Find neighborhood match
  const neighborhood = DURHAM_NEIGHBORHOODS.find((n) =>
    deal.city.toLowerCase().includes("durham") &&
    (deal.address.toLowerCase().includes(n.name.toLowerCase().split(" / ")[0]) ||
     deal.address.toLowerCase().includes(n.name.toLowerCase()))
  );

  const [neighborhoodScore, setNeighborhoodScore] = useState(
    neighborhood?.score || 7.0
  );
  const [neighborhoodFactors, setNeighborhoodFactors] = useState<NeighborhoodFactor[]>(
    DEFAULT_NEIGHBORHOOD_FACTORS
  );

  // Qualitative score (0-100)
  const qualScore = factors.reduce(
    (sum, f) => sum + f.score * f.weight * 20,
    0
  );

  // Neighborhood composite score (1-10)
  const computedNeighborhoodScore = neighborhoodFactors.reduce(
    (sum, f) => sum + f.score * f.weight * 2,
    0
  );

  // Hard gates
  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;
  const gates = [
    {
      label: `Units within buy box (${BUY_BOX.min_units}–${BUY_BOX.max_units})`,
      pass: deal.units >= BUY_BOX.min_units && deal.units <= BUY_BOX.max_units,
      value: `${deal.units} units`,
    },
    {
      label: `Rehab/unit ≤ $${(BUY_BOX.max_rehab_per_unit / 1000).toFixed(0)}K`,
      pass: rehabPerUnit <= BUY_BOX.max_rehab_per_unit,
      value: `$${(rehabPerUnit / 1000).toFixed(0)}K`,
    },
    {
      label: `DSCR ≥ ${BUY_BOX.min_dscr}`,
      pass: dscr >= BUY_BOX.min_dscr,
      value: dscr.toFixed(2),
    },
    {
      label: `Stabilized yield ≥ ${(BUY_BOX.min_yield_on_cost * 100).toFixed(0)}%`,
      pass: stabilizedYield >= BUY_BOX.min_yield_on_cost,
      value: `${(stabilizedYield * 100).toFixed(1)}%`,
    },
    {
      label: `Neighborhood score ≥ ${BUY_BOX.min_neighborhood_score}`,
      pass: neighborhoodScore >= BUY_BOX.min_neighborhood_score,
      value: neighborhoodScore.toFixed(2),
    },
  ];
  const failedGates = gates.filter((g) => !g.pass).length;

  // Final score
  const finalScore = failedGates > 0 ? Math.max(0, qualScore - failedGates * 15) : qualScore;
  const recommendation =
    failedGates > 1
      ? "PASS"
      : finalScore >= 75
      ? "PURSUE"
      : finalScore >= 50
      ? "MAYBE"
      : "PASS";

  const recColor = {
    PURSUE: "bg-green-600 text-white",
    MAYBE: "bg-yellow-600 text-white",
    PASS: "bg-red-600 text-white",
  }[recommendation];

  function updateFactor(idx: number, score: number) {
    setFactors((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, score: Math.min(5, Math.max(1, score)) } : f))
    );
  }

  function updateNeighborhoodFactor(idx: number, score: number) {
    setNeighborhoodFactors((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, score: Math.min(10, Math.max(1, score)) } : f))
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white text-base">Buy Box Scorecard</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              {BUY_BOX.decision_rule}
            </p>
          </div>
          <Badge className={`${recColor} text-sm px-3`}>{recommendation}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Deal Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <span className="text-slate-500">Units</span>
            <p className="text-white font-medium">{deal.units}</p>
          </div>
          <div>
            <span className="text-slate-500">Price / Unit</span>
            <p className="text-white font-medium">{formatCurrency(pricePerUnit)}</p>
          </div>
          <div>
            <Label className="text-slate-500 text-xs">Est. Rehab / Unit</Label>
            <Input
              type="number"
              value={rehabPerUnit}
              onChange={(e) => setRehabPerUnit(Number(e.target.value))}
              className="bg-slate-800 border-slate-700 text-white h-8 text-sm mt-0.5"
            />
          </div>
          <div>
            <Label className="text-slate-500 text-xs">Neighborhood Score</Label>
            <Input
              type="number"
              step="0.1"
              value={neighborhoodScore}
              onChange={(e) => setNeighborhoodScore(Number(e.target.value))}
              className="bg-slate-800 border-slate-700 text-white h-8 text-sm mt-0.5"
            />
            {neighborhood && (
              <p className="text-[10px] text-blue-400 mt-0.5">
                Matched: {neighborhood.name} (Tier {neighborhood.tier})
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <Label className="text-slate-500 text-xs">In-Place Cap</Label>
            <Input
              type="number"
              step="0.001"
              value={inPlaceCap}
              onChange={(e) => setInPlaceCap(Number(e.target.value))}
              className="bg-slate-800 border-slate-700 text-white h-8 text-sm mt-0.5"
            />
          </div>
          <div>
            <Label className="text-slate-500 text-xs">Stabilized Yield</Label>
            <Input
              type="number"
              step="0.001"
              value={stabilizedYield}
              onChange={(e) => setStabilizedYield(Number(e.target.value))}
              className="bg-slate-800 border-slate-700 text-white h-8 text-sm mt-0.5"
            />
          </div>
          <div>
            <Label className="text-slate-500 text-xs">DSCR</Label>
            <Input
              type="number"
              step="0.01"
              value={dscr}
              onChange={(e) => setDscr(Number(e.target.value))}
              className="bg-slate-800 border-slate-700 text-white h-8 text-sm mt-0.5"
            />
          </div>
        </div>

        {/* Qualitative Factors */}
        <div>
          <p className="text-xs text-slate-400 mb-2 font-medium">
            Qualitative Factors (1=bad, 5=excellent)
          </p>
          <div className="space-y-1.5">
            {factors.map((f, i) => (
              <div key={i} className="flex items-center gap-3 group">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-slate-400">{f.label}</span>
                  <span className="text-[10px] text-slate-600 ml-1 hidden group-hover:inline">
                    — {f.hint}
                  </span>
                </div>
                <span className="text-[10px] text-slate-600 w-8 text-right">
                  {Math.round(f.weight * 100)}%
                </span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => updateFactor(i, n)}
                      className={`w-6 h-6 rounded text-xs font-medium transition-colors ${
                        n <= f.score
                          ? "bg-blue-600 text-white"
                          : "bg-slate-800 text-slate-500 hover:bg-slate-700"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Neighborhood Deep Dive (collapsible) */}
        <div className="border-t border-slate-800 pt-3">
          <button
            onClick={() => setShowNeighborhood(!showNeighborhood)}
            className="text-xs text-blue-400 hover:text-blue-300 font-medium"
          >
            {showNeighborhood ? "▾" : "▸"} Neighborhood Deep Dive (computed: {computedNeighborhoodScore.toFixed(2)}/10)
          </button>
          {showNeighborhood && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px] text-slate-500">
                Rate each factor 1-10 based on your knowledge of the neighborhood.
                Composite score can be applied to the Neighborhood Score above.
              </p>
              {neighborhoodFactors.map((f, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 flex-1">{f.label}</span>
                  <span className="text-[10px] text-slate-600 w-8 text-right">
                    {Math.round(f.weight * 100)}%
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={f.score}
                    onChange={(e) => updateNeighborhoodFactor(i, Number(e.target.value))}
                    className="bg-slate-800 border-slate-700 text-white h-7 w-14 text-xs text-center"
                  />
                </div>
              ))}
              <button
                onClick={() => setNeighborhoodScore(Number(computedNeighborhoodScore.toFixed(2)))}
                className="text-xs text-green-400 hover:text-green-300 mt-1"
              >
                Apply computed score ({computedNeighborhoodScore.toFixed(2)}) →
              </button>
            </div>
          )}
        </div>

        {/* Hard Gates */}
        <div>
          <p className="text-xs text-slate-400 mb-2 font-medium">Hard Gates</p>
          <div className="space-y-1">
            {gates.map((g, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                    g.pass
                      ? "bg-green-900 text-green-400"
                      : "bg-red-900 text-red-400"
                  }`}
                >
                  {g.pass ? "✓" : "✗"}
                </span>
                <span className={g.pass ? "text-slate-400" : "text-red-400"}>
                  {g.label}
                </span>
                <span className="text-slate-600 ml-auto">{g.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Buy box criteria */}
        <div className="text-[10px] text-slate-600 space-y-0.5 border-t border-slate-800 pt-2">
          <p><strong>Asset:</strong> {BUY_BOX.asset_condition}</p>
          <p><strong>Scope:</strong> {BUY_BOX.work_scope}</p>
          <p><strong>Avoid:</strong> {BUY_BOX.avoid}</p>
          <p><strong>Hold:</strong> {BUY_BOX.hold_period}</p>
        </div>

        {/* Score Summary */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div className="text-sm">
            <span className="text-slate-500">Qualitative: </span>
            <span className="text-white font-medium">{qualScore.toFixed(0)}/100</span>
            {failedGates > 0 && (
              <span className="text-red-400 ml-2">
                ({failedGates} gate{failedGates !== 1 ? "s" : ""} failed, −{failedGates * 15} pts)
              </span>
            )}
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Final: </span>
            <span className="text-white font-bold text-lg">{finalScore.toFixed(0)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
