import type { Scenario } from "./validations";
import type { ScenarioInputs } from "./underwriting";

/**
 * Map a stored Scenario to the ScenarioInputs the engine consumes. Mirrors the
 * mapping the scenario API routes use so a client-side re-computation (e.g. the
 * reverse price-solve) matches the server's result exactly.
 */
export function scenarioToInputs(scenario: Scenario): ScenarioInputs {
  const s = scenario as unknown as Record<string, unknown>;
  return {
    purchase: s.purchase_assumptions,
    financing: s.financing_assumptions,
    revenue: s.revenue_assumptions,
    expenses: s.expense_assumptions,
    capex: s.capex_assumptions,
    exit: s.exit_assumptions,
    tax: s.tax_assumptions,
    depreciation: s.depreciation_assumptions || undefined,
  } as unknown as ScenarioInputs;
}
