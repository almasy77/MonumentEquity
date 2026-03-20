"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, Trash2, TableProperties, ChevronDown, ChevronRight } from "lucide-react";
import type { RentRollUnit } from "@/lib/validations";

interface OtherIncomeItem {
  label: string;
  amount: number | undefined; // monthly
}

const STATUS_STYLES: Record<string, string> = {
  occupied: "bg-green-900/50 text-green-400 border-green-800",
  vacant: "bg-red-900/50 text-red-400 border-red-800",
  notice_to_vacate: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
  down: "bg-slate-800 text-slate-400 border-slate-700",
};

const STATUS_LABELS: Record<string, string> = {
  occupied: "Occupied",
  vacant: "Vacant",
  notice_to_vacate: "Notice to Vacate",
  down: "Down for Reno",
};

function fmt(n: number | undefined): string {
  if (n == null) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function emptyUnit(): RentRollUnit {
  return {
    unit_number: "",
    unit_type: "",
    sqft: undefined,
    tenant_name: "",
    status: "vacant",
    lease_start: "",
    lease_end: "",
    current_rent: undefined,
    market_rent: undefined,
    other_charges: undefined,
  };
}

interface EditableCellProps {
  value: string;
  onChange: (val: string) => void;
  type?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
}

function EditableCell({ value, onChange, type = "text", options, className = "", placeholder }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    if (type === "select" && options) {
      return (
        <select
          value={draft}
          onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); setEditing(false); }}
          onBlur={() => setEditing(false)}
          autoFocus
          className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white w-full outline-none focus:border-blue-500"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Enter") { onChange(draft); setEditing(false); } if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        autoFocus
        placeholder={placeholder}
        className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white w-full outline-none focus:border-blue-500"
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`cursor-pointer hover:bg-slate-800 active:bg-slate-700 rounded px-1 py-0.5 block min-h-[1.25rem] border border-transparent hover:border-slate-700 ${className}`}
      title="Click to edit"
      role="button"
      aria-label={`Edit ${placeholder || "value"}`}
    >
      {value || <span className="text-slate-600 italic text-xs">{placeholder || "--"}</span>}
    </span>
  );
}

