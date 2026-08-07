/**
 * Marketing scenario builder — turns a broker Offering Memorandum's pro forma
 * into a "marketing" scenario for a deal.
 *
 * The Marketing scenario captures the BROKER's stabilized projection (market
 * rents + pro-forma expenses at the offering price) as its own scenario, so it
 * can be compared side-by-side against the buyer's own underwriting. It mirrors
 * the exact scenario shape produced by POST /api/scenarios: build default inputs
 * from the deal, overlay the extracted pro-forma numbers, run the underwriting
 * engine, and persist a `scenario:<id>` record indexed under
 * `scenarios:by_deal:<dealId>`.
 */
import { getRedis, addToIndex } from "./db";
import { logActivity } from "./activity";
import {
  buildDefaultInputs,
  calculateUnderwriting,
  type ScenarioInputs,
  type UnitMix,
  type ExpenseAssumptions,
} from "./underwriting";
import type { Scenario, Deal } from "./validations";
import type { OMExtractedData } from "./om-extract";

export const MARKETING_SCENARIO_TYPE = "marketing";
export const MARKETING_SCENARIO_NAME = "Marketing (OM)";

/**
 * True when the OM actually carries a usable pro forma — i.e. BOTH a revenue
 * signal (a pro-forma unit mix with market rents, or a stated GPR/NOI) AND at
 * least one pro-forma expense line. A facts-only OM (address, price, unit count
 * but no operating projection) returns false so no empty Marketing scenario is
 * created.
 */
export function hasMarketingProForma(data: OMExtractedData): boolean {
  const pf = data.marketing_pro_forma;
  if (!pf) return false;

  const unitMixRevenue = (pf.unit_mix ?? []).some(
    (u) => (u.market_rent ?? 0) > 0 || (u.current_rent ?? 0) > 0,
  );
  const hasRevenue =
    unitMixRevenue ||
    (pf.gross_potential_rent ?? 0) > 0 ||
    (pf.effective_gross_income ?? 0) > 0 ||
    (pf.net_operating_income ?? 0) > 0;

  const e = pf.expenses ?? {};
  const hasExpenses =
    (e.property_taxes ?? 0) > 0 ||
    (e.insurance ?? 0) > 0 ||
    (e.management_fees ?? 0) > 0 ||
    (e.management_fee_rate ?? 0) > 0 ||
    (e.repairs_maintenance ?? 0) > 0 ||
    (e.utilities ?? 0) > 0 ||
    (e.payroll ?? 0) > 0 ||
    (e.admin_marketing ?? 0) > 0 ||
    (e.contract_services ?? 0) > 0 ||
    (e.reserves ?? 0) > 0 ||
    (e.total_operating_expenses ?? 0) > 0;

  return hasRevenue && hasExpenses;
}

/** Build the DealData shape buildDefaultInputs expects from a persisted Deal. */
function toDealData(deal: Deal): Parameters<typeof buildDefaultInputs>[0] {
  return {
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
  } as Parameters<typeof buildDefaultInputs>[0];
}

/**
 * Overlay the extracted pro forma onto default inputs. The Marketing scenario
 * is a stabilized, at-market case: every unit pays its pro-forma/market rent
 * from month 1 (no ramp, no renovation premium), and each pro-forma expense line
 * that the OM stated replaces the corresponding default.
 */
