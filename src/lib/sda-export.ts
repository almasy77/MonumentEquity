/**
 * "Export SDA" — renders our underwriting in the format of Michael Blank's
 * Syndicated Deal Analyzer (v2.9.4). Maps the engine's outputs into the SDA's
 * syndication waterfall (src/lib/syndication.ts) and lays the result out across
 * the SDA's sheets: Summary, P&L (with the distribution waterfall), Exit Strategy,
 * Returns (LP + GP), and the investor One Pager.
 */
import ExcelJS from "exceljs";
import type { ScenarioInputs, UnderwritingResult } from "./underwriting";
import type { Deal } from "./validations";
import { computeSyndication, type SyndicationAssumptions, type SyndicationInput, type SyndicationResult } from "./syndication";
import { SDA_SYNDICATION_DEFAULTS, SDA_ACQUISITION_DEFAULTS } from "./sda-heuristics";

const USD = '$#,##0';
const PCT = '0.0%';
const PCT2 = '0.00%';
const MULT = '0.00"x"';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const SUB_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF0F6" } };

export function defaultSyndicationAssumptions(): SyndicationAssumptions {
  return {
    lp_equity_pct: SDA_SYNDICATION_DEFAULTS.lp_equity_pct,
    preferred_return_rate: SDA_SYNDICATION_DEFAULTS.preferred_return_rate,
    acquisition_fee_pct: SDA_ACQUISITION_DEFAULTS.acquisition_fee_pct,
    asset_management_fee_pct: SDA_SYNDICATION_DEFAULTS.asset_management_fee_pct,
    capital_transaction_fee_pct: SDA_SYNDICATION_DEFAULTS.capital_transaction_fee_pct,
    lp_excess_split: SDA_SYNDICATION_DEFAULTS.lp_excess_split,
  };
}

/** Map the engine's result + inputs into the SDA syndication input. */
export function buildSyndicationInput(
  inputs: ScenarioInputs,
  result: UnderwritingResult,
  assumptions: SyndicationAssumptions,
): SyndicationInput {
  const m = result.metrics;
  const purchasePrice = inputs.purchase.purchase_price;
  const acqFee = assumptions.acquisition_fee_pct * purchasePrice;
  const saleYear = inputs.exit.hold_period_years;

  return {
    assumptions,
    // LPs fund the whole equity check plus the GP's acquisition fee (a use of funds).
    initial_lp_capital: m.total_equity + acqFee,
    purchase_price: purchasePrice,
    sale_year: saleYear,
    // Partnership equity at sale before returning capital / pref / splitting profit.
    net_sale_equity: m.net_sale_proceeds + (m.return_of_operating_reserve ?? 0),
    sale_price: m.exit_value,
    years: result.annual.slice(0, saleYear).map((a) => ({
      year: a.year,
      egi: a.egi,
      // NOI − debt service − reserves; reserves are inside the SDA's OpEx, so this
      // is the SDA's "Cash Flow available for Distribution".
      distributable_cash_flow: a.cash_flow_before_capex,
    })),
    refi:
      m.refi_net_proceeds > 0 && m.refi_year
        ? { year: m.refi_year, net_refi_proceeds: m.refi_net_proceeds }
        : undefined,
  };
}

// ── styling helpers ──
function title(ws: ExcelJS.Worksheet, text: string, span = 12) {
  const r = ws.addRow([text]);
  r.getCell(1).font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= span; c++) r.getCell(c).fill = HEADER_FILL;
  r.height = 20;
  ws.addRow([]);
  return r;
}
function section(ws: ExcelJS.Worksheet, text: string, span = 12) {
  const r = ws.addRow([text]);
  r.getCell(1).font = { bold: true, size: 11 };
  for (let c = 1; c <= span; c++) r.getCell(c).fill = SUB_FILL;
  return r;
}
function kv(ws: ExcelJS.Worksheet, label: string, value: number | string, fmt?: string, col = 4) {
  const r = ws.addRow([label]);
  const cell = r.getCell(col);
  cell.value = value;
  if (fmt && typeof value === "number") cell.numFmt = fmt;
  cell.font = { bold: true };
  return r;
}

const YEAR_COLS = (n: number) => Array.from({ length: n }, (_, i) => `Year ${i + 1}`);

