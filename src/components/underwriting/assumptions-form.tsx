"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Trash2, Save, Loader2, Plus, X, Download } from "lucide-react";
import type { Scenario, T12Statement } from "@/lib/validations";
import type { ScenarioInputs, CapexProject } from "@/lib/underwriting";

interface Props {
  scenario: Scenario;
  onUpdate: (updates: Partial<Record<string, unknown>>) => Promise<void>;
  onDelete: () => void;
  loading: boolean;
  dealT12?: T12Statement;
  dealUnits?: number;
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-800 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800/50 transition-colors rounded-lg"
      >
        {title}
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-500" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  suffix,
  step,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: string;
  min?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-slate-400">
        {label}
        {suffix && <span className="text-slate-600 ml-1">{suffix}</span>}
      </Label>
      <Input
        type="number"
        value={value || ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        step={step ?? "1"}
        min={min ?? "0"}
        className="bg-slate-800 border-slate-700 text-white text-sm h-8"
      />
    </div>
  );
}

export function AssumptionsForm({ scenario, onUpdate, onDelete, loading, dealT12, dealUnits }: Props) {
  const purchase = (scenario.purchase_assumptions ?? {}) as unknown as ScenarioInputs["purchase"];
  const financing = (scenario.financing_assumptions ?? {}) as unknown as ScenarioInputs["financing"];
  const revenue = (scenario.revenue_assumptions ?? {}) as unknown as ScenarioInputs["revenue"];
  const expenses = (scenario.expense_assumptions ?? {}) as unknown as ScenarioInputs["expenses"];
  const capex = (scenario.capex_assumptions ?? { projects: [] }) as unknown as ScenarioInputs["capex"];
  const exit = (scenario.exit_assumptions ?? {}) as unknown as ScenarioInputs["exit"];

  // Local state for editing
  const [p, setP] = useState(purchase);
  const [f, setF] = useState(financing);
  const [r, setR] = useState(revenue);
  const [e, setE] = useState(expenses);
  const [c, setC] = useState(capex);
  const [ex, setEx] = useState(exit);
  const [dirty, setDirty] = useState(false);

  function markDirty() {
    setDirty(true);
  }

  async function save() {
    await onUpdate({
      purchase_assumptions: p,
      financing_assumptions: f,
      revenue_assumptions: r,
      expense_assumptions: e,
      capex_assumptions: c,
      exit_assumptions: ex,
    });
    setDirty(false);
  }

  // Unit mix helpers
  const unitMix = r.unit_mix || [{ type: "Average", count: 1, current_rent: 1000, market_rent: 1100, renovated_rent_premium: 200 }];

  function updateUnitMix(index: number, field: string, value: number | string) {
    const updated = [...unitMix];
    updated[index] = { ...updated[index], [field]: value };
    setR({ ...r, unit_mix: updated });
    markDirty();
  }

  function addUnitType() {
    setR({
      ...r,
      unit_mix: [...unitMix, { type: "New Type", count: 1, current_rent: 1000, market_rent: 1100, renovated_rent_premium: 200 }],
    });
    markDirty();
  }

  function removeUnitType(index: number) {
    if (unitMix.length <= 1) return;
    setR({ ...r, unit_mix: unitMix.filter((_, i) => i !== index) });
    markDirty();
  }

  // CapEx project helpers
  const projects = c.projects || [];

  function addProject() {
    setC({
      ...c,
      projects: [
        ...projects,
        { name: "New Project", cost: 0, start_month: 1, duration_months: 1 },
      ],
    });
    markDirty();
  }

  function updateProject(index: number, field: string, value: number | string) {
    const updated = [...projects];
    updated[index] = { ...updated[index], [field]: value };
    setC({ ...c, projects: updated });
    markDirty();
  }

  function removeProject(index: number) {
    setC({ ...c, projects: projects.filter((_, i) => i !== index) });
    markDirty();
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">Assumptions</CardTitle>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                onClick={save}
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
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="border-slate-700 text-red-400 hover:bg-red-900/20"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Growth Rates */}
        <Section title="Growth Rates" defaultOpen>
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Rent Growth" value={r.rent_growth_rate * 100} suffix="%/yr" step="0.5" onChange={(v) => { setR({ ...r, rent_growth_rate: v / 100 }); markDirty(); }} />
            <NumField label="Expense Growth" value={(e.expense_escalation_rate || 0) * 100} suffix="%/yr" step="0.5" onChange={(v) => { setE({ ...e, expense_escalation_rate: v / 100 }); markDirty(); }} />
            <NumField label="Tax Escalation" value={e.tax_escalation_rate * 100} suffix="%/yr" step="0.5" onChange={(v) => { setE({ ...e, tax_escalation_rate: v / 100 }); markDirty(); }} />
          </div>
          <p className="text-xs text-slate-500 pt-1">
            Rent growth applies to all units annually. Expense growth applies to all operating expenses except taxes. Tax escalation applies to property taxes only.
          </p>
        </Section>

        {/* Purchase & Financing */}
        <Section title="Purchase & Financing" defaultOpen>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NumField label="Purchase Price" value={p.purchase_price} onChange={(v) => { setP({ ...p, purchase_price: v }); markDirty(); }} />
            <NumField label="Closing Costs" value={p.closing_cost_rate * 100} suffix="%" step="0.1" onChange={(v) => { setP({ ...p, closing_cost_rate: v / 100 }); markDirty(); }} />
            <NumField label="Earnest Money" value={p.earnest_money} onChange={(v) => { setP({ ...p, earnest_money: v }); markDirty(); }} />
            <NumField label="LTV" value={f.ltv * 100} suffix="%" step="0.5" onChange={(v) => { setF({ ...f, ltv: v / 100 }); markDirty(); }} />
            <NumField label="Interest Rate" value={f.interest_rate * 100} suffix="%" step="0.125" onChange={(v) => { setF({ ...f, interest_rate: v / 100 }); markDirty(); }} />
            <NumField label="Amortization" value={f.amortization_years} suffix="yrs" onChange={(v) => { setF({ ...f, amortization_years: v }); markDirty(); }} />
            <NumField label="Loan Term" value={f.loan_term_years} suffix="yrs" onChange={(v) => { setF({ ...f, loan_term_years: v }); markDirty(); }} />
            <NumField label="IO Period" value={f.io_period_months} suffix="mo" onChange={(v) => { setF({ ...f, io_period_months: v }); markDirty(); }} />
            <NumField label="Origination Fee" value={f.origination_fee_rate * 100} suffix="%" step="0.1" onChange={(v) => { setF({ ...f, origination_fee_rate: v / 100 }); markDirty(); }} />
          </div>
        </Section>

        {/* Bid & LOI */}
        <Section title="Bid & LOI">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumField label="Bid Price" value={p.bid_price || 0} onChange={(v) => { setP({ ...p, bid_price: v }); markDirty(); }} />
            <NumField label="LOI Amount" value={p.loi_amount || 0} onChange={(v) => { setP({ ...p, loi_amount: v }); markDirty(); }} />
            <div>
              <Label className="text-xs text-slate-400">LOI Date</Label>
              <Input
                type="date"
                value={p.loi_date || ""}
                onChange={(e) => { setP({ ...p, loi_date: e.target.value }); markDirty(); }}
                className="bg-slate-800 border-slate-700 text-white text-sm h-8"
              />
            </div>
            <NumField label="Earnest Money" value={p.earnest_money} onChange={(v) => { setP({ ...p, earnest_money: v }); markDirty(); }} />
          </div>
        </Section>

        {/* Revenue & Rent Roll */}
        <Section title="Revenue & Rent Roll">
          <div className="space-y-3">
            <div className="text-xs text-slate-500 font-medium">Unit Mix</div>
            {unitMix.map((unit, i) => (
              <div key={i} className="grid grid-cols-6 gap-2 items-end">
                <div>
                  <Label className="text-xs text-slate-400">Type</Label>
                  <Input
                    value={unit.type}
                    onChange={(e) => updateUnitMix(i, "type", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white text-sm h-8"
                  />
                </div>
                <NumField label="Count" value={unit.count} onChange={(v) => updateUnitMix(i, "count", v)} />
                <NumField label="Current Rent" value={unit.current_rent} onChange={(v) => updateUnitMix(i, "current_rent", v)} />
                <NumField label="Market Rent" value={unit.market_rent} onChange={(v) => updateUnitMix(i, "market_rent", v)} />
                <NumField label="Reno Premium" value={unit.renovated_rent_premium} onChange={(v) => updateUnitMix(i, "renovated_rent_premium", v)} />
                <div className="flex items-end pb-0.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeUnitType(i)}
                    disabled={unitMix.length <= 1}
                    className="border-slate-700 text-slate-500 hover:text-red-400 h-8"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={addUnitType}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              <Plus className="h-3 w-3 mr-1" /> Unit Type
            </Button>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <NumField label="Other Income" value={r.other_income_monthly} suffix="/mo" onChange={(v) => { setR({ ...r, other_income_monthly: v }); markDirty(); }} />
              <NumField label="Vacancy" value={r.vacancy_rate * 100} suffix="%" step="0.5" onChange={(v) => { setR({ ...r, vacancy_rate: v / 100 }); markDirty(); }} />
              <NumField label="Bad Debt" value={r.bad_debt_rate * 100} suffix="%" step="0.5" onChange={(v) => { setR({ ...r, bad_debt_rate: v / 100 }); markDirty(); }} />
            </div>
          </div>
        </Section>

        {/* T12 Operating Statement — scenario-local baseline */}
        <Section title="T12 Operating Statement">
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Trailing 12-month baseline for this scenario. Edit values below, then import to populate expense assumptions.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumField label="Gross Potential Rent" value={e.t12_baseline?.gross_potential_rent || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, gross_potential_rent: v } }); markDirty(); }} />
              <NumField label="Vacancy Loss" value={e.t12_baseline?.vacancy_loss || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, vacancy_loss: v } }); markDirty(); }} />
              <NumField label="Other Income" value={e.t12_baseline?.other_income || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, other_income: v } }); markDirty(); }} />
              <NumField label="Property Taxes" value={e.t12_baseline?.property_taxes || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, property_taxes: v } }); markDirty(); }} />
              <NumField label="Insurance" value={e.t12_baseline?.insurance || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, insurance: v } }); markDirty(); }} />
              <NumField label="Utilities" value={e.t12_baseline?.utilities || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, utilities: v } }); markDirty(); }} />
              <NumField label="R&M" value={e.t12_baseline?.repairs_maintenance || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, repairs_maintenance: v } }); markDirty(); }} />
              <NumField label="Payroll" value={e.t12_baseline?.payroll || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, payroll: v } }); markDirty(); }} />
              <NumField label="Management Fees" value={e.t12_baseline?.management_fees || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, management_fees: v } }); markDirty(); }} />
              <NumField label="Admin/Marketing" value={e.t12_baseline?.admin_marketing || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, admin_marketing: v } }); markDirty(); }} />
              <NumField label="Contract Svcs" value={e.t12_baseline?.contract_services || 0} suffix="/yr" onChange={(v) => { setE({ ...e, t12_baseline: { ...e.t12_baseline, contract_services: v } }); markDirty(); }} />
            </div>
            <div className="flex gap-2">
              {dealT12 && dealT12.months && dealT12.months.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const t12Sum = (field: string) =>
                      dealT12!.months.reduce((acc, m) => acc + ((m as unknown as Record<string, number>)[field] || 0), 0);
                    setE({
                      ...e,
                      t12_baseline: {
                        gross_potential_rent: t12Sum("gross_potential_rent") || t12Sum("rental_income"),
                        vacancy_loss: t12Sum("vacancy_loss"),
                        other_income: t12Sum("other_income"),
                        property_taxes: t12Sum("property_taxes"),
                        insurance: t12Sum("insurance"),
                        utilities: t12Sum("utilities") + t12Sum("utilities_water") + t12Sum("utilities_electric") + t12Sum("utilities_gas"),
                        repairs_maintenance: t12Sum("repairs_maintenance"),
                        payroll: t12Sum("payroll"),
                        management_fees: t12Sum("management_fees"),
                        admin_marketing: t12Sum("admin_expenses") + t12Sum("marketing"),
                        contract_services: t12Sum("contract_services"),
                      },
                    });
                    markDirty();
                  }}
                  className="border-slate-700 text-slate-400 hover:bg-slate-800"
                >
                  <Download className="h-3 w-3 mr-1" /> Load from Deal T12
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const t = e.t12_baseline || {};
                  const units = dealUnits || 1;
                  setE({
                    ...e,
                    property_tax_total: t.property_taxes || e.property_tax_total,
                    insurance_per_unit: t.insurance ? Math.round(t.insurance / units) : e.insurance_per_unit,
                    utilities_per_unit: t.utilities ? Math.round(t.utilities / units) : e.utilities_per_unit,
                    repairs_maintenance_per_unit: t.repairs_maintenance ? Math.round(t.repairs_maintenance / units) : e.repairs_maintenance_per_unit,
                    payroll_annual: t.payroll || e.payroll_annual,
                    admin_legal_marketing: t.admin_marketing || e.admin_legal_marketing,
                    contract_services: t.contract_services || e.contract_services,
                  });
                  markDirty();
                }}
                className="border-slate-700 text-blue-400 hover:bg-blue-900/20"
              >
                <Download className="h-3 w-3 mr-1" /> Import to Expenses
              </Button>
            </div>
          </div>
        </Section>

        {/* Operating Expenses */}
        <Section title="Operating Expenses">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NumField label="Mgmt Fee" value={e.management_fee_rate * 100} suffix="% EGI" step="0.5" onChange={(v) => { setE({ ...e, management_fee_rate: v / 100 }); markDirty(); }} />
            <NumField label="Payroll" value={e.payroll_annual} suffix="/yr" onChange={(v) => { setE({ ...e, payroll_annual: v }); markDirty(); }} />
            <NumField label="R&M" value={e.repairs_maintenance_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, repairs_maintenance_per_unit: v }); markDirty(); }} />
            <NumField label="Turnover" value={e.turnover_cost_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, turnover_cost_per_unit: v }); markDirty(); }} />
            <NumField label="Insurance" value={e.insurance_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, insurance_per_unit: v }); markDirty(); }} />
            <NumField label="Property Tax" value={e.property_tax_total} suffix="/yr total" onChange={(v) => { setE({ ...e, property_tax_total: v }); markDirty(); }} />
            <NumField label="Utilities" value={e.utilities_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, utilities_per_unit: v }); markDirty(); }} />
            <NumField label="Admin/Legal/Mktg" value={e.admin_legal_marketing} suffix="/yr" onChange={(v) => { setE({ ...e, admin_legal_marketing: v }); markDirty(); }} />
            <NumField label="Contract Svcs" value={e.contract_services} suffix="/yr" onChange={(v) => { setE({ ...e, contract_services: v }); markDirty(); }} />
            <NumField label="Reserves" value={e.reserves_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, reserves_per_unit: v }); markDirty(); }} />
          </div>
        </Section>

        {/* CapEx: Per-Unit Renovations */}
        <Section title="CapEx: Per-Unit Renovations">
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Cost / Unit" value={c.per_unit_cost} onChange={(v) => { setC({ ...c, per_unit_cost: v }); markDirty(); }} />
            <NumField label="Units to Renovate" value={c.units_to_renovate} onChange={(v) => { setC({ ...c, units_to_renovate: v }); markDirty(); }} />
            <NumField label="Units / Month" value={c.units_per_month} onChange={(v) => { setC({ ...c, units_per_month: v }); markDirty(); }} />
          </div>
        </Section>

        {/* CapEx: Projects */}
        <Section title="CapEx: Named Projects">
          <div className="space-y-2">
            {projects.map((proj: CapexProject, i: number) => (
              <div key={i} className="grid grid-cols-5 gap-2 items-end">
                <div>
                  <Label className="text-xs text-slate-400">Project Name</Label>
                  <Input
                    value={proj.name}
                    onChange={(e) => updateProject(i, "name", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white text-sm h-8"
                  />
                </div>
                <NumField label="Cost" value={proj.cost} onChange={(v) => updateProject(i, "cost", v)} />
                <NumField label="Start Month" value={proj.start_month} onChange={(v) => updateProject(i, "start_month", v)} />
                <NumField label="Duration" value={proj.duration_months} suffix="mo" onChange={(v) => updateProject(i, "duration_months", v)} />
                <div className="flex items-end pb-0.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeProject(i)}
                    className="border-slate-700 text-slate-500 hover:text-red-400 h-8"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={addProject}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              <Plus className="h-3 w-3 mr-1" /> Add Project
            </Button>
          </div>
        </Section>

        {/* Exit / Sale */}
        <Section title="Exit / Refi / Sale">
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Hold Period" value={ex.hold_period_years} suffix="yrs" onChange={(v) => { setEx({ ...ex, hold_period_years: v }); markDirty(); }} />
            <NumField label="Exit Cap Rate" value={ex.exit_cap_rate * 100} suffix="%" step="0.1" onChange={(v) => { setEx({ ...ex, exit_cap_rate: v / 100 }); markDirty(); }} />
            <NumField label="Selling Costs" value={ex.selling_cost_rate * 100} suffix="%" step="0.1" onChange={(v) => { setEx({ ...ex, selling_cost_rate: v / 100 }); markDirty(); }} />
          </div>
        </Section>
      </CardContent>
    </Card>
  );
}

