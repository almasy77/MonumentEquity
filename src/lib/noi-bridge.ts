/**
 * Change C (Manny Lou, Nov 2026): "pay for what is documented today; what our plan
 * adds is our profit."
 *
 * Builds the documented → plan → Year-1 → stabilized NOI bridge for a scenario and
 * two prices at the target IRR: one on documented NOI only (the property as it is
 * today, with no plan income and no plan spend), and one with the plan.
 *
 * Method: plan and untagged items are reverted to their documented value one at a
 * time, in a fixed order, and each item's line is the drop in Year-1 NOI from that
 * step. The items therefore sum exactly to (Year-1 NOI − documented-model NOI). Any
 * gap between the documented-model NOI and the seller's documented NOI (our 8%
 * management, vacancy, insurance and similar restatements) is shown on its own line,
 * never folded into a plan item.
 *
 * Only items that RAISE NOI above documented are bridge items (rents above in-place,
 * a tax below the bill, an expense line below its T12 baseline, other income). A
 * modeled cost above documented (a reassessment, 8% management) is a restatement,
 * not a plan item.
 *
 * Pure and engine-only: the engine never reads the tags.
 */
import {
  calculateUnderwriting,
  resolveDocumentedNOI,
  type DocumentedNoiSource,
  type ExpenseResetLine,
  type NoiBasisTag,
  type OtherIncomeLineItem,
  type ScenarioInputs,
} from "./underwriting";
import { solvePriceForIRR } from "./price-solve";

export type BridgeTag = NoiBasisTag | "untagged";

export type BridgeItemKind = "property_tax" | "expense_reset" | "other_income" | "renovation_premium" | "rent_markup";

export interface BridgeItem {
  key: string; // stable id, e.g. "other_income:2", "expense:repairs_maintenance"
  kind: BridgeItemKind;
  label: string;
  tag: BridgeTag;
  tag_source: "explicit" | "traced" | "default"; // stored tag, inferred from T12/rent-roll, or none
  noi_delta: number; // Year-1 NOI this item adds (only for plan/untagged; 0 for documented)
  detail: string; // what the item is, e.g. "$20,731 modeled vs $39,170 documented bill"
}

export interface NoiBridge {
  documented_noi: number | null;
  documented_noi_source: DocumentedNoiSource | null;
  documented_model_noi: number; // Year-1 NOI with every plan + untagged item reverted
  restatement: number | null; // documented_model_noi − documented_noi (null when no documented NOI)
  items: BridgeItem[]; // plan + untagged, in bridge order, each with its NOI delta
  documented_items: BridgeItem[]; // tagged/traced documented: inside documented NOI, no delta
  year1_noi: number;
  stabilized_noi: number;
  stabilized_year: number;
  has_t12_baseline: boolean;
  target_irr: number;
  price_documented: number | null; // price at target IRR, documented inputs
  price_with_plan: number | null; // price at target IRR, full plan
  notes: string[];
}

export const BRIDGE_TAG_COLORS: Record<BridgeTag, string> = {
  documented: "#2F7D4F",
  plan: "#1F5FA8",
  untagged: "#7B3FA0", // spec: purple = unresolved
};

// Management is excluded: it is a % of income, so a lease-up year shows fewer
// management dollars with no plan behind it. A rate change is a restatement.
const EXPENSE_LINES: { line: ExpenseResetLine; label: string; t12: string; breakdown: string }[] = [
  { line: "payroll", label: "Payroll", t12: "payroll", breakdown: "payroll" },
  { line: "repairs_maintenance", label: "Repairs & maintenance", t12: "repairs_maintenance", breakdown: "repairs_maintenance" },
  { line: "insurance", label: "Insurance", t12: "insurance", breakdown: "insurance" },
  { line: "utilities", label: "Utilities", t12: "utilities", breakdown: "utilities" },
  { line: "admin_legal_marketing", label: "Admin / legal / marketing", t12: "admin_marketing", breakdown: "admin_legal_marketing" },
  { line: "contract_services", label: "Contract services", t12: "contract_services", breakdown: "contract_services" },
];

