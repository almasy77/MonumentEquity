"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Trash2, Save, Loader2, Plus, X, Download } from "lucide-react";
import type { Scenario, T12Statement, RentComp, RentRollUnit } from "@/lib/validations";
import type { ScenarioInputs, CapexProject, DepreciationAssumptions, ClosingCostMode, OpexInputMode, OpexInput, OpexInputs, UtilitiesSublines, ServicesSublines, RentBasis, RentRampAssumptions, OtherIncomeSublines, OtherIncomeLineItem, RubsBasis, UnitMix, UnitDetail, TaxReassessment, PropertyTaxAssumptions } from "@/lib/underwriting";
import { sumClosingCostBreakdown, applyTurnoverRate } from "@/lib/underwriting";
import { TAX_DEFAULTS } from "@/lib/tax";
import type { TaxAssumptions } from "@/lib/tax";

interface Props {
  scenario: Scenario;
  onUpdate: (updates: Partial<Record<string, unknown>>) => Promise<void>;
  onDelete: () => void;
  loading: boolean;
  dealT12?: T12Statement;
  dealUnits?: number;
  dealCity?: string; // filters rent comps for the market-rent guardrail (spec B8)
  dealRentRoll?: RentRollUnit[]; // deal-level imported rent roll — source for per-unit rows (spec B2)
  year1Revenue?: number; // engine year-1 GPR + other income (annual $) — feeds the trajectory block
}

// ─── Per-unit rows (spec B2 / ramp Phase 2) ───

// Map a deal rent-roll status to a per-unit ramp status. The rent roll has no
// explicit MTM flag, so: vacant/down → vacant; notice_to_vacate → mtm (turning
// soon); occupied with an unexpired lease_end → occupied; otherwise mtm.
function rentRollToUnitDetail(u: RentRollUnit): UnitDetail {
  let status: UnitDetail["status"];
  if (u.status === "vacant" || u.status === "down") status = "vacant";
  else if (u.status === "notice_to_vacate") status = "mtm";
  else if (u.lease_end && new Date(u.lease_end) > new Date()) status = "occupied";
  else status = "mtm";
  return {
    unit_id: u.unit_number,
    status,
    current_rent: status === "vacant" ? 0 : (u.current_rent ?? 0),
    market_rent: u.market_rent,
    lease_end: status === "occupied" ? u.lease_end : undefined,
  };
}

// Sync a row's aggregate fields from its per-unit details:
// count = all units; current_rent = mean over NON-vacant units (occupied-only
// average per spec A2); market_rent = mean of per-unit overrides when every
// unit has one, else the row's value stays authoritative.
function syncRowFromUnits(row: UnitMix, units: UnitDetail[]): UnitMix {
  const nonVacant = units.filter((u) => u.status !== "vacant");
  const avgCurrent = nonVacant.length > 0
    ? nonVacant.reduce((s, u) => s + u.current_rent, 0) / nonVacant.length
    : 0;
  const withOverride = units.filter((u) => u.market_rent !== undefined && u.market_rent > 0);
  const avgMarket = units.length > 0 && withOverride.length === units.length
    ? units.reduce((s, u) => s + (u.market_rent ?? 0), 0) / units.length
    : row.market_rent;
  return {
    ...row,
    units,
    count: units.length,
    current_rent: Math.round(avgCurrent * 100) / 100,
    market_rent: Math.round(avgMarket * 100) / 100,
  };
}

// ─── Rent-comp support for the Market Rent guardrail (spec B8) ───

