"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Loader2, RotateCcw } from "lucide-react";
import { DEFAULT_ASSUMPTIONS } from "@/lib/constants";

type Assumptions = Record<string, number>;

const FIELDS: Array<{
  key: string;
  label: string;
  suffix: string;
  step: string;
  pct?: boolean;
}> = [
  { key: "vacancy_rate", label: "Vacancy Rate", suffix: "%", step: "0.5", pct: true },
  { key: "bad_debt_rate", label: "Bad Debt Rate", suffix: "%", step: "0.5", pct: true },
  { key: "management_fee_rate", label: "Management Fee", suffix: "% of EGI", step: "0.5", pct: true },
  { key: "repairs_maintenance_per_unit", label: "R&M", suffix: "/unit/yr", step: "25" },
  { key: "turnover_cost_per_unit", label: "Turnover Cost", suffix: "/unit/yr", step: "25" },
  { key: "insurance_per_unit", label: "Insurance", suffix: "/unit/yr", step: "25" },
  { key: "utilities_per_unit", label: "Utilities", suffix: "/unit/yr", step: "25" },
  { key: "reserves_per_unit", label: "Reserves", suffix: "/unit/yr", step: "25" },
  { key: "tax_escalation_rate", label: "Tax Escalation", suffix: "%/yr", step: "0.25", pct: true },
  { key: "rent_growth_rate", label: "Rent Growth", suffix: "%/yr", step: "0.25", pct: true },
  { key: "ltv", label: "LTV", suffix: "%", step: "0.5", pct: true },
  { key: "interest_rate", label: "Interest Rate", suffix: "%", step: "0.125", pct: true },
  { key: "amortization_years", label: "Amortization", suffix: "yrs", step: "1" },
  { key: "loan_term_years", label: "Loan Term", suffix: "yrs", step: "1" },
  { key: "io_period_months", label: "IO Period", suffix: "months", step: "1" },
  { key: "origination_fee_rate", label: "Origination Fee", suffix: "%", step: "0.1", pct: true },
  { key: "closing_cost_rate", label: "Closing Costs", suffix: "%", step: "0.1", pct: true },
  { key: "selling_cost_rate", label: "Selling Costs", suffix: "%", step: "0.1", pct: true },
  { key: "hold_period_years", label: "Hold Period", suffix: "yrs", step: "1" },
  { key: "exit_cap_rate_spread", label: "Exit Cap Spread", suffix: "bps", step: "25", pct: true },
];

export function DefaultAssumptionsForm() {
  const [values, setValues] = useState<Assumptions>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setValues(data.default_assumptions || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function getValue(key: string, pct?: boolean): number {
    const stored = values[key] ?? (DEFAULT_ASSUMPTIONS as Assumptions)[key] ?? 0;
    return pct ? stored * 100 : stored;
  }

  function setValue(key: string, displayVal: number, pct?: boolean) {
    setValues((prev) => ({
      ...prev,
      [key]: pct ? displayVal / 100 : displayVal,
    }));
    setDirty(true);
  }

  function resetToDefaults() {
    setValues(DEFAULT_ASSUMPTIONS as unknown as Assumptions);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_assumptions: values }),
      });
      setDirty(false);
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <Label className="text-xs text-slate-400">
              {field.label}
              <span className="text-slate-600 ml-1">{field.suffix}</span>
            </Label>
            <Input
              type="number"
              value={getValue(field.key, field.pct) || ""}
              onChange={(e) =>
                setValue(field.key, parseFloat(e.target.value) || 0, field.pct)
              }
              step={field.step}
              className="bg-slate-800 border-slate-700 text-white text-sm h-8"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          onClick={save}
          disabled={!dirty || saving}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Save className="h-4 w-4 mr-1" /> Save Defaults
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={resetToDefaults}
          className="border-slate-700 text-slate-400 hover:bg-slate-800"
        >
          <RotateCcw className="h-4 w-4 mr-1" /> Reset to System Defaults
        </Button>
      </div>
    </div>
  );
}