/**
 * A line traces to documented history if its label or source note cites the T12,
 * the rent roll, or an in-place lease. "Unverified" always wins (not documented).
 */
export function tracesToDocuments(text: string | undefined): boolean {
  if (!text || /unverified/i.test(text)) return false;
  return /\bT-?12\b|trailing|rent roll|in[- ]place/i.test(text);
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const y1 = (inputs: ScenarioInputs) => calculateUnderwriting(inputs).annual[0]?.noi ?? 0;

// A capex project that funds the tax carry until an appeal lands is the cost side of
// the tax plan item, so it is removed with it.
function isTaxCarryProject(p: { name?: string; category?: string }): boolean {
  return p.category === "tax" || /\btax\b/i.test(p.name ?? "");
}

interface Candidate {
  item: Omit<BridgeItem, "noi_delta">;
  revert: (i: ScenarioInputs) => void; // mutate a clone back to documented (revenue AND cost)
}

function candidates(inputs: ScenarioInputs, deal: { current_annual_taxes?: number | null } | null | undefined, full: ReturnType<typeof calculateUnderwriting>): Candidate[] {
  const out: Candidate[] = [];
  const ex = inputs.expenses;
  const rev = inputs.revenue;
  const b0 = full.annual[0]?.opex_breakdown as unknown as Record<string, number> | undefined;
  const t12 = ex.t12_baseline as Record<string, number | undefined> | undefined;

  // 1. Property tax below the documented bill (e.g. post-sale appeal).
  const docTax = (deal?.current_annual_taxes && deal.current_annual_taxes > 0 ? deal.current_annual_taxes : undefined) ?? t12?.property_taxes;
  const modelTax = b0?.property_tax ?? 0;
  if (docTax && docTax > 0 && modelTax < docTax * 0.99 - 1) {
    const tag = ex.property_tax_basis;
    out.push({
      item: {
        key: "property_tax", kind: "property_tax", label: "Property tax below current bill",
        tag: tag ?? "untagged", tag_source: tag ? "explicit" : "default",
        detail: `${usd(modelTax)} modeled vs ${usd(docTax)} documented bill`,
      },
      revert: (i) => {
        i.expenses.property_tax_total = docTax;
        i.expenses.opex_inputs = { ...(i.expenses.opex_inputs ?? {}), property_tax: { value: docTax, mode: "total_annual" } };
        if (i.expenses.property_tax_v2) i.expenses.property_tax_v2 = { ...i.expenses.property_tax_v2, enabled: false };
        if (i.expenses.tax_reassessment) i.expenses.tax_reassessment = { ...i.expenses.tax_reassessment, enabled: false };
        i.capex.projects = (i.capex.projects ?? []).filter((p) => !isTaxCarryProject(p as { name?: string; category?: string }));
      },
    });
  }

  // 2. Expense lines below the T12 baseline (needs an imported T12).
  if (t12 && b0) {
    for (const e of EXPENSE_LINES) {
      const base = t12[e.t12];
      const model = b0[e.breakdown] ?? 0;
      if (!base || base <= 0 || model >= base - Math.max(500, base * 0.02)) continue;
      const tag = ex.expense_reset_basis?.[e.line];
      out.push({
        item: {
          key: `expense:${e.line}`, kind: "expense_reset", label: `${e.label} below T12`,
          tag: tag ?? "untagged", tag_source: tag ? "explicit" : "default",
          detail: `${usd(model)} modeled vs ${usd(base)} T12`,
        },
        revert: (i) => {
          const oi = { ...(i.expenses.opex_inputs ?? {}) } as Record<string, unknown>;
          oi[e.line] = { value: base, mode: "total_annual" };
          if (e.line === "utilities") delete oi.utilities_sublines;
          if (e.line === "contract_services") delete oi.services_sublines;
          i.expenses.opex_inputs = oi as ScenarioInputs["expenses"]["opex_inputs"];
        },
      });
    }
  }

  // 3. Itemized other income, one line each.
  const lines = rev.other_income?.line_items ?? [];
  lines.forEach((li: OtherIncomeLineItem, idx: number) => {
    const traced = tracesToDocuments(li.source_note) || tracesToDocuments(li.label);
    const tag: BridgeTag = li.basis ?? (traced ? "documented" : "untagged");
    const amount = li.kind === "flat" ? `${usd((li.monthly_amount ?? 0) * 12)}/yr` : `RUBS ${Math.round((li.rubs_recovery_pct ?? 0) * 100)}% recovery`;
    out.push({
      item: {
        key: `other_income:${idx}`, kind: "other_income", label: li.label || `Other income ${idx + 1}`,
        tag, tag_source: li.basis ? "explicit" : traced ? "traced" : "default",
        detail: `${amount}${li.recurring === false ? ", one-time" : ""}${li.source_note ? ` (${li.source_note})` : ""}`,
      },
      revert: (i) => {
        const items = i.revenue.other_income?.line_items;
        if (!items) return;
        // Zero the line rather than splice it, so later indices stay stable.
        const t = items[idx];
        if (t.kind === "flat") t.monthly_amount = 0;
        else t.rubs_recovery_pct = 0;
      },
    });
  });

  // 4. Renovation rent premium (and its capex, per Bryan: documented = no plan spend).
  const hasPremium = rev.unit_mix.some((u) => (u.renovated_rent_premium ?? 0) > 0 || (u.units ?? []).some((d) => (d.renovated_rent ?? 0) > 0));
  const renoOn = inputs.capex.per_unit_enabled !== false
    && ((inputs.capex.renovation_lines?.some((l) => (l.units_to_renovate ?? 0) > 0) ?? false) || (inputs.capex.units_to_renovate ?? 0) > 0
      || rev.unit_mix.some((u) => (u.units ?? []).some((d) => d.renovate)));
  if (hasPremium && renoOn) {
    const tag = rev.renovation_premium_basis;
    out.push({
      item: {
        key: "renovation_premium", kind: "renovation_premium", label: "Renovation rent premium",
        tag: tag ?? "untagged", tag_source: tag ? "explicit" : "default",
        detail: "Renovated-unit premium; its renovation capex comes out with it",
      },
      revert: (i) => { i.capex.per_unit_enabled = false; },
    });
  }

  // 5. Rents marked above in-place (market > current), incl. lease-up to market.
  const marked = rev.unit_mix.some((u) => u.market_rent > u.current_rent + 0.5 || (u.units ?? []).some((d) => (d.market_rent ?? u.market_rent) > d.current_rent + 0.5 && d.current_rent > 0));
  if (marked) {
    const tag = rev.rent_markup_basis;
    out.push({
      item: {
        key: "rent_markup", kind: "rent_markup", label: "Rents marked above in-place",
        tag: tag ?? "untagged", tag_source: tag ? "explicit" : "default",
        detail: "Market rent above current rent on turned / leased-up units",
      },
      revert: (i) => {
        for (const u of i.revenue.unit_mix) {
          u.market_rent = Math.min(u.market_rent, u.current_rent);
          for (const d of u.units ?? []) {
            if (d.current_rent > 0 && d.market_rent != null) d.market_rent = Math.min(d.market_rent, d.current_rent);
            else if (d.current_rent > 0) d.market_rent = Math.min(u.market_rent, d.current_rent);
          }
        }
      },
    });
  }
  return out;
}

export function buildNoiBridge(
  inputs: ScenarioInputs,
  ctx: {
    deal?: { current_annual_taxes?: number | null } | null;
    target_irr?: number;
    solvePrices?: boolean; // default true; false skips the two bisection solves (≈100 engine runs)
  } = {},
): NoiBridge {
  const full = calculateUnderwriting(inputs);
  const cands = candidates(inputs, ctx.deal, full);
  const notes: string[] = [];

  // Sequentially revert every plan + untagged item (documented-tagged stay in).
  const reverted = clone(inputs);
  let prev = full.annual[0]?.noi ?? 0;
  const items: BridgeItem[] = [];
  const documented_items: BridgeItem[] = [];
  for (const c of cands) {
    if (c.item.tag === "documented") {
      documented_items.push({ ...c.item, noi_delta: 0 });
      continue;
    }
    const trial = clone(reverted);
    c.revert(trial);
    const next = y1(trial);
    // An untagged item with no NOI effect (e.g. market rents above in-place on a
    // scenario that never marks to market) is noise, not an open question: skip it.
    if (Math.abs(prev - next) < 1 && c.item.tag_source === "default") continue;
    c.revert(reverted);
    items.push({ ...c.item, noi_delta: prev - next });
    prev = next;
  }
  const documentedModelNOI = prev;

  const doc = resolveDocumentedNOI(inputs.sizing_context);
  if (!doc) notes.push("No documented NOI on the deal or in Pricing Views: the bridge starts from the model with plan items removed.");
  if (!inputs.expenses.t12_baseline) notes.push("No T12 baseline on this scenario, so expense cuts can't be itemized; they sit in the restatement line.");
  if (items.some((i) => i.tag === "untagged")) notes.push("Untagged items (purple) are treated as NOT documented in the documented price. Tag each one.");

  const last = full.annual[full.annual.length - 1];
  const target = ctx.target_irr && ctx.target_irr > 0 ? ctx.target_irr : 0.15;
  const solve = ctx.solvePrices !== false;
  return {
    documented_noi: doc?.noi ?? null,
    documented_noi_source: doc?.source ?? null,
    documented_model_noi: documentedModelNOI,
    restatement: doc ? documentedModelNOI - doc.noi : null,
    items,
    documented_items,
    year1_noi: full.annual[0]?.noi ?? 0,
    stabilized_noi: last?.noi ?? 0,
    stabilized_year: last?.year ?? 0,
    has_t12_baseline: !!inputs.expenses.t12_baseline,
    target_irr: target,
    price_documented: solve ? solvePriceForIRR(reverted, target) : null,
    price_with_plan: solve ? solvePriceForIRR(inputs, target) : null,
    notes,
  };
}

/** Where a tag is stored on the scenario, so the UI can patch exactly one field. */
export function applyBridgeTag(
  scenario: { revenue_assumptions?: unknown; expense_assumptions?: unknown },
  key: string,
  tag: BridgeTag,
): { revenue_assumptions?: Record<string, unknown>; expense_assumptions?: Record<string, unknown> } {
  const v = tag === "untagged" ? undefined : tag;
  const rev = clone((scenario.revenue_assumptions ?? {}) as Record<string, unknown>);
  const ex = clone((scenario.expense_assumptions ?? {}) as Record<string, unknown>);
  const set = (o: Record<string, unknown>, k: string) => { if (v) o[k] = v; else delete o[k]; };
  if (key === "property_tax") { set(ex, "property_tax_basis"); return { expense_assumptions: ex }; }
  if (key === "renovation_premium") { set(rev, "renovation_premium_basis"); return { revenue_assumptions: rev }; }
  if (key === "rent_markup") { set(rev, "rent_markup_basis"); return { revenue_assumptions: rev }; }
  if (key.startsWith("expense:")) {
    const m = { ...((ex.expense_reset_basis ?? {}) as Record<string, unknown>) };
    set(m, key.slice("expense:".length));
    ex.expense_reset_basis = m;
    return { expense_assumptions: ex };
  }
  if (key.startsWith("other_income:")) {
    const idx = Number(key.slice("other_income:".length));
    const items = ((rev.other_income as { line_items?: Record<string, unknown>[] } | undefined)?.line_items) ?? [];
    if (items[idx]) set(items[idx], "basis");
    return { revenue_assumptions: rev };
  }
  return {};
}
