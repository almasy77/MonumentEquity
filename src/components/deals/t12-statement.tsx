"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Save } from "lucide-react";
import type { T12Statement, RentRollUnit } from "@/lib/validations";

function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "—";
  if (n === 0) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function pct(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(1) + "%";
}

function perUnit(n: number | undefined | null, units: number): string {
  if (n == null || isNaN(n) || units <= 0) return "—";
  return fmt(n / units);
}

function pctOfEgi(n: number | undefined | null, egi: number): string {
  if (n == null || isNaN(n) || egi <= 0) return "—";
  return ((n / egi) * 100).toFixed(1) + "%";
}

const SOURCE_OPTIONS = [
  { value: "seller_provided", label: "Seller Provided" },
  { value: "broker_om", label: "Broker OM" },
  { value: "verified", label: "Verified" },
  { value: "estimated", label: "Estimated" },
];

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]));

// ─── Editable Cell ──────────────────────────────────────────
function EditableCell({
  value,
  onChange,
  readOnly = false,
  prefix = "$",
  suffix,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  if (readOnly) {
    const num = parseFloat(value);
    if (suffix === "%") return <span className={`text-slate-400 ${className}`}>{isNaN(num) ? "—" : num.toFixed(1) + "%"}</span>;
    return <span className={`text-slate-400 ${className}`}>{fmt(isNaN(num) ? 0 : num)}</span>;
  }

  return (
    <div className="flex items-center gap-0.5">
      {prefix && !suffix && <span className="text-slate-600 text-xs">{prefix}</span>}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent border-0 border-b border-slate-700/50 text-sm text-white w-full outline-none focus:border-blue-500 px-0 py-0 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        placeholder="0"
      />
      {suffix && <span className="text-slate-600 text-xs ml-0.5">{suffix}</span>}
    </div>
  );
}

// ─── Row types ──────────────────────────────────────────────
interface LineItemRowProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
  annual: number;
  units: number;
  egi: number;
  isNegative?: boolean;
  indent?: boolean;
  prefix?: string;
  suffix?: string;
  readOnly?: boolean;
}

function LineItemRow({ label, value, onChange, editing, annual, units, egi, isNegative, indent, prefix = "$", suffix, readOnly }: LineItemRowProps) {
  const displayVal = isNegative && annual > 0 ? -annual : annual;
  return (
    <tr className="group hover:bg-slate-800/30">
      <td className={`py-1.5 text-sm text-slate-300 ${indent ? "pl-5" : "pl-2"}`}>{label}</td>
      <td className="py-1.5 text-sm text-right pr-3 w-32">
        {editing ? (
          <EditableCell value={value} onChange={onChange} prefix={prefix} suffix={suffix} readOnly={readOnly} />
        ) : (
          <span className={isNegative ? "text-red-400" : "text-slate-200"}>
            {isNegative ? `(${fmt(annual)})` : suffix === "%" ? pct(annual) : fmt(annual)}
          </span>
        )}
      </td>
      <td className="py-1.5 text-sm text-right pr-3 text-slate-500 w-24">{perUnit(displayVal, units)}</td>
      <td className="py-1.5 text-sm text-right pr-2 text-slate-500 w-20">{pctOfEgi(Math.abs(annual), egi)}</td>
    </tr>
  );
}

function SubtotalRow({ label, value, units, egi, bold }: { label: string; value: number; units: number; egi: number; bold?: boolean }) {
  const cls = bold ? "text-white font-semibold" : "text-slate-200 font-medium";
  return (
    <tr className="border-t border-slate-700/50">
      <td className={`py-2 text-sm pl-2 ${cls}`}>{label}</td>
      <td className={`py-2 text-sm text-right pr-3 ${cls}`}>{fmt(value)}</td>
      <td className="py-2 text-sm text-right pr-3 text-slate-400 font-medium">{perUnit(value, units)}</td>
      <td className="py-2 text-sm text-right pr-2 text-slate-400 font-medium">{egi > 0 ? pctOfEgi(Math.abs(value), egi) : "—"}</td>
    </tr>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={4} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider pt-4 pb-1.5 pl-2">{label}</td>
    </tr>
  );
}

