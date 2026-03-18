"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Loader2, Archive, Trash2, MoreVertical, Eye, EyeOff } from "lucide-react";
import { AssumptionsForm } from "@/components/underwriting/assumptions-form";
import type { Deal, Scenario } from "@/lib/validations";
import type { UnderwritingResult } from "@/lib/underwriting";

interface ScenarioWithResult {
  scenario: Scenario;
  underwriting: UnderwritingResult;
}

export function DealAssumptionsPanel({
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
    <div className="space-y-3">
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
        <span className="text-sm font-medium text-slate-300 mr-1">Scenarios:</span>
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

      {/* Active Scenario Assumptions */}
      {activeScenario && (
        <AssumptionsForm
          scenario={activeScenario}
          onUpdate={updateScenario}
          onDelete={() => deleteScenario(activeScenario.id)}
          loading={loading}
        />
      )}

      {/* Loading state */}
      {loading && !activeScenario && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
        </div>
      )}
    </div>
  );
}
