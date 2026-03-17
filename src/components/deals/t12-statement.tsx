"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Save } from "lucide-react";
import type { T12Statement, RentRollUnit } from "@/lib/validations";

function fmt(n: number | undefined | null): string {
  if (n == null) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

const SOURCE_OPTIONS = [
  { value: "seller_provided", label: "Seller Provided" },
  { value: "broker_om", label: "Broker OM" },
  { value: "verified", label: "Verified" },
  { value: "estimated", label: "Estimated" },
];

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]));

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
  // Calculate annual rent from rent roll
  const monthlyRent = rentRoll.reduce((sum, u) => sum + (u.current_rent || 0), 0);
  const annualRentFromRoll = monthlyRent * 12;

  const gpi = t12?.total_gpi ?? annualRentFromRoll;
  const vacLoss = m?.vacancy_loss ?? 0;
  const vacPct = gpi > 0 ? ((vacLoss / gpi) * 100) : 0;

  // Management: try to derive percentage from stored value
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

function NumberInput({ label, value, onChange, readOnly = false, suffix, className = "" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      <div className="flex items-center">
        {!suffix && <span className="text-slate-500 text-sm mr-1">$</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          className={`bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full outline-none focus:border-blue-500 ${readOnly ? "text-slate-400 cursor-not-allowed" : ""}`}
          placeholder="0"
        />
        {suffix && <span className="text-slate-500 text-sm ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

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

  // Recompute GPR from rent roll when rent roll changes
  useEffect(() => {
    const monthlyRent = rentRoll.reduce((sum, u) => sum + (u.current_rent || 0), 0);
    const annualRent = monthlyRent * 12;
    if (annualRent > 0 && !form.total_gpi) {
      setForm((prev) => ({ ...prev, total_gpi: annualRent.toString() }));
    }
  }, [rentRoll]); // eslint-disable-line react-hooks/exhaustive-deps

  function recalc(next: T12FormState): T12FormState {
    const gpi = parseFloat(next.total_gpi) || 0;

    // Vacancy loss from percentage
    const vacPct = parseFloat(next.vacancy_loss_pct) || 0;
    const vacLoss = gpi * (vacPct / 100);
    next.vacancy_loss = vacLoss ? vacLoss.toFixed(0) : "";

    const otherInc = parseFloat(next.other_income) || 0;
    const egi = gpi - vacLoss + otherInc;
    next.total_egi = egi.toString();

    // Management from percentage of EGI
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

  function updateField(field: keyof T12FormState, value: string) {
    setForm((prev) => recalc({ ...prev, [field]: value }));
  }

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

  const m = t12?.months?.[0];
  const totalUtilitiesDisplay = (m?.utilities_water || 0) + (m?.utilities_electric || 0) + (m?.utilities_gas || 0) || m?.utilities;

  // Display mode
  if (hasData && !editing) {
    return (
      <CollapsibleCard
        title="T12 Operating Statement"
        icon={<FileSpreadsheet className="h-4 w-4 text-orange-400" />}
        headerRight={
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800">
            Edit
          </Button>
        }
      >
          <table className="w-full text-sm">
            <tbody>
              {/* Income */}
              <tr>
                <td colSpan={2} className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-1 pb-2">Income</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Gross Potential Rent</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(t12?.total_gpi)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Vacancy Loss</td>
                <td className="text-red-400 text-right py-0.5">({fmt(m?.vacancy_loss)})</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Other Income</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.other_income)}</td>
              </tr>
              <tr className="border-t border-slate-800">
                <td className="text-slate-300 font-medium py-1">Effective Gross Income</td>
                <td className="text-white font-medium text-right py-1">{fmt(t12?.total_egi)}</td>
              </tr>

              {/* Expenses */}
              <tr>
                <td colSpan={2} className="text-xs font-semibold text-slate-400 uppercase tracking-wide pt-4 pb-2">Expenses (Annual)</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Property Taxes</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.property_taxes)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Insurance</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.insurance)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5 pl-0">Utilities — Water</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.utilities_water)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5 pl-0">Utilities — Electric</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.utilities_electric)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5 pl-0">Utilities — Gas</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.utilities_gas)}</td>
              </tr>
              {totalUtilitiesDisplay != null && totalUtilitiesDisplay > 0 && (
                <tr>
                  <td className="text-slate-500 py-0.5 text-xs italic pl-2">Total Utilities</td>
                  <td className="text-slate-400 text-right py-0.5 text-xs italic">{fmt(totalUtilitiesDisplay)}</td>
                </tr>
              )}
              <tr>
                <td className="text-slate-400 py-0.5">Repairs & Maintenance (Annual)</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.repairs_maintenance)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Management</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.management_fees)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Payroll</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.payroll)}</td>
              </tr>
              <tr>
                <td className="text-slate-400 py-0.5">Other Expenses</td>
                <td className="text-slate-200 text-right py-0.5">{fmt(m?.other_expenses)}</td>
              </tr>
              <tr className="border-t border-slate-800">
                <td className="text-slate-300 font-medium py-1">Total Operating Expenses</td>
                <td className="text-white font-medium text-right py-1">{fmt(t12?.total_opex)}</td>
              </tr>

              {/* NOI */}
              <tr className="border-t-2 border-slate-700">
                <td className="text-white font-semibold py-2">Net Operating Income</td>
                <td className="text-green-400 font-semibold text-right py-2">{fmt(t12?.total_noi)}</td>
              </tr>
            </tbody>
          </table>

          {/* Source & Notes */}
          <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-4 text-xs text-slate-500">
            {t12?.source && <span>Source: {SOURCE_LABELS[t12.source] || t12.source}</span>}
            {t12?.notes && <span>Notes: {t12.notes}</span>}
          </div>
      </CollapsibleCard>
    );
  }

  // Edit / Quick Entry mode
  const monthlyRent = rentRoll.reduce((sum, u) => sum + (u.current_rent || 0), 0);
  const annualRentFromRoll = monthlyRent * 12;

  return (
    <CollapsibleCard
      title={`T12 Operating Statement${!hasData ? " — Quick Entry" : ""}`}
      icon={<FileSpreadsheet className="h-4 w-4 text-orange-400" />}
    >
        <div className="space-y-4">
          {/* Income Section */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Income</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Gross Potential Rent
                  {annualRentFromRoll > 0 && (
                    <button onClick={fillFromRentRoll} className="text-blue-400 hover:text-blue-300 ml-1 text-[10px]">
                      (fill from rent roll: {fmt(annualRentFromRoll)})
                    </button>
                  )}
                </label>
                <div className="flex items-center">
                  <span className="text-slate-500 text-sm mr-1">$</span>
                  <input
                    type="number"
                    value={form.total_gpi}
                    onChange={(e) => updateField("total_gpi", e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full outline-none focus:border-blue-500"
                    placeholder="0"
                  />
                </div>
              </div>
              <NumberInput label="Vacancy Loss %" value={form.vacancy_loss_pct} onChange={(v) => updateField("vacancy_loss_pct", v)} suffix="%" />
              <NumberInput label="Vacancy Loss ($)" value={form.vacancy_loss} onChange={() => {}} readOnly />
              <NumberInput label="Other Income" value={form.other_income} onChange={(v) => updateField("other_income", v)} />
            </div>
            <div className="mt-2">
              <NumberInput label="Effective Gross Income" value={form.total_egi} onChange={() => {}} readOnly className="max-w-xs" />
            </div>
          </div>

          {/* Expense Section */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Expenses (Annual)</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumberInput label="Property Taxes" value={form.property_taxes} onChange={(v) => updateField("property_taxes", v)} />
              <NumberInput label="Insurance" value={form.insurance} onChange={(v) => updateField("insurance", v)} />
              <NumberInput label="Utilities — Water" value={form.utilities_water} onChange={(v) => updateField("utilities_water", v)} />
              <NumberInput label="Utilities — Electric" value={form.utilities_electric} onChange={(v) => updateField("utilities_electric", v)} />
              <NumberInput label="Utilities — Gas" value={form.utilities_gas} onChange={(v) => updateField("utilities_gas", v)} />
              <NumberInput label="Repairs & Maintenance (Annual)" value={form.repairs_maintenance} onChange={(v) => updateField("repairs_maintenance", v)} />
              <NumberInput label="Management Fee %" value={form.management_fee_pct} onChange={(v) => updateField("management_fee_pct", v)} suffix="%" />
              <NumberInput label="Management ($)" value={form.management_fees} onChange={() => {}} readOnly />
              <NumberInput label="Payroll" value={form.payroll} onChange={(v) => updateField("payroll", v)} />
              <NumberInput label="Other Expenses" value={form.other_expenses} onChange={(v) => updateField("other_expenses", v)} />
              <NumberInput label="Total OpEx" value={form.total_opex} onChange={() => {}} readOnly />
            </div>
          </div>

          {/* NOI */}
          <div className="border-t border-slate-800 pt-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">NOI (auto-calculated)</label>
                <div className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-green-400 font-semibold">
                  {fmt(parseFloat(form.total_noi) || 0)}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Source</label>
                <select
                  value={form.source}
                  onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full outline-none focus:border-blue-500"
                >
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-slate-400 block mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={1}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full outline-none focus:border-blue-500 resize-none"
                  placeholder="Source notes..."
                />
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2">
            {hasData && (
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} className="border-slate-700 text-slate-300 hover:bg-slate-800">
                Cancel
              </Button>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Save className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving..." : "Save T12 Summary"}
            </Button>
          </div>
        </div>
    </CollapsibleCard>
  );
}
