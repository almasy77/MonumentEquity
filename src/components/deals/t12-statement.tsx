"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Save } from "lucide-react";
import type { T12Statement } from "@/lib/validations";

function fmt(n: number | undefined | null): string {
  if (n == null) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
  vacancy_loss: string;
  other_income: string;
  total_egi: string;
  property_taxes: string;
  insurance: string;
  utilities: string;
  repairs_maintenance: string;
  management_fees: string;
  payroll: string;
  other_expenses: string;
  total_opex: string;
  total_noi: string;
  source: string;
  notes: string;
}

function t12ToForm(t12: T12Statement | undefined): T12FormState {
  return {
    total_gpi: t12?.total_gpi?.toString() || "",
    vacancy_loss: t12?.months?.[0]?.vacancy_loss?.toString() || "",
    other_income: t12?.months?.[0]?.other_income?.toString() || "",
    total_egi: t12?.total_egi?.toString() || "",
    property_taxes: t12?.months?.[0]?.property_taxes?.toString() || "",
    insurance: t12?.months?.[0]?.insurance?.toString() || "",
    utilities: t12?.months?.[0]?.utilities?.toString() || "",
    repairs_maintenance: t12?.months?.[0]?.repairs_maintenance?.toString() || "",
    management_fees: t12?.months?.[0]?.management_fees?.toString() || "",
    payroll: t12?.months?.[0]?.payroll?.toString() || "",
    other_expenses: t12?.months?.[0]?.other_expenses?.toString() || "",
    total_opex: t12?.total_opex?.toString() || "",
    total_noi: t12?.total_noi?.toString() || "",
    source: t12?.source || "estimated",
    notes: t12?.notes || "",
  };
}

function NumberInput({ label, value, onChange, readOnly = false }: { label: string; value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      <div className="flex items-center">
        <span className="text-slate-500 text-sm mr-1">$</span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          className={`bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white w-full outline-none focus:border-blue-500 ${readOnly ? "text-slate-400 cursor-not-allowed" : ""}`}
          placeholder="0"
        />
      </div>
    </div>
  );
}

export function T12StatementPanel({ dealId, t12 }: { dealId: string; t12: T12Statement | undefined }) {
  const router = useRouter();
  const hasData = t12 && (t12.total_noi || t12.total_egi || t12.total_opex);
  const [editing, setEditing] = useState(!hasData);
  const [form, setForm] = useState<T12FormState>(t12ToForm(t12));
  const [saving, setSaving] = useState(false);

  function updateField(field: keyof T12FormState, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-calculate EGI and NOI
      const gpi = parseFloat(next.total_gpi) || 0;
      const vacLoss = parseFloat(next.vacancy_loss) || 0;
      const otherInc = parseFloat(next.other_income) || 0;
      const egi = gpi - vacLoss + otherInc;
      next.total_egi = egi.toString();

      const taxes = parseFloat(next.property_taxes) || 0;
      const ins = parseFloat(next.insurance) || 0;
      const util = parseFloat(next.utilities) || 0;
      const rm = parseFloat(next.repairs_maintenance) || 0;
      const mgmt = parseFloat(next.management_fees) || 0;
      const pay = parseFloat(next.payroll) || 0;
      const otherExp = parseFloat(next.other_expenses) || 0;
      const opex = taxes + ins + util + rm + mgmt + pay + otherExp;
      next.total_opex = opex.toString();
      next.total_noi = (egi - opex).toString();

      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
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
          utilities: parseFloat(form.utilities) || undefined,
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

  // Display mode
  if (hasData && !editing) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> T12 Operating Statement
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="h-7 text-xs border-slate-700 text-slate-300 hover:bg-slate-800">
              Edit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
            {/* Income */}
            <div className="col-span-2 text-xs font-semibold text-slate-400 uppercase tracking-wide mt-1">Income</div>
            <span className="text-slate-400">Gross Potential Rent</span>
            <span className="text-slate-200 text-right">{fmt(t12?.total_gpi)}</span>
            <span className="text-slate-400">Vacancy Loss</span>
            <span className="text-red-400 text-right">({fmt(t12?.months?.[0]?.vacancy_loss)})</span>
            <span className="text-slate-400">Other Income</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.other_income)}</span>
            <span className="text-slate-300 font-medium">Effective Gross Income</span>
            <span className="text-white font-medium text-right">{fmt(t12?.total_egi)}</span>

            {/* Expenses */}
            <div className="col-span-2 text-xs font-semibold text-slate-400 uppercase tracking-wide mt-3">Expenses</div>
            <span className="text-slate-400">Property Taxes</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.property_taxes)}</span>
            <span className="text-slate-400">Insurance</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.insurance)}</span>
            <span className="text-slate-400">Utilities</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.utilities)}</span>
            <span className="text-slate-400">Repairs & Maintenance</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.repairs_maintenance)}</span>
            <span className="text-slate-400">Management</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.management_fees)}</span>
            <span className="text-slate-400">Payroll</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.payroll)}</span>
            <span className="text-slate-400">Other Expenses</span>
            <span className="text-slate-200 text-right">{fmt(t12?.months?.[0]?.other_expenses)}</span>
            <span className="text-slate-300 font-medium">Total Operating Expenses</span>
            <span className="text-white font-medium text-right">{fmt(t12?.total_opex)}</span>

            {/* NOI */}
            <div className="col-span-2 border-t border-slate-800 mt-2 pt-2">
              <div className="flex justify-between">
                <span className="text-white font-semibold">Net Operating Income</span>
                <span className="text-green-400 font-semibold">{fmt(t12?.total_noi)}</span>
              </div>
            </div>
          </div>

          {/* Source & Notes */}
          <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-4 text-xs text-slate-500">
            {t12?.source && <span>Source: {SOURCE_LABELS[t12.source] || t12.source}</span>}
            {t12?.notes && <span>Notes: {t12.notes}</span>}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Edit / Quick Entry mode
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" /> T12 Operating Statement {!hasData && <span className="text-xs text-slate-500 font-normal">- Quick Entry</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Income Section */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Income</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumberInput label="Total GPR" value={form.total_gpi} onChange={(v) => updateField("total_gpi", v)} />
              <NumberInput label="Vacancy Loss" value={form.vacancy_loss} onChange={(v) => updateField("vacancy_loss", v)} />
              <NumberInput label="Other Income" value={form.other_income} onChange={(v) => updateField("other_income", v)} />
              <NumberInput label="Effective Gross Income" value={form.total_egi} onChange={() => {}} readOnly />
            </div>
          </div>

          {/* Expense Section */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Expenses</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumberInput label="Property Taxes" value={form.property_taxes} onChange={(v) => updateField("property_taxes", v)} />
              <NumberInput label="Insurance" value={form.insurance} onChange={(v) => updateField("insurance", v)} />
              <NumberInput label="Utilities" value={form.utilities} onChange={(v) => updateField("utilities", v)} />
              <NumberInput label="Repairs & Maintenance" value={form.repairs_maintenance} onChange={(v) => updateField("repairs_maintenance", v)} />
              <NumberInput label="Management" value={form.management_fees} onChange={(v) => updateField("management_fees", v)} />
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
      </CardContent>
    </Card>
  );
}