export function buildMarketingScenarioInputs(
  deal: Deal,
  data: OMExtractedData,
): ScenarioInputs {
  const base = buildDefaultInputs(toDealData(deal), {});
  const pf = data.marketing_pro_forma ?? {};

  const units = deal.units || base.revenue.unit_mix.reduce((sum, u) => sum + (u.count || 0), 0);
  const dealHasRentRoll = (deal.rent_roll?.length ?? 0) > 0;

  // Annual GPR stated (or derivable) from the OM's aggregate pro forma, cascading
  // GPR → EGI → NOI. This is the source of truth for an aggregate-only OM that
  // gives totals but no per-unit mix — without it the Marketing scenario would
  // silently run on the deal's placeholder $1,000/unit rents.
  const vacancyForDerive = pf.vacancy_rate ?? base.revenue.vacancy_rate;
  const otherIncomeAnnualStated = pf.other_income ?? 0;
  const statedTotalOpex =
    pf.expenses?.total_operating_expenses ??
    (pf.expenses
      ? [pf.expenses.property_taxes, pf.expenses.insurance, pf.expenses.management_fees, pf.expenses.repairs_maintenance, pf.expenses.utilities, pf.expenses.payroll, pf.expenses.admin_marketing, pf.expenses.contract_services, pf.expenses.reserves]
          .reduce<number>((s, v) => s + (v ?? 0), 0) || undefined
      : undefined);
  let derivedGprAnnual: number | undefined = pf.gross_potential_rent ?? undefined;
  if (derivedGprAnnual == null && pf.effective_gross_income != null) {
    derivedGprAnnual = (pf.effective_gross_income - otherIncomeAnnualStated) / Math.max(0.01, 1 - vacancyForDerive);
  }
  if (derivedGprAnnual == null && pf.net_operating_income != null && statedTotalOpex != null) {
    const egi = pf.net_operating_income + statedTotalOpex;
    derivedGprAnnual = (egi - otherIncomeAnnualStated) / Math.max(0.01, 1 - vacancyForDerive);
  }

  // ── Unit mix ── prefer the pro-forma unit mix; else derive per-unit market
  // rent from the OM's stated GPR; else (real rent roll only) use the deal's mix.
  let unitMix: UnitMix[];
  if (pf.unit_mix && pf.unit_mix.length > 0) {
    unitMix = pf.unit_mix.map((r) => {
      const rent = Math.round(r.market_rent || r.current_rent || 0);
      return {
        type: r.unit_type || "Average",
        count: r.count,
        current_rent: rent,
        market_rent: rent,
        renovated_rent_premium: 0,
      };
    });
  } else if (derivedGprAnnual != null && derivedGprAnnual > 0 && units > 0 && !dealHasRentRoll) {
    // Aggregate-only OM with no rent roll: spread the stated GPR evenly across the
    // units rather than fabricating a placeholder rent.
    const perUnitMonthly = Math.round(derivedGprAnnual / units / 12);
    unitMix = [{ type: "Average (from OM pro forma)", count: units, current_rent: perUnitMonthly, market_rent: perUnitMonthly, renovated_rent_premium: 0 }];
  } else {
    unitMix = base.revenue.unit_mix.map((u) => {
      const rent = u.market_rent > 0 ? u.market_rent : u.current_rent;
      return { ...u, current_rent: rent, market_rent: rent, renovated_rent_premium: 0 };
    });
  }

  // ── EGI estimate (used only to convert a $ management fee into a rate) ──
  const gprAnnual =
    pf.gross_potential_rent ??
    unitMix.reduce((sum, u) => sum + u.market_rent * u.count * 12, 0);
  const otherIncomeAnnual = pf.other_income ?? base.revenue.other_income_monthly * 12;
  const vacancyRate = pf.vacancy_rate ?? base.revenue.vacancy_rate;
  const egiEstimate =
    pf.effective_gross_income ??
    gprAnnual * (1 - vacancyRate) + otherIncomeAnnual;

  // ── Expenses ── overlay each stated pro-forma line.
  const e = pf.expenses ?? {};
  const expenses: ExpenseAssumptions = { ...base.expenses };
  if (e.property_taxes != null) expenses.property_tax_total = e.property_taxes;
  if (e.insurance != null && units > 0) expenses.insurance_per_unit = e.insurance / units;
  if (e.management_fee_rate != null) {
    expenses.management_fee_rate = e.management_fee_rate;
  } else if (e.management_fees != null && egiEstimate > 0) {
    expenses.management_fee_rate = Math.round((e.management_fees / egiEstimate) * 1000) / 1000;
  }
  if (e.repairs_maintenance != null && units > 0)
    expenses.repairs_maintenance_per_unit = e.repairs_maintenance / units;
  if (e.utilities != null && units > 0) expenses.utilities_per_unit = e.utilities / units;
  if (e.payroll != null) expenses.payroll_annual = e.payroll;
  if (e.admin_marketing != null) expenses.admin_legal_marketing = e.admin_marketing;
  if (e.contract_services != null) expenses.contract_services = e.contract_services;
  if (e.reserves != null && units > 0) expenses.reserves_per_unit = e.reserves / units;

  const purchasePrice =
    pf.offering_price || deal.asking_price || base.purchase.purchase_price;

  return {
    ...base,
    purchase: { ...base.purchase, purchase_price: purchasePrice },
    revenue: {
      ...base.revenue,
      unit_mix: unitMix,
      other_income_monthly: Math.round(otherIncomeAnnual / 12),
      vacancy_rate: vacancyRate,
    },
    expenses,
  };
}

interface CreateOrUpdateArgs {
  dealId: string;
  deal: Deal;
  data: OMExtractedData;
  userId: string;
}

/**
 * Find-or-create the Marketing scenario for a deal from the OM pro forma.
 * Returns null when the OM has no usable pro forma (guardrail). Otherwise
 * persists (updating an existing "marketing" scenario in place, or creating a
 * new one), indexes it, logs activity, and reports whether it was created.
 */
export async function createOrUpdateMarketingScenario(
  args: CreateOrUpdateArgs,
): Promise<{ created: boolean; scenario: Scenario } | null> {
  const { dealId, deal, data, userId } = args;
  if (!hasMarketingProForma(data)) return null;

  const inputs = buildMarketingScenarioInputs(deal, data);
  const result = calculateUnderwriting(inputs);
  const now = new Date().toISOString();
  const redis = getRedis();

  // Look for an existing Marketing scenario on this deal.
  const ids = await redis.zrange(`scenarios:by_deal:${dealId}`, 0, -1, { rev: true });
  let existing: Scenario | null = null;
  if (ids.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.get(`scenario:${id}`);
    const scenarios = await pipeline.exec<(Scenario | null)[]>();
    existing = scenarios.find(
      (s): s is Scenario => s !== null && s.type === MARKETING_SCENARIO_TYPE,
    ) ?? null;
  }

  const id = existing?.id ?? crypto.randomUUID();
  const created = !existing;

  const calculated_metrics = {
    irr: result.metrics.irr ?? undefined,
    cash_on_cash: result.metrics.average_cash_on_cash,
    dscr: result.metrics.year1_dscr,
    equity_multiple: result.metrics.equity_multiple,
    going_in_cap: result.metrics.going_in_cap,
    stabilized_cap: result.metrics.stabilized_cap,
  };

  const scenario: Scenario = {
    id,
    deal_id: dealId,
    name: MARKETING_SCENARIO_NAME,
    type: MARKETING_SCENARIO_TYPE,
    version: existing ? (existing.version ?? 1) + 1 : 1,
    is_active: existing?.is_active ?? true,
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
    calculated_metrics,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await redis.set(`scenario:${id}`, JSON.stringify(scenario));
  await addToIndex(`scenarios:by_deal:${dealId}`, id, Date.now());

  await logActivity({
    deal_id: dealId,
    action: created ? "scenario_created" : "scenario_updated",
    entity_type: "scenario",
    entity_id: id,
    details: {
      name: scenario.name,
      type: scenario.type,
      source: "offering_memo_pro_forma",
    },
    user_id: userId,
  });

  return { created, scenario };
}