// ─── Form State & Logic ─────────────────────────────────────
interface T12FormState {
  total_gpi: string;
  vacancy_loss_pct: string;
  vacancy_loss: string;
  other_income: string;
  total_egi: string;
  property_taxes: string;
  insurance: string;
  utilities_water: string;
  utilities_electric: string;
  utilities_gas: string;
  repairs_maintenance: string;
  management_fee_pct: string;
  management_fees: string;
  payroll: string;
  other_expenses: string;
  total_opex: string;
  total_noi: string;
  source: string;
  notes: string;
}

function t12ToForm(t12: T12Statement | undefined, rentRoll: RentRollUnit[]): T12FormState {
  const m = t12?.months?.[0];
  const monthlyRent = rentRoll.reduce((sum, u) => sum + (u.current_rent || 0), 0);
  const annualRentFromRoll = monthlyRent * 12;

  const gpi = t12?.total_gpi ?? annualRentFromRoll;
  const vacLoss = m?.vacancy_loss ?? 0;
  const vacPct = gpi > 0 ? ((vacLoss / gpi) * 100) : 0;

  const mgmt = m?.management_fees ?? 0;
  const egi = gpi - vacLoss + (m?.other_income ?? 0);
  const mgmtPct = egi > 0 ? ((mgmt / egi) * 100) : 8;

  return {
    total_gpi: gpi ? gpi.toString() : "",
    vacancy_loss_pct: vacPct ? vacPct.toFixed(1) : "5",
    vacancy_loss: vacLoss ? vacLoss.toString() : "",
    other_income: m?.other_income?.toString() || "",
    total_egi: t12?.total_egi?.toString() || "",
    property_taxes: m?.property_taxes?.toString() || "",
    insurance: m?.insurance?.toString() || "",
    utilities_water: m?.utilities_water?.toString() || "",
    utilities_electric: m?.utilities_electric?.toString() || "",
    utilities_gas: m?.utilities_gas?.toString() || "",
    repairs_maintenance: m?.repairs_maintenance?.toString() || "",
    management_fee_pct: mgmtPct ? mgmtPct.toFixed(1) : "8",
    management_fees: mgmt ? mgmt.toString() : "",
    payroll: m?.payroll?.toString() || "",
    other_expenses: m?.other_expenses?.toString() || "",
    total_opex: t12?.total_opex?.toString() || "",
    total_noi: t12?.total_noi?.toString() || "",
    source: t12?.source || "estimated",
    notes: t12?.notes || "",
  };
}

function recalc(next: T12FormState): T12FormState {
  const gpi = parseFloat(next.total_gpi) || 0;
  const vacPct = parseFloat(next.vacancy_loss_pct) || 0;
  const vacLoss = gpi * (vacPct / 100);
  next.vacancy_loss = vacLoss ? vacLoss.toFixed(0) : "";

  const otherInc = parseFloat(next.other_income) || 0;
  const egi = gpi - vacLoss + otherInc;
  next.total_egi = egi.toString();

  const mgmtPct = parseFloat(next.management_fee_pct) || 0;
  const mgmt = egi * (mgmtPct / 100);
  next.management_fees = mgmt ? mgmt.toFixed(0) : "";

  const taxes = parseFloat(next.property_taxes) || 0;
  const ins = parseFloat(next.insurance) || 0;
  const water = parseFloat(next.utilities_water) || 0;
  const electric = parseFloat(next.utilities_electric) || 0;
  const gas = parseFloat(next.utilities_gas) || 0;
  const rm = parseFloat(next.repairs_maintenance) || 0;
  const pay = parseFloat(next.payroll) || 0;
  const otherExp = parseFloat(next.other_expenses) || 0;
  const opex = taxes + ins + water + electric + gas + rm + mgmt + pay + otherExp;
  next.total_opex = opex.toString();
  next.total_noi = (egi - opex).toString();

  return next;
}

