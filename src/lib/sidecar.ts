/**
 * JSON sidecar (fix-spec Phase 3.5) — machine-readable companion to the xlsx:
 * full inputs, tax vectors, key outputs, reconciliation checks, metadata.
 * The golden test harness asserts this shape.
 */
import type { Deal } from "./validations";
import type { ScenarioInputs, UnderwritingResult } from "./underwriting";
import { computeReconciliationChecks, allChecksPass, exitMethodFor, capexGuardrailWarning } from "./checks";

export interface ExportSidecar {
  metadata: {
    deal_address: string;
    scenario_name: string;
    tax_scenario: string;
    exit_method: string;
    git_sha: string;
    generated_at: string;
  };
  inputs: ScenarioInputs;
  key_outputs: {
    irr: number | null;
    equity_multiple: number;
    average_cash_on_cash: number;
    year1_dscr: number;
    going_in_cap: number;
    stabilized_cap: number;
    exit_value: number;
    exit_noi: number;
    net_sale_proceeds: number;
    total_equity: number;
    annual_noi: number[];
    annual_property_tax: number[];
  };
  property_tax_vectors: UnderwritingResult["property_tax_vectors"] | null;
  checks: { all_pass: boolean; items: ReturnType<typeof computeReconciliationChecks> };
  warnings: string[];
}

export function buildSidecar(
  deal: Deal,
  scenarioName: string,
  inputs: ScenarioInputs,
  result: UnderwritingResult,
): ExportSidecar {
  const checks = computeReconciliationChecks(deal, inputs, result);
  const m = result.metrics;
  return {
    metadata: {
      deal_address: `${deal.address}, ${deal.city}, ${deal.state}`,
      scenario_name: scenarioName,
      tax_scenario: result.property_tax_vectors?.scenario_in_force ?? "legacy/none",
      exit_method: exitMethodFor(inputs),
      git_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
      generated_at: new Date().toISOString(),
    },
    inputs,
    key_outputs: {
      irr: m.irr,
      equity_multiple: m.equity_multiple,
      average_cash_on_cash: m.average_cash_on_cash,
      year1_dscr: m.year1_dscr,
      going_in_cap: m.going_in_cap,
      stabilized_cap: m.stabilized_cap,
      exit_value: m.exit_value,
      exit_noi: m.exit_noi,
      net_sale_proceeds: m.net_sale_proceeds,
      total_equity: m.total_equity,
      annual_noi: result.annual.map((a) => a.noi),
      annual_property_tax: result.annual.map((a) => a.opex_breakdown.property_tax),
    },
    property_tax_vectors: result.property_tax_vectors ?? null,
    checks: { all_pass: allChecksPass(checks), items: checks },
    warnings: [...result.warnings, ...(capexGuardrailWarning(deal, inputs) ? [capexGuardrailWarning(deal, inputs)!] : [])],
  };
}