function buildSummary(wb: ExcelJS.Workbook, deal: Deal, scenarioName: string, inputs: ScenarioInputs, result: UnderwritingResult, syn: SyndicationResult, a: SyndicationAssumptions) {
  const ws = wb.addWorksheet("Summary");
  ws.getColumn(1).width = 34; ws.getColumn(4).width = 16;
  title(ws, "Executive Summary");
  ws.addRow([`${deal.address}, ${deal.city}, ${deal.state}  ·  ${scenarioName}`]);
  ws.addRow([]);
  const m = result.metrics;
  const a0 = result.annual[0];

  section(ws, "Purchase");
  kv(ws, "# Units", deal.units, '#,##0');
  kv(ws, "Purchase Price", m.purchase_price, USD);
  kv(ws, "Price Per Unit", deal.units ? m.purchase_price / deal.units : 0, USD);
  kv(ws, "1st Mortgage", m.loan_amount, USD);
  kv(ws, "Interest Rate", inputs.financing.interest_rate, PCT2);
  kv(ws, "Amortization (yrs)", inputs.financing.amortization_years, '#,##0');
  kv(ws, "Closing Costs", m.closing_costs, USD);
  kv(ws, "Acquisition Fee", a.acquisition_fee_pct * m.purchase_price, USD);
  kv(ws, "Total Member Capital to Close", syn.years[0]?.lp_capital_begin ?? 0, USD);
  ws.addRow([]);

  section(ws, "Income & Expenses (Year 1)");
  kv(ws, "Gross Potential Rent", a0.gpr, USD);
  kv(ws, "Effective Gross Income", a0.egi, USD);
  kv(ws, "Total Expenses", a0.total_opex, USD);
  kv(ws, "Net Operating Income", a0.noi, USD);
  kv(ws, "Debt Service", a0.debt_service, USD);
  kv(ws, "Cash Flow After Debt Service", a0.noi - a0.debt_service, USD);
  ws.addRow([]);

  section(ws, "Key Indicators");
  kv(ws, "Going-In Cap Rate", m.going_in_cap, PCT2);
  kv(ws, "Debt Coverage Ratio (Yr 1)", m.year1_dscr, '0.00');
  kv(ws, "Gross Rent Multiplier", a0.gpr ? m.purchase_price / a0.gpr : 0, '0.0');
  ws.addRow([]);

  section(ws, "Investor Returns (LP / Member)");
  kv(ws, "Member Equity", a.lp_equity_pct, PCT);
  kv(ws, "Manager Equity", 1 - a.lp_equity_pct, PCT);
  kv(ws, "Preferred Return to Members", a.preferred_return_rate, PCT);
  kv(ws, "Asset Management Fee (% EGI)", a.asset_management_fee_pct, PCT);
  kv(ws, "IRR", syn.lp_irr ?? 0, PCT2);
  kv(ws, "Equity Multiple", syn.lp_equity_multiple, MULT);
  kv(ws, "Average Annual Return", syn.lp_average_annual_return, PCT2);
  kv(ws, "Average Cash-on-Cash", syn.lp_average_cash_on_cash, PCT2);
  ws.addRow([]);

  section(ws, "Manager (GP) Compensation");
  kv(ws, "Acquisition Fee", syn.gp_acquisition_fee, USD);
  kv(ws, "Asset Management Fees (total)", syn.gp_asset_mgmt_fees_total, USD);
  kv(ws, "Capital Transaction Fees", syn.gp_capital_transaction_fees, USD);
  kv(ws, "Promote (excess CF + sale profit)", syn.gp_promote_total, USD);
  kv(ws, "Total Manager Compensation", syn.gp_total_compensation, USD);
}

function headerRow(ws: ExcelJS.Worksheet, labels: string[]) {
  const r = ws.addRow(labels);
  r.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEADER_FILL; });
  return r;
}
function dataRow(ws: ExcelJS.Worksheet, label: string, values: number[], fmt = USD, bold = false) {
  const r = ws.addRow([label, ...values]);
  r.getCell(1).font = { bold };
  for (let i = 0; i < values.length; i++) { const c = r.getCell(i + 2); c.numFmt = fmt; if (bold) c.font = { bold: true }; }
  return r;
}