// ─── Main Component ─────────────────────────────────────────
interface T12Props {
  dealId: string;
  t12: T12Statement | undefined;
  rentRoll: RentRollUnit[];
  units: number;
}

export function T12StatementPanel({ dealId, t12, rentRoll, units }: T12Props) {
  const router = useRouter();
  const hasData = t12 && (t12.total_noi || t12.total_egi || t12.total_opex);
  const [editing, setEditing] = useState(!hasData);
  const [form, setForm] = useState<T12FormState>(() => t12ToForm(t12, rentRoll));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const monthlyRent = rentRoll.reduce((sum, u) => sum + (u.current_rent || 0), 0);
    const annualRent = monthlyRent * 12;
    if (annualRent > 0 && !form.total_gpi) {
      setForm((prev) => ({ ...prev, total_gpi: annualRent.toString() }));
    }
  }, [rentRoll]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = useCallback((field: keyof T12FormState, value: string) => {
    setForm((prev) => recalc({ ...prev, [field]: value }));
  }, []);

  function fillFromRentRoll() {
    const monthlyRent = rentRoll.reduce((sum, u) => sum + (u.current_rent || 0), 0);
    const annualRent = monthlyRent * 12;
    if (annualRent > 0) {
      setForm((prev) => recalc({ ...prev, total_gpi: annualRent.toString() }));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const water = parseFloat(form.utilities_water) || 0;
      const electric = parseFloat(form.utilities_electric) || 0;
      const gas = parseFloat(form.utilities_gas) || 0;
      const totalUtilities = water + electric + gas;

      const t12Data: T12Statement = {
        total_gpi: parseFloat(form.total_gpi) || undefined,
        total_egi: parseFloat(form.total_egi) || undefined,
        total_opex: parseFloat(form.total_opex) || undefined,
        total_noi: parseFloat(form.total_noi) || undefined,
        source: form.source || undefined,
        notes: form.notes || undefined,
        months: [{
          month: "annual",
          gross_potential_rent: parseFloat(form.total_gpi) || undefined,
          vacancy_loss: parseFloat(form.vacancy_loss) || undefined,
          other_income: parseFloat(form.other_income) || undefined,
          property_taxes: parseFloat(form.property_taxes) || undefined,
          insurance: parseFloat(form.insurance) || undefined,
          utilities: totalUtilities || undefined,
          utilities_water: water || undefined,
          utilities_electric: electric || undefined,
          utilities_gas: gas || undefined,
          repairs_maintenance: parseFloat(form.repairs_maintenance) || undefined,
          management_fees: parseFloat(form.management_fees) || undefined,
          payroll: parseFloat(form.payroll) || undefined,
          other_expenses: parseFloat(form.other_expenses) || undefined,
        }],
      };

      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t12: t12Data }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEditing(false);
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // Computed values for display
  const gpi = parseFloat(form.total_gpi) || (t12?.total_gpi ?? 0);
  const vacLoss = parseFloat(form.vacancy_loss) || (t12?.months?.[0]?.vacancy_loss ?? 0);
  const otherIncome = parseFloat(form.other_income) || (t12?.months?.[0]?.other_income ?? 0);
  const egi = parseFloat(form.total_egi) || (t12?.total_egi ?? 0);
  const taxes = parseFloat(form.property_taxes) || (t12?.months?.[0]?.property_taxes ?? 0);
  const ins = parseFloat(form.insurance) || (t12?.months?.[0]?.insurance ?? 0);
  const water = parseFloat(form.utilities_water) || (t12?.months?.[0]?.utilities_water ?? 0);
  const electric = parseFloat(form.utilities_electric) || (t12?.months?.[0]?.utilities_electric ?? 0);
  const gas = parseFloat(form.utilities_gas) || (t12?.months?.[0]?.utilities_gas ?? 0);
  const totalUtilities = water + electric + gas;
  const rm = parseFloat(form.repairs_maintenance) || (t12?.months?.[0]?.repairs_maintenance ?? 0);
  const mgmt = parseFloat(form.management_fees) || (t12?.months?.[0]?.management_fees ?? 0);
  const pay = parseFloat(form.payroll) || (t12?.months?.[0]?.payroll ?? 0);
  const otherExp = parseFloat(form.other_expenses) || (t12?.months?.[0]?.other_expenses ?? 0);
  const opex = parseFloat(form.total_opex) || (t12?.total_opex ?? 0);
  const noi = parseFloat(form.total_noi) || (t12?.total_noi ?? 0);
  const vacPct = parseFloat(form.vacancy_loss_pct) || 0;
  const mgmtPct = parseFloat(form.management_fee_pct) || 0;

  const monthlyRent = rentRoll.reduce((sum, u) => sum + (u.current_rent || 0), 0);
  const annualRentFromRoll = monthlyRent * 12;

  return (
    <CollapsibleCard
      title="T12 Operating Statement"
      icon={<FileSpreadsheet className="h-4 w-4 text-orange-400" />}
      headerRight={
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              {annualRentFromRoll > 0 && (
                <button onClick={fillFromRentRoll} className="text-blue-400 hover:text-blue-300 text-[11px]">
                  Fill GPR from rent roll
                </button>
              )}
              {hasData && (
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} className="h-6 text-[11px] border-slate-700 text-slate-400 hover:bg-slate-800 px-2">
                  Cancel
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving} className="h-6 text-[11px] bg-blue-600 hover:bg-blue-700 text-white px-2">
                <Save className="h-3 w-3 mr-1" /> {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-6 text-[11px] border-slate-700 text-slate-300 hover:bg-slate-800 px-2">
              Edit
            </Button>
          )}
        </div>
      }
    >
      <div className="overflow-x-auto -mx-1">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-700">
              <th className="text-left py-1.5 pl-2 font-medium">Line Item</th>
              <th className="text-right py-1.5 pr-3 font-medium w-32">Annual</th>
              <th className="text-right py-1.5 pr-3 font-medium w-24">Per Unit</th>
              <th className="text-right py-1.5 pr-2 font-medium w-20">% of EGI</th>
            </tr>
          </thead>
          <tbody>
            {/* ── Income ──────────────────────────── */}
            <SectionHeader label="Revenue" />

            <LineItemRow
              label="Gross Potential Rent"
              value={form.total_gpi}
              onChange={(v) => updateField("total_gpi", v)}
              editing={editing}
              annual={gpi}
              units={units}
              egi={egi}
            />
            <LineItemRow
              label={`Vacancy & Credit Loss (${vacPct.toFixed(1)}%)`}
              value={form.vacancy_loss_pct}
              onChange={(v) => updateField("vacancy_loss_pct", v)}
              editing={editing}
              annual={vacLoss}
              units={units}
              egi={egi}
              isNegative
              prefix=""
              suffix="%"
            />
            <LineItemRow
              label="Other Income"
              value={form.other_income}
              onChange={(v) => updateField("other_income", v)}
              editing={editing}
              annual={otherIncome}
              units={units}
              egi={egi}
            />

            <SubtotalRow label="Effective Gross Income" value={egi} units={units} egi={egi} />

            {/* ── Expenses ────────────────────────── */}
            <SectionHeader label="Operating Expenses" />

            <LineItemRow
              label="Real Estate Taxes"
              value={form.property_taxes}
              onChange={(v) => updateField("property_taxes", v)}
              editing={editing}
              annual={taxes}
              units={units}
              egi={egi}
            />
            <LineItemRow
              label="Insurance"
              value={form.insurance}
              onChange={(v) => updateField("insurance", v)}
              editing={editing}
              annual={ins}
              units={units}
              egi={egi}
            />
            <LineItemRow
              label="Utilities — Water/Sewer"
              value={form.utilities_water}
              onChange={(v) => updateField("utilities_water", v)}
              editing={editing}
              annual={water}
              units={units}
              egi={egi}
              indent
            />
            <LineItemRow
              label="Utilities — Electric"
              value={form.utilities_electric}
              onChange={(v) => updateField("utilities_electric", v)}
              editing={editing}
              annual={electric}
              units={units}
              egi={egi}
              indent
            />
            <LineItemRow
              label="Utilities — Gas"
              value={form.utilities_gas}
              onChange={(v) => updateField("utilities_gas", v)}
              editing={editing}
              annual={gas}
              units={units}
              egi={egi}
              indent
            />
            {totalUtilities > 0 && !editing && (
              <tr className="hover:bg-slate-800/30">
                <td className="py-1 text-xs text-slate-500 italic pl-5">Total Utilities</td>
                <td className="py-1 text-xs text-right pr-3 text-slate-500 italic">{fmt(totalUtilities)}</td>
                <td className="py-1 text-xs text-right pr-3 text-slate-600 italic">{perUnit(totalUtilities, units)}</td>
                <td className="py-1 text-xs text-right pr-2 text-slate-600 italic">{pctOfEgi(totalUtilities, egi)}</td>
              </tr>
            )}
            <LineItemRow
              label="Repairs & Maintenance"
              value={form.repairs_maintenance}
              onChange={(v) => updateField("repairs_maintenance", v)}
              editing={editing}
              annual={rm}
              units={units}
              egi={egi}
            />
            <LineItemRow
              label={`Management (${mgmtPct.toFixed(1)}% of EGI)`}
              value={form.management_fee_pct}
              onChange={(v) => updateField("management_fee_pct", v)}
              editing={editing}
              annual={mgmt}
              units={units}
              egi={egi}
              prefix=""
              suffix="%"
            />
            <LineItemRow
              label="Payroll"
              value={form.payroll}
              onChange={(v) => updateField("payroll", v)}
              editing={editing}
              annual={pay}
              units={units}
              egi={egi}
            />
            <LineItemRow
              label="Other Expenses"
              value={form.other_expenses}
              onChange={(v) => updateField("other_expenses", v)}
              editing={editing}
              annual={otherExp}
              units={units}
              egi={egi}
            />

            <SubtotalRow label="Total Operating Expenses" value={opex} units={units} egi={egi} />

            {/* ── NOI ─────────────────────────────── */}
            <tr className="border-t-2 border-slate-600">
              <td className="py-2.5 text-sm pl-2 text-white font-bold">Net Operating Income</td>
              <td className="py-2.5 text-sm text-right pr-3 text-green-400 font-bold">{fmt(noi)}</td>
              <td className="py-2.5 text-sm text-right pr-3 text-green-400/70 font-semibold">{perUnit(noi, units)}</td>
              <td className="py-2.5 text-sm text-right pr-2 text-green-400/70 font-semibold">{pctOfEgi(noi, egi)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Source & Notes */}
      {editing ? (
        <div className="mt-4 pt-3 border-t border-slate-800 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Source</label>
            <select
              value={form.source}
              onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white w-full outline-none focus:border-blue-500"
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Notes</label>
            <input
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white w-full outline-none focus:border-blue-500"
              placeholder="Source notes..."
            />
          </div>
        </div>
      ) : (
        (t12?.source || t12?.notes) && (
          <div className="mt-3 pt-2 border-t border-slate-800 flex flex-wrap gap-4 text-[11px] text-slate-500">
            {t12?.source && <span>Source: {SOURCE_LABELS[t12.source] || t12.source}</span>}
            {t12?.notes && <span>Notes: {t12.notes}</span>}
          </div>
        )
      )}
    </CollapsibleCard>
  );
}
