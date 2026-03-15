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
}

const DEFAULT_FACTORS: QualFactor[] = [
  { label: "Location fit for first deal", weight: 0.15, score: 3 },
  { label: "Value-add clarity", weight: 0.15, score: 3 },
  { label: "Seller record quality", weight: 0.15, score: 3 },
  { label: "Physical risk (reverse-scored)", weight: 0.15, score: 3 },
  { label: "Tenant stability", weight: 0.10, score: 3 },
  { label: "Management simplicity", weight: 0.10, score: 3 },
  { label: "Exit / liquidity", weight: 0.10, score: 3 },
  { label: "Broker / PM confidence", weight: 0.10, score: 3 },
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
  const [occupancy, setOccupancy] = useState(0.92);

  // Find neighborhood match
  const neighborhood = DURHAM_NEIGHBORHOODS.find((n) =>
    deal.city.toLowerCase().includes("durham") &&
    (deal.address.toLowerCase().includes(n.name.toLowerCase().split(" / ")[0]) ||
     deal.address.toLowerCase().includes(n.name.toLowerCase()))
  );
  const [neighborhoodScore, setNeighborhoodScore] = useState(
    neighborhood?.score || 7.0
  );

  // Qualitative score (0-100)
  const qualScore = factors.reduce(
    (sum, f) => sum + f.score * f.weight * 20,
    0
  );

  // Hard gates
  const pricePerUnit = deal.units > 0 ? deal.asking_price / deal.units : 0;
  const gates = [
    {
      label: "Units within buy box",
      pass: deal.units >= BUY_BOX.min_units && deal.units <= BUY_BOX.max_units,
    },
    { label: "Rehab / unit within limit", pass: rehabPerUnit <= BUY_BOX.max_rehab_per_unit },
    { label: "DSCR above minimum", pass: dscr >= BUY_BOX.min_dscr },
    { label: "Stabilized yield above minimum", pass: stabilizedYield >= BUY_BOX.min_yield_on_cost },
    { label: "Neighborhood score above minimum", pass: neighborhoodScore >= BUY_BOX.min_neighborhood_score },
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

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">Buy Box Scorecard</CardTitle>
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
          <p className="text-xs text-slate-400 mb-2">
            Qualitative Factors (1=bad, 5=excellent)
          </p>
          <div className="space-y-1.5">
            {factors.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 flex-1">{f.label}</span>
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

        {/* Hard Gates */}
        <div>
          <p className="text-xs text-slate-400 mb-2">Hard Gates</p>
          <div className="space-y-1">
            {gates.map((g, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
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
              </div>
            ))}
          </div>
        </div>

        {/* Score Summary */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div className="text-sm">
            <span className="text-slate-500">Qualitative: </span>
            <span className="text-white font-medium">{qualScore.toFixed(0)}/100</span>
            {failedGates > 0 && (
              <span className="text-red-400 ml-2">
                ({failedGates} gate{failedGates !== 1 ? "s" : ""} failed)
              </span>
            )}
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Score: </span>
            <span className="text-white font-bold">{finalScore.toFixed(0)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
