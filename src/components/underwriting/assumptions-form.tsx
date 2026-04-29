"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Trash2, Save, Loader2, Plus, X, Download } from "lucide-react";
import type { Scenario, T12Statement } from "@/lib/validations";
import type { ScenarioInputs, CapexProject, DepreciationAssumptions, ClosingCostMode, OpexInputMode, OpexInput, OpexInputs, UtilitiesSublines, ServicesSublines } from "@/lib/underwriting";
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

const OPEX_MODE_LABELS: Record<OpexInputMode, string> = {
  total_annual: "$ /yr",
  per_unit_annual: "$ /unit/yr",
  per_unit_monthly: "$ /unit/mo",
  pct_egi: "% EGI",
  pct_gpr: "% GPR",
};
const OPEX_MODES = Object.keys(OPEX_MODE_LABELS) as OpexInputMode[];

function opexToAnnual(input: OpexInput, units: number, egi: number, gpr: number): number {
  const v = input.value || 0;
  switch (input.mode) {
    case "total_annual": return v;
    case "per_unit_annual": return v * units;
    case "per_unit_monthly": return v * units * 12;
    case "pct_egi": return v * egi;
    case "pct_gpr": return v * gpr;
    default: return v;
  }
}

function OpexLineField({
  label,
  input,
  onChange,
  units,
  egi,
  gpr,
  leftContent,
  indented,
  readOnlySum,
}: {
  label: string;
  input: OpexInput;
  onChange: (input: OpexInput) => void;
  units: number;
  egi: number;
  gpr: number;
  leftContent?: React.ReactNode;
  indented?: boolean;
  readOnlySum?: number; // when set, render as read-only showing this annual total
}) {
  const [focused, setFocused] = useState(false);
  const [editValue, setEditValue] = useState("");

  const isPct = input.mode === "pct_egi" || input.mode === "pct_gpr";
  const displayValue = input.value
    ? isPct
      ? `${Math.round(input.value * 10000) / 100}`
      : `$${formatWithCommas(input.value)}`
    : "";
  const annualDollars = readOnlySum !== undefined ? readOnlySum : opexToAnnual(input, units, egi, gpr);
  const pctOfEGI = egi > 0 ? (annualDollars / egi * 100).toFixed(1) : "0.0";

  return (
    <div className="grid grid-cols-12 items-center gap-2">
      <div className={`col-span-4 text-sm truncate flex items-center gap-1 ${indented ? "text-slate-400 pl-6" : "text-slate-300"}`} title={label}>
        {leftContent}
        <span className="truncate">{label}</span>
      </div>
      <div className="col-span-3">
        {readOnlySum !== undefined ? (
          <div className="bg-slate-800/40 border border-slate-800 rounded-md text-slate-500 text-sm h-8 px-3 flex items-center justify-between italic">
            <span className="text-[10px]">sum of sub-items</span>
          </div>
        ) : (
          <Input
            type="text"
            inputMode="decimal"
            value={focused ? editValue : displayValue}
            onFocus={() => {
              setFocused(true);
              setEditValue(input.value ? String(isPct ? Math.round(input.value * 10000) / 100 : input.value) : "");
            }}
            onBlur={() => {
              setFocused(false);
              const parsed = parseFloat(editValue.replace(/[^0-9.-]/g, ""));
              if (!isNaN(parsed)) {
                onChange({ ...input, value: isPct ? Math.round(parsed * 100) / 10000 : parsed });
              }
            }}
            onChange={(e) => setEditValue(e.target.value)}
            className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
          />
        )}
      </div>
      <div className="col-span-2">
        {readOnlySum !== undefined ? (
          <div className="h-8" />
        ) : (
          <select
            value={input.mode}
            onChange={(e) => onChange({ ...input, mode: e.target.value as OpexInputMode })}
            className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-xs h-8 rounded-md px-1.5 outline-none hover:border-slate-500 focus:border-blue-500 transition-colors appearance-none"
            style={{
              backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 20 20'><path fill='%2394a3b8' d='M5 7l5 6 5-6z'/></svg>\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 6px center",
              backgroundSize: "10px",
              paddingRight: "22px",
            }}
          >
            {OPEX_MODES.map((m) => (
              <option key={m} value={m}>{OPEX_MODE_LABELS[m]}</option>
            ))}
          </select>
        )}
      </div>
      <div className="col-span-3 text-right">
        <span className="text-slate-500 text-xs mr-1">=</span>
        <span className={`text-sm font-semibold tabular-nums ${readOnlySum !== undefined ? "text-white" : isPct ? "text-blue-400" : "text-white"}`}>
          {fmtCurrency(annualDollars)}/yr
        </span>
        <span className="text-slate-500 text-[10px] ml-1 tabular-nums">{pctOfEGI}%</span>
      </div>
    </div>
  );
}

