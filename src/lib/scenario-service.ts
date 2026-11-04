/**
 * Scenario create / update logic shared by the web API routes and the MCP connector.
 *
 * These were extracted verbatim from `POST /api/scenarios` (non-clone path) and
 * `PUT /api/scenarios/[id]` so that a scenario written by Claude through the
 * connector is built, calculated, versioned and logged exactly like one saved from
 * the UI. Auth, role checks and ownership checks stay with the callers.
 */
import { getRedis, addToIndex } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import {
  calculateUnderwriting,
  buildDefaultInputs,
  type ScenarioInputs,
} from "@/lib/underwriting";
import { stampMetrics } from "@/lib/engine-version";
import type { Scenario, Deal } from "@/lib/validations";

export type ChangeSource = "web" | "connector";

// Scenario-type growth-rate presets. Applied both when creating a scenario from
// defaults and when a clone is RETYPED to one of these types (e.g. Renovation
// seeded from Base) so the two paths produce the same starting assumptions.
export const SCENARIO_TYPE_PRESETS: Record<
  string,
  { rent_growth_rate?: number; tax_escalation_rate?: number; vacancy_rate?: number; exit_cap_rate?: number }
> = {
  upside: { rent_growth_rate: 0.05, tax_escalation_rate: 0.015, vacancy_rate: 0.05, exit_cap_rate: 0.06 },
  downside: { rent_growth_rate: 0.01, tax_escalation_rate: 0.03, vacancy_rate: 0.10, exit_cap_rate: 0.08 },
  value_add: { rent_growth_rate: 0.04, tax_escalation_rate: 0.02, vacancy_rate: 0.08 },
  renovation: { rent_growth_rate: 0.04, tax_escalation_rate: 0.02, vacancy_rate: 0.08 },
  // marketing / current are filled from documents — no growth-rate preset.
};

type UnderwritingResult = ReturnType<typeof calculateUnderwriting>;

