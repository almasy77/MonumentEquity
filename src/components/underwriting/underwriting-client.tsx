"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Loader2, AlertTriangle, Download } from "lucide-react";
import { MetricsBar } from "./metrics-bar";
import { AssumptionsForm } from "./assumptions-form";
import { ProFormaTable } from "./pro-forma-table";
import { SensitivityGrid } from "./sensitivity-grid";
import type { Deal, Scenario } from "@/lib/validations";
import type { UnderwritingResult, ScenarioInputs } from "@/lib/underwriting";

interface ScenarioWithResult {
  scenario: Scenario;
  underwriting: UnderwritingResult;
}

export function UnderwritingClient({
  deal,
  initialScenarios,
}: {
  deal: Deal;
  initialScenarios: Scenario[];
}) {
  const [scenarios, setScenarios] = useState<Scenario[]>(initialScenarios);
  const [activeId, setActiveId] = useState<string | null>(
    initialScenarios[0]?.id ?? null
  );
  const [activeResult, setActiveResult] = useState<UnderwritingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadScenario = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/scenarios/${id}`);
      if (res.ok) {
        const data: ScenarioWithResult = await res.json();
        setActiveResult(data.underwriting);
        // Update the scenario in our list
        setScenarios((prev) =>
          prev.map((s) => (s.id === id ? data.scenario : s))
        );
      }
    } catch (err) {
      console.error("Failed to load scenario:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeId) {
      loadScenario(activeId);
    }
  }, [activeId, loadScenario]);

  async function createScenario(type: string = "base") {
    setCreating(true);
    try {
      const names: Record<string, string> = {
        base: "Base Case",
        upside: "Upside",
        downside: "Downside",
        value_add: "Value-Add",
        sale: "Sale Analysis",
        custom: "Custom",
      };

      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: deal.id,
          name: names[type] || "Base Case",
          type,
        }),
      });

      if (res.ok) {
        const data: ScenarioWithResult = await res.json();
        setScenarios((prev) => [...prev, data.scenario]);
        setActiveId(data.scenario.id);
        setActiveResult(data.underwriting);
      }
    } catch (err) {
      console.error("Failed to create scenario:", err);
    } finally {
      setCreating(false);
    }
  }

  async function updateScenario(updates: Partial<Record<string, unknown>>) {
    if (!activeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/scenarios/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        const data: ScenarioWithResult = await res.json();
        setScenarios((prev) =>
          prev.map((s) => (s.id === activeId ? data.scenario : s))
        );
        setActiveResult(data.underwriting);
      }
    } catch (err) {
      console.error("Failed to update scenario:", err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteScenario(id: string) {
    try {
      await fetch(`/api/scenarios/${id}`, { method: "DELETE" });
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        const remaining = scenarios.filter((s) => s.id !== id);
        setActiveId(remaining[0]?.id ?? null);
        setActiveResult(null);
      }
    } catch (err) {
      console.error("Failed to delete scenario:", err);
    }
  }

  const activeScenario = scenarios.find((s) => s.id === activeId);

  return (
    <div className="space-y-4">
      {/* Scenario Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeId === s.id
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
            }`}
          >
            {s.name}
          </button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => createScenario("base")}
          disabled={creating}
          className="border-slate-700 text-slate-400 hover:bg-slate-800"
        >
          {creating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <Plus className="h-3 w-3 mr-1" /> Scenario
            </>
          )}
        </Button>
        {activeId && activeResult && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.open(
                `/api/export/${deal.id}?scenario_id=${activeId}`,
                "_blank"
              );
            }}
            className="border-slate-700 text-green-400 hover:bg-green-900/20 ml-auto"
          >
            <Download className="h-3 w-3 mr-1" /> Export Excel
          </Button>
        )}
      </div>

      {/* No scenarios yet */}
      {scenarios.length === 0 && !creating && (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-8 text-center">
            <p className="text-slate-400 mb-4">
              No underwriting scenarios yet. Create one to start analyzing this deal.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {["base", "value_add", "sale"].map((type) => (
                <Button
                  key={type}
                  onClick={() => createScenario(type)}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {type === "base"
                    ? "Base Case"
                    : type === "value_add"
                      ? "Value-Add"
                      : "Sale Analysis"}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Scenario Content */}
      {activeScenario && activeResult && (
        <>
          {/* Warnings */}
          {activeResult.warnings.length > 0 && (
            <Card className="bg-yellow-900/20 border-yellow-700/50">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    {activeResult.warnings.map((w, i) => (
                      <p key={i} className="text-sm text-yellow-300">
                        {w}
                      </p>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Key Metrics */}
          <MetricsBar metrics={activeResult.metrics} />

          {/* Assumptions Form */}
          <AssumptionsForm
            scenario={activeScenario}
            onUpdate={updateScenario}
            onDelete={() => deleteScenario(activeScenario.id)}
            loading={loading}
          />

          {/* Pro Forma */}
          <ProFormaTable
            monthly={activeResult.monthly}
            annual={activeResult.annual}
          />

          {/* Sensitivity */}
          <SensitivityGrid
            sensitivity={activeResult.sensitivity}
            basePurchasePrice={
              (activeScenario.purchase_assumptions as { purchase_price?: number })
                ?.purchase_price ?? deal.asking_price
            }
          />
        </>
      )}

      {/* Loading state */}
      {loading && !activeResult && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
        </div>
      )}
    </div>
  );
}
