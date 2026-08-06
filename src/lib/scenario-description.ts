// Auto-generated one-line scenario description: summarizes the key assumptions and,
// for non-base scenarios, how they DIFFER from the Base Case. Pure + deterministic
// (no AI) so it's instant and always in sync with the current inputs.
import type { Scenario } from "./validations";
import { SCENARIO_TYPE_LABELS } from "./constants";

type Rec = Record<string, unknown> | undefined;

function num(r: Rec, k: string): number | undefined {
  const v = r?.[k];
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

const pct = (v: number) => `${Number((v * 100).toFixed(2))}%`;
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
const moneyK = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`);

interface FieldDesc {
  label: string;
  section: string;
  key: string;
  fmt: (v: number) => string;
  minDelta: number; // ignore diffs smaller than this
}

// The "key inputs" compared against the base case, in priority order.
const FIELDS: FieldDesc[] = [
  { label: "price", section: "purchase_assumptions", key: "purchase_price", fmt: money, minDelta: 1 },
  { label: "rent growth", section: "revenue_assumptions", key: "rent_growth_rate", fmt: pct, minDelta: 0.0001 },
  { label: "vacancy", section: "revenue_assumptions", key: "vacancy_rate", fmt: pct, minDelta: 0.0001 },
  { label: "concessions", section: "revenue_assumptions", key: "concessions_rate", fmt: pct, minDelta: 0.0001 },
  { label: "exit cap", section: "exit_assumptions", key: "exit_cap_rate", fmt: pct, minDelta: 0.0001 },
  { label: "hold", section: "exit_assumptions", key: "hold_period_years", fmt: (v) => `${v}yr`, minDelta: 0.5 },
  { label: "LTV", section: "financing_assumptions", key: "ltv", fmt: pct, minDelta: 0.001 },
  { label: "rate", section: "financing_assumptions", key: "interest_rate", fmt: pct, minDelta: 0.0001 },
  { label: "exp. growth", section: "expense_assumptions", key: "expense_escalation_rate", fmt: pct, minDelta: 0.0001 },
];

// Short note on the renovation scope, if a program is on.
function renoNote(capex: Rec): string | null {
  if (!capex || capex["renovation_enabled"] === false) return null;
  const cost = num(capex, "per_unit_cost");
  const units = num(capex, "units_to_renovate");
  if (!cost || !units) return null;
  return `reno ${moneyK(cost)}/unit × ${units}`;
}

/**
 * One-line description. For the Base Case (or when there's no base to compare to)
 * it's a self-summary; otherwise it's the notable diffs vs the base.
 */
export function describeScenario(scenario: Scenario, base?: Scenario): string {
  const s = scenario as unknown as Record<string, Rec>;
  const isBase = scenario.type === "base" || (base != null && base.id === scenario.id);

  if (isBase || !base) {
    const parts: string[] = [];
    const rg = num(s.revenue_assumptions, "rent_growth_rate");
    if (rg != null) parts.push(`${pct(rg)} rent growth`);
    const vac = num(s.revenue_assumptions, "vacancy_rate");
    if (vac != null) parts.push(`${pct(vac)} vacancy`);
    const cap = num(s.exit_assumptions, "exit_cap_rate");
    if (cap != null) parts.push(`${pct(cap)} exit cap`);
    const hold = num(s.exit_assumptions, "hold_period_years");
    if (hold != null) parts.push(`${hold}-yr hold`);
    const reno = renoNote(s.capex_assumptions);
    if (reno) parts.push(reno);
    const prefix = isBase ? "Base case — " : "";
    return parts.length ? prefix + parts.join(" · ") : prefix || "No assumptions set yet";
  }

  const b = base as unknown as Record<string, Rec>;
  const diffs: string[] = [];
  for (const f of FIELDS) {
    const tv = num(s[f.section], f.key);
    if (tv == null) continue;
    const bv = num(b[f.section], f.key);
    if (bv == null || Math.abs(tv - bv) >= f.minDelta) {
      diffs.push(bv == null ? `${f.label} ${f.fmt(tv)}` : `${f.label} ${f.fmt(tv)} (vs ${f.fmt(bv)})`);
    }
  }
  const renoThis = renoNote(s.capex_assumptions);
  if (renoThis && renoThis !== renoNote(b.capex_assumptions)) diffs.push(renoThis);

  const baseLabel = SCENARIO_TYPE_LABELS[base.type] ?? base.name ?? "Base";
  return diffs.length ? `vs ${baseLabel}: ${diffs.join(", ")}` : `Same key inputs as ${baseLabel}`;
}
