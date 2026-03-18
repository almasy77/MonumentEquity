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

// Format number with commas for display
function formatWithCommas(n: number): string {
  if (!n && n !== 0) return "";
  return n.toLocaleString("en-US");
}

// Currency input that displays with commas and $ prefix
function CurrencyField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [editValue, setEditValue] = useState("");

  const displayValue = value ? `$${formatWithCommas(value)}` : "";

  return (
    <div>
      <Label className="text-xs text-slate-400">
        {label}
        {suffix && <span className="text-slate-600 ml-1">{suffix}</span>}
      </Label>
      <Input
        type="text"
        value={focused ? editValue : displayValue}
        onFocus={() => {
          setFocused(true);
          setEditValue(value ? String(value) : "");
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseFloat(editValue.replace(/[^0-9.-]/g, ""));
          onChange(isNaN(parsed) ? 0 : parsed);
        }}
        onChange={(e) => setEditValue(e.target.value)}
        className="bg-slate-800 border-slate-700 text-white text-sm h-8"
      />
    </div>
  );
}

// Percentage input that avoids floating point display issues
function PctField({
  label,
  value,
  onChange,
  step,
  suffix,
}: {
  label: string;
  value: number; // stored as decimal e.g. 0.07
  onChange: (v: number) => void;
  step?: string;
  suffix?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [editValue, setEditValue] = useState("");

  // Display with fixed precision to avoid floating point noise
  const displayPct = Math.round(value * 10000) / 100;
  const displayStr = displayPct ? `${displayPct}` : "";

  return (
    <div>
      <Label className="text-xs text-slate-400">
        {label}
        <span className="text-slate-600 ml-1">{suffix || "%"}</span>
      </Label>
      <Input
        type="text"
        inputMode="decimal"
        value={focused ? editValue : displayStr}
        onFocus={() => {
          setFocused(true);
          setEditValue(displayPct ? String(displayPct) : "");
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseFloat(editValue);
          if (!isNaN(parsed)) {
            onChange(Math.round(parsed * 100) / 10000);
          }
        }}
        onChange={(e) => setEditValue(e.target.value)}
        className="bg-slate-800 border-slate-700 text-white text-sm h-8"
      />
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

// Read-only display field for computed values
function ReadOnlyField({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-slate-400">
        {label}
        {suffix && <span className="text-slate-600 ml-1">{suffix}</span>}
      </Label>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-md text-slate-300 text-sm h-8 px-3 flex items-center">
        {value}
      </div>
    </div>
  );
}

function fmtCurrency(n: number): string {
  if (!n) return "$0";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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

  // ── Computed T12 values from Revenue & OpEx ──
  const totalUnits = unitMix.reduce((sum, u) => sum + u.count, 0);
  const t12GPR = unitMix.reduce((sum, u) => sum + u.count * u.current_rent * 12, 0);
  const t12VacancyLoss = t12GPR * (r.vacancy_rate || 0);
  const t12BadDebt = t12GPR * (r.bad_debt_rate || 0);
  const t12OtherIncome = (r.other_income_monthly || 0) * 12;
  const t12EGI = t12GPR - t12VacancyLoss - t12BadDebt + t12OtherIncome;
  const t12MgmtFees = t12EGI * (e.management_fee_rate || 0);
  const t12Payroll = e.payroll_annual || 0;
  const t12RM = (e.repairs_maintenance_per_unit || 0) * totalUnits;
  const t12Turnover = (e.turnover_cost_per_unit || 0) * totalUnits;
  const t12Insurance = (e.insurance_per_unit || 0) * totalUnits;
  const t12PropertyTax = e.property_tax_total || 0;
  const t12Utilities = (e.utilities_per_unit || 0) * totalUnits;
  const t12Admin = e.admin_legal_marketing || 0;
  const t12ContractSvcs = e.contract_services || 0;
  const t12Reserves = (e.reserves_per_unit || 0) * totalUnits;
  const t12TotalOpex = t12MgmtFees + t12Payroll + t12RM + t12Turnover + t12Insurance + t12PropertyTax + t12Utilities + t12Admin + t12ContractSvcs + t12Reserves;
  const t12NOI = t12EGI - t12TotalOpex;

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
        {/* Bid & LOI — moved to top */}
        <Section title="Bid & LOI" defaultOpen>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CurrencyField label="Bid Price" value={p.bid_price || 0} onChange={(v) => {
              setP({ ...p, bid_price: v, purchase_price: v || p.purchase_price });
              markDirty();
            }} />
            <CurrencyField label="LOI Amount" value={p.loi_amount || 0} onChange={(v) => { setP({ ...p, loi_amount: v }); markDirty(); }} />
            <div>
              <Label className="text-xs text-slate-400">LOI Date</Label>
              <Input
                type="date"
                value={p.loi_date || ""}
                onChange={(e) => { setP({ ...p, loi_date: e.target.value }); markDirty(); }}
                className="bg-slate-800 border-slate-700 text-white text-sm h-8"
              />
            </div>
            <CurrencyField label="Earnest Money" value={p.earnest_money} onChange={(v) => { setP({ ...p, earnest_money: v }); markDirty(); }} />
          </div>
        </Section>

        {/* Purchase & Financing — purchase price auto-fills from bid price */}
        <Section title="Purchase & Financing" defaultOpen>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <CurrencyField label="Purchase Price" value={p.purchase_price} onChange={(v) => { setP({ ...p, purchase_price: v }); markDirty(); }} />
            <PctField label="Closing Costs" value={p.closing_cost_rate} onChange={(v) => { setP({ ...p, closing_cost_rate: v }); markDirty(); }} />
            <CurrencyField label="Earnest Money" value={p.earnest_money} onChange={(v) => { setP({ ...p, earnest_money: v }); markDirty(); }} />
            <PctField label="LTV" value={f.ltv} onChange={(v) => { setF({ ...f, ltv: v }); markDirty(); }} />
            <PctField label="Interest Rate" value={f.interest_rate} onChange={(v) => { setF({ ...f, interest_rate: v }); markDirty(); }} />
            <NumField label="Amortization" value={f.amortization_years} suffix="yrs" onChange={(v) => { setF({ ...f, amortization_years: v }); markDirty(); }} />
            <NumField label="Loan Term" value={f.loan_term_years} suffix="yrs" onChange={(v) => { setF({ ...f, loan_term_years: v }); markDirty(); }} />
            <NumField label="IO Period" value={f.io_period_months} suffix="mo" onChange={(v) => { setF({ ...f, io_period_months: v }); markDirty(); }} />
            <PctField label="Origination Fee" value={f.origination_fee_rate} onChange={(v) => { setF({ ...f, origination_fee_rate: v }); markDirty(); }} />
          </div>
        </Section>

        {/* Growth Rates */}
        <Section title="Growth Rates" defaultOpen>
          <div className="grid grid-cols-3 gap-3">
            <PctField label="Rent Growth" value={r.rent_growth_rate} suffix="%/yr" onChange={(v) => { setR({ ...r, rent_growth_rate: v }); markDirty(); }} />
            <PctField label="Expense Growth" value={e.expense_escalation_rate || 0} suffix="%/yr" onChange={(v) => { setE({ ...e, expense_escalation_rate: v }); markDirty(); }} />
            <PctField label="Tax Escalation" value={e.tax_escalation_rate} suffix="%/yr" onChange={(v) => { setE({ ...e, tax_escalation_rate: v }); markDirty(); }} />
          </div>
          <p className="text-xs text-slate-500 pt-1">
            Rent growth applies to all units annually. Expense growth applies to all operating expenses except taxes. Tax escalation applies to property taxes only.
          </p>
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
                <CurrencyField label="Current Rent" value={unit.current_rent} onChange={(v) => updateUnitMix(i, "current_rent", v)} />
                <CurrencyField label="Market Rent" value={unit.market_rent} onChange={(v) => updateUnitMix(i, "market_rent", v)} />
                <CurrencyField label="Reno Premium" value={unit.renovated_rent_premium} onChange={(v) => updateUnitMix(i, "renovated_rent_premium", v)} />
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
              <CurrencyField label="Other Income" value={r.other_income_monthly} suffix="/mo" onChange={(v) => { setR({ ...r, other_income_monthly: v }); markDirty(); }} />
              <PctField label="Vacancy" value={r.vacancy_rate} onChange={(v) => { setR({ ...r, vacancy_rate: v }); markDirty(); }} />
              <PctField label="Bad Debt" value={r.bad_debt_rate} onChange={(v) => { setR({ ...r, bad_debt_rate: v }); markDirty(); }} />
            </div>
          </div>
        </Section>

        {/* Operating Expenses — now above T12 */}
        <Section title="Operating Expenses">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <PctField label="Mgmt Fee" value={e.management_fee_rate} suffix="% EGI" onChange={(v) => { setE({ ...e, management_fee_rate: v }); markDirty(); }} />
            <CurrencyField label="Payroll" value={e.payroll_annual} suffix="/yr" onChange={(v) => { setE({ ...e, payroll_annual: v }); markDirty(); }} />
            <CurrencyField label="R&M" value={e.repairs_maintenance_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, repairs_maintenance_per_unit: v }); markDirty(); }} />
            <CurrencyField label="Turnover" value={e.turnover_cost_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, turnover_cost_per_unit: v }); markDirty(); }} />
            <CurrencyField label="Insurance" value={e.insurance_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, insurance_per_unit: v }); markDirty(); }} />
            <CurrencyField label="Property Tax" value={e.property_tax_total} suffix="/yr total" onChange={(v) => { setE({ ...e, property_tax_total: v }); markDirty(); }} />
            <CurrencyField label="Utilities" value={e.utilities_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, utilities_per_unit: v }); markDirty(); }} />
            <CurrencyField label="Admin/Legal/Mktg" value={e.admin_legal_marketing} suffix="/yr" onChange={(v) => { setE({ ...e, admin_legal_marketing: v }); markDirty(); }} />
            <CurrencyField label="Contract Svcs" value={e.contract_services} suffix="/yr" onChange={(v) => { setE({ ...e, contract_services: v }); markDirty(); }} />
            <CurrencyField label="Reserves" value={e.reserves_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, reserves_per_unit: v }); markDirty(); }} />
          </div>
        </Section>

        {/* T12 Operating Statement — read-only, computed from Revenue & OpEx */}
        <Section title="T12 Operating Statement">
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Auto-calculated from Revenue &amp; Rent Roll and Operating Expenses above.
            </p>

            {/* Revenue section */}
            <div className="text-xs text-slate-500 font-medium pt-1">Revenue</div>
            <div className="border border-slate-800/50 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Gross Potential Rent</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12GPR)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Less: Vacancy Loss</td>
                    <td className="px-3 py-1.5 text-right text-red-400">({fmtCurrency(t12VacancyLoss)})</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Less: Bad Debt</td>
                    <td className="px-3 py-1.5 text-right text-red-400">({fmtCurrency(t12BadDebt)})</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Plus: Other Income</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12OtherIncome)}</td>
                  </tr>
                  <tr className="border-b border-slate-800 bg-slate-800/30">
                    <td className="px-3 py-1.5 text-slate-200 font-medium">Effective Gross Income</td>
                    <td className="px-3 py-1.5 text-right text-slate-200 font-medium">{fmtCurrency(t12EGI)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Expenses section */}
            <div className="text-xs text-slate-500 font-medium pt-1">Operating Expenses</div>
            <div className="border border-slate-800/50 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Management Fees</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12MgmtFees)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Payroll</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12Payroll)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Repairs & Maintenance</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12RM)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Turnover</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12Turnover)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Insurance</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12Insurance)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Property Tax</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12PropertyTax)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Utilities</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12Utilities)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Admin / Legal / Marketing</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12Admin)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Contract Services</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12ContractSvcs)}</td>
                  </tr>
                  <tr className="border-b border-slate-800/50">
                    <td className="px-3 py-1.5 text-slate-400">Reserves</td>
                    <td className="px-3 py-1.5 text-right text-slate-200">{fmtCurrency(t12Reserves)}</td>
                  </tr>
                  <tr className="border-b border-slate-800 bg-slate-800/30">
                    <td className="px-3 py-1.5 text-slate-200 font-medium">Total Operating Expenses</td>
                    <td className="px-3 py-1.5 text-right text-slate-200 font-medium">{fmtCurrency(t12TotalOpex)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* NOI */}
            <div className="border border-slate-800/50 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  <tr className="bg-slate-800/50">
                    <td className="px-3 py-2 text-white font-semibold">Net Operating Income (NOI)</td>
                    <td className={`px-3 py-2 text-right font-semibold ${t12NOI >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {fmtCurrency(t12NOI)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Load from Deal T12 button — still allows importing historical data to OpEx */}
            {dealT12 && dealT12.months && dealT12.months.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const t12Sum = (field: string) =>
                      dealT12!.months.reduce((acc, m) => acc + ((m as unknown as Record<string, number>)[field] || 0), 0);
                    const units = dealUnits || 1;
                    setE({
                      ...e,
                      property_tax_total: t12Sum("property_taxes") || e.property_tax_total,
                      insurance_per_unit: t12Sum("insurance") ? Math.round(t12Sum("insurance") / units) : e.insurance_per_unit,
                      utilities_per_unit: (t12Sum("utilities") + t12Sum("utilities_water") + t12Sum("utilities_electric") + t12Sum("utilities_gas"))
                        ? Math.round((t12Sum("utilities") + t12Sum("utilities_water") + t12Sum("utilities_electric") + t12Sum("utilities_gas")) / units)
                        : e.utilities_per_unit,
                      repairs_maintenance_per_unit: t12Sum("repairs_maintenance") ? Math.round(t12Sum("repairs_maintenance") / units) : e.repairs_maintenance_per_unit,
                      payroll_annual: t12Sum("payroll") || e.payroll_annual,
                      admin_legal_marketing: (t12Sum("admin_expenses") + t12Sum("marketing")) || e.admin_legal_marketing,
                      contract_services: t12Sum("contract_services") || e.contract_services,
                    });
                    markDirty();
                  }}
                  className="border-slate-700 text-blue-400 hover:bg-blue-900/20"
                >
                  <Download className="h-3 w-3 mr-1" /> Import Deal T12 to Expenses
                </Button>
              </div>
            )}
          </div>
        </Section>

        {/* CapEx: Per-Unit Renovations */}
        <Section title="CapEx: Per-Unit Renovations">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CurrencyField label="Cost / Unit" value={c.per_unit_cost} onChange={(v) => { setC({ ...c, per_unit_cost: v }); markDirty(); }} />
            <NumField label="Units to Renovate" value={c.units_to_renovate} onChange={(v) => { setC({ ...c, units_to_renovate: v }); markDirty(); }} />
            <NumField label="Units / Month" value={c.units_per_month} onChange={(v) => { setC({ ...c, units_per_month: v }); markDirty(); }} />
            <NumField label="Start Month" value={c.renovation_start_month || 1} suffix="mo" onChange={(v) => { setC({ ...c, renovation_start_month: v }); markDirty(); }} />
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
                <CurrencyField label="Cost" value={proj.cost} onChange={(v) => updateProject(i, "cost", v)} />
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

        {/* Exit */}
        <Section title="Exit">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumField label="Hold Period" value={ex.hold_period_years} suffix="yrs" onChange={(v) => { setEx({ ...ex, hold_period_years: v }); markDirty(); }} />
            <CurrencyField label="Sale Price" value={ex.sale_price || 0} onChange={(v) => { setEx({ ...ex, sale_price: v }); markDirty(); }} />
            <PctField label="Selling Costs" value={ex.selling_cost_rate} onChange={(v) => { setEx({ ...ex, selling_cost_rate: v }); markDirty(); }} />
            {ex.sale_price && ex.sale_price > 0 ? (
              <ReadOnlyField
                label="Exit Cap Rate"
                suffix="(calculated)"
                value={
                  t12NOI > 0
                    ? `${((t12NOI / ex.sale_price) * 100).toFixed(2)}%`
                    : "—"
                }
              />
            ) : (
              <PctField label="Exit Cap Rate" value={ex.exit_cap_rate} onChange={(v) => { setEx({ ...ex, exit_cap_rate: v }); markDirty(); }} />
            )}
          </div>
          <p className="text-xs text-slate-500 pt-1">
            {ex.sale_price && ex.sale_price > 0
              ? "Exit cap rate is calculated from Sale Price and projected NOI."
              : "Enter a sale price to auto-calculate exit cap rate, or set the cap rate directly."}
          </p>
        </Section>
      </CardContent>
    </Card>
  );
}
