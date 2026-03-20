"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Trash2, Save, Loader2, Plus, X, Download } from "lucide-react";
import type { Scenario, T12Statement } from "@/lib/validations";
import type { ScenarioInputs, CapexProject, DepreciationAssumptions, ClosingCostMode } from "@/lib/underwriting";
import { sumClosingCostBreakdown } from "@/lib/underwriting";

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
    <div className="border border-slate-800 rounded-lg hover:border-slate-600 transition-colors group/section">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800/50 hover:text-white transition-colors rounded-lg"
      >
        {title}
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-500 group-hover/section:text-slate-300" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-500 group-hover/section:text-slate-300" />
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
        className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
      />
    </div>
  );
}

// Percentage input that avoids floating point display issues
function PctField({
  label,
  value,
  onChange,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
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
        className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
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
  const depreciation = ((scenario as Record<string, unknown>).depreciation_assumptions ?? {}) as unknown as DepreciationAssumptions;

  // Local state for editing
  const [p, setP] = useState(purchase);
  const [f, setF] = useState(financing);
  const [r, setR] = useState(revenue);
  const [e, setE] = useState(expenses);
  const [c, setC] = useState(capex);
  const [ex, setEx] = useState(exit);
  const [dep, setDep] = useState(depreciation);
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
      depreciation_assumptions: dep,
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
      unit_mix: [...unitMix, { type: "", count: 1, current_rent: 1000, market_rent: 1100, renovated_rent_premium: 200 }],
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
        { name: "", cost: 0, start_month: 1, duration_months: 1 },
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

  const totalUnits = unitMix.reduce((sum, u) => sum + u.count, 0);

  // Lightweight NOI estimate for display in Exit section & reserves % EGI
  const t12GPR = unitMix.reduce((sum, u) => sum + u.count * u.current_rent * 12, 0);
  const t12EGI = t12GPR * (1 - (r.vacancy_rate || 0) - (r.bad_debt_rate || 0) - (r.concessions_rate || 0)) + (r.other_income_monthly || 0) * 12;
  const t12TotalOpex = t12EGI * (e.management_fee_rate || 0)
    + (e.payroll_annual || 0)
    + (e.repairs_maintenance_per_unit || 0) * totalUnits
    + (e.turnover_cost_per_unit || 0) * totalUnits
    + (e.insurance_per_unit || 0) * totalUnits
    + (e.property_tax_total || 0)
    + (e.utilities_per_unit || 0) * totalUnits
    + (e.admin_legal_marketing || 0)
    + (e.contract_services || 0)
    + (e.reserves_per_unit || 0) * totalUnits;
  const t12NOI = t12EGI - t12TotalOpex;

  return (
    <Card className={`bg-slate-900 ${dirty ? "border-yellow-700/60" : "border-slate-800"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base flex items-center gap-2">
            Assumptions
            {dirty && <span className="inline-block w-2 h-2 rounded-full bg-yellow-500" title="Unsaved changes" />}
          </CardTitle>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <CurrencyField label="Bid Price" value={p.bid_price || 0} onChange={(v) => {
              setP({ ...p, bid_price: v, loi_amount: v, purchase_price: v || p.purchase_price });
              markDirty();
            }} />
            <div>
              <Label className="text-xs text-slate-400">LOI Date</Label>
              <Input
                type="date"
                value={p.loi_date || ""}
                onChange={(e) => { setP({ ...p, loi_date: e.target.value }); markDirty(); }}
                className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>
            <CurrencyField label="Earnest Money" value={p.earnest_money} onChange={(v) => { setP({ ...p, earnest_money: v }); markDirty(); }} />
          </div>
        </Section>

        {/* Purchase & Financing — compact grid layout */}
        <Section title="Purchase & Financing" defaultOpen>
          {(() => {
            const loanAmount = p.purchase_price * (f.ltv || 0);
            const downPayment = p.purchase_price - loanAmount;
            const ccMode: ClosingCostMode = p.closing_cost_mode || "rate";
            const ccBk = p.closing_cost_breakdown || {};
            const ccBreakdownTotal = sumClosingCostBreakdown(ccBk);
            const closingCosts = ccMode === "itemized" ? ccBreakdownTotal : p.purchase_price * (p.closing_cost_rate || 0);
            const originationFee = loanAmount * (f.origination_fee_rate || 0);
            const isItemized = ccMode === "itemized";
            return (
              <div className="space-y-4">
                {/* Purchase + Financing side by side in a dense grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                  <CurrencyField label="Purchase Price" value={p.purchase_price} onChange={(v) => { setP({ ...p, purchase_price: v }); markDirty(); }} />
                  <PctField label="LTV" value={f.ltv} onChange={(v) => { setF({ ...f, ltv: v }); markDirty(); }} />
                  <PctField label="Interest Rate" value={f.interest_rate} onChange={(v) => { setF({ ...f, interest_rate: v }); markDirty(); }} />
                  <NumField label="Amortization" value={f.amortization_years} suffix="yrs" onChange={(v) => { setF({ ...f, amortization_years: v }); markDirty(); }} />
                  <NumField label="Loan Term" value={f.loan_term_years} suffix="yrs" onChange={(v) => { setF({ ...f, loan_term_years: v }); markDirty(); }} />
                  <NumField label="IO Period" value={f.io_period_months} suffix="mo" onChange={(v) => { setF({ ...f, io_period_months: v }); markDirty(); }} />
                </div>
                {/* Computed fields row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <ReadOnlyField label="Loan Amount" value={fmtCurrency(loanAmount)} />
                  <ReadOnlyField label="Down Payment" value={fmtCurrency(downPayment)} />
                  <PctField label="Origination Fee Rate" value={f.origination_fee_rate} onChange={(v) => { setF({ ...f, origination_fee_rate: v }); markDirty(); }} />
                  <ReadOnlyField label="Origination Fee" value={fmtCurrency(originationFee)} />
                </div>
              </div>
            );
          })()}
        </Section>

        {/* Closing Costs — own sub-card with rate/itemized toggle */}
        <Section title="Closing Costs" defaultOpen>
          {(() => {
            const ccMode: ClosingCostMode = p.closing_cost_mode || "rate";
            const ccBk = p.closing_cost_breakdown || {};
            const ccBreakdownTotal = sumClosingCostBreakdown(ccBk);
            const closingCosts = ccMode === "itemized" ? ccBreakdownTotal : p.purchase_price * (p.closing_cost_rate || 0);
            const isItemized = ccMode === "itemized";
            const loanAmount = p.purchase_price * (f.ltv || 0);
            const originationFee = loanAmount * (f.origination_fee_rate || 0);
            return (
              <div className="space-y-4">
                {/* Toggle between Rate and Itemized */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setP({ ...p, closing_cost_mode: "rate" as ClosingCostMode }); markDirty(); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-l-md border transition-colors ${
                      !isItemized
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-slate-800 text-slate-400 border-slate-600 hover:text-slate-300"
                    }`}
                  >
                    % of Purchase Price
                  </button>
                  <button
                    type="button"
                    onClick={() => { setP({ ...p, closing_cost_mode: "itemized" as ClosingCostMode }); markDirty(); }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-r-md border transition-colors ${
                      isItemized
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-slate-800 text-slate-400 border-slate-600 hover:text-slate-300"
                    }`}
                  >
                    Itemized
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* Rate field — active when mode is "rate", grayed out otherwise */}
                  <div className={isItemized ? "opacity-40 pointer-events-none" : ""}>
                    <PctField label="Closing Cost Rate" value={p.closing_cost_rate} onChange={(v) => { setP({ ...p, closing_cost_rate: v }); markDirty(); }} />
                  </div>
                </div>

                {/* Itemized breakdown — active when mode is "itemized", grayed out otherwise */}
                <div className={!isItemized ? "opacity-40 pointer-events-none" : ""}>
                  <div className="text-xs text-slate-500 font-medium mb-2">Itemized Breakdown</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <CurrencyField label="Title Insurance" value={ccBk.title_insurance || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, title_insurance: v } }); markDirty(); }} />
                    <CurrencyField label="Legal Fees" value={ccBk.legal_fees || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, legal_fees: v } }); markDirty(); }} />
                    <CurrencyField label="Inspections / Surveys" value={ccBk.property_costs || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, property_costs: v } }); markDirty(); }} />
                    <CurrencyField label="Prorations" value={ccBk.prorations || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, prorations: v } }); markDirty(); }} />
                    <CurrencyField label="3rd Party Reports" value={ccBk.third_party_reports || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, third_party_reports: v } }); markDirty(); }} />
                    <CurrencyField label="Transfer Taxes" value={ccBk.transfer_taxes || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, transfer_taxes: v } }); markDirty(); }} />
                    <CurrencyField label="Reserves / Escrow" value={ccBk.reserves_escrow || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, reserves_escrow: v } }); markDirty(); }} />
                    <CurrencyField label="Other Closing Costs" value={ccBk.other_closing || 0} onChange={(v) => { setP({ ...p, closing_cost_breakdown: { ...ccBk, other_closing: v } }); markDirty(); }} />
                  </div>
                </div>

                {/* CapEx Reserve */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-slate-700 pt-3">
                  <CurrencyField label="CapEx Reserve" value={p.capex_reserve || 0} onChange={(v) => { setP({ ...p, capex_reserve: v }); markDirty(); }} />
                  <div className="col-span-1 sm:col-span-3 flex items-end">
                    <p className="text-[10px] text-slate-500 pb-2">Additional equity funded at closing for renovation shortfalls</p>
                  </div>
                </div>

                {/* Totals row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-slate-700 pt-3">
                  <ReadOnlyField label="Total Closing Costs" value={fmtCurrency(closingCosts)} />
                  <ReadOnlyField label="CapEx Reserve" value={fmtCurrency(p.capex_reserve || 0)} />
                  <ReadOnlyField label="Total Cost" value={fmtCurrency(p.purchase_price + closingCosts + originationFee + (p.capex_reserve || 0))} />
                  <ReadOnlyField label="Total Equity Required" value={fmtCurrency(p.purchase_price + closingCosts + originationFee + (p.capex_reserve || 0) - loanAmount)} />
                </div>
              </div>
            );
          })()}
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
                    placeholder="e.g. 1BR/1BA"
                    className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
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

        {/* Operating Expenses — clean grouped layout */}
        <Section title="Operating Expenses">
          {(() => {
            const ub = e.utilities_breakdown || {};
            const sb = e.services_breakdown || {};
            const utilitiesTotal = (ub.electric_per_unit || 0) + (ub.water_sewer_per_unit || 0) +
              (ub.gas_per_unit || 0) + (ub.trash_per_unit || 0) + (ub.other_utilities_per_unit || 0);
            const servicesTotal = (sb.landscaping || 0) + (sb.snow_removal || 0) +
              (sb.pest_control || 0) + (sb.security || 0) + (sb.cleaning || 0) + (sb.other_services || 0);
            const reservesAnnual = (e.reserves_per_unit || 0) * totalUnits;
            const reservesPctEGI = t12EGI > 0 ? (reservesAnnual / t12EGI * 100).toFixed(1) : "0.0";
            return (
              <div className="space-y-5">
                {/* Core expenses */}
                <div>
                  <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2 border-l-2 border-slate-600 pl-2">Core Expenses</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <PctField label="Mgmt Fee" value={e.management_fee_rate} suffix="% EGI" onChange={(v) => { setE({ ...e, management_fee_rate: v }); markDirty(); }} />
                    <CurrencyField label="Payroll" value={e.payroll_annual} suffix="/yr" onChange={(v) => { setE({ ...e, payroll_annual: v }); markDirty(); }} />
                    <CurrencyField label="Property Tax" value={e.property_tax_total} suffix="/yr" onChange={(v) => { setE({ ...e, property_tax_total: v }); markDirty(); }} />
                    <CurrencyField label="Insurance" value={e.insurance_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, insurance_per_unit: v }); markDirty(); }} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <CurrencyField label="Repairs & Maintenance" value={e.repairs_maintenance_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, repairs_maintenance_per_unit: v }); markDirty(); }} />
                    <CurrencyField label="Turnover" value={e.turnover_cost_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, turnover_cost_per_unit: v }); markDirty(); }} />
                    <CurrencyField label="Admin / Legal / Marketing" value={e.admin_legal_marketing} suffix="/yr" onChange={(v) => { setE({ ...e, admin_legal_marketing: v }); markDirty(); }} />
                    <div>
                      <CurrencyField label="Reserves" value={e.reserves_per_unit} suffix="/unit/yr" onChange={(v) => { setE({ ...e, reserves_per_unit: v }); markDirty(); }} />
                      <p className="text-[10px] text-slate-500 mt-0.5">{reservesPctEGI}% EGI &middot; {fmtCurrency(reservesAnnual)}/yr</p>
                    </div>
                  </div>
                </div>

                {/* Utilities */}
                <div>
                  <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2 border-l-2 border-slate-600 pl-2">Utilities <span className="normal-case text-slate-500 font-normal">per unit/yr</span></div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    <CurrencyField label="Electric" value={ub.electric_per_unit || 0} onChange={(v) => {
                      const newUb = { ...ub, electric_per_unit: v };
                      const newTotal = (v || 0) + (ub.water_sewer_per_unit || 0) + (ub.gas_per_unit || 0) + (ub.trash_per_unit || 0) + (ub.other_utilities_per_unit || 0);
                      setE({ ...e, utilities_breakdown: newUb, utilities_per_unit: newTotal }); markDirty();
                    }} />
                    <CurrencyField label="Water / Sewer" value={ub.water_sewer_per_unit || 0} onChange={(v) => {
                      const newUb = { ...ub, water_sewer_per_unit: v };
                      const newTotal = (ub.electric_per_unit || 0) + (v || 0) + (ub.gas_per_unit || 0) + (ub.trash_per_unit || 0) + (ub.other_utilities_per_unit || 0);
                      setE({ ...e, utilities_breakdown: newUb, utilities_per_unit: newTotal }); markDirty();
                    }} />
                    <CurrencyField label="Gas" value={ub.gas_per_unit || 0} onChange={(v) => {
                      const newUb = { ...ub, gas_per_unit: v };
                      const newTotal = (ub.electric_per_unit || 0) + (ub.water_sewer_per_unit || 0) + (v || 0) + (ub.trash_per_unit || 0) + (ub.other_utilities_per_unit || 0);
                      setE({ ...e, utilities_breakdown: newUb, utilities_per_unit: newTotal }); markDirty();
                    }} />
                    <CurrencyField label="Trash" value={ub.trash_per_unit || 0} onChange={(v) => {
                      const newUb = { ...ub, trash_per_unit: v };
                      const newTotal = (ub.electric_per_unit || 0) + (ub.water_sewer_per_unit || 0) + (ub.gas_per_unit || 0) + (v || 0) + (ub.other_utilities_per_unit || 0);
                      setE({ ...e, utilities_breakdown: newUb, utilities_per_unit: newTotal }); markDirty();
                    }} />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-3">
                    <CurrencyField label="Other Utilities" value={ub.other_utilities_per_unit || 0} onChange={(v) => {
                      const newUb = { ...ub, other_utilities_per_unit: v };
                      const newTotal = (ub.electric_per_unit || 0) + (ub.water_sewer_per_unit || 0) + (ub.gas_per_unit || 0) + (ub.trash_per_unit || 0) + (v || 0);
                      setE({ ...e, utilities_breakdown: newUb, utilities_per_unit: newTotal }); markDirty();
                    }} />
                    {utilitiesTotal > 0 ? (
                      <ReadOnlyField label="Total Utilities" value={`${fmtCurrency(utilitiesTotal)}/unit`} />
                    ) : (
                      <CurrencyField label="Total Utilities" value={e.utilities_per_unit} onChange={(v) => { setE({ ...e, utilities_per_unit: v }); markDirty(); }} />
                    )}
                  </div>
                </div>

                {/* Contract Services */}
                <div>
                  <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2 border-l-2 border-slate-600 pl-2">Contract Services <span className="normal-case text-slate-500 font-normal">per year</span></div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    <CurrencyField label="Landscaping" value={sb.landscaping || 0} onChange={(v) => {
                      const newSb = { ...sb, landscaping: v };
                      const newTotal = (v || 0) + (sb.snow_removal || 0) + (sb.pest_control || 0) + (sb.security || 0) + (sb.cleaning || 0) + (sb.other_services || 0);
                      setE({ ...e, services_breakdown: newSb, contract_services: newTotal }); markDirty();
                    }} />
                    <CurrencyField label="Snow Removal" value={sb.snow_removal || 0} onChange={(v) => {
                      const newSb = { ...sb, snow_removal: v };
                      const newTotal = (sb.landscaping || 0) + (v || 0) + (sb.pest_control || 0) + (sb.security || 0) + (sb.cleaning || 0) + (sb.other_services || 0);
                      setE({ ...e, services_breakdown: newSb, contract_services: newTotal }); markDirty();
                    }} />
                    <CurrencyField label="Pest Control" value={sb.pest_control || 0} onChange={(v) => {
                      const newSb = { ...sb, pest_control: v };
                      const newTotal = (sb.landscaping || 0) + (sb.snow_removal || 0) + (v || 0) + (sb.security || 0) + (sb.cleaning || 0) + (sb.other_services || 0);
                      setE({ ...e, services_breakdown: newSb, contract_services: newTotal }); markDirty();
                    }} />
                    <CurrencyField label="Security" value={sb.security || 0} onChange={(v) => {
                      const newSb = { ...sb, security: v };
                      const newTotal = (sb.landscaping || 0) + (sb.snow_removal || 0) + (sb.pest_control || 0) + (v || 0) + (sb.cleaning || 0) + (sb.other_services || 0);
                      setE({ ...e, services_breakdown: newSb, contract_services: newTotal }); markDirty();
                    }} />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-3">
                    <CurrencyField label="Cleaning" value={sb.cleaning || 0} onChange={(v) => {
                      const newSb = { ...sb, cleaning: v };
                      const newTotal = (sb.landscaping || 0) + (sb.snow_removal || 0) + (sb.pest_control || 0) + (sb.security || 0) + (v || 0) + (sb.other_services || 0);
                      setE({ ...e, services_breakdown: newSb, contract_services: newTotal }); markDirty();
                    }} />
                    <CurrencyField label="Other Services" value={sb.other_services || 0} onChange={(v) => {
                      const newSb = { ...sb, other_services: v };
                      const newTotal = (sb.landscaping || 0) + (sb.snow_removal || 0) + (sb.pest_control || 0) + (sb.security || 0) + (sb.cleaning || 0) + (v || 0);
                      setE({ ...e, services_breakdown: newSb, contract_services: newTotal }); markDirty();
                    }} />
                    {servicesTotal > 0 ? (
                      <ReadOnlyField label="Total Services" value={fmtCurrency(servicesTotal)} />
                    ) : (
                      <CurrencyField label="Total Services" value={e.contract_services} onChange={(v) => { setE({ ...e, contract_services: v }); markDirty(); }} />
                    )}
                  </div>
                </div>
                {/* Import Deal T12 button */}
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
            );
          })()}
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
                    placeholder="e.g. Roof Replacement"
                    className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
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

        {/* Depreciation */}
        <Section title="Depreciation">
          {(() => {
            const landAssess = dep.land_tax_assessment || 0;
            const impAssess = dep.improvement_tax_assessment || 0;
            const totalAssess = landAssess + impAssess;
            const landPct = totalAssess > 0 ? landAssess / totalAssess : 0;
            const impPct = totalAssess > 0 ? impAssess / totalAssess : 0;
            const depreciableBasis = p.purchase_price * impPct;
            const straightLine = depreciableBasis / 27.5;
            const accelPct = dep.accelerated_depreciation_pct || 0;
            const acceleratedPortion = depreciableBasis * accelPct;
            const remainderPortion = depreciableBasis - acceleratedPortion;
            const remainderAnnual = remainderPortion / 27.5;
            const acceleratedYear1 = accelPct > 0 ? acceleratedPortion + remainderAnnual : 0;
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left: inputs */}
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 font-medium">Tax Assessments</div>
                  <CurrencyField label="Land Assessment" value={landAssess} onChange={(v) => { setDep({ ...dep, land_tax_assessment: v }); markDirty(); }} />
                  <CurrencyField label="Improvement Assessment" value={impAssess} onChange={(v) => { setDep({ ...dep, improvement_tax_assessment: v }); markDirty(); }} />
                  <ReadOnlyField label="% Value in Land" value={totalAssess > 0 ? `${(landPct * 100).toFixed(1)}%` : "—"} />
                  <ReadOnlyField label="% Value in Improvements" value={totalAssess > 0 ? `${(impPct * 100).toFixed(1)}%` : "—"} />
                  <div className="pt-2">
                    <PctField label="% Accelerated Depreciation" value={accelPct} onChange={(v) => { setDep({ ...dep, accelerated_depreciation_pct: v }); markDirty(); }} />
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-slate-500">% of improvements eligible for bonus depreciation in year 1 (cost segregation)</p>
                    </div>
                  </div>
                </div>
                {/* Right: computed results */}
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 font-medium">Depreciation Estimates</div>
                  <ReadOnlyField label="Depreciable Basis" value={fmtCurrency(depreciableBasis)} suffix={`= ${fmtCurrency(p.purchase_price)} × ${(impPct * 100).toFixed(1)}%`} />
                  <div className="border border-slate-800/50 rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b border-slate-800/50">
                          <td className="px-3 py-2 text-slate-400">Straight-Line (27.5 yr)</td>
                          <td className="px-3 py-2 text-right text-slate-200 font-medium">{fmtCurrency(straightLine)}<span className="text-slate-500 text-xs">/yr</span></td>
                        </tr>
                        {accelPct > 0 && (
                          <tr className="border-b border-slate-800/50">
                            <td className="px-3 py-2 text-slate-400">Accelerated Yr 1</td>
                            <td className="px-3 py-2 text-right text-green-400 font-medium">{fmtCurrency(acceleratedYear1)}</td>
                          </tr>
                        )}
                        {accelPct > 0 && (
                          <tr className="border-b border-slate-800/50">
                            <td className="px-3 py-2 text-slate-400">Yrs 2+ (Remainder)</td>
                            <td className="px-3 py-2 text-right text-slate-200 font-medium">{fmtCurrency(remainderAnnual)}<span className="text-slate-500 text-xs">/yr</span></td>
                          </tr>
                        )}
                        {accelPct > 0 && (
                          <tr className="bg-slate-800/30">
                            <td className="px-3 py-2 text-slate-400">Yr 1 Bonus Deduction</td>
                            <td className="px-3 py-2 text-right text-green-400 font-medium">+{fmtCurrency(acceleratedPortion)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500">
                    Straight-line: 27.5-year residential schedule. Accelerated: eligible portion taken as bonus depreciation in year 1, remainder on 27.5-year schedule.
                  </p>
                </div>
              </div>
            );
          })()}
        </Section>
      </CardContent>
    </Card>
  );
}