function buildPnL(wb: ExcelJS.Workbook, inputs: ScenarioInputs, result: UnderwritingResult, syn: SyndicationResult) {
  const ws = wb.addWorksheet("P&L");
  ws.getColumn(1).width = 34;
  const n = syn.years.length;
  for (let c = 2; c <= n + 1; c++) ws.getColumn(c).width = 14;
  title(ws, "Profit & Loss + Distribution Waterfall", n + 1);
  const annual = result.annual.slice(0, n);
  headerRow(ws, ["", ...YEAR_COLS(n)]);

  section(ws, "Income", n + 1);
  dataRow(ws, "Gross Potential Rent", annual.map((a) => a.gpr));
  dataRow(ws, "Less: Vacancy", annual.map((a) => -a.vacancy_loss));
  dataRow(ws, "Less: Concessions / LTL / Bad Debt", annual.map((a) => -(a.bad_debt + a.concessions)));
  dataRow(ws, "Plus: Other Income", annual.map((a) => a.other_income));
  dataRow(ws, "Effective Gross Income", annual.map((a) => a.egi), USD, true);
  section(ws, "Expenses", n + 1);
  dataRow(ws, "Total Operating Expenses", annual.map((a) => a.total_opex));
  dataRow(ws, "Net Operating Income", annual.map((a) => a.noi), USD, true);
  section(ws, "Debt Service", n + 1);
  dataRow(ws, "Total Debt Service", annual.map((a) => a.debt_service));
  // Reserves sit below NOI in this app's convention (the SDA folds them into OpEx),
  // so show them explicitly here — otherwise NOI − Debt Service wouldn't foot to
  // Cash Flow available for Distribution.
  dataRow(ws, "Less: Reserves & Replacement", annual.map((a) => -(a.reserves + (a.capital_reserve ?? 0))));
  dataRow(ws, "Cash Flow available for Distribution", syn.years.map((y) => y.distributable_cash_flow), USD, true);

  section(ws, "Distributions from Cash Flow", n + 1);
  dataRow(ws, "Asset Mgt Fee (to GP)", syn.years.map((y) => y.asset_mgmt_fee));
  dataRow(ws, "Members Preferred Return Due", syn.years.map((y) => y.pref_due));
  dataRow(ws, "Members Preferred Return Paid", syn.years.map((y) => y.pref_paid));
  dataRow(ws, "Preferred Return Deficiency (accrued)", syn.years.map((y) => y.pref_deficiency));
  dataRow(ws, "Excess Cash Flow to Members (LP)", syn.years.map((y) => y.excess_to_lp));
  dataRow(ws, "Excess Cash Flow to Manager (GP)", syn.years.map((y) => y.excess_to_gp));
  dataRow(ws, "Total Distributions to Members", syn.years.map((y) => y.lp_operating_distributions), USD, true);
  dataRow(ws, "Member Cash-on-Cash Return", syn.years.map((y) => y.lp_cash_on_cash), PCT2);

  section(ws, "Metrics", n + 1);
  dataRow(ws, "Debt Coverage Ratio", annual.map((a) => (a.debt_service ? a.noi / a.debt_service : 0)), '0.00');
  dataRow(ws, "Capital Account (Begin of Year)", syn.years.map((y) => y.lp_capital_begin));
}

function buildExitStrategy(wb: ExcelJS.Workbook, inputs: ScenarioInputs, result: UnderwritingResult, syn: SyndicationResult) {
  const ws = wb.addWorksheet("Exit Strategy");
  ws.getColumn(1).width = 40; ws.getColumn(4).width = 16;
  title(ws, "Exit Strategy");
  const m = result.metrics;
  section(ws, "Sale / Disposition");
  kv(ws, "Year of Sale", inputs.exit.hold_period_years, '#,##0');
  kv(ws, "NOI at Sale", m.exit_noi, USD);
  kv(ws, "Exit Cap Rate", inputs.exit.exit_cap_rate, PCT2);
  kv(ws, "Sales Price", m.exit_value, USD);
  kv(ws, "Net Sale Proceeds (partnership equity)", m.net_sale_proceeds + (m.return_of_operating_reserve ?? 0), USD);
  ws.addRow([]);
  section(ws, "Sale Waterfall (SDA H17–H25)");
  kv(ws, "Return of Member Capital", syn.sale_return_of_capital, USD);
  kv(ws, "Members Preferred Return Deficiency Paid", syn.sale_pref_deficiency_paid, USD);
  kv(ws, "Net Profit from Sale", syn.sale_net_profit, USD);
  kv(ws, "Profit Paid to Members (LP)", syn.sale_profit_to_lp, USD);
  kv(ws, "Profit Paid to Manager (GP)", syn.sale_profit_to_gp, USD);
  ws.addRow([]);
  if (m.refi_net_proceeds > 0 && m.refi_year) {
    section(ws, "Cash-Out Refinance");
    kv(ws, "Year of Refinance", m.refi_year, '#,##0');
    kv(ws, "Net Refinance Proceeds", m.refi_net_proceeds, USD);
    const refiRow = syn.years.find((y) => y.year === m.refi_year);
    kv(ws, "Return of Member Capital (refi)", refiRow?.lp_capital_returned ?? 0, USD);
  }
}

