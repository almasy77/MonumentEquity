import type { Deal, Scenario } from "./validations";
import type { SensitivityCell } from "./underwriting";
import { calculateUnderwriting } from "./underwriting";
import { scenarioToInputs } from "./scenario-inputs";

// Builds the read-only, seller/partner-facing data for one scenario on the public
// share page. Recomputes from stored inputs (the same calculateUnderwriting the app
// and Excel export use) so the shared assumptions / pro forma / sensitivity always
// match the live model — never a stale stored snapshot. Pure + serializable so a
// server component can hand the result straight to the client card.

export interface ShareAssumption {
  label: string;
  value: string;
}

export interface ShareProFormaYear {
  year: number;
  gpr: number;
  vacancy: number;
  egi: number;
  opex: number;
  noi: number;
  debtService: number;
  capex: number;
  cashFlow: number;
}

export interface ShareScenarioData {
  id: string;
  name: string;
  type: string;
  metrics: {
    irr: number | null;
    coc: number | null;
    em: number | null;
    dscr: number | null;
    goingCap: number | null;
    stabCap: number | null;
  };
  assumptions: ShareAssumption[];
  proforma: ShareProFormaYear[];
  sensitivity: SensitivityCell[];
  basePurchasePrice: number;
}

const usd = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

export function buildShareScenarioData(deal: Deal, s: Scenario): ShareScenarioData {
  const units = deal.units || 0;
  try {
    const inputs = scenarioToInputs(s);
    const r = calculateUnderwriting(inputs);
    const m = r.metrics;
    const assumptions: ShareAssumption[] = [
      { label: "Purchase Price", value: usd(inputs.purchase.purchase_price) },
      { label: "Price / Unit", value: units > 0 ? usd(inputs.purchase.purchase_price / units) : "—" },
      { label: "Loan (LTV)", value: pct(inputs.financing.ltv) },
      { label: "Loan Amount", value: usd(m.loan_amount) },
      { label: "Interest Rate", value: pct(inputs.financing.interest_rate) },
      { label: "Amortization", value: `${inputs.financing.amortization_years} yr` },
      { label: "Interest-Only", value: inputs.financing.io_period_months ? `${inputs.financing.io_period_months} mo` : "None" },
      { label: "Hold Period", value: `${inputs.exit.hold_period_years} yr` },
      { label: "Exit Cap Rate", value: pct(inputs.exit.exit_cap_rate) },
      { label: "Rent Growth", value: pct(inputs.revenue.rent_growth_rate) },
      { label: "Vacancy", value: pct(inputs.revenue.vacancy_rate) },
      { label: "Total Equity", value: usd(m.total_equity) },
    ];
    const proforma: ShareProFormaYear[] = r.annual.map((a) => ({
      year: a.year,
      gpr: a.gpr,
      vacancy: a.vacancy_loss,
      egi: a.egi,
      opex: a.total_opex,
      noi: a.noi,
      debtService: a.debt_service,
      capex: a.capex,
      cashFlow: a.cash_flow,
    }));
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      metrics: {
        irr: m.irr,
        coc: m.average_cash_on_cash,
        em: m.equity_multiple,
        dscr: m.year1_dscr,
        goingCap: m.going_in_cap,
        stabCap: m.stabilized_cap,
      },
      assumptions,
      proforma,
      sensitivity: r.sensitivity ?? [],
      basePurchasePrice: inputs.purchase.purchase_price,
    };
  } catch {
    // Compute failed (e.g. malformed stored inputs) — fall back to the stored
    // metric strip with no expandable detail; the card handles the empty case.
    const cm = (s as unknown as { calculated_metrics?: Record<string, number | null | undefined> }).calculated_metrics;
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      metrics: {
        irr: cm?.irr ?? null,
        coc: cm?.cash_on_cash ?? null,
        em: cm?.equity_multiple ?? null,
        dscr: cm?.dscr ?? null,
        goingCap: cm?.going_in_cap ?? null,
        stabCap: cm?.stabilized_cap ?? null,
      },
      assumptions: [],
      proforma: [],
      sensitivity: [],
      basePurchasePrice: 0,
    };
  }
}
