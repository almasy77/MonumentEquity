"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Loader2, AlertTriangle, Download, Archive, Trash2, MoreVertical, Eye, EyeOff, Copy, Pencil, FileText, Upload } from "lucide-react";
import { useAiChatbot } from "./ai-chatbot-context";
import { AssumptionsForm } from "./assumptions-form";
import { MetricsBar } from "./metrics-bar";
import { ProFormaTable } from "./pro-forma-table";
import { SensitivityGrid } from "./sensitivity-grid";
import type { Deal, Scenario } from "@/lib/validations";
import { resolveProformaBases } from "@/lib/underwriting";
import type { UnderwritingResult, RentBasis, UnrenovatedBasis, RenovatedBasis, ExitAssumptions } from "@/lib/underwriting";
import { uploadFile } from "@/lib/upload-client";

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importing, setImporting] = useState<"rent_roll" | "t12" | null>(null);
  const rentRollInputRef = useRef<HTMLInputElement>(null);
  const t12InputRef = useRef<HTMLInputElement>(null);
  const { setScenarioId, setOnAiResult } = useAiChatbot();

  useEffect(() => {
    setScenarioId(activeId);
    if (activeId) {
      setOnAiResult((data) => {
        setScenarios((prev) =>
          prev.map((s) => (s.id === activeId ? data.scenario : s))
        );
        setActiveResult(data.underwriting);
      });
    } else {
      setOnAiResult(null);
    }
    return () => {
      setScenarioId(null);
      setOnAiResult(null);
    };
  }, [activeId, setScenarioId, setOnAiResult]);

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
      setActiveResult(null);
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

  // applyResult=false is the autosave path: persist the assumptions quietly
  // (no spinner, and crucially do NOT push the recomputed result or the bumped
  // scenario into state — that would reset the form mid-edit and the displayed
  // KPIs would jump on every keystroke). The form stays the source of truth
  // until the user explicitly hits "Refresh KPIs" (applyResult=true).
  async function updateScenario(
    updates: Partial<Record<string, unknown>>,
    opts?: { applyResult?: boolean },
  ) {
    if (!activeId) return;
    const applyResult = opts?.applyResult !== false;
    if (applyResult) setLoading(true);
    try {
      const res = await fetch(`/api/scenarios/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok && applyResult) {
        const data: ScenarioWithResult = await res.json();
        setScenarios((prev) =>
          prev.map((s) => (s.id === activeId ? data.scenario : s))
        );
        setActiveResult(data.underwriting);
      }
    } catch (err) {
      console.error("Failed to update scenario:", err);
    } finally {
      if (applyResult) setLoading(false);
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

  async function cloneScenario(id: string) {
    setCreating(true);
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: deal.id,
          clone_from: id,
        }),
      });

      if (res.ok) {
        const data: ScenarioWithResult = await res.json();
        setScenarios((prev) => [...prev, data.scenario]);
        setActiveId(data.scenario.id);
        setActiveResult(data.underwriting);
      }
    } catch (err) {
      console.error("Failed to clone scenario:", err);
    } finally {
      setCreating(false);
      setMenuOpenId(null);
    }
  }

  async function renameScenario(id: string, newName: string) {
    if (!newName.trim()) return;
    try {
      const res = await fetch(`/api/scenarios/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const data: ScenarioWithResult = await res.json();
        setScenarios((prev) =>
          prev.map((s) => (s.id === id ? data.scenario : s))
        );
        if (id === activeId) {
          setActiveResult(data.underwriting);
        }
      }
    } catch (err) {
      console.error("Failed to rename scenario:", err);
    }
    setRenamingId(null);
  }


  async function handleFileImport(file: File, type: "rent_roll" | "t12") {
    if (!activeId) return;
    setImporting(type);
    try {
      const endpoint = type === "rent_roll" ? "import-rent-roll" : "import-t12";
      const res = await uploadFile(file, `/api/scenarios/${activeId}/${endpoint}`);
      if (res.ok) {
        const data: ScenarioWithResult & { imported: Record<string, number> } = await res.json();
        setScenarios((prev) =>
          prev.map((s) => (s.id === activeId ? data.scenario : s))
        );
        setActiveResult(data.underwriting);
      } else {
        const err = await res.json();
        alert(err.error || `Failed to import ${type === "rent_roll" ? "rent roll" : "T12"}`);
      }
    } catch (err) {
      console.error(`Failed to import ${type}:`, err);
      alert(`Failed to import ${type === "rent_roll" ? "rent roll" : "T12"}. ${err instanceof Error ? err.message : "Please try again."}`);
    } finally {
      setImporting(null);
      if (rentRollInputRef.current) rentRollInputRef.current.value = "";
      if (t12InputRef.current) t12InputRef.current.value = "";
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
              {renamingId === s.id ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); renameScenario(s.id, renameValue); }}
                  className="flex items-center"
                >
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => renameScenario(s.id, renameValue)}
                    onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                    className="px-2 py-1 text-sm bg-slate-700 border border-blue-500 rounded-l-md text-white outline-none w-32"
                  />
                </form>
              ) : (
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
              )}
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
                        onClick={() => { setRenamingId(s.id); setRenameValue(s.name); setMenuOpenId(null); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 text-left"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Rename
                      </button>
                      <button
                        onClick={() => { cloneScenario(s.id); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-blue-400 hover:bg-slate-700 text-left"
                      >
                        <Copy className="h-3.5 w-3.5" /> Clone
                      </button>
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
          <>
            <input
              ref={rentRollInputRef}
              type="file"
              accept=".csv,.xlsx,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileImport(f, "rent_roll");
              }}
            />
            <input
              ref={t12InputRef}
              type="file"
              accept=".csv,.xlsx,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileImport(f, "t12");
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => rentRollInputRef.current?.click()}
              disabled={importing !== null}
              className="border-slate-700 text-purple-400 hover:bg-purple-900/20 ml-auto"
            >
              {importing === "rent_roll" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
              Import Rent Roll
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => t12InputRef.current?.click()}
              disabled={importing !== null}
              className="border-slate-700 text-purple-400 hover:bg-purple-900/20"
            >
              {importing === "t12" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
              Import T12
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.open(
                  `/api/loi/${deal.id}?scenario_id=${activeId}`,
                  "_blank"
                );
              }}
              className="border-slate-700 text-blue-400 hover:bg-blue-900/20"
            >
              <FileText className="h-3 w-3 mr-1" /> Generate LOI
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.open(
                  `/api/export/${deal.id}?scenario_id=${activeId}`,
                  "_blank"
                );
              }}
              className="border-slate-700 text-green-400 hover:bg-green-900/20"
            >
              <Download className="h-3 w-3 mr-1" /> Export Excel
            </Button>
            <a
              href={`/api/export/${deal.id}/sidecar?scenario_id=${activeId}`}
              download
              className="text-[11px] text-slate-500 hover:text-blue-400 underline ml-1"
              title="Machine-readable companion: inputs, tax vectors, key outputs, reconciliation checks"
            >
              JSON
            </a>
          </>
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
  onUpdate: (updates: Partial<Record<string, unknown>>, opts?: { applyResult?: boolean }) => Promise<void>;
}) {
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

      {/* Key Metrics — at the top */}
      <MetricsBar metrics={result.metrics} />

      {/* Full Assumptions Form */}
      <AssumptionsForm
        key={scenario.id}
        scenario={scenario}
        onUpdate={onUpdate}
        onDelete={() => {}}
        loading={loading}
        dealT12={deal.t12}
        dealUnits={deal.units}
        dealCity={deal.city}
        dealRentRoll={deal.rent_roll}
        year1Revenue={result.annual[0] ? result.annual[0].gpr + result.annual[0].other_income : undefined}
        year1DebtService={result.annual[0]?.debt_service}
        year1Opex={result.annual[0]?.total_opex}
      />

      {/* Pro Forma */}
      {(() => {
        const exit = (scenario.exit_assumptions ?? {}) as Partial<ExitAssumptions>;
        const bases = resolveProformaBases(exit as ExitAssumptions);
        return (
          <ProFormaTable
            monthly={result.monthly}
            annual={result.annual}
            unrenovatedBasis={bases.unrenovated}
            renovatedBasis={bases.renovated}
            taxYears={result.tax?.years}
            taxView={((scenario.tax_assumptions as Record<string, unknown> | null | undefined)?.opco_view as "propco" | "household" | undefined) ?? "household"}
            onUnrenovatedBasisChange={(basis: UnrenovatedBasis) => {
              const currentExit = (scenario.exit_assumptions ?? {}) as Record<string, unknown>;
              onUpdate({
                exit_assumptions: {
                  ...currentExit,
                  proforma_unrenovated_basis: basis,
                  // Preserve renovated side from the resolved bases (handles legacy migration)
                  proforma_renovated_basis: bases.renovated,
                  // Clear legacy combined field so the new split takes precedence
                  proforma_rent_basis: undefined,
                },
              });
            }}
            onRenovatedBasisChange={(basis: RenovatedBasis) => {
              const currentExit = (scenario.exit_assumptions ?? {}) as Record<string, unknown>;
              onUpdate({
                exit_assumptions: {
                  ...currentExit,
                  proforma_unrenovated_basis: bases.unrenovated,
                  proforma_renovated_basis: basis,
                  proforma_rent_basis: undefined,
                },
              });
            }}
          />
        );
      })()}

      {/* After-Tax (TAX_TREATMENT_SPEC) — only when the scenario has tax assumptions */}
      {result.tax && (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-white text-base font-semibold">After-Tax (1031 exit — taxes deferred, not eliminated)</h3>
              <span className="text-[10px] text-slate-500 italic">estimate — not tax advice</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-800/60 rounded p-2.5 text-center ring-1 ring-blue-500/50">
                <div className="text-xs text-blue-300 mb-0.5 font-medium">Household After-Tax IRR</div>
                <div className="text-sm text-white font-bold tabular-nums">
                  {result.tax.after_tax_irr_household !== null ? `${(result.tax.after_tax_irr_household * 100).toFixed(1)}%` : "—"}
                </div>
                <div className="text-[10px] text-blue-400/70 mt-0.5">OpCo fee recycled — decision view</div>
              </div>
              <div className="bg-slate-800/50 rounded p-2.5 text-center">
                <div className="text-xs text-slate-400 mb-0.5">PropCo After-Tax IRR</div>
                <div className="text-sm text-white font-semibold tabular-nums">
                  {result.tax.after_tax_irr_propco !== null ? `${(result.tax.after_tax_irr_propco * 100).toFixed(1)}%` : "—"}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">lender / valuation view</div>
              </div>
              <div className="bg-slate-800/50 rounded p-2.5 text-center">
                <div className="text-xs text-slate-400 mb-0.5">Year-1 Federal Shield</div>
                <div className="text-sm text-emerald-400 font-semibold tabular-nums">
                  ${Math.round(result.tax.year1_federal_shield).toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">+ ${Math.round(result.tax.year1_state_shield).toLocaleString()} NY</div>
              </div>
              <div className="bg-slate-800/50 rounded p-2.5 text-center">
                <div className="text-xs text-slate-400 mb-0.5">Deferred Gain (memo)</div>
                <div className="text-sm text-amber-400 font-semibold tabular-nums">
                  ${Math.round(result.tax.deferred_gain_memo.deferred_gain).toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">carries into replacement property</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="text-left py-1.5 pr-3 font-medium">Year</th>
                    <th className="text-right py-1.5 px-2 font-medium">REPS</th>
                    <th className="text-right py-1.5 px-2 font-medium">Fed Dep</th>
                    <th className="text-right py-1.5 px-2 font-medium">NY Dep</th>
                    <th className="text-right py-1.5 px-2 font-medium">Fed Taxable</th>
                    <th className="text-right py-1.5 px-2 font-medium">Fed Tax/(Shield)</th>
                    <th className="text-right py-1.5 px-2 font-medium">NY Tax/(Shield)</th>
                    <th className="text-right py-1.5 px-2 font-medium">NIIT</th>
                    <th className="text-right py-1.5 px-2 font-medium">ATCF PropCo</th>
                    <th className="text-right py-1.5 px-2 font-medium">ATCF Household</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tax.years.map((ty) => {
                    const f = (n: number) => `${n < 0 ? "(" : ""}$${Math.abs(Math.round(n)).toLocaleString()}${n < 0 ? ")" : ""}`;
                    return (
                      <tr key={ty.year} className="border-b border-slate-800/50 tabular-nums">
                        <td className="py-1 pr-3 text-slate-300">Y{ty.year}</td>
                        <td className={`py-1 px-2 text-right ${ty.reps_on ? "text-emerald-400" : "text-slate-500"}`}>{ty.reps_on ? "ON" : "off"}</td>
                        <td className="py-1 px-2 text-right text-slate-300">{f(ty.federal_depreciation)}</td>
                        <td className="py-1 px-2 text-right text-slate-400">{f(ty.state_depreciation)}</td>
                        <td className="py-1 px-2 text-right text-slate-300">{f(ty.federal_taxable_income)}</td>
                        <td className={`py-1 px-2 text-right ${ty.federal_tax < 0 ? "text-emerald-400" : "text-slate-300"}`}>{f(ty.federal_tax)}</td>
                        <td className={`py-1 px-2 text-right ${ty.state_tax < 0 ? "text-emerald-400" : "text-slate-400"}`}>{f(ty.state_tax)}</td>
                        <td className="py-1 px-2 text-right text-slate-400">{f(ty.niit)}</td>
                        <td className="py-1 px-2 text-right text-slate-300">{f(ty.after_tax_cash_flow_propco)}</td>
                        <td className="py-1 px-2 text-right text-white font-medium">{f(ty.after_tax_cash_flow_household)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {result.tax.pal_carryforward_at_exit > 0 && (
              <p className="text-[11px] text-amber-400/80">
                Suspended PALs at exit: ${Math.round(result.tax.pal_carryforward_at_exit).toLocaleString()} — a 1031 is not a fully-taxable
                disposition, so these stay suspended (they carry to the replacement holding period).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sensitivity */}
      <SensitivityGrid
        sensitivity={result.sensitivity}
        basePurchasePrice={
          (scenario.purchase_assumptions as { purchase_price?: number })
            ?.purchase_price ?? deal.asking_price
        }
        rentBasis={
          (scenario.exit_assumptions as { sensitivity_rent_basis?: RentBasis })
            ?.sensitivity_rent_basis
        }
        onRentBasisChange={(basis: RentBasis) => {
          const currentExit = (scenario.exit_assumptions ?? {}) as Record<string, unknown>;
          onUpdate({ exit_assumptions: { ...currentExit, sensitivity_rent_basis: basis } });
        }}
      />
    </div>
  );
}