function buildReturns(wb: ExcelJS.Workbook, syn: SyndicationResult) {
  const ws = wb.addWorksheet("Returns");
  ws.getColumn(1).width = 40;
  const n = syn.years.length;
  for (let c = 2; c <= n + 1; c++) ws.getColumn(c).width = 14;
  title(ws, "Projected Returns", n + 1);

  section(ws, "Member (LP) Cash Flows", n + 1);
  headerRow(ws, ["", ...YEAR_COLS(n)]);
  dataRow(ws, "Beginning Capital Account", syn.years.map((y) => y.lp_capital_begin));
  dataRow(ws, "Operating Distributions", syn.years.map((y) => y.lp_operating_distributions));
  dataRow(ws, "Capital Returned (refi/sale)", syn.years.map((y) => y.lp_capital_returned));
  dataRow(ws, "Total LP Cash Flow", syn.years.map((y) => y.lp_total_cash), USD, true);
  dataRow(ws, "Cash-on-Cash Return", syn.years.map((y) => y.lp_cash_on_cash), PCT2);
  ws.addRow([]);

  section(ws, "LP Return Summary", n + 1);
  kv(ws, "IRR", syn.lp_irr ?? 0, PCT2);
  kv(ws, "Equity Multiple", syn.lp_equity_multiple, MULT);
  kv(ws, "Average Annual Return", syn.lp_average_annual_return, PCT2);
  kv(ws, "Average Cash-on-Cash", syn.lp_average_cash_on_cash, PCT2);
  kv(ws, "Total Cash Returned to LP", syn.lp_total_cash_returned, USD);
  kv(ws, "LP Profit", syn.lp_profit, USD);
  ws.addRow([]);

  section(ws, "Manager (GP) Compensation", n + 1);
  kv(ws, "Acquisition Fee", syn.gp_acquisition_fee, USD);
  kv(ws, "Asset Management Fees (total)", syn.gp_asset_mgmt_fees_total, USD);
  kv(ws, "Capital Transaction Fees", syn.gp_capital_transaction_fees, USD);
  kv(ws, "Promote", syn.gp_promote_total, USD);
  kv(ws, "Total Manager Compensation", syn.gp_total_compensation, USD, 4);
}

function buildOnePager(wb: ExcelJS.Workbook, deal: Deal, inputs: ScenarioInputs, result: UnderwritingResult, syn: SyndicationResult) {
  const ws = wb.addWorksheet("One Pager");
  ws.getColumn(1).width = 30; ws.getColumn(4).width = 16;
  title(ws, "Investment Summary");
  ws.addRow([`${deal.address}, ${deal.city}, ${deal.state}`]);
  ws.addRow([]);
  const m = result.metrics;
  section(ws, "Deal");
  kv(ws, "Purchase Price", m.purchase_price, USD);
  kv(ws, "# Units", deal.units, '#,##0');
  kv(ws, "Price Per Unit", deal.units ? m.purchase_price / deal.units : 0, USD);
  kv(ws, "Hold Period (Years)", inputs.exit.hold_period_years, '#,##0');
  ws.addRow([]);
  section(ws, "LP (Member) Returns");
  kv(ws, "Cash-on-Cash Return (avg)", syn.lp_average_cash_on_cash, PCT2);
  kv(ws, "IRR", syn.lp_irr ?? 0, PCT2);
  kv(ws, "Equity Multiple", syn.lp_equity_multiple, MULT);
  kv(ws, "Average Annual Return", syn.lp_average_annual_return, PCT2);
  ws.addRow([]);
  section(ws, "Key Indicators — Year 1 → Exit");
  const a0 = result.annual[0];
  const aExit = result.annual[Math.min(inputs.exit.hold_period_years, result.annual.length) - 1];
  kv(ws, "NOI (Yr 1)", a0.noi, USD); kv(ws, "NOI (Exit)", aExit.noi, USD);
  kv(ws, "DSCR (Yr 1)", a0.debt_service ? a0.noi / a0.debt_service : 0, '0.00');
  kv(ws, "Sale Price (Exit)", m.exit_value, USD);
}

/** Build the full SDA-format workbook. */
export async function generateSdaWorkbook(
  deal: Deal,
  scenarioName: string,
  inputs: ScenarioInputs,
  result: UnderwritingResult,
  assumptions: SyndicationAssumptions = defaultSyndicationAssumptions(),
): Promise<Buffer> {
  const synInput = buildSyndicationInput(inputs, result, assumptions);
  const syn = computeSyndication(synInput);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Monument Equity — SDA Export";
  wb.created = new Date();

  buildSummary(wb, deal, scenarioName, inputs, result, syn, assumptions);
  buildPnL(wb, inputs, result, syn);
  buildExitStrategy(wb, inputs, result, syn);
  buildReturns(wb, syn);
  buildOnePager(wb, deal, inputs, result, syn);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