const UTIL_SUBLINE_DEFS: { key: keyof UtilitiesSublines; label: string; defaultMode: OpexInputMode }[] = [
  { key: "electric", label: "Electric", defaultMode: "total_annual" },
  { key: "water_sewer", label: "Water / Sewer", defaultMode: "total_annual" },
  { key: "gas", label: "Gas", defaultMode: "total_annual" },
  { key: "trash", label: "Trash", defaultMode: "total_annual" },
  { key: "internet", label: "Internet / Cable", defaultMode: "total_annual" },
  { key: "other_utilities", label: "Other Utilities", defaultMode: "total_annual" },
];

const SVC_SUBLINE_DEFS: { key: keyof ServicesSublines; label: string; defaultMode: OpexInputMode }[] = [
  { key: "landscaping", label: "Landscaping", defaultMode: "total_annual" },
  { key: "snow_removal", label: "Snow Removal", defaultMode: "total_annual" },
  { key: "pest_control", label: "Pest Control", defaultMode: "total_annual" },
  { key: "security", label: "Security", defaultMode: "total_annual" },
  { key: "cleaning", label: "Cleaning", defaultMode: "total_annual" },
  { key: "other_services", label: "Other Services", defaultMode: "total_annual" },
];

function OpexGroup<K extends string>({
  label,
  topInput,
  onTopChange,
  sublines,
  onSublineChange,
  sublineDefs,
  units,
  egi,
  gpr,
}: {
  label: string;
  topInput: OpexInput;
  onTopChange: (input: OpexInput) => void;
  sublines: Record<string, OpexInput | undefined> | undefined;
  onSublineChange: (key: K, input: OpexInput) => void;
  sublineDefs: { key: K; label: string; defaultMode: OpexInputMode }[];
  units: number;
  egi: number;
  gpr: number;
}) {
  // Default to expanded when sublines have any values
  const sublineSum = sublineDefs.reduce((sum, def) => {
    const s = sublines?.[def.key as string];
    return sum + (s ? opexToAnnual(s, units, egi, gpr) : 0);
  }, 0);
  const hasSublineValues = sublineSum > 0;
  const [expanded, setExpanded] = useState(hasSublineValues);

  return (
    <div className="space-y-1.5">
      <OpexLineField
        label={label}
        input={topInput}
        onChange={onTopChange}
        units={units}
        egi={egi}
        gpr={gpr}
        readOnlySum={hasSublineValues ? sublineSum : undefined}
        leftContent={
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-slate-500 hover:text-slate-200 transition-colors"
            title={expanded ? "Hide sub-items" : "Show sub-items"}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        }
      />
      {expanded && (
        <div className="border-l border-slate-700/50 ml-2 space-y-1">
          {sublineDefs.map((def) => {
            const current = (sublines?.[def.key as string]) || { value: 0, mode: def.defaultMode };
            return (
              <OpexLineField
                key={def.key}
                label={def.label}
                input={current}
                onChange={(v) => onSublineChange(def.key, v)}
                units={units}
                egi={egi}
                gpr={gpr}
                indented
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AssumptionsForm({ scenario, onUpdate, onDelete, loading, dealT12 }: Props) {
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

  useEffect(() => {
    setP(purchase);
    setF(financing);
    setR(revenue);
    setE(expenses);
    setC(capex);
    setEx(exit);
    setDep(depreciation);
    setDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.version]);

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

  // ── OpEx inputs — initialize from legacy fields if not already set ──
  function getOpexInputs(): OpexInputs {
    if (e.opex_inputs) {
      // Migrate legacy utilities/services breakdowns to sublines on the fly if not already present
      const migrated: OpexInputs = { ...e.opex_inputs };
      if (!migrated.utilities_sublines && e.utilities_breakdown) {
        const ub = e.utilities_breakdown;
        const hasAny = (ub.electric_per_unit || 0) + (ub.water_sewer_per_unit || 0) +
          (ub.gas_per_unit || 0) + (ub.trash_per_unit || 0) + (ub.other_utilities_per_unit || 0) > 0;
        if (hasAny) {
          migrated.utilities_sublines = {
            electric: { value: ub.electric_per_unit || 0, mode: "per_unit_annual" },
            water_sewer: { value: ub.water_sewer_per_unit || 0, mode: "per_unit_annual" },
            gas: { value: ub.gas_per_unit || 0, mode: "per_unit_annual" },
            trash: { value: ub.trash_per_unit || 0, mode: "per_unit_annual" },
            other_utilities: { value: ub.other_utilities_per_unit || 0, mode: "per_unit_annual" },
          };
        }
      }
      if (!migrated.services_sublines && e.services_breakdown) {
        const sb = e.services_breakdown;
        const hasAny = (sb.landscaping || 0) + (sb.snow_removal || 0) + (sb.pest_control || 0) +
          (sb.security || 0) + (sb.cleaning || 0) + (sb.other_services || 0) > 0;
        if (hasAny) {
          migrated.services_sublines = {
            landscaping: { value: sb.landscaping || 0, mode: "total_annual" },
            snow_removal: { value: sb.snow_removal || 0, mode: "total_annual" },
            pest_control: { value: sb.pest_control || 0, mode: "total_annual" },
            security: { value: sb.security || 0, mode: "total_annual" },
            cleaning: { value: sb.cleaning || 0, mode: "total_annual" },
            other_services: { value: sb.other_services || 0, mode: "total_annual" },
          };
        }
      }
      return migrated;
    }
    // Fully seed from legacy fields
    const inputs: OpexInputs = {
      management_fees: { value: e.management_fee_rate || 0, mode: "pct_egi" },
      payroll: { value: e.payroll_annual || 0, mode: "total_annual" },
      repairs_maintenance: { value: e.repairs_maintenance_per_unit || 0, mode: "per_unit_annual" },
      turnover: { value: e.turnover_cost_per_unit || 0, mode: "per_unit_annual" },
      insurance: { value: e.insurance_per_unit || 0, mode: "per_unit_annual" },
      property_tax: { value: e.property_tax_total || 0, mode: "total_annual" },
      utilities: { value: e.utilities_per_unit || 0, mode: "per_unit_annual" },
      admin_legal_marketing: { value: e.admin_legal_marketing || 0, mode: "total_annual" },
      contract_services: { value: e.contract_services || 0, mode: "total_annual" },
      reserves: { value: e.reserves_per_unit || 0, mode: "per_unit_annual" },
    };
    if (e.utilities_breakdown) {
      const ub = e.utilities_breakdown;
      inputs.utilities_sublines = {
        electric: { value: ub.electric_per_unit || 0, mode: "per_unit_annual" },
        water_sewer: { value: ub.water_sewer_per_unit || 0, mode: "per_unit_annual" },
        gas: { value: ub.gas_per_unit || 0, mode: "per_unit_annual" },
        trash: { value: ub.trash_per_unit || 0, mode: "per_unit_annual" },
        other_utilities: { value: ub.other_utilities_per_unit || 0, mode: "per_unit_annual" },
      };
    }
    if (e.services_breakdown) {
      const sb = e.services_breakdown;
      inputs.services_sublines = {
        landscaping: { value: sb.landscaping || 0, mode: "total_annual" },
        snow_removal: { value: sb.snow_removal || 0, mode: "total_annual" },
        pest_control: { value: sb.pest_control || 0, mode: "total_annual" },
        security: { value: sb.security || 0, mode: "total_annual" },
        cleaning: { value: sb.cleaning || 0, mode: "total_annual" },
        other_services: { value: sb.other_services || 0, mode: "total_annual" },
      };
    }
    return inputs;
  }
  const opexInputs = getOpexInputs();

  function updateOpexLine(key: keyof OpexInputs, input: OpexInput) {
    const updated = { ...opexInputs, [key]: input };
    setE({ ...e, opex_inputs: updated });
    markDirty();
  }

  function updateUtilitiesSubline(key: keyof UtilitiesSublines, input: OpexInput) {
    const updated: OpexInputs = {
      ...opexInputs,
      utilities_sublines: { ...(opexInputs.utilities_sublines || {}), [key]: input },
    };
    setE({ ...e, opex_inputs: updated });
    markDirty();
  }

  function updateServicesSubline(key: keyof ServicesSublines, input: OpexInput) {
    const updated: OpexInputs = {
      ...opexInputs,
      services_sublines: { ...(opexInputs.services_sublines || {}), [key]: input },
    };
    setE({ ...e, opex_inputs: updated });
    markDirty();
  }

  // Lightweight NOI estimate for display in Exit section
  const t12GPR = unitMix.reduce((sum, u) => sum + u.count * u.current_rent * 12, 0);
  const t12EGI = t12GPR * (1 - (r.vacancy_rate || 0) - (r.bad_debt_rate || 0) - (r.concessions_rate || 0)) + (r.other_income_monthly || 0) * 12;

  function opexLineAnnual(key: keyof OpexInputs): number {
    const oi = opexInputs[key];
    if (!oi || typeof oi !== "object" || !("mode" in oi)) return 0;
    return opexToAnnual(oi as OpexInput, totalUnits, t12EGI, t12GPR);
  }
  function sumSublinesAnnual(sublines: UtilitiesSublines | ServicesSublines | undefined): number {
    if (!sublines) return 0;
    return Object.values(sublines as Record<string, OpexInput | undefined>).reduce(
      (sum, s) => sum + (s ? opexToAnnual(s, totalUnits, t12EGI, t12GPR) : 0),
      0,
    );
  }
  const utilSubSum = sumSublinesAnnual(opexInputs.utilities_sublines);
  const svcSubSum = sumSublinesAnnual(opexInputs.services_sublines);
  const utilEffective = utilSubSum > 0 ? utilSubSum : opexLineAnnual("utilities");
  const svcEffective = svcSubSum > 0 ? svcSubSum : opexLineAnnual("contract_services");
  const t12TotalOpex =
    opexLineAnnual("management_fees") +
    opexLineAnnual("payroll") +
    opexLineAnnual("repairs_maintenance") +
    opexLineAnnual("turnover") +
    opexLineAnnual("insurance") +
    opexLineAnnual("property_tax") +
    utilEffective +
    opexLineAnnual("admin_legal_marketing") +
    svcEffective +
    opexLineAnnual("reserves");
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
            <NumField label="Due Diligence (days)" value={p.due_diligence_days || 0} onChange={(v) => { setP({ ...p, due_diligence_days: v }); markDirty(); }} />
            <NumField label="Closing Timeline (days)" value={p.closing_days || 0} onChange={(v) => { setP({ ...p, closing_days: v }); markDirty(); }} />
            <div>
              <Label className="text-xs text-slate-400">Buyer Entity</Label>
              <Input
                value={p.buyer_entity || ""}
                onChange={(e) => { setP({ ...p, buyer_entity: e.target.value }); markDirty(); }}
                placeholder="e.g. Monument Equity LLC"
                className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>
          </div>
        </Section>

        {/* Purchase & Financing — compact grid layout */}
        <Section title="Purchase & Financing" defaultOpen>
          {(() => {
            const loanAmount = p.purchase_price * (f.ltv || 0);
            const downPayment = p.purchase_price - loanAmount;
            const originationFee = loanAmount * (f.origination_fee_rate || 0);
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-slate-700 pt-3">
                  <ReadOnlyField label="Total Closing Costs" value={fmtCurrency(closingCosts)} />
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

        {/* Operating Expenses — per-line flexible input */}
        <Section title="Operating Expenses">
          <div className="space-y-5">
            {/* Header row with totals */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3 text-slate-400">
                <span>Annual OpEx <span className="text-white font-semibold tabular-nums">{fmtCurrency(t12TotalOpex)}</span></span>
                <span className="text-slate-600">·</span>
                <span>OpEx Ratio <span className="text-white font-semibold tabular-nums">{t12EGI > 0 ? `${(t12TotalOpex / t12EGI * 100).toFixed(1)}%` : "—"}</span></span>
              </div>
              {dealT12 && dealT12.months && dealT12.months.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const t12Sum = (field: string) =>
                      dealT12!.months.reduce((acc, m) => acc + ((m as unknown as Record<string, number>)[field] || 0), 0);
                    const mgmtTotal = t12Sum("management_fees");
                    const payrollTotal = t12Sum("payroll");
                    const taxTotal = t12Sum("property_taxes");
                    const insTotal = t12Sum("insurance");
                    const utilTotal = t12Sum("utilities") + t12Sum("utilities_water") + t12Sum("utilities_electric") + t12Sum("utilities_gas");
                    const rmTotal = t12Sum("repairs_maintenance");
                    const adminTotal = t12Sum("admin_expenses") + t12Sum("marketing");
                    const svcTotal = t12Sum("contract_services");
                    const imported: OpexInputs = {
                      ...opexInputs,
                      ...(mgmtTotal ? { management_fees: { value: mgmtTotal, mode: "total_annual" as OpexInputMode } } : {}),
                      ...(payrollTotal ? { payroll: { value: payrollTotal, mode: "total_annual" as OpexInputMode } } : {}),
                      ...(taxTotal ? { property_tax: { value: taxTotal, mode: "total_annual" as OpexInputMode } } : {}),
                      ...(insTotal ? { insurance: { value: insTotal, mode: "total_annual" as OpexInputMode } } : {}),
                      ...(utilTotal ? { utilities: { value: utilTotal, mode: "total_annual" as OpexInputMode } } : {}),
                      ...(rmTotal ? { repairs_maintenance: { value: rmTotal, mode: "total_annual" as OpexInputMode } } : {}),
                      ...(adminTotal ? { admin_legal_marketing: { value: adminTotal, mode: "total_annual" as OpexInputMode } } : {}),
                      ...(svcTotal ? { contract_services: { value: svcTotal, mode: "total_annual" as OpexInputMode } } : {}),
                    };
                    setE({ ...e, opex_inputs: imported });
                    markDirty();
                  }}
                  className="border-slate-700 text-blue-400 hover:bg-blue-900/20 h-6 text-xs"
                >
                  <Download className="h-3 w-3 mr-1" /> Import T12
                </Button>
              )}
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-12 items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider">
              <div className="col-span-4">Line Item</div>
              <div className="col-span-3">Value</div>
              <div className="col-span-2">Format</div>
              <div className="col-span-3 text-right">Annual $ / % EGI</div>
            </div>

            {/* Core Expenses */}
            <div>
              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mb-2 border-l-2 border-slate-600 pl-2">Core Expenses</div>
              <div className="space-y-1.5">
                <OpexLineField label="Management Fee" input={opexInputs.management_fees || { value: 0, mode: "pct_egi" }} onChange={(v) => updateOpexLine("management_fees", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Payroll" input={opexInputs.payroll || { value: 0, mode: "total_annual" }} onChange={(v) => updateOpexLine("payroll", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Property Tax" input={opexInputs.property_tax || { value: 0, mode: "total_annual" }} onChange={(v) => updateOpexLine("property_tax", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Insurance" input={opexInputs.insurance || { value: 0, mode: "per_unit_annual" }} onChange={(v) => updateOpexLine("insurance", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Repairs & Maint." input={opexInputs.repairs_maintenance || { value: 0, mode: "per_unit_annual" }} onChange={(v) => updateOpexLine("repairs_maintenance", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Turnover" input={opexInputs.turnover || { value: 0, mode: "per_unit_annual" }} onChange={(v) => updateOpexLine("turnover", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Admin / Legal / Mktg" input={opexInputs.admin_legal_marketing || { value: 0, mode: "total_annual" }} onChange={(v) => updateOpexLine("admin_legal_marketing", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Reserves" input={opexInputs.reserves || { value: 0, mode: "per_unit_annual" }} onChange={(v) => updateOpexLine("reserves", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
              </div>
            </div>

            {/* Utilities */}
            <div>
              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mb-2 border-l-2 border-slate-600 pl-2">
                Utilities
                <span className="text-slate-600 font-normal normal-case ml-2">enter total or break out by type</span>
              </div>
              <OpexGroup<keyof UtilitiesSublines>
                label="Utilities"
                topInput={opexInputs.utilities || { value: 0, mode: "per_unit_annual" }}
                onTopChange={(v) => updateOpexLine("utilities", v)}
                sublines={opexInputs.utilities_sublines as Record<string, OpexInput | undefined> | undefined}
                onSublineChange={(k, v) => updateUtilitiesSubline(k, v)}
                sublineDefs={UTIL_SUBLINE_DEFS}
                units={totalUnits}
                egi={t12EGI}
                gpr={t12GPR}
              />
            </div>

            {/* Contract Services */}
            <div>
              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mb-2 border-l-2 border-slate-600 pl-2">
                Contract Services
                <span className="text-slate-600 font-normal normal-case ml-2">enter total or break out by service</span>
              </div>
              <OpexGroup<keyof ServicesSublines>
                label="Contract Services"
                topInput={opexInputs.contract_services || { value: 0, mode: "total_annual" }}
                onTopChange={(v) => updateOpexLine("contract_services", v)}
                sublines={opexInputs.services_sublines as Record<string, OpexInput | undefined> | undefined}
                onSublineChange={(k, v) => updateServicesSubline(k, v)}
                sublineDefs={SVC_SUBLINE_DEFS}
                units={totalUnits}
                egi={t12EGI}
                gpr={t12GPR}
              />
            </div>
          </div>
        </Section>

        {/* CapEx: Per-Unit Renovations */}
        <Section title="CapEx: Per-Unit Renovations">
          {(() => {
            const startMo = c.renovation_start_month || 1;
            const endMo = c.renovation_end_month || startMo;
            const span = Math.max(1, endMo - startMo + 1);
            const derivedUPM = c.units_to_renovate > 0 ? (c.units_to_renovate / span) : 0;
            const downtimeEnabled = c.renovation_downtime_enabled || false;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <CurrencyField label="Cost / Unit" value={c.per_unit_cost} onChange={(v) => { setC({ ...c, per_unit_cost: v }); markDirty(); }} />
                  <NumField label="Units to Renovate" value={c.units_to_renovate} onChange={(v) => { setC({ ...c, units_to_renovate: v }); markDirty(); }} />
                  <NumField label="Start Month" value={startMo} suffix="mo" onChange={(v) => { setC({ ...c, renovation_start_month: v }); markDirty(); }} />
                  <NumField label="End Month" value={endMo} suffix="mo" onChange={(v) => { setC({ ...c, renovation_end_month: Math.max(startMo, v) }); markDirty(); }} />
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>Units / Month: <span className="text-white font-medium">{derivedUPM % 1 === 0 ? derivedUPM : derivedUPM.toFixed(1)}</span></span>
                  <span>Total CapEx: <span className="text-white font-medium">{fmtCurrency(c.per_unit_cost * c.units_to_renovate)}</span></span>
                </div>
                {/* Renovation Downtime */}
                <div className="flex items-center gap-3 border-t border-slate-700 pt-3">
                  <button
                    type="button"
                    onClick={() => { setC({ ...c, renovation_downtime_enabled: !downtimeEnabled }); markDirty(); }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${downtimeEnabled ? "bg-blue-600" : "bg-slate-700"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${downtimeEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                  <span className="text-xs text-slate-400">Renovation downtime vacancy</span>
                  {downtimeEnabled && (
                    <div className="flex items-center gap-2">
                      <NumField label="Downtime" value={c.renovation_downtime_months || 1} suffix="mo/unit" onChange={(v) => { setC({ ...c, renovation_downtime_months: Math.max(0.5, v) }); markDirty(); }} />
                    </div>
                  )}
                </div>
                {downtimeEnabled && (
                  <p className="text-[10px] text-slate-500">Units earn $0 rent during renovation. Each unit is offline for {c.renovation_downtime_months || 1} month(s) before coming back online at the renovated rent.</p>
                )}
              </div>
            );
          })()}
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