interface CompStats {
  count: number;
  median: number;
  min: number;
  max: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Comp stats for one unit-mix row. Prefer comps whose unit_type matches the
 * row's type (normalized); fall back to all comps for the city when no type
 * matches — a loose range beats no guardrail.
 */
function compStatsForType(comps: RentComp[], unitType: string): CompStats | null {
  if (comps.length === 0) return null;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  const typed = unitType.trim()
    ? comps.filter((c) => c.unit_type && norm(c.unit_type) === norm(unitType))
    : [];
  const pool = typed.length > 0 ? typed : comps;
  const rents = pool.map((c) => c.rent).sort((a, b) => a - b);
  return {
    count: pool.length,
    median: median(rents),
    min: rents[0],
    max: rents[rents.length - 1],
  };
}

function UnitClassChip({
  value,
  onChange,
}: {
  value: "residential" | "commercial" | undefined;
  onChange: (next: "residential" | "commercial" | undefined) => void;
}) {
  // Click to cycle: blank → residential → commercial → blank.
  function cycle() {
    if (!value) onChange("residential");
    else if (value === "residential") onChange("commercial");
    else onChange(undefined);
  }
  const label = value === "residential" ? "Res" : value === "commercial" ? "Com" : "+";
  const cls = value === "residential"
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-700/40"
    : value === "commercial"
    ? "bg-amber-500/10 text-amber-400 border-amber-700/40"
    : "bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300";
  return (
    <button
      type="button"
      onClick={cycle}
      title="Click to cycle: Residential / Commercial / None. Informational only."
      className={`text-[10px] px-1.5 h-4 rounded border font-medium tabular-nums leading-none ${cls}`}
    >
      {label}
    </button>
  );
}

/**
 * Revenue trajectory (spec B4) — one block replacing the old duplicated
 * Monthly + Annual totals. Shows the path the engine actually produces:
 * In-place → Year 1 (ramping) → Stabilized (used at exit) → Reno ceiling.
 * Stabilized is emphasized (it drives exit value); the reno ceiling is
 * demoted to context. Loss-to-lease makes the value-add thesis legible.
 */
function RevenueTrajectory({
  inPlaceRentMonthly,
  stabilizedRentMonthly,
  renoCeilingRentMonthly,
  otherIncomeMonthly,
  year1RevenueAnnual,
  rampEnabled,
}: {
  inPlaceRentMonthly: number;     // occupied units at current rent
  stabilizedRentMonthly: number;  // all units at market rent
  renoCeilingRentMonthly: number; // all units at renovated basis + premium
  otherIncomeMonthly: number;
  year1RevenueAnnual?: number;    // engine year-1 GPR + other income
  rampEnabled: boolean;
}) {
  const [period, setPeriod] = useState<"mo" | "yr">("yr");
  const mult = period === "yr" ? 12 : 1;
  const fmt = (monthly: number) => fmtCurrency(monthly * mult);

  const inPlace = inPlaceRentMonthly + otherIncomeMonthly;
  const stabilized = stabilizedRentMonthly + otherIncomeMonthly;
  const renoCeiling = renoCeilingRentMonthly + otherIncomeMonthly;
  const year1Monthly = year1RevenueAnnual !== undefined ? year1RevenueAnnual / 12 : undefined;

  // Loss-to-lease: gap from in-place to stabilized market, rent only.
  const lossToLease = Math.max(0, stabilizedRentMonthly - inPlaceRentMonthly);
  const lossToLeasePct = stabilizedRentMonthly > 0 ? lossToLease / stabilizedRentMonthly : 0;

  return (
    <div className="border-t border-slate-700 pt-3 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500 font-medium">Revenue Trajectory (rent + other income)</div>
        <div className="flex items-center rounded border border-slate-700 overflow-hidden text-[11px]">
          <button
            type="button"
            onClick={() => setPeriod("mo")}
            className={`px-2 py-0.5 ${period === "mo" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
          >
            /mo
          </button>
          <button
            type="button"
            onClick={() => setPeriod("yr")}
            className={`px-2 py-0.5 ${period === "yr" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
          >
            /yr
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800/50 rounded p-2.5 text-center">
          <div className="text-xs text-slate-400 mb-0.5">In-Place</div>
          <div className="text-sm text-white font-semibold tabular-nums">{fmt(inPlace)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">occupied, today</div>
        </div>
        <div className="bg-slate-800/50 rounded p-2.5 text-center">
          <div className="text-xs text-slate-400 mb-0.5">Year 1{rampEnabled ? " (ramping)" : ""}</div>
          <div className="text-sm text-white font-semibold tabular-nums">
            {year1Monthly !== undefined ? fmt(year1Monthly) : "—"}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">engine pro forma</div>
        </div>
        <div className="bg-slate-800/60 rounded p-2.5 text-center ring-1 ring-blue-500/50">
          <div className="text-xs text-blue-300 mb-0.5 font-medium">Stabilized</div>
          <div className="text-sm text-white font-bold tabular-nums">{fmt(stabilized)}</div>
          <div className="text-[10px] text-blue-400/70 mt-0.5">used at exit</div>
        </div>
        {/* Reno ceiling — demoted: context, not an underwriting basis */}
        <div className="rounded p-2.5 text-center border border-dashed border-slate-700">
          <div className="text-xs text-slate-500 mb-0.5">Reno Ceiling</div>
          <div className="text-sm text-slate-400 font-semibold tabular-nums">{fmt(renoCeiling)}</div>
          <div className="text-[10px] text-slate-600 mt-0.5">all units renovated at once; never reached in the hold</div>
        </div>
      </div>

      {/* Loss-to-lease — the value-add thesis made legible */}
      {lossToLease > 0 && (
        <div className="text-[11px] text-slate-400">
          Loss-to-lease:{" "}
          <span className="text-amber-400 font-medium tabular-nums">
            {fmtCurrency(lossToLease)}/mo ({(lossToLeasePct * 100).toFixed(1)}% below market)
          </span>
        </div>
      )}
    </div>
  );
}

function RentRampPanel({
  ramp,
  proformaUnrenovatedBasis,
  vacancyRate,
  holdMonths,
  hasPerUnitData,
  onChange,
}: {
  ramp: RentRampAssumptions | undefined;
  proformaUnrenovatedBasis: "current" | "market" | undefined;
  vacancyRate: number;
  holdMonths?: number; // hold period in months — sizes the absorption bar
  hasPerUnitData?: boolean; // per-unit rows exist → schedule mode drives the ramp
  onChange: (next: RentRampAssumptions | undefined) => void;
}) {
  const enabled = !!ramp?.enabled;

  // Default values for first-time enablement (Phase 1 — linear absorption).
  const DEFAULTS: RentRampAssumptions = {
    enabled: true,
    mode: "linear",
    absorption_months: 24,
    turn_downtime_months: 1,
    max_turns_per_month: 2,
    initial_vacant_units: 0,
    vacant_leaseup_months: 2,
  };

  function setField<K extends keyof RentRampAssumptions>(field: K, value: RentRampAssumptions[K]) {
    const current = ramp ?? DEFAULTS;
    onChange({ ...current, [field]: value });
  }

  function toggleEnabled(next: boolean) {
    if (next) onChange(ramp ? { ...ramp, enabled: true } : DEFAULTS);
    else if (ramp) onChange({ ...ramp, enabled: false });
    else onChange(undefined);
  }

  // Warning: market basis selected for pro forma but no ramp → year-1 rents jump to market.
  const showMarketWithoutRampWarning = proformaUnrenovatedBasis === "market" && !enabled;

  // Soft tooltip: with ramp on, vacancy_rate should be set to stabilized economic vacancy
  // (~4–5%); the turn_downtime already captures value-add turnover loss.
  const showVacancyTip = enabled && vacancyRate > 0.055;

  return (
    <div className="border-t border-slate-700 pt-3 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-300 font-medium flex items-center gap-2">
            Rent Ramp (Mark-to-Market)
            {enabled && hasPerUnitData && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-700/40 font-medium">
                per-unit schedule
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {enabled && hasPerUnitData
              ? "Each unit turns on its own timeline: vacant → lease-up; MTM → paced turns; fixed lease → after lease end."
              : "Below-market in-place leases roll to market over time, independent of the renovation schedule."}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
          {enabled ? "Enabled" : "Disabled"}
        </label>
      </div>

      {showMarketWithoutRampWarning && (
        <div className="bg-amber-950/30 border border-amber-800/50 rounded p-2 text-[11px] text-amber-300">
          <span className="font-semibold">Heads up:</span>{" "}
          Pro Forma unrenovated basis is set to <span className="font-mono">Market</span> and Rent Ramp is off.
          All in-place units will price at market from month 1, ignoring lease-up and tenant rollover.
          Enable Rent Ramp, or set the Pro Forma unrenovated basis to <span className="font-mono">Current</span>.
        </div>
      )}

      {enabled && (
        <>
          {showVacancyTip && (
            <div className="bg-slate-800/50 border border-slate-700 rounded p-2 text-[11px] text-slate-400">
              With Rent Ramp on, set <span className="font-mono">Vacancy</span> to stabilized economic vacancy (~4–5%).
              The ramp&apos;s turn downtime already captures the value-add turnover loss.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {hasPerUnitData ? (
              <div>
                <Label className="text-xs text-slate-400">Analysis Start</Label>
                <Input
                  type="date"
                  value={ramp?.analysis_start_date || ""}
                  onChange={(e) => setField("analysis_start_date", e.target.value || undefined)}
                  className="bg-slate-800 border-slate-700 text-white text-sm h-8"
                  title="Anchor for converting lease-end dates to pro forma months"
                />
              </div>
            ) : (
              <NumField
                label="Absorption"
                suffix="mo"
                value={ramp?.absorption_months ?? DEFAULTS.absorption_months}
                onChange={(v) => setField("absorption_months", v)}
              />
            )}
            <NumField
              label="Turn Downtime"
              suffix="mo"
              value={ramp?.turn_downtime_months ?? DEFAULTS.turn_downtime_months}
              onChange={(v) => setField("turn_downtime_months", v)}
            />
            <NumField
              label="Max Turns / Mo"
              value={ramp?.max_turns_per_month ?? DEFAULTS.max_turns_per_month ?? 2}
              onChange={(v) => setField("max_turns_per_month", v)}
            />
            {hasPerUnitData ? (
              <ReadOnlyField label="Vacant @ Close" value="from unit statuses" />
            ) : (
              <NumField
                label="Vacant @ Close"
                suffix="units"
                value={ramp?.initial_vacant_units ?? 0}
                onChange={(v) => setField("initial_vacant_units", v)}
              />
            )}
            <NumField
              label="Lease-Up"
              suffix="mo"
              value={ramp?.vacant_leaseup_months ?? DEFAULTS.vacant_leaseup_months ?? 2}
              onChange={(v) => setField("vacant_leaseup_months", v)}
            />
          </div>
          {/* Thin absorption bar (B7): in-place → ramping → stabilized over the hold */}
          {(() => {
            const hold = Math.max(1, holdMonths ?? 120);
            const absorb = Math.min(ramp?.absorption_months ?? DEFAULTS.absorption_months, hold);
            const rampPct = (absorb / hold) * 100;
            return (
              <div>
                <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-800">
                  <div
                    className="bg-gradient-to-r from-slate-500 to-blue-500"
                    style={{ width: `${rampPct}%` }}
                    title={`Ramping: months 1–${absorb}`}
                  />
                  <div
                    className="bg-emerald-500/80 flex-1"
                    title={`Stabilized: month ${absorb + 1} onward`}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                  <span>In-place → ramping ({absorb} mo)</span>
                  <span className="text-emerald-500">stabilized → exit</span>
                </div>
              </div>
            );
          })()}
          <div className="text-[11px] text-slate-500">
            Linear absorption: below-market units (current_rent &lt; market_rent) mark to market evenly over the
            absorption window. Each turn includes the turn-downtime months as vacancy. Renovated units always
            pay renovated rent regardless of absorption (a reno implies a turn).
          </div>
        </>
      )}
    </div>
  );
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
// Label-less currency input — used where the caller renders its own header
// (e.g. the Other Income cell with its "itemize" toggle).
function BareCurrencyInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [editValue, setEditValue] = useState("");

  const displayValue = value ? `$${formatWithCommas(value)}` : "";

  return (
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
  );
}

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
  return (
    <div>
      <Label className="text-xs text-slate-400">
        {label}
        {suffix && <span className="text-slate-600 ml-1">{suffix}</span>}
      </Label>
      <BareCurrencyInput value={value} onChange={onChange} />
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

// Itemized Other Income lines (spec B6) — deliberately short; not a 12-row taxonomy.
const OTHER_INCOME_LINES: { key: keyof OtherIncomeSublines; label: string }[] = [
  { key: "laundry", label: "Laundry" },
  { key: "storage", label: "Storage" },
  { key: "parking", label: "Parking" },
  { key: "pet_admin", label: "Pet / Admin" },
  { key: "utility_reimbursement", label: "Utility Reimb." },
  { key: "other", label: "Other" },
];

const RUBS_BASIS_LABELS: Record<RubsBasis, string> = {
  utilities_total: "Total utilities",
  utilities_electric: "Electric",
  utilities_water: "Water/Sewer",
  utilities_gas: "Gas",
};
const RUBS_BASES = Object.keys(RUBS_BASIS_LABELS) as RubsBasis[];

// Live (client-side) estimate of annual utility expense for a RUBS basis, so the
// form can show an implied recovery ratio while editing. Handles the common
// dollar modes; %EGI/%GPR utilities are skipped in this estimate (the
// authoritative figure lives in the engine result / export).
function estimateAnnualUtilities(
  expenses: ScenarioInputs["expenses"],
  totalUnits: number,
  basis: RubsBasis,
): number {
  const resolveOne = (oi?: OpexInput): number => {
    if (!oi || !oi.value) return 0;
    switch (oi.mode) {
      case "total_annual": return oi.value;
      case "per_unit_annual": return oi.value * totalUnits;
      case "per_unit_monthly": return oi.value * totalUnits * 12;
      default: return 0; // pct modes — not estimable here
    }
  };
  const subs = expenses.opex_inputs?.utilities_sublines as Record<string, OpexInput | undefined> | undefined;
  if (basis !== "utilities_total") {
    const key = basis === "utilities_electric" ? "electric" : basis === "utilities_water" ? "water_sewer" : "gas";
    const sub = subs?.[key];
    if (sub && sub.value) return resolveOne(sub);
    // fall through to total when the chosen subline isn't itemized
  }
  if (subs) {
    let any = false, sum = 0;
    for (const k of Object.keys(subs)) { const s = subs[k]; if (s && s.value) { any = true; sum += resolveOne(s); } }
    if (any) return sum;
  }
  const total = resolveOne(expenses.opex_inputs?.utilities);
  if (total > 0) return total;
  return (expenses.utilities_per_unit || 0) * totalUnits;
}

// Total monthly other income implied by a set of line items (live estimate).
function estimateLineItemsMonthly(
  items: OtherIncomeLineItem[],
  expenses: ScenarioInputs["expenses"],
  totalUnits: number,
  vacancyRate: number,
): number {
  const physOcc = Math.max(0, 1 - vacancyRate);
  let monthly = 0;
  for (const it of items) {
    if (it.kind === "rubs") {
      const basisAnnual = estimateAnnualUtilities(expenses, totalUnits, it.rubs_basis ?? "utilities_total");
      monthly += ((it.rubs_recovery_pct ?? 0) * basisAnnual * physOcc) / 12;
    } else {
      monthly += it.monthly_amount ?? 0;
    }
  }
  return Math.round(monthly * 100) / 100;
}

const OPEX_MODE_LABELS: Record<OpexInputMode, string> = {
  total_annual: "$ /yr",
  per_unit_annual: "$ /unit/yr",
  per_unit_monthly: "$ /unit/mo",
  pct_egi: "% EGI",
  pct_gpr: "% GPR",
};
const OPEX_MODES = Object.keys(OPEX_MODE_LABELS) as OpexInputMode[];

// Editable itemized other-income table (FIX: itemized-other-income). When line
// items are present they are the source of truth — they supersede the flat
// field and the single-knob structured RUBS toggle.
function OtherIncomeLineItems({
  items,
  expenses,
  totalUnits,
  vacancyRate,
  onChange,
}: {
  items: OtherIncomeLineItem[];
  expenses: ScenarioInputs["expenses"];
  totalUnits: number;
  vacancyRate: number;
  onChange: (items: OtherIncomeLineItem[]) => void;
}) {
  const physOcc = Math.max(0, 1 - vacancyRate);
  const update = (i: number, patch: Partial<OtherIncomeLineItem>) =>
    onChange(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, n) => n !== i));
  const addFlat = () => onChange([...items, { label: "", kind: "flat", monthly_amount: 0, recurring: true }]);
  const addRubs = () => onChange([...items, { label: "RUBS", kind: "rubs", rubs_recovery_pct: 0.8, rubs_basis: "utilities_total", recurring: true }]);

  const computed = items.map((it) => {
    if (it.kind === "rubs") {
      const basisAnnual = estimateAnnualUtilities(expenses, totalUnits, it.rubs_basis ?? "utilities_total");
      const annual = (it.rubs_recovery_pct ?? 0) * basisAnnual * physOcc;
      return { annual, ratio: basisAnnual > 0 ? annual / basisAnnual : null, isRubs: true };
    }
    return { annual: (it.monthly_amount ?? 0) * 12, ratio: null as number | null, isRubs: false };
  });
  const totalMonthly = computed.reduce((s, c) => s + c.annual / 12, 0);
  const rubsAnnual = computed.reduce((s, c) => s + (c.isRubs ? c.annual : 0), 0);
  const utilitiesAnnual = estimateAnnualUtilities(expenses, totalUnits, "utilities_total");
  const aggregateRatio = utilitiesAnnual > 0 ? rubsAnnual / utilitiesAnnual : null;

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {items.map((it, i) => {
          const c = computed[i];
          const ratioOver = c.ratio !== null && c.ratio > 1.0;
          return (
            <div key={i} className="border border-slate-800 rounded p-2 space-y-2 bg-slate-900/30">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={it.label}
                  placeholder="Label (e.g. RUBS - Electric)"
                  onChange={(e) => update(i, { label: e.target.value })}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder:text-slate-600"
                />
                <div className="flex items-center rounded border border-slate-700 overflow-hidden text-[11px]">
                  <button type="button" onClick={() => update(i, { kind: "flat" })} className={`px-2 py-1 ${it.kind === "flat" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}>Flat</button>
                  <button type="button" onClick={() => update(i, { kind: "rubs" })} className={`px-2 py-1 ${it.kind === "rubs" ? "bg-blue-900/50 text-blue-200" : "text-slate-500 hover:text-slate-300"}`}>RUBS</button>
                </div>
                <button type="button" onClick={() => remove(i)} className="text-slate-500 hover:text-red-400 px-1" title="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                {it.kind === "flat" ? (
                  <div className="w-32">
                    <Label className="text-[10px] text-slate-400">$/mo</Label>
                    <BareCurrencyInput value={it.monthly_amount ?? 0} onChange={(v) => update(i, { monthly_amount: v })} />
                  </div>
                ) : (
                  <>
                    <div className="w-24">
                      <PctField label="Recovery %" value={it.rubs_recovery_pct ?? 0} onChange={(v) => update(i, { rubs_recovery_pct: v })} />
                    </div>
                    <div className="w-40">
                      <Label className="text-[10px] text-slate-400">Basis</Label>
                      <select
                        value={it.rubs_basis ?? "utilities_total"}
                        onChange={(e) => update(i, { rubs_basis: e.target.value as RubsBasis })}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                      >
                        {RUBS_BASES.map((b) => <option key={b} value={b}>{RUBS_BASIS_LABELS[b]}</option>)}
                      </select>
                    </div>
                    <div className="text-[11px] text-slate-400 pb-1.5">
                      ≈ <span className="tabular-nums text-slate-200">{fmtCurrency(Math.round(c.annual))}/yr</span>
                      {c.ratio !== null && (
                        <span className={`ml-1 ${ratioOver ? "text-amber-400" : "text-slate-500"}`}>({(c.ratio * 100).toFixed(0)}% of basis)</span>
                      )}
                    </div>
                  </>
                )}
                <label className="flex items-center gap-1 text-[11px] text-slate-400 pb-1.5 cursor-pointer">
                  <input type="checkbox" checked={it.recurring !== false} onChange={(e) => update(i, { recurring: e.target.checked })} className="accent-blue-500" />
                  recurring
                </label>
              </div>
              <input
                type="text"
                value={it.source_note ?? ""}
                placeholder={it.kind === "rubs" && ratioOver ? "Source required for gross-up (>100%) — e.g. T-12 actual" : "Source note (e.g. T-12 Jun25-May26)"}
                onChange={(e) => update(i, { source_note: e.target.value })}
                className={`w-full bg-slate-800 border rounded px-2 py-1 text-[11px] text-white placeholder:text-slate-600 ${it.kind === "rubs" && ratioOver && !it.source_note?.trim() ? "border-amber-600/60" : "border-slate-700"}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={addFlat} className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="h-3 w-3" /> Flat line</button>
        <button type="button" onClick={addRubs} className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="h-3 w-3" /> RUBS line</button>
      </div>
      <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-[11px]">
        <span className="text-slate-400">Total other income <span className="text-slate-200 tabular-nums font-medium">{fmtCurrency(Math.round(totalMonthly))}/mo · {fmtCurrency(Math.round(totalMonthly * 12))}/yr</span></span>
        {aggregateRatio !== null && (
          <span className={aggregateRatio > 1.0 ? "text-amber-400" : "text-slate-500"}>
            RUBS recovery {(aggregateRatio * 100).toFixed(0)}% of utilities{aggregateRatio > 1.0 ? " (gross-up)" : ""}
          </span>
        )}
      </div>
      <p className="text-[10px] text-slate-500">Itemized other income overrides the flat field and the single-knob RUBS toggle. RUBS = recovery × utility expense × physical occupancy. Estimates use current expense inputs; the export shows the engine&apos;s authoritative figures.</p>
    </div>
  );
}

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
  multiplier,
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
  multiplier?: number; // post-multiplier applied to annual display (e.g. turnover rate)
}) {
  const [focused, setFocused] = useState(false);
  const [editValue, setEditValue] = useState("");

  const isPct = input.mode === "pct_egi" || input.mode === "pct_gpr";
  const displayValue = input.value
    ? isPct
      ? `${Math.round(input.value * 10000) / 100}`
      : `$${formatWithCommas(input.value)}`
    : "";
  const rawAnnual = readOnlySum !== undefined ? readOnlySum : opexToAnnual(input, units, egi, gpr);
  const annualDollars = rawAnnual * (multiplier ?? 1);
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

export function AssumptionsForm({ scenario, onUpdate, onDelete, loading, dealT12, dealCity, dealRentRoll, year1Revenue }: Props) {
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
  const taxInitial = ((scenario as Record<string, unknown>).tax_assumptions ?? undefined) as TaxAssumptions | undefined;
  const [tx, setTx] = useState<TaxAssumptions | undefined>(taxInitial);
  const [dirty, setDirty] = useState(false);
  const [renovatedBasis, setRenovatedBasis] = useState<"current" | "market">("market");

  // Rent comps for the market-rent guardrail (spec B8). Fetched once per deal city;
  // failures degrade silently — no comps just means no guardrail.
  const [rentComps, setRentComps] = useState<RentComp[]>([]);
  useEffect(() => {
    if (!dealCity) return;
    let cancelled = false;
    fetch(`/api/rent-comps?city=${encodeURIComponent(dealCity)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled && Array.isArray(data)) setRentComps(data); })
      .catch(() => { /* silent — guardrail is best-effort */ });
    return () => { cancelled = true; };
  }, [dealCity]);

  // Itemized Other Income (spec B6)
  const [oiExpanded, setOiExpanded] = useState(false);
  // Entry period for the itemization panel: $/mo or $/yr. Values are STORED
  // monthly; /yr entry divides by 12 (rounded to cents) on the way in.
  const [oiPeriod, setOiPeriod] = useState<"mo" | "yr">("mo");
  const oiMult = oiPeriod === "yr" ? 12 : 1;
  const oiHasSublines = Object.values(r.other_income_sublines ?? {}).some((v) => (v as number) > 0);
  const oiUsesLineItems = !!(r.other_income?.line_items && r.other_income.line_items.length > 0);
  // Migrate the legacy sub-line / flat / single-knob-RUBS state into editable
  // line items when the user switches to the advanced editor.
  function seedLineItems(): OtherIncomeLineItem[] {
    const out: OtherIncomeLineItem[] = [];
    const subs = r.other_income_sublines ?? {};
    for (const { key, label } of OTHER_INCOME_LINES) {
      const v = (subs[key] as number) || 0;
      if (v <= 0) continue;
      if (key === "utility_reimbursement") {
        out.push({ label: "RUBS", kind: "rubs", rubs_recovery_pct: r.rubs?.recovery_pct ?? 0.8, rubs_basis: "utilities_total", recurring: true, source_note: r.rubs?.source_note });
      } else {
        out.push({ label, kind: "flat", monthly_amount: v, recurring: true });
      }
    }
    const subSum = Object.values(subs).reduce((s: number, v) => s + ((v as number) || 0), 0);
    const remainder = (r.other_income_monthly || 0) - subSum;
    if (remainder > 1) out.push({ label: "Other", kind: "flat", monthly_amount: Math.round(remainder * 100) / 100, recurring: true });
    if (r.rubs?.mode === "structured" && !subs.utility_reimbursement) {
      out.push({ label: "RUBS", kind: "rubs", rubs_recovery_pct: r.rubs.recovery_pct ?? 0.8, rubs_basis: "utilities_total", recurring: true, source_note: r.rubs.source_note });
    }
    if (out.length === 0) out.push({ label: "", kind: "flat", monthly_amount: 0, recurring: true });
    return out;
  }
  function updateOtherIncomeSubline(key: keyof OtherIncomeSublines, displayValue: number) {
    const monthly = Math.round((displayValue / oiMult) * 100) / 100;
    const next: OtherIncomeSublines = { ...(r.other_income_sublines ?? {}), [key]: monthly };
    const sum = Object.values(next).reduce((s: number, v) => s + ((v as number) || 0), 0);
    // Keep the canonical total in sync — the engine only reads other_income_monthly.
    setR({ ...r, other_income_sublines: next, other_income_monthly: Math.round(sum * 100) / 100 });
    markDirty();
  }

  useEffect(() => {
    setP(purchase);
    setF(financing);
    setR(revenue);
    setE(expenses);
    setC(capex);
    setEx(exit);
    setDep(depreciation);
    setTx(taxInitial);
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
      tax_assumptions: tx ?? null,
    });
    setDirty(false);
  }

  // Unit mix helpers
  const unitMix = r.unit_mix || [{ type: "Average", count: 1, current_rent: 1000, market_rent: 1100, renovated_rent_premium: 200 }];

  function updateUnitMix(index: number, field: string, value: number | string | undefined) {
    const updated = [...unitMix];
    const row = { ...updated[index] } as Record<string, unknown>;
    if (value === undefined || value === "") {
      delete row[field];
    } else {
      row[field] = value;
    }
    updated[index] = row as unknown as typeof updated[number];
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

  const subtotalUnits = totalUnits;
  const subtotalCurrent = unitMix.reduce((sum, u) => sum + u.count * u.current_rent, 0);
  const subtotalMarket = unitMix.reduce((sum, u) => sum + u.count * u.market_rent, 0);
  const subtotalPremium = unitMix.reduce((sum, u) => sum + u.count * u.renovated_rent_premium, 0);
  const subtotalRenovated = renovatedBasis === "market"
    ? unitMix.reduce((sum, u) => sum + u.count * (u.market_rent + u.renovated_rent_premium), 0)
    : unitMix.reduce((sum, u) => sum + u.count * (u.current_rent + u.renovated_rent_premium), 0);
  const otherIncome = r.other_income_monthly || 0;

  // Per-unit rows present anywhere? (spec B2 — drives schedule-mode ramp + exact in-place math)
  const hasPerUnitData = unitMix.some((u) => (u.units?.length ?? 0) > 0);

  // In-place rent over OCCUPIED units only (spec A2: current_rent is the occupied
  // average, and vacant-at-close units never pay in-place rent). With per-unit
  // data, use the exact sum over non-vacant units; otherwise approximate via the
  // ramp's vacant count.
  const vacantAtClose = r.rent_ramp?.enabled ? (r.rent_ramp.initial_vacant_units ?? 0) : 0;
  const avgCurrentRent = totalUnits > 0 ? subtotalCurrent / totalUnits : 0;
  const inPlaceOccupiedRent = hasPerUnitData
    ? unitMix.reduce((sum, row) => {
        if (row.units && row.units.length > 0) {
          return sum + row.units.reduce((s, u) => s + (u.status !== "vacant" ? u.current_rent : 0), 0);
        }
        return sum + row.count * row.current_rent;
      }, 0)
    : Math.max(0, subtotalCurrent - vacantAtClose * avgCurrentRent);

  // Keep the ramp in schedule mode whenever per-unit data exists (the engine's
  // per-unit branch triggers on mode==="schedule"). Also seed the lease-date
  // anchor so "occupied" units can schedule their turns.
  useEffect(() => {
    if (hasPerUnitData && r.rent_ramp?.enabled && r.rent_ramp.mode !== "schedule") {
      setR((prev) => ({
        ...prev,
        rent_ramp: {
          ...prev.rent_ramp!,
          mode: "schedule",
          analysis_start_date: prev.rent_ramp!.analysis_start_date || new Date().toISOString().slice(0, 10),
        },
      }));
      markDirty();
    }
  }, [hasPerUnitData, r.rent_ramp?.enabled, r.rent_ramp?.mode]);

  // ── Per-unit row editing (spec B2) ──
  const [expandedUnitRows, setExpandedUnitRows] = useState<Set<number>>(new Set());

  function toggleUnitRow(i: number) {
    setExpandedUnitRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) { next.delete(i); return next; }
      next.add(i);
      return next;
    });
    // First expansion seeds per-unit details from the row's aggregate values.
    const row = unitMix[i];
    if (!row.units || row.units.length === 0) {
      const seeded: UnitDetail[] = Array.from({ length: Math.max(1, row.count) }, (_, n) => ({
        unit_id: `${n + 1}`,
        status: "mtm" as const,
        current_rent: row.current_rent,
      }));
      const updated = [...unitMix];
      updated[i] = { ...row, units: seeded };
      setR({ ...r, unit_mix: updated });
      markDirty();
    }
  }

  function updateUnitDetail(rowIdx: number, unitIdx: number, patch: Partial<UnitDetail>) {
    const row = unitMix[rowIdx];
    if (!row.units) return;
    const units = row.units.map((u, n) => (n === unitIdx ? { ...u, ...patch } : u));
    const updated = [...unitMix];
    updated[rowIdx] = syncRowFromUnits(row, units);
    setR({ ...r, unit_mix: updated });
    markDirty();
  }

  function addUnitDetail(rowIdx: number) {
    const row = unitMix[rowIdx];
    const units = [...(row.units ?? []), { unit_id: `${(row.units?.length ?? 0) + 1}`, status: "mtm" as const, current_rent: row.current_rent }];
    const updated = [...unitMix];
    updated[rowIdx] = syncRowFromUnits(row, units);
    setR({ ...r, unit_mix: updated });
    markDirty();
  }

  function removeUnitDetail(rowIdx: number, unitIdx: number) {
    const row = unitMix[rowIdx];
    if (!row.units || row.units.length <= 1) return;
    const units = row.units.filter((_, n) => n !== unitIdx);
    const updated = [...unitMix];
    updated[rowIdx] = syncRowFromUnits(row, units);
    setR({ ...r, unit_mix: updated });
    markDirty();
  }

  // Replace the whole roll with one per-unit row per rent-roll entry.
  function loadUnitsFromRentRoll() {
    if (!dealRentRoll || dealRentRoll.length === 0) return;
    const details = dealRentRoll.map(rentRollToUnitDetail);
    const marketAvg = details.length > 0
      ? details.reduce((s, u) => s + (u.market_rent ?? 0), 0) / details.length
      : 0;
    const base: UnitMix = {
      unit_number: "All units",
      type: dealRentRoll[0]?.unit_type || "Average",
      count: details.length,
      current_rent: 0,
      market_rent: Math.round(marketAvg * 100) / 100,
      renovated_rent_premium: unitMix[0]?.renovated_rent_premium ?? 200,
    };
    setR({ ...r, unit_mix: [syncRowFromUnits(base, details)] });
    setExpandedUnitRows(new Set([0]));
    markDirty();
  }

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

  // Lightweight NOI estimate for display — respects OpEx rent basis
  const opexRentBasis: RentBasis = e.opex_rent_basis || "current";
  const t12GPR = unitMix.reduce((sum, u) => {
    const base = (opexRentBasis === "market" || opexRentBasis === "market_plus_reno") ? u.market_rent : u.current_rent;
    const rent = (opexRentBasis === "current_plus_reno" || opexRentBasis === "market_plus_reno") ? base + (u.renovated_rent_premium || 0) : base;
    return sum + u.count * rent * 12;
  }, 0);
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
  const turnoverRate = e.turnover_rate ?? 0.50;
  // Rate only applies to per-unit turnover inputs; total/pct inputs are aggregates already.
  const turnoverInput = opexInputs.turnover;
  const turnoverIsPerUnit =
    !turnoverInput ||
    turnoverInput.mode === "per_unit_annual" ||
    turnoverInput.mode === "per_unit_monthly";
  const turnoverDisplayMultiplier = turnoverIsPerUnit ? turnoverRate : 1;
  const t12TotalOpex =
    opexLineAnnual("management_fees") +
    opexLineAnnual("payroll") +
    opexLineAnnual("repairs_maintenance") +
    applyTurnoverRate(opexLineAnnual("turnover"), turnoverInput, turnoverRate) +
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
            <div>
              <CurrencyField label="Bid Price" value={p.bid_price || 0} onChange={(v) => {
                setP({ ...p, bid_price: v, loi_amount: v, purchase_price: v || p.purchase_price });
                markDirty();
              }} />
              {!!p.bid_price && Math.abs((p.bid_price || 0) - p.purchase_price) >= 1 && (
                <p className="text-[10px] text-amber-400/80 mt-0.5">
                  ≠ modeled purchase {fmtCurrency(p.purchase_price)} — the model uses Purchase Price
                </p>
              )}
            </div>
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
                {/* DSCR-aware sizing (fix-spec Phase 4.1): loan = min(LTV, DSCR proceeds) */}
                <div className="flex items-end gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => { setF({ ...f, size_to_dscr: f.size_to_dscr === false ? true : false }); markDirty(); }}
                    className={`px-2 py-1.5 rounded text-xs border ${f.size_to_dscr !== false ? "bg-blue-900/40 border-blue-500 text-blue-200" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                  >
                    Size loan to DSCR: {f.size_to_dscr !== false ? "ON" : "OFF"}
                  </button>
                  {f.size_to_dscr !== false && (
                    <div className="w-28">
                      <NumField label="DSCR Floor" value={f.dscr_floor ?? 1.25} suffix="x" onChange={(v) => { setF({ ...f, dscr_floor: v }); markDirty(); }} />
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500 flex-1 min-w-[220px]">
                    Lender convention: proceeds = min(LTV loan, loan whose amortizing payment year-1 NOI covers at the floor).
                    When DSCR binds, the engine resizes the loan and notes the extra equity required.
                  </p>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-xs text-slate-500 font-medium">Unit Mix</div>
                {dealRentRoll && dealRentRoll.length > 0 && (
                  <button
                    type="button"
                    onClick={loadUnitsFromRentRoll}
                    title={`Replace the roll with ${dealRentRoll.length} per-unit rows from the imported rent roll`}
                    className="text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    load {dealRentRoll.length} units from rent roll
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Renovated basis:</span>
                <select
                  value={renovatedBasis}
                  onChange={(e) => setRenovatedBasis(e.target.value as "current" | "market")}
                  className="bg-slate-800 border border-slate-700 text-white text-xs rounded px-1.5 py-0.5 hover:border-slate-500"
                >
                  <option value="market">Market + Premium</option>
                  <option value="current">Current + Premium</option>
                </select>
              </div>
            </div>
            {unitMix.map((unit, i) => (
              <div key={i} className="space-y-1.5">
              <div className="grid grid-cols-3 sm:grid-cols-8 gap-2 items-end">
                <div>
                  <Label className="text-xs text-slate-400 flex items-center justify-between">
                    <span className="flex items-center gap-0.5">
                      {/* Expand to per-unit detail (spec B2) */}
                      <button
                        type="button"
                        onClick={() => toggleUnitRow(i)}
                        title={expandedUnitRows.has(i) ? "Collapse to average" : "Expand to per-unit detail"}
                        className="text-slate-500 hover:text-slate-300 -ml-1"
                      >
                        {expandedUnitRows.has(i)
                          ? <ChevronDown className="h-3 w-3" />
                          : <ChevronRight className="h-3 w-3" />}
                      </button>
                      Unit
                    </span>
                    {/* Mixed-use chip — informational only; does NOT affect totals. */}
                    <UnitClassChip
                      value={unit.unit_class}
                      onChange={(c) => updateUnitMix(i, "unit_class", c ?? "")}
                    />
                  </Label>
                  <Input
                    value={unit.unit_number || ""}
                    onChange={(e) => updateUnitMix(i, "unit_number", e.target.value)}
                    placeholder="e.g. Apartments, A-3"
                    className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-400">Type</Label>
                  <Input
                    value={unit.type}
                    onChange={(e) => updateUnitMix(i, "type", e.target.value)}
                    placeholder="e.g. 1BR/1BA"
                    className="bg-slate-800 border-slate-700 text-white text-sm h-8 hover:border-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
                  />
                </div>
                {(unit.units?.length ?? 0) > 0 ? (
                  <>
                    <ReadOnlyField label="Count" value={`${unit.count}`} />
                    <ReadOnlyField label="Current Rent" value={`${fmtCurrency(unit.current_rent)} avg`} />
                  </>
                ) : (
                  <>
                    <NumField label="Count" value={unit.count} onChange={(v) => updateUnitMix(i, "count", v)} />
                    <CurrencyField label="Current Rent" value={unit.current_rent} onChange={(v) => updateUnitMix(i, "current_rent", v)} />
                  </>
                )}
                {(() => {
                  // Comp support (spec B8) — the root-cause guardrail on the one
                  // assumption everything traces back to.
                  const stats = compStatsForType(rentComps, unit.type);
                  const aboveComps = stats !== null && unit.market_rent > stats.max;
                  return (
                    <div>
                      <CurrencyField label="Market Rent" value={unit.market_rent} onChange={(v) => updateUnitMix(i, "market_rent", v)} />
                      {stats && (
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                          <span className="text-slate-500 tabular-nums">
                            {stats.count} comp{stats.count === 1 ? "" : "s"} · med {fmtCurrency(stats.median)}
                            {stats.min !== stats.max && ` (${fmtCurrency(stats.min)}–${fmtCurrency(stats.max)})`}
                          </span>
                          {unit.market_rent !== Math.round(stats.median) && (
                            <button
                              type="button"
                              onClick={() => updateUnitMix(i, "market_rent", Math.round(stats.median))}
                              className="text-blue-400 hover:text-blue-300"
                              title="Set market rent to the comp median"
                            >
                              use median
                            </button>
                          )}
                        </div>
                      )}
                      {aboveComps && (
                        <p className="text-[10px] text-amber-400 mt-0.5">above comps — verify</p>
                      )}
                    </div>
                  );
                })()}
                <CurrencyField label="Reno Premium" value={unit.renovated_rent_premium} onChange={(v) => updateUnitMix(i, "renovated_rent_premium", v)} />
                <div>
                  <Label className="text-xs text-slate-400">Renovated</Label>
                  <div className="bg-slate-800/50 border border-slate-700 rounded text-sm h-8 px-2 flex items-center text-emerald-400 tabular-nums">
                    {fmtCurrency(
                      renovatedBasis === "market"
                        ? unit.market_rent + unit.renovated_rent_premium
                        : unit.current_rent + unit.renovated_rent_premium
                    )}
                  </div>
                </div>
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

              {/* Expanded per-unit detail (spec B2 / ramp Phase 2). Each unit's
                  status + lease end drive its own time-to-market in the engine. */}
              {expandedUnitRows.has(i) && (unit.units?.length ?? 0) > 0 && (
                <div className="ml-4 border border-slate-800 rounded p-2 space-y-1">
                  <div className="grid grid-cols-6 gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-1">
                    <span>Unit ID</span>
                    <span>Status</span>
                    <span>Current Rent</span>
                    <span>Lease End</span>
                    <span>Market Rent</span>
                    <span />
                  </div>
                  {unit.units!.map((ud, n) => (
                    <div key={n} className="grid grid-cols-6 gap-2 items-center">
                      <Input
                        value={ud.unit_id}
                        onChange={(e) => updateUnitDetail(i, n, { unit_id: e.target.value })}
                        placeholder="A-3"
                        className="bg-slate-800 border-slate-700 text-white text-xs h-7"
                      />
                      <select
                        value={ud.status}
                        onChange={(e) => {
                          const status = e.target.value as UnitDetail["status"];
                          updateUnitDetail(i, n, {
                            status,
                            // Vacant pays $0; clearing back from vacant restores the row average.
                            current_rent: status === "vacant" ? 0 : (ud.current_rent || unit.current_rent),
                            lease_end: status === "occupied" ? ud.lease_end : undefined,
                          });
                        }}
                        className="bg-slate-800 border border-slate-700 text-white text-xs h-7 rounded px-1"
                      >
                        <option value="occupied">Occupied (lease)</option>
                        <option value="mtm">MTM</option>
                        <option value="vacant">Vacant</option>
                      </select>
                      <BareCurrencyInput
                        value={ud.current_rent}
                        onChange={(v) => updateUnitDetail(i, n, { current_rent: v })}
                      />
                      <Input
                        type="date"
                        value={ud.lease_end || ""}
                        disabled={ud.status !== "occupied"}
                        onChange={(e) => updateUnitDetail(i, n, { lease_end: e.target.value || undefined })}
                        className="bg-slate-800 border-slate-700 text-white text-xs h-7 disabled:opacity-40"
                      />
                      <BareCurrencyInput
                        value={ud.market_rent ?? unit.market_rent}
                        onChange={(v) => updateUnitDetail(i, n, { market_rent: v })}
                      />
                      <button
                        type="button"
                        onClick={() => removeUnitDetail(i, n)}
                        disabled={(unit.units?.length ?? 0) <= 1}
                        className="text-slate-600 hover:text-red-400 disabled:opacity-30 justify-self-start"
                        title="Remove unit"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => addUnitDetail(i)}
                      className="text-[11px] text-blue-400 hover:text-blue-300"
                    >
                      + add unit
                    </button>
                    <span className="text-[10px] text-slate-500">
                      Vacant: lease-up then market · MTM: paced turns · Occupied: turns after lease end
                    </span>
                  </div>
                </div>
              )}
              </div>
            ))}

            {/* Subtotals row */}
            <div className="grid grid-cols-3 sm:grid-cols-8 gap-2 items-end border-t border-slate-700 pt-2">
              <div />
              <div className="text-xs text-slate-400 font-medium flex items-center h-8">Subtotals</div>
              <div className="text-xs text-slate-300 font-medium flex items-center h-8 tabular-nums">{subtotalUnits} units</div>
              <div className="text-xs text-slate-300 font-medium flex items-center h-8 tabular-nums">{fmtCurrency(subtotalCurrent)}/mo</div>
              <div className="text-xs text-slate-300 font-medium flex items-center h-8 tabular-nums">{fmtCurrency(subtotalMarket)}/mo</div>
              <div className="text-xs text-slate-300 font-medium flex items-center h-8 tabular-nums">{fmtCurrency(subtotalPremium)}/mo</div>
              <div className="text-xs text-emerald-400 font-medium flex items-center h-8 tabular-nums">{fmtCurrency(subtotalRenovated)}/mo</div>
              <div />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={addUnitType}
              className="border-slate-700 text-slate-400 hover:bg-slate-800"
            >
              <Plus className="h-3 w-3 mr-1" /> Unit Type
            </Button>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-400">Other Income</Label>
                  <button
                    type="button"
                    onClick={() => setOiExpanded(!oiExpanded)}
                    className="text-[10px] text-blue-400 hover:text-blue-300"
                  >
                    {oiExpanded ? "collapse" : "itemize"}
                  </button>
                </div>
                {oiUsesLineItems || oiHasSublines ? (
                  <div className="bg-slate-800/40 border border-slate-800 rounded-md text-slate-400 text-sm h-8 px-3 flex items-center justify-between italic">
                    <span className="text-[10px]">{oiUsesLineItems ? "sum of line items" : "sum of sub-items"}</span>
                    <span className="tabular-nums not-italic text-slate-200">{fmtCurrency(r.other_income_monthly || 0)}/mo</span>
                  </div>
                ) : (
                  <BareCurrencyInput value={r.other_income_monthly} onChange={(v) => { setR({ ...r, other_income_monthly: v }); markDirty(); }} />
                )}
                {(r.other_income_monthly || 0) === 0 && (
                  <p className="text-[10px] text-amber-400/80 mt-0.5">empty — check OM for laundry / storage / parking</p>
                )}
              </div>
              <div>
                <PctField label="Vacancy" value={r.vacancy_rate} onChange={(v) => { setR({ ...r, vacancy_rate: v }); markDirty(); }} />
                {r.rent_ramp?.enabled && (
                  <p className="text-[10px] text-slate-500 mt-0.5">stabilized — ramp models turn vacancy</p>
                )}
              </div>
              <PctField label="Bad Debt" value={r.bad_debt_rate} onChange={(v) => { setR({ ...r, bad_debt_rate: v }); markDirty(); }} />
              <PctField label="Concessions" value={r.concessions_rate ?? 0} onChange={(v) => { setR({ ...r, concessions_rate: v }); markDirty(); }} />
              <div>
                <PctField label="Turnover" value={e.turnover_rate ?? 0.50} suffix="% units/yr" onChange={(v) => { setE({ ...e, turnover_rate: v }); markDirty(); }} />
                {r.rent_ramp?.enabled && (
                  <p className="text-[10px] text-slate-500 mt-0.5">drives turn cost; ramp turns are costed separately</p>
                )}
              </div>
            </div>

            {/* Itemized Other Income. Two modes: the legacy fixed sub-line grid
                (+ Phase 4 single-knob RUBS), or the advanced editable line-item
                table which supersedes both when present. */}
            {oiExpanded && (
              <div className="border border-slate-800 rounded p-3 space-y-2">
                {oiUsesLineItems ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-medium">Other Income — itemized (advanced)</span>
                      <button
                        type="button"
                        onClick={() => { setR({ ...r, other_income: undefined }); markDirty(); }}
                        className="text-[10px] text-slate-500 hover:text-slate-300"
                      >
                        revert to simple
                      </button>
                    </div>
                    <OtherIncomeLineItems
                      items={r.other_income!.line_items!}
                      expenses={e}
                      totalUnits={totalUnits}
                      vacancyRate={r.vacancy_rate}
                      onChange={(items) => {
                        const monthly = estimateLineItemsMonthly(items, e, totalUnits, r.vacancy_rate);
                        // Keep other_income_monthly synced for displays that don't
                        // read line items; the engine ignores it when items exist.
                        setR({ ...r, other_income: { line_items: items }, other_income_monthly: monthly });
                        markDirty();
                      }}
                    />
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-medium">Other Income — itemized</span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => { setR({ ...r, other_income: { line_items: seedLineItems() }, rubs: undefined }); markDirty(); }}
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          switch to advanced (RUBS by line)
                        </button>
                        <div className="flex items-center rounded border border-slate-700 overflow-hidden text-[11px]">
                          <button type="button" onClick={() => setOiPeriod("mo")} className={`px-2 py-0.5 ${oiPeriod === "mo" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}>$/mo</button>
                          <button type="button" onClick={() => setOiPeriod("yr")} className={`px-2 py-0.5 ${oiPeriod === "yr" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"}`}>$/yr</button>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                      {OTHER_INCOME_LINES.map(({ key, label }) => (
                        <CurrencyField
                          key={key}
                          label={label}
                          suffix={`/${oiPeriod}`}
                          value={Math.round(((r.other_income_sublines?.[key] as number) || 0) * oiMult * 100) / 100}
                          onChange={(v) => updateOtherIncomeSubline(key, v)}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Utility Reimbursement (RUBS) can be entered here <span className="font-semibold">or</span> netted in the
                      Utilities expense section (negative line) — pick <span className="font-semibold">one</span> to avoid
                      double-counting. For per-utility RUBS with recovery ratios, use <span className="font-semibold">switch to advanced</span>.
                    </p>
                    {/* Structured RUBS (fix-spec Phase 4.2): derive the reimbursement
                        instead of hand-typing it. recovery × utilities × physical occupancy. */}
                    <div className="flex items-end gap-3 flex-wrap border-t border-slate-800 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          const on = r.rubs?.mode === "structured";
                          setR({ ...r, rubs: on ? undefined : { mode: "structured", recovery_pct: r.rubs?.recovery_pct ?? 0.80, source_note: r.rubs?.source_note } });
                          markDirty();
                        }}
                        className={`px-2 py-1.5 rounded text-xs border ${r.rubs?.mode === "structured" ? "bg-blue-900/40 border-blue-500 text-blue-200" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                      >
                        Structured RUBS: {r.rubs?.mode === "structured" ? "ON" : "OFF"}
                      </button>
                      {r.rubs?.mode === "structured" && (
                        <>
                          <div className="w-28">
                            <PctField label="Recovery %" value={r.rubs.recovery_pct ?? 0.80} onChange={(v) => { setR({ ...r, rubs: { ...r.rubs!, recovery_pct: v } }); markDirty(); }} />
                          </div>
                          <div className="flex-1 min-w-[220px]">
                            <label className="text-[11px] text-slate-400 block mb-1">Source note {(r.rubs.recovery_pct ?? 0.80) > 0.85 && <span className="text-amber-400">(required above 85%)</span>}</label>
                            <input
                              type="text"
                              value={r.rubs.source_note ?? ""}
                              placeholder="e.g. Lease audit 2026-05: 100% billback in place"
                              onChange={(e) => { setR({ ...r, rubs: { ...r.rubs!, source_note: e.target.value } }); markDirty(); }}
                              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-white placeholder:text-slate-600"
                            />
                          </div>
                        </>
                      )}
                    </div>
                    {r.rubs?.mode === "structured" && (
                      <p className="text-[11px] text-slate-500">
                        Derived RUBS = recovery × utilities expense × physical occupancy, replacing the manual
                        Utility Reimb. line above. Default 80%; above 85% requires collections evidence.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Revenue trajectory (B4) — the path the engine actually produces.
                Replaces the old duplicated Monthly + Annual totals blocks. */}
            <RevenueTrajectory
              inPlaceRentMonthly={inPlaceOccupiedRent}
              stabilizedRentMonthly={subtotalMarket}
              renoCeilingRentMonthly={subtotalRenovated}
              otherIncomeMonthly={otherIncome}
              year1RevenueAnnual={year1Revenue}
              rampEnabled={!!r.rent_ramp?.enabled}
            />

            {/* Rent Ramp panel (B7) — co-located with the trajectory it drives */}
            <RentRampPanel
              ramp={r.rent_ramp}
              proformaUnrenovatedBasis={exit.proforma_unrenovated_basis}
              vacancyRate={r.vacancy_rate}
              holdMonths={(exit.hold_period_years || 10) * 12}
              hasPerUnitData={hasPerUnitData}
              onChange={(next) => { setR({ ...r, rent_ramp: next }); markDirty(); }}
            />
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
                <span className="text-slate-600">·</span>
                <span className="flex items-center gap-1">
                  Rents:
                  <select
                    value={opexRentBasis}
                    onChange={(ev) => { setE({ ...e, opex_rent_basis: ev.target.value as RentBasis }); markDirty(); }}
                    className="bg-slate-800 border border-slate-700 text-slate-300 text-xs h-6 rounded px-1.5 outline-none focus:border-blue-500"
                  >
                    <option value="current">Current</option>
                    <option value="market">Market</option>
                    <option value="current_plus_reno">Current + Reno</option>
                    <option value="market_plus_reno">Market + Reno</option>
                  </select>
                </span>
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
                <OpexLineField label="Turnover Cost" input={opexInputs.turnover || { value: 0, mode: "per_unit_annual" }} onChange={(v) => updateOpexLine("turnover", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} multiplier={turnoverDisplayMultiplier} />
                <OpexLineField label="Admin / Legal / Mktg" input={opexInputs.admin_legal_marketing || { value: 0, mode: "total_annual" }} onChange={(v) => updateOpexLine("admin_legal_marketing", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
                <OpexLineField label="Reserves" input={opexInputs.reserves || { value: 0, mode: "per_unit_annual" }} onChange={(v) => updateOpexLine("reserves", v)} units={totalUnits} egi={t12EGI} gpr={t12GPR} />
              </div>

              {/* Property tax reassessment — operations + exit (seller's bill is not your bill) */}
              {(() => {
                const tr = e.tax_reassessment;
                const trEnabled = !!tr?.enabled;
                const updateTr = (patch: Partial<TaxReassessment>) => {
                  const base: TaxReassessment = tr ?? { enabled: true, effective_tax_rate: 0.0185, phase_in_year: 1, apply_at_exit: true };
                  setE({ ...e, tax_reassessment: { ...base, ...patch } });
                  markDirty();
                };
                const estReassessed = (tr?.reassessed_value ?? p.purchase_price) * (tr?.effective_tax_rate ?? 0.0185);
                const enteredAnnual = opexToAnnual(opexInputs.property_tax || { value: e.property_tax_total || 0, mode: "total_annual" }, totalUnits, t12EGI, t12GPR);
                const underTaxed = !trEnabled && estReassessed > 0 && enteredAnnual < estReassessed * 0.7;
                return (
                  <div className="mt-2 border border-slate-800 rounded p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-slate-400">
                        <span className="font-medium text-slate-300">Tax Reassessment</span>
                        <span className="text-slate-500 ml-2">the seller&apos;s bill is not your bill — counties reassess toward the sale price</span>
                      </div>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={trEnabled}
                          onChange={(ev) => {
                            if (ev.target.checked) updateTr({ enabled: true });
                            else if (tr) { setE({ ...e, tax_reassessment: { ...tr, enabled: false } }); markDirty(); }
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-blue-500"
                        />
                        {trEnabled ? "On" : "Off"}
                      </label>
                    </div>
                    {underTaxed && (
                      <p className="text-[10px] text-amber-400">
                        Entered tax ({fmtCurrency(enteredAnnual)}/yr) is well below the reassessed estimate ({fmtCurrency(estReassessed)}/yr at purchase price). Enable reassessment or verify.
                      </p>
                    )}
                    {trEnabled && tr && (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <PctField label="Effective Tax Rate" value={tr.effective_tax_rate} onChange={(v) => updateTr({ effective_tax_rate: v })} />
                          <CurrencyField label="Reassessed Value" value={tr.reassessed_value ?? p.purchase_price} onChange={(v) => updateTr({ reassessed_value: v })} />
                          <NumField label="Phase-In Year" value={tr.phase_in_year ?? 1} onChange={(v) => updateTr({ phase_in_year: Math.max(1, Math.round(v)) })} />
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={tr.apply_at_exit ?? true}
                                onChange={(ev) => updateTr({ apply_at_exit: ev.target.checked })}
                                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-blue-500"
                              />
                              Apply at exit
                            </label>
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          Operations: from the phase-in year, property tax = reassessed value × rate ({fmtCurrency(estReassessed)}/yr), escalated. Exit: value = NOI excl. tax ÷ (cap + rate) — your buyer&apos;s taxes at their price.
                        </p>

                        {/* Property Tax v2 (fix-spec Phase 2): abatement record + scenario.
                            Enabling creates expenses.property_tax_v2 (calendar-anchored,
                            HB 920 shaped, three vectors) which takes precedence over the
                            v1 phase-in above. */}
                        {(() => {
                          const v2 = e.property_tax_v2;
                          const v2On = !!v2?.enabled;
                          const updateV2 = (patch: Partial<PropertyTaxAssumptions>) => {
                            const base: PropertyTaxAssumptions = v2 ?? {
                              enabled: true,
                              effective_tax_rate: tr?.effective_tax_rate ?? 0.0185,
                              reassessed_value: tr?.reassessed_value,
                              apply_at_exit: tr?.apply_at_exit ?? true,
                              closing_date: new Date().toISOString().slice(0, 10),
                            };
                            setE({ ...e, property_tax_v2: { ...base, ...patch } });
                            markDirty();
                          };
                          const ab = v2?.abatement;
                          const updateAb = (patch: Partial<NonNullable<PropertyTaxAssumptions["abatement"]>>) => {
                            updateV2({
                              abatement: {
                                abated_annual_tax: 0,
                                unabated_annual_tax: 0,
                                final_abated_tax_year: new Date().getFullYear() + 2,
                                transferable: "unconfirmed",
                                ...(ab ?? {}),
                                ...patch,
                              },
                            });
                          };
                          return (
                            <div className="border-t border-slate-800 pt-2 mt-2 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400 font-medium">
                                  Abatement / Tax Scenarios (v2)
                                  {v2On && ab && ab.transferable !== "confirmed" && (
                                    <span className="ml-2 text-[10px] text-amber-400">defaulting to abatement-lost (transfer not confirmed)</span>
                                  )}
                                </span>
                                <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={v2On}
                                    onChange={(ev) => {
                                      if (ev.target.checked) updateV2({ enabled: true });
                                      else if (v2) { setE({ ...e, property_tax_v2: { ...v2, enabled: false } }); markDirty(); }
                                    }}
                                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-blue-500"
                                  />
                                  {v2On ? "On" : "Off"}
                                </label>
                              </div>
                              {v2On && v2 && (
                                <>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div>
                                      <Label className="text-xs text-slate-400">Closing Date</Label>
                                      <Input type="date" value={v2.closing_date || ""} onChange={(ev) => updateV2({ closing_date: ev.target.value || undefined })} className="bg-slate-800 border-slate-700 text-white text-sm h-8" />
                                    </div>
                                    <div>
                                      <Label className="text-xs text-slate-400">Scenario In Force</Label>
                                      <select
                                        value={v2.scenario || "auto"}
                                        onChange={(ev) => updateV2({ scenario: ev.target.value === "auto" ? undefined : (ev.target.value as PropertyTaxAssumptions["scenario"]) })}
                                        className="bg-slate-800 border border-slate-700 text-white text-sm h-8 rounded px-2 w-full"
                                      >
                                        <option value="auto">Auto (default rule)</option>
                                        <option value="abated_transfers">Abated, transfers</option>
                                        <option value="abatement_lost">Abatement lost</option>
                                        <option value="reassessed_to_price">Reassessed to price</option>
                                      </select>
                                    </div>
                                    <CurrencyField label="Abated Tax /yr" value={ab?.abated_annual_tax ?? 0} onChange={(v) => updateAb({ abated_annual_tax: v })} />
                                    <CurrencyField label="Unabated Tax /yr" value={ab?.unabated_annual_tax ?? 0} onChange={(v) => updateAb({ unabated_annual_tax: v })} />
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <NumField label="Final Abated Tax Year" value={ab?.final_abated_tax_year ?? 0} onChange={(v) => updateAb({ final_abated_tax_year: Math.round(v) })} />
                                    <div>
                                      <Label className="text-xs text-slate-400">Transferable</Label>
                                      <select
                                        value={ab?.transferable ?? "unconfirmed"}
                                        onChange={(ev) => updateAb({ transferable: ev.target.value as "confirmed" | "unconfirmed" | "none" })}
                                        className="bg-slate-800 border border-slate-700 text-white text-sm h-8 rounded px-2 w-full"
                                      >
                                        <option value="confirmed">Confirmed</option>
                                        <option value="unconfirmed">Unconfirmed</option>
                                        <option value="none">None</option>
                                      </select>
                                    </div>
                                    <div>
                                      <Label className="text-xs text-slate-400">Program</Label>
                                      <Input value={ab?.program || ""} onChange={(ev) => updateAb({ program: ev.target.value })} placeholder="e.g. CRA 100%" className="bg-slate-800 border-slate-700 text-white text-sm h-8" />
                                    </div>
                                    <div>
                                      <Label className="text-xs text-slate-400">Parcel ID</Label>
                                      <Input value={v2.parcel?.parcel_id || ""} onChange={(ev) => updateV2({ parcel: { ...(v2.parcel ?? {}), parcel_id: ev.target.value } })} placeholder="010-123456" className="bg-slate-800 border-slate-700 text-white text-sm h-8" />
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-slate-500">
                                    Bills are calendar-anchored to the closing date (Ohio: tax year = calendar year, billed in arrears) and shaped per HB 920 — only ~12.5% of the bill floats with valuation; the voted remainder is dollar-flat plus levy drift. All three scenario vectors export to the workbook.
                                  </p>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })()}
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
                    onClick={() => { setC({ ...c, pca_complete: !c.pca_complete }); markDirty(); }}
                    className={`px-2 py-1.5 rounded text-xs border ${c.pca_complete ? "bg-green-900/40 border-green-600 text-green-200" : "bg-slate-800 border-slate-700 text-slate-400"}`}
                  >
                    PCA on file: {c.pca_complete ? "YES" : "NO"}
                  </button>
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

        {/* Tax Treatment (TAX_TREATMENT_SPEC.md) — after-tax modeling, owner-specific */}
        <Section title="Tax Treatment">
          {(() => {
            const holdYears = ex.hold_period_years || 10;
            const enabled = !!tx;
            const updateTx = (patch: Partial<TaxAssumptions>) => {
              if (!tx) return;
              setTx({ ...tx, ...patch });
              markDirty();
            };
            const toggleEnabled = (on: boolean) => {
              setTx(on ? { ...TAX_DEFAULTS, reps_status: Array(holdYears).fill(true) } : undefined);
              markDirty();
            };
            const repsYears: boolean[] = Array.from({ length: holdYears }, (_, i) =>
              tx?.reps_status?.[i] ?? tx?.reps_status?.[(tx?.reps_status?.length ?? 1) - 1] ?? true
            );
            const toggleRepsYear = (i: number) => {
              if (!tx) return;
              const next = [...repsYears];
              next[i] = !next[i];
              updateTx({ reps_status: next });
            };
            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] text-slate-500 italic">
                    Estimate — not tax advice. Owner-specific conventions (MFJ NYC, OpCo/PropCo, REPS, 1031 exit) per TAX_TREATMENT_SPEC.md. Confirm with CPA.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e2) => toggleEnabled(e2.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    {enabled ? "Enabled" : "Disabled"}
                  </label>
                </div>

                {enabled && tx && (
                  <>
                    {/* REPS attestation gate (spec section 1) — per-year, heavily audited */}
                    <div className="bg-amber-950/20 border border-amber-800/40 rounded p-3 space-y-2">
                      <div className="text-xs text-amber-300 font-medium">
                        REPS attestation — answer per year: is real estate &gt;50% of the principal&apos;s working time
                        this year, AND &ge;750 hours, with material participation in the rentals?
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {repsYears.map((on, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => toggleRepsYear(i)}
                            title={`Year ${i + 1}: REPS ${on ? "ON — loss offsets W-2" : "OFF — loss suspended (PAL); a 1031 will NOT release it"}`}
                            className={`text-[11px] px-2 py-0.5 rounded border font-medium tabular-nums ${
                              on
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-700/40"
                                : "bg-slate-800 text-slate-500 border-slate-700"
                            }`}
                          >
                            Y{i + 1}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-amber-400/70">
                        OFF years suspend the loss as a PAL — and a 1031 exit does NOT release suspended PALs.
                      </p>
                    </div>

                    {/* Rates & loss limits */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <PctField label="Federal Rate" value={tx.federal_ordinary_rate} onChange={(v) => updateTx({ federal_ordinary_rate: v })} />
                      <PctField label="NY + NYC Rate" value={tx.state_local_ordinary_rate} onChange={(v) => updateTx({ state_local_ordinary_rate: v })} />
                      <PctField label="NIIT" value={tx.niit_rate} onChange={(v) => updateTx({ niit_rate: v })} />
                      <CurrencyField label="461(l) Cap (MFJ)" value={tx.ebl_cap_mfj} onChange={(v) => updateTx({ ebl_cap_mfj: v })} />
                    </div>

                    {/* Entity view */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <Label className="text-xs text-slate-400">Headline View</Label>
                        <select
                          value={tx.opco_view}
                          onChange={(e2) => updateTx({ opco_view: e2.target.value as "propco" | "household" })}
                          className="bg-slate-800 border border-slate-700 text-white text-sm h-8 rounded px-2 w-full"
                        >
                          <option value="household">Household (OpCo fee recycled)</option>
                          <option value="propco">PropCo standalone</option>
                        </select>
                      </div>
                      <PctField label="OpCo Fee Leakage" value={tx.opco_fee_tax_rate} onChange={(v) => updateTx({ opco_fee_tax_rate: v })} />
                      <PctField label="Federal Bonus" value={tx.federal_bonus_pct} onChange={(v) => updateTx({ federal_bonus_pct: v })} />
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tx.state_conforms_bonus}
                            onChange={(e2) => updateTx({ state_conforms_bonus: e2.target.checked })}
                            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-blue-500"
                          />
                          NY conforms to bonus
                        </label>
                      </div>
                    </div>

                    {/* Basis & cost-seg */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <PctField label="Land Allocation" value={tx.land_allocation_pct} onChange={(v) => updateTx({ land_allocation_pct: v })} />
                      <PctField label="5-yr Cost-Seg" value={tx.costseg_5yr_pct} onChange={(v) => updateTx({ costseg_5yr_pct: v })} />
                      <PctField label="15-yr Land Impr." value={tx.costseg_15yr_pct} onChange={(v) => updateTx({ costseg_15yr_pct: v })} />
                      <PctField label="Reno 5-yr Share" value={tx.reno_5yr_pct} onChange={(v) => updateTx({ reno_5yr_pct: v })} />
                      <PctField label="Repairs Expensed" value={tx.reno_repairs_expensed_pct} onChange={(v) => updateTx({ reno_repairs_expensed_pct: v })} />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Land is carved out first; cost-seg percentages apply to the improvement basis. Federal takes bonus on the 5-yr and 15-yr buckets; NY adds bonus back.
                    </p>

                    {/* Exit */}
                    <div className="flex flex-wrap items-center gap-5">
                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tx.exit_via_1031}
                          onChange={(e2) => updateTx({ exit_via_1031: e2.target.checked })}
                          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-blue-500"
                        />
                        Exit via 1031 exchange
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tx.personal_property_worthless_at_exit}
                          onChange={(e2) => updateTx({ personal_property_worthless_at_exit: e2.target.checked })}
                          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-blue-500"
                        />
                        1245 personal property worthless at exit
                      </label>
                      <span className="text-[10px] text-slate-500 italic">
                        Taxes are deferred, not eliminated — deferred gain carries into the replacement property.
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </Section>
      </CardContent>
    </Card>
  );
}
