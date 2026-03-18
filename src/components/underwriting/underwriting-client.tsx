"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Loader2, AlertTriangle, Download, Archive, Trash2, MoreVertical, Eye, EyeOff, Save, Settings2 } from "lucide-react";
import { MetricsBar } from "./metrics-bar";
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
    initialScenarios.find((s) => s.is_active !== false)?.id ?? null
  );
  const [activeResult, setActiveResult] = useState<UnderwritingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: "delete" | "archive" } | null>(null);

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

  async function archiveScenario(id: string) {
    try {
      const res = await fetch(`/api/scenarios/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false }),
      });
      if (res.ok) {
        setScenarios((prev) =>
          prev.map((s) => (s.id === id ? { ...s, is_active: false } : s))
        );
        if (activeId === id) {
          const remaining = scenarios.filter((s) => s.id !== id && s.is_active !== false);
          setActiveId(remaining[0]?.id ?? null);
          setActiveResult(null);
        }
      }
    } catch (err) {
      console.error("Failed to archive scenario:", err);
    }
  }

  async function unarchiveScenario(id: string) {
    try {
      const res = await fetch(`/api/scenarios/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      if (res.ok) {
        setScenarios((prev) =>
          prev.map((s) => (s.id === id ? { ...s, is_active: true } : s))
        );
      }
    } catch (err) {
      console.error("Failed to unarchive scenario:", err);
    }
  }

  async function deleteScenario(id: string) {
    try {
      await fetch(`/api/scenarios/${id}`, { method: "DELETE" });
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        const remaining = scenarios.filter((s) => s.id !== id && s.is_active !== false);
        setActiveId(remaining[0]?.id ?? null);
        setActiveResult(null);
      }
    } catch (err) {
      console.error("Failed to delete scenario:", err);
    }
  }

  function handleConfirmedAction() {
    if (!confirmAction) return;
    if (confirmAction.type === "delete") {
      deleteScenario(confirmAction.id);
    } else {
      archiveScenario(confirmAction.id);
    }
    setConfirmAction(null);
    setMenuOpenId(null);
  }

  const activeScenario = scenarios.find((s) => s.id === activeId);
  const activeScenarios = scenarios.filter((s) => s.is_active !== false);
  const archivedScenarios = scenarios.filter((s) => s.is_active === false);
  const visibleScenarios = showArchived ? scenarios : activeScenarios;

  return (
    <div className="space-y-4">
      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setConfirmAction(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-medium mb-2">
              {confirmAction.type === "delete" ? "Delete Scenario" : "Archive Scenario"}
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              {confirmAction.type === "delete"
                ? "This will permanently delete this scenario and all its data. This cannot be undone."
                : "This will archive the scenario. You can restore it later from the archived list."}
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction(null)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmedAction}
                className={confirmAction.type === "delete" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-yellow-600 hover:bg-yellow-700 text-white"}
              >
                {confirmAction.type === "delete" ? "Delete" : "Archive"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Scenario Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {visibleScenarios.map((s) => (
          <div key={s.id} className="relative">
            <div className="flex items-center">
              <button
                onClick={() => { if (s.is_active !== false) setActiveId(s.id); }}
                className={`px-3 py-1.5 text-sm rounded-l-md transition-colors ${
                  s.is_active === false
                    ? "bg-slate-800/50 text-slate-600 line-through"
                    : activeId === s.id
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                {s.name}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === s.id ? null : s.id); }}
                className={`px-1 py-1.5 text-sm rounded-r-md border-l transition-colors ${
                  s.is_active === false
                    ? "bg-slate-800/50 text-slate-600 border-slate-700/50"
                    : activeId === s.id
                      ? "bg-blue-600 text-white/70 hover:text-white border-blue-500"
                      : "bg-slate-800 text-slate-500 hover:text-slate-300 border-slate-700"
                }`}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Context Menu */}
            {menuOpenId === s.id && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpenId(null)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1 min-w-[140px]">
                  {s.is_active === false ? (
                    <>
                      <button
                        onClick={() => { unarchiveScenario(s.id); setMenuOpenId(null); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 text-left"
                      >
                        <Eye className="h-3.5 w-3.5" /> Restore
                      </button>
                      <button
                        onClick={() => { setConfirmAction({ id: s.id, type: "delete" }); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-slate-700 text-left"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete Forever
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setConfirmAction({ id: s.id, type: "archive" }); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-yellow-400 hover:bg-slate-700 text-left"
                      >
                        <Archive className="h-3.5 w-3.5" /> Archive
                      </button>
                      <button
                        onClick={() => { setConfirmAction({ id: s.id, type: "delete" }); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-slate-700 text-left"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
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
        {archivedScenarios.length > 0 && (
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 ml-1"
          >
            {showArchived ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showArchived ? "Hide" : "Show"} archived ({archivedScenarios.length})
          </button>
        )}
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
            <p className="text-slate-400 mb-3">
              No underwriting scenarios yet. Create one to analyze this deal.
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Scenarios let you compare different assumptions — rent growth, expense escalation, vacancy, and exit cap rates.
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {[
                { type: "base", label: "Base Case", desc: "3% rent growth, 2% expense escalation" },
                { type: "upside", label: "Upside", desc: "5% rent growth, 1.5% expense escalation" },
                { type: "downside", label: "Downside", desc: "1% rent growth, 3% expense escalation" },
              ].map(({ type, label, desc }) => (
                <div key={type} className="text-center">
                  <Button
                    onClick={() => createScenario(type)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-1" /> {label}
                  </Button>
                  <p className="text-[10px] text-slate-500 mt-1">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Scenario Content */}
      {activeScenario && activeResult && (
        <ScenarioAnalysis
          scenario={activeScenario}
          result={activeResult}
          deal={deal}
          loading={loading}
          onUpdate={updateScenario}
        />
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

// ─── Scenario Analysis Sub-Component ─────────────────────────

interface RevenueAssumptions {
  vacancy_rate?: number;
  bad_debt_rate?: number;
  rent_growth_rate?: number;
}

interface ExpenseAssumptions {
  tax_escalation_rate?: number;
  management_fee_rate?: number;
}

interface ExitAssumptions {
  hold_period_years?: number;
  exit_cap_rate?: number;
  selling_cost_rate?: number;
}

function ScenarioAnalysis({
  scenario,
  result,
  deal,
  loading,
  onUpdate,
}: {
  scenario: Scenario;
  result: UnderwritingResult;
  deal: Deal;
  loading: boolean;
  onUpdate: (updates: Partial<Record<string, unknown>>) => Promise<void>;
}) {
  const revenue = (scenario.revenue_assumptions ?? {}) as RevenueAssumptions;
  const expenses = (scenario.expense_assumptions ?? {}) as ExpenseAssumptions;
  const exit = (scenario.exit_assumptions ?? {}) as ExitAssumptions;

  const [rentGrowth, setRentGrowth] = useState((revenue.rent_growth_rate ?? 0.03) * 100);
  const [taxEscalation, setTaxEscalation] = useState((expenses.tax_escalation_rate ?? 0.02) * 100);
  const [vacancy, setVacancy] = useState((revenue.vacancy_rate ?? 0.07) * 100);
  const [exitCap, setExitCap] = useState((exit.exit_cap_rate ?? 0.07) * 100);
  const [holdPeriod, setHoldPeriod] = useState(exit.hold_period_years ?? 5);
  const [dirty, setDirty] = useState(false);

  // Reset local state when scenario changes
  useEffect(() => {
    const rev = (scenario.revenue_assumptions ?? {}) as RevenueAssumptions;
    const exp = (scenario.expense_assumptions ?? {}) as ExpenseAssumptions;
    const ex = (scenario.exit_assumptions ?? {}) as ExitAssumptions;
    setRentGrowth((rev.rent_growth_rate ?? 0.03) * 100);
    setTaxEscalation((exp.tax_escalation_rate ?? 0.02) * 100);
    setVacancy((rev.vacancy_rate ?? 0.07) * 100);
    setExitCap((ex.exit_cap_rate ?? 0.07) * 100);
    setHoldPeriod(ex.hold_period_years ?? 5);
    setDirty(false);
  }, [scenario.id, scenario.revenue_assumptions, scenario.expense_assumptions, scenario.exit_assumptions]);

  async function recalculate() {
    await onUpdate({
      revenue_assumptions: {
        ...revenue,
        rent_growth_rate: rentGrowth / 100,
        vacancy_rate: vacancy / 100,
      },
      expense_assumptions: {
        ...expenses,
        tax_escalation_rate: taxEscalation / 100,
      },
      exit_assumptions: {
        ...exit,
        exit_cap_rate: exitCap / 100,
        hold_period_years: holdPeriod,
      },
    });
    setDirty(false);
  }

  return (
    <div className="space-y-4">
      {/* Warnings */}
      {result.warnings.length > 0 && (
        <Card className="bg-yellow-900/20 border-yellow-700/50">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <div className="space-y-1">
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-sm text-yellow-300">{w}</p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scenario Key Assumptions — quick edit */}
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-blue-400" />
              <h3 className="text-sm font-medium text-white">Scenario Assumptions</h3>
              <span className="text-xs text-slate-500">— adjust to compare outcomes</span>
            </div>
            {dirty && (
              <Button
                onClick={recalculate}
                disabled={loading}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <Save className="h-3 w-3 mr-1" /> Recalculate
                  </>
                )}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div>
              <Label className="text-xs text-slate-400">Rent Growth <span className="text-slate-600">%/yr</span></Label>
              <Input
                type="number"
                value={rentGrowth || ""}
                onChange={(e) => { setRentGrowth(parseFloat(e.target.value) || 0); setDirty(true); }}
                step="0.5"
                className="bg-slate-800 border-slate-700 text-white text-sm h-8"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Expense Escalation <span className="text-slate-600">%/yr</span></Label>
              <Input
                type="number"
                value={taxEscalation || ""}
                onChange={(e) => { setTaxEscalation(parseFloat(e.target.value) || 0); setDirty(true); }}
                step="0.5"
                className="bg-slate-800 border-slate-700 text-white text-sm h-8"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Vacancy <span className="text-slate-600">%</span></Label>
              <Input
                type="number"
                value={vacancy || ""}
                onChange={(e) => { setVacancy(parseFloat(e.target.value) || 0); setDirty(true); }}
                step="0.5"
                className="bg-slate-800 border-slate-700 text-white text-sm h-8"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Exit Cap Rate <span className="text-slate-600">%</span></Label>
              <Input
                type="number"
                value={exitCap || ""}
                onChange={(e) => { setExitCap(parseFloat(e.target.value) || 0); setDirty(true); }}
                step="0.25"
                className="bg-slate-800 border-slate-700 text-white text-sm h-8"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Hold Period <span className="text-slate-600">yrs</span></Label>
              <Input
                type="number"
                value={holdPeriod || ""}
                onChange={(e) => { setHoldPeriod(parseInt(e.target.value) || 5); setDirty(true); }}
                min="1"
                max="30"
                className="bg-slate-800 border-slate-700 text-white text-sm h-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <MetricsBar metrics={result.metrics} />

      {/* Pro Forma */}
      <ProFormaTable
        monthly={result.monthly}
        annual={result.annual}
      />

      {/* Sensitivity */}
      <SensitivityGrid
        sensitivity={result.sensitivity}
        basePurchasePrice={
          (scenario.purchase_assumptions as { purchase_price?: number })
            ?.purchase_price ?? deal.asking_price
        }
      />
    </div>
  );
}