/** The `underwriting` block returned by the scenario endpoints. */
export function underwritingPayload(result: UnderwritingResult) {
  return {
    monthly: result.monthly,
    annual: result.annual,
    metrics: result.metrics,
    sensitivity: result.sensitivity,
    warnings: result.warnings,
    tax: result.tax, // after-tax layer (present only when tax_assumptions set)
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

/**
 * Create a scenario for `deal` from defaults + the caller's overrides
 * (explicit overrides > type presets > user defaults > deal data).
 */
export async function createScenarioFromDefaults(
  deal: Deal,
  body: Body,
  userId: string,
  via: ChangeSource = "web"
): Promise<{ scenario: Scenario; result: UnderwritingResult }> {
  const redis = getRedis();

  // Fetch user's default assumptions
  const user = await redis.get<{ default_assumptions?: Record<string, number> }>(
    `user:${userId}`
  );
  const defaults = user?.default_assumptions ?? {};

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  // Build default inputs from deal data + user defaults
  const defaultInputs = buildDefaultInputs(
    {
      asking_price: deal.asking_price,
      units: deal.units,
      loi_amount: deal.loi_amount,
      bid_price: deal.bid_price,
      earnest_money: deal.earnest_money,
      ltv: deal.ltv,
      interest_rate: deal.interest_rate,
      loan_term_years: deal.loan_term_years,
      amortization_years: deal.amortization_years,
      io_period_months: deal.io_period_months,
      origination_fee_rate: deal.origination_fee_rate,
      transaction_costs: deal.transaction_costs,
      rent_roll: deal.rent_roll,
      current_occupancy: deal.current_occupancy,
      current_noi: deal.current_noi,
      current_annual_taxes: deal.current_annual_taxes,
      current_annual_insurance: deal.current_annual_insurance,
      t12: deal.t12,
      buy_box_scores: deal.buy_box_scores,
    },
    defaults
  );

  // Apply scenario-type-specific growth rate presets
  const scenarioType = body.type || "base";
  const preset = SCENARIO_TYPE_PRESETS[scenarioType] || {};

  // Merge any provided overrides (explicit overrides > type presets > defaults)
  const inputs: ScenarioInputs = {
    purchase: { ...defaultInputs.purchase, ...body.purchase_assumptions },
    financing: { ...defaultInputs.financing, ...body.financing_assumptions },
    revenue: {
      ...defaultInputs.revenue,
      ...(preset.rent_growth_rate !== undefined ? { rent_growth_rate: preset.rent_growth_rate } : {}),
      ...(preset.vacancy_rate !== undefined ? { vacancy_rate: preset.vacancy_rate } : {}),
      ...body.revenue_assumptions,
    },
    expenses: {
      ...defaultInputs.expenses,
      ...(preset.tax_escalation_rate !== undefined ? { tax_escalation_rate: preset.tax_escalation_rate } : {}),
      ...body.expense_assumptions,
    },
    capex: {
      ...defaultInputs.capex,
      ...body.capex_assumptions,
      projects: body.capex_assumptions?.projects ?? defaultInputs.capex.projects,
    },
    exit: {
      ...defaultInputs.exit,
      ...(preset.exit_cap_rate !== undefined ? { exit_cap_rate: preset.exit_cap_rate } : {}),
      ...body.exit_assumptions,
    },
    depreciation: body.depreciation_assumptions || undefined,
  };

  // Run calculations
  const result = calculateUnderwriting(inputs);

  const scenario: Scenario = {
    id,
    deal_id: deal.id,
    name: body.name || "Base Case",
    type: body.type || "base",
    version: 1,
    is_active: true,
    purchase_assumptions: inputs.purchase as unknown as Record<string, unknown>,
    financing_assumptions: inputs.financing as unknown as Record<string, unknown>,
    revenue_assumptions: inputs.revenue as unknown as Record<string, unknown>,
    expense_assumptions: inputs.expenses as unknown as Record<string, unknown>,
    capex_assumptions: {
      ...inputs.capex,
      projects: inputs.capex.projects,
    },
    exit_assumptions: inputs.exit as unknown as Record<string, unknown>,
    depreciation_assumptions: (inputs.depreciation || {}) as unknown as Record<string, unknown>,
    monthly_pro_forma: [], // storage: recomputed on read, never persisted
    calculated_metrics: {
      irr: result.metrics.irr ?? undefined,
      cash_on_cash: result.metrics.average_cash_on_cash,
      dscr: result.metrics.year1_dscr,
      equity_multiple: result.metrics.equity_multiple,
      going_in_cap: result.metrics.going_in_cap,
      stabilized_cap: result.metrics.stabilized_cap,
    },
    created_at: now,
    updated_at: now,
    updated_by: userId,
    updated_via: via,
  };
  stampMetrics(scenario, result); // P3-7: engine_version + metrics_calculated_at

  await redis.set(`scenario:${id}`, JSON.stringify(scenario));
  await addToIndex(`scenarios:by_deal:${deal.id}`, id, Date.now());

  await logActivity({
    deal_id: deal.id,
    action: "scenario_created",
    entity_type: "scenario",
    entity_id: id,
    details: { name: scenario.name, type: scenario.type },
    user_id: userId,
    actor: via,
  });

  return { scenario, result };
}

/**
 * Apply an update to `existing` (merge, recalculate, snapshot the prior version,
 * persist, sync the deal-level bid, log). Returns the saved scenario + fresh result.
 */
export async function applyScenarioUpdate(
  existing: Scenario,
  body: Body,
  userId: string,
  via: ChangeSource = "web"
): Promise<{ scenario: Scenario; result: UnderwritingResult }> {
  const redis = getRedis();
  const id = existing.id;
  const now = new Date().toISOString();

  // Merge updates
  const updated: Scenario = {
    ...existing,
    name: body.name ?? existing.name,
    type: body.type ?? existing.type,
    is_active: body.is_active ?? existing.is_active,
    notes: body.notes !== undefined ? body.notes : (existing as Record<string, unknown>).notes,
    purchase_assumptions: body.purchase_assumptions ?? existing.purchase_assumptions,
    financing_assumptions: body.financing_assumptions ?? existing.financing_assumptions,
    revenue_assumptions: body.revenue_assumptions ?? existing.revenue_assumptions,
    expense_assumptions: body.expense_assumptions ?? existing.expense_assumptions,
    capex_assumptions: body.capex_assumptions ?? existing.capex_assumptions,
    exit_assumptions: body.exit_assumptions ?? existing.exit_assumptions,
    depreciation_assumptions: body.depreciation_assumptions ?? (existing as Record<string, unknown>).depreciation_assumptions ?? {},
    // tax_assumptions: explicit !== undefined check (not ??) because the form
    // sends null to DISABLE the tax layer — ?? would resurrect the old value.
    tax_assumptions: body.tax_assumptions !== undefined
      ? body.tax_assumptions
      : (existing as Record<string, unknown>).tax_assumptions,
    pricing_views: body.pricing_views ?? (existing as Record<string, unknown>).pricing_views,
    version: existing.version + 1,
    updated_at: now,
    updated_by: userId,
    updated_via: via,
  };

  // P3-9: stamp notes vs inputs change times so the UI can flag notes that predate
  // an input change. The form sends everything on each save, so compare the merged
  // values to the stored ones to tell a notes edit from an input edit.
  const sc = updated as unknown as Record<string, unknown>;
  const exSc = existing as unknown as Record<string, unknown>;
  if (sc.notes !== exSc.notes) sc.notes_updated_at = now;
  const INPUT_KEYS = [
    "purchase_assumptions",
    "financing_assumptions",
    "revenue_assumptions",
    "expense_assumptions",
    "capex_assumptions",
    "exit_assumptions",
    "tax_assumptions",
    "depreciation_assumptions",
  ];
  if (INPUT_KEYS.some((k) => JSON.stringify(sc[k]) !== JSON.stringify(exSc[k]))) {
    sc.inputs_updated_at = now;
  }

  // Recalculate
  const inputs = {
    purchase: updated.purchase_assumptions,
    financing: updated.financing_assumptions,
    revenue: updated.revenue_assumptions,
    expenses: updated.expense_assumptions,
    capex: updated.capex_assumptions,
    exit: updated.exit_assumptions,
    tax: updated.tax_assumptions,
    // Include depreciation so the PUT response carries metrics.depreciation +
    // the land-allocation reconciliation warning (matches GET / clone / export).
    depreciation: updated.depreciation_assumptions || undefined,
  } as unknown as ScenarioInputs;

  const result = calculateUnderwriting(inputs);

  updated.monthly_pro_forma = []; // storage: recomputed on read
  stampMetrics(updated, result); // P3-7: calculated_metrics + engine_version + metrics_calculated_at

  // Save version snapshot
  await redis.set(
    `scenario_version:${id}:${existing.version}`,
    JSON.stringify(existing)
  );

  await redis.set(`scenario:${id}`, JSON.stringify(updated));

  // Persist-back (FIX: bid-price desync): keep the deal-level bid in sync
  // with the ACTIVE scenario's bid, so the deal headline and any deal-level
  // export default never go stale when the bid is edited in the underwriting
  // tab. Only the active scenario drives the deal-level bid. Non-fatal.
  try {
    const bid = (updated.purchase_assumptions as Record<string, unknown>)?.bid_price as number | undefined;
    if (updated.is_active !== false && typeof bid === "number" && bid > 0) {
      const deal = await redis.get<Deal>(`deal:${existing.deal_id}`);
      if (deal && deal.bid_price !== bid) {
        await redis.set(`deal:${existing.deal_id}`, JSON.stringify({ ...deal, bid_price: bid, updated_at: now }));
      }
    }
  } catch (e) {
    console.error("bid persist-back failed (non-fatal):", e);
  }

  await logActivity({
    deal_id: existing.deal_id,
    action: "scenario_updated",
    entity_type: "scenario",
    entity_id: id,
    details: { name: updated.name, version: updated.version },
    user_id: userId,
    actor: via,
  });

  return { scenario: updated, result };
}