function StatusCell({ status, onChange }: { status: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        value={status}
        onChange={(e) => { onChange(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        autoFocus
        className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-white w-full outline-none focus:border-blue-500"
      >
        <option value="occupied">Occupied</option>
        <option value="vacant">Vacant</option>
        <option value="notice_to_vacate">Notice to Vacate</option>
        <option value="down">Down for Reno</option>
      </select>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 cursor-pointer ${STATUS_STYLES[status] || ""}`}
      onClick={() => setEditing(true)}
    >
      {STATUS_LABELS[status] || status}
    </Badge>
  );
}

const COLUMNS: readonly { key: string; label: string; align: string; defaultWidth: number; resizable?: boolean }[] = [
  { key: "unit_number", label: "Unit #", align: "left", defaultWidth: 60 },
  { key: "unit_type", label: "Beds/Baths", align: "left", defaultWidth: 90 },
  { key: "sqft", label: "SqFt", align: "right", defaultWidth: 60 },
  { key: "status", label: "Status", align: "left", defaultWidth: 80 },
  { key: "tenant_name", label: "Tenant", align: "left", defaultWidth: 120 },
  { key: "current_rent", label: "Current Rent", align: "right", defaultWidth: 95 },
  { key: "market_rent", label: "Market Rent", align: "right", defaultWidth: 95 },
  { key: "lease_start", label: "Lease Start", align: "left", defaultWidth: 95 },
  { key: "lease_end", label: "Lease End", align: "left", defaultWidth: 95 },
  { key: "other_charges", label: "Other", align: "right", defaultWidth: 65 },
  { key: "actions", label: "", align: "left", defaultWidth: 24, resizable: false },
];

export function RentRollTable({ dealId, rentRoll, dealUnits }: { dealId: string; rentRoll: RentRollUnit[]; dealUnits: number }) {
  const router = useRouter();
  const [units, setUnits] = useState<RentRollUnit[]>(rentRoll || []);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [otherIncomeItems, setOtherIncomeItems] = useState<OtherIncomeItem[]>([]);
  const [otherIncomeExpanded, setOtherIncomeExpanded] = useState(false);

  // Column resize state
  const [colWidths, setColWidths] = useState<number[]>(COLUMNS.map((c) => c.defaultWidth));
  const resizing = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);

  const onResizeStart = useCallback((colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[colIdx];
    resizing.current = { colIdx, startX, startW };

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const diff = ev.clientX - resizing.current.startX;
      const newW = Math.max(30, resizing.current.startW + diff);
      setColWidths((prev) => {
        const next = [...prev];
        next[resizing.current!.colIdx] = newW;
        return next;
      });
    };
    const onUp = () => {
      resizing.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths]);

  function initializeUnits() {
    const newUnits: RentRollUnit[] = [];
    for (let i = 1; i <= dealUnits; i++) {
      newUnits.push({ ...emptyUnit(), unit_number: i.toString() });
    }
    setUnits(newUnits);
    setDirty(true);
  }

  const updateUnit = useCallback((idx: number, field: keyof RentRollUnit, raw: string) => {
    setUnits((prev) => {
      const next = [...prev];
      const unit = { ...next[idx] };
      if (["sqft", "current_rent", "market_rent", "other_charges"].includes(field)) {
        (unit as Record<string, unknown>)[field] = raw ? Number(raw) : undefined;
      } else {
        (unit as Record<string, unknown>)[field] = raw;
      }
      next[idx] = unit;
      return next;
    });
    setDirty(true);
  }, []);

  function addUnit() {
    setUnits((prev) => [...prev, emptyUnit()]);
    setDirty(true);
  }

  function removeUnit(idx: number) {
    setUnits((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  function addOtherIncomeItem() {
    setOtherIncomeItems((prev) => [...prev, { label: "", amount: undefined }]);
    setOtherIncomeExpanded(true);
    setDirty(true);
  }

  function updateOtherIncomeItem(idx: number, field: keyof OtherIncomeItem, value: string) {
    setOtherIncomeItems((prev) => {
      const next = [...prev];
      if (field === "amount") {
        next[idx] = { ...next[idx], amount: value ? Number(value) : undefined };
      } else {
        next[idx] = { ...next[idx], label: value };
      }
      return next;
    });
    setDirty(true);
  }

  function removeOtherIncomeItem(idx: number) {
    setOtherIncomeItems((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }

  const totalOtherIncomeMonthly = otherIncomeItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rent_roll: units }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setDirty(false);
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // Summary calculations
  const totalUnits = units.length;
  const occupied = units.filter((u) => u.status === "occupied").length;
  const vacancyPct = totalUnits > 0 ? ((totalUnits - occupied) / totalUnits) * 100 : 0;
  const rents = units.filter((u) => u.current_rent).map((u) => u.current_rent!);
  const avgRent = rents.length > 0 ? rents.reduce((a, b) => a + b, 0) / rents.length : 0;
  const totalMonthly = rents.reduce((a, b) => a + b, 0);

  return (
    <CollapsibleCard
      title="Revenue + Rent Roll"
      icon={<TableProperties className="h-4 w-4 text-purple-400" />}
      headerRight={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addUnit} className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800">
            <Plus className="h-3 w-3 mr-1" /> Add Unit
          </Button>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white">
              <Save className="h-3 w-3 mr-1" /> {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      }
    >
        {units.length === 0 ? (
          <div className="text-center py-4 space-y-2">
            <p className="text-sm text-slate-500">No rent roll data.</p>
            {dealUnits > 0 && (
              <Button variant="outline" size="sm" onClick={initializeUnits} className="border-slate-700 text-slate-300 hover:bg-slate-800">
                <Plus className="h-3 w-3 mr-1" /> Create {dealUnits} Units
              </Button>
            )}
            <p className="text-xs text-slate-600">Or click &quot;Add Unit&quot; to add one at a time.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs" style={{ tableLayout: "fixed", width: colWidths.reduce((a, b) => a + b, 0) }}>
              <colgroup>
                {colWidths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  {COLUMNS.map((col, i) => (
                    <th
                      key={col.key}
                      className={`py-2 px-1 font-medium relative select-none ${col.align === "right" ? "text-right" : "text-left"}`}
                    >
                      {col.label}
                      {col.resizable !== false && (
                        <span
                          onMouseDown={(e) => onResizeStart(i, e)}
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/40"
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {units.map((unit, idx) => (
                  <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="py-1 px-1">
                      <EditableCell value={unit.unit_number} onChange={(v) => updateUnit(idx, "unit_number", v)} />
                    </td>
                    <td className="py-1 px-1">
                      <EditableCell value={unit.unit_type || ""} onChange={(v) => updateUnit(idx, "unit_type", v)} placeholder="1BR/1BA" />
                    </td>
                    <td className="py-1 px-1 text-right">
                      <EditableCell value={unit.sqft?.toString() || ""} onChange={(v) => updateUnit(idx, "sqft", v)} type="number" className="text-right" />
                    </td>
                    <td className="py-1 px-1">
                      <StatusCell
                        status={unit.status}
                        onChange={(v) => updateUnit(idx, "status", v)}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <EditableCell value={unit.tenant_name || ""} onChange={(v) => updateUnit(idx, "tenant_name", v)} />
                    </td>
                    <td className="py-1 px-1 text-right">
                      <EditableCell value={unit.current_rent?.toString() || ""} onChange={(v) => updateUnit(idx, "current_rent", v)} type="number" className="text-right" />
                    </td>
                    <td className="py-1 px-1 text-right">
                      <EditableCell value={unit.market_rent?.toString() || ""} onChange={(v) => updateUnit(idx, "market_rent", v)} type="number" className="text-right" />
                    </td>
                    <td className="py-1 px-1">
                      <EditableCell value={unit.lease_start || ""} onChange={(v) => updateUnit(idx, "lease_start", v)} type="date" />
                    </td>
                    <td className="py-1 px-1">
                      <EditableCell value={unit.lease_end || ""} onChange={(v) => updateUnit(idx, "lease_end", v)} type="date" />
                    </td>
                    <td className="py-1 px-1 text-right">
                      <EditableCell value={unit.other_charges?.toString() || ""} onChange={(v) => updateUnit(idx, "other_charges", v)} type="number" className="text-right" />
                    </td>
                    <td className="py-1 px-1">
                      <button onClick={() => removeUnit(idx)} className="text-slate-600 hover:text-red-400 p-0.5" title="Remove unit">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary Row */}
            <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-6 text-xs text-slate-400">
              <span>Total Units: <strong className="text-slate-200">{totalUnits}</strong></span>
              <span>Occupied: <strong className="text-green-400">{occupied}</strong></span>
              <span>Vacancy: <strong className={vacancyPct > 10 ? "text-red-400" : "text-slate-200"}>{vacancyPct.toFixed(1)}%</strong></span>
              <span>Avg Rent: <strong className="text-slate-200">{fmt(avgRent)}</strong></span>
              <span>Total Monthly: <strong className="text-slate-200">{fmt(totalMonthly)}</strong></span>
            </div>
          </div>
        )}

        {/* ── Other Income Sub-Card ──────────────────────── */}
        <div className="mt-4 border border-slate-800 rounded-lg bg-slate-900/50">
          <button
            onClick={() => setOtherIncomeExpanded(!otherIncomeExpanded)}
            className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/50 rounded-t-lg"
          >
            <div className="flex items-center gap-2">
              {otherIncomeExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
              <span className="font-medium">Other Income</span>
              {totalOtherIncomeMonthly > 0 && (
                <span className="text-xs text-slate-500 ml-2">{fmt(totalOtherIncomeMonthly)}/mo</span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); addOtherIncomeItem(); }}
              className="h-6 text-[11px] border-slate-700 text-slate-400 hover:bg-slate-800 px-2"
            >
              <Plus className="h-3 w-3 mr-1" /> Add Item
            </Button>
          </button>

          {otherIncomeExpanded && (
            <div className="px-3 pb-3">
              {otherIncomeItems.length === 0 ? (
                <p className="text-xs text-slate-600 py-2 text-center">No other income items. Click &quot;Add Item&quot; to add laundry, parking, pet fees, etc.</p>
              ) : (
                <table className="w-full text-xs mt-1">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500">
                      <th className="text-left py-1.5 px-1 font-medium">Revenue Item</th>
                      <th className="text-right py-1.5 px-1 font-medium w-28">Amount (Monthly)</th>
                      <th className="py-1.5 px-1 w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherIncomeItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        <td className="py-1 px-1">
                          <EditableCell
                            value={item.label}
                            onChange={(v) => updateOtherIncomeItem(idx, "label", v)}
                          />
                        </td>
                        <td className="py-1 px-1 text-right">
                          <EditableCell
                            value={item.amount?.toString() || ""}
                            onChange={(v) => updateOtherIncomeItem(idx, "amount", v)}
                            type="number"
                            className="text-right"
                          />
                        </td>
                        <td className="py-1 px-1">
                          <button onClick={() => removeOtherIncomeItem(idx)} className="text-slate-600 hover:text-red-400 p-0.5" title="Remove item">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {otherIncomeItems.length > 1 && (
                    <tfoot>
                      <tr className="border-t border-slate-700/50">
                        <td className="py-1.5 px-1 text-xs text-slate-400 font-medium">Total Other Income</td>
                        <td className="py-1.5 px-1 text-xs text-right text-slate-300 font-medium">{fmt(totalOtherIncomeMonthly)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          )}
        </div>
    </CollapsibleCard>
  );
}
