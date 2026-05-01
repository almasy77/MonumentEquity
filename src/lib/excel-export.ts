/**
 * Monument Equity — Excel Export
 *
 * Generates a professional .xlsx workbook with engine-computed values.
 * Simple formulas are used only in Unit Mix and CapEx Schedule sheets
 * where inputs are static. All metrics and pro forma data use static
 * values from the underwriting engine to avoid ExcelJS formula chain issues.
 */

import ExcelJS from "exceljs";
import type { Deal } from "./validations";
import type {
  ScenarioInputs,
  UnderwritingResult,
  MonthlyRow,
  AnnualSummary,
  SensitivityCell,
  DealMetrics,
  OpexInput,
  OpexInputMode,
} from "./underwriting";

// ─── Styles ──────────────────────────────────────────────────

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const SUBHEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2D4A6F" },
};

const LIGHT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF0F4F8" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

const SUBHEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 10,
};

const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10 };
const NORMAL_FONT: Partial<ExcelJS.Font> = { size: 10 };

const CURRENCY_FMT = '$#,##0';
const PCT_FMT = '0.0%';
const NUMBER_FMT = '#,##0';
const MULT_FMT = '0.00"x"';

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D5DD" } },
  bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
  left: { style: "thin", color: { argb: "FFD0D5DD" } },
  right: { style: "thin", color: { argb: "FFD0D5DD" } },
};

// ─── Main Export Function ────────────────────────────────────

export async function generateExcelWorkbook(
  deal: Deal,
  scenarioName: string,
  inputs: ScenarioInputs,
  result: UnderwritingResult
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Monument Equity";
  wb.created = new Date();

  buildSummarySheet(wb, deal, scenarioName, result);
  buildAssumptionsSheet(wb, inputs);
  buildMonthlySheet(wb, result.monthly, inputs.exit.hold_period_years);
  buildAnnualSheet(wb, result.annual, inputs.exit.hold_period_years);
  buildReturnsSheet(wb, result);
  buildSensitivitySheet(wb, result.sensitivity, inputs.purchase.purchase_price);
  buildUnitMixSheet(wb, inputs.revenue.unit_mix);
  buildCapexSheet(wb, inputs.capex);
  if (result.metrics.depreciation) {
    buildDepreciationSheet(wb, inputs, result.metrics);
  }
  buildValidationSheet(wb, result);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Sheet Builders ──────────────────────────────────────────

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  deal: Deal,
  scenarioName: string,
  result: UnderwritingResult
) {
  const ws = wb.addWorksheet("Summary");
  ws.columns = [{ width: 28 }, { width: 18 }, { width: 14 }, { width: 28 }, { width: 18 }];

  // Title
  const titleRow = ws.addRow(["Monument Equity — Deal Summary"]);
  titleRow.font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  ws.mergeCells("A1:E1");
  ws.addRow([]);

  // Deal Info
  addSectionHeader(ws, "Property Information", 5);
  addLabelValue(ws, "Address", `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`);
  addLabelValue(ws, "Units", deal.units, NUMBER_FMT);
  addLabelValue(ws, "Asking Price", deal.asking_price, CURRENCY_FMT);
  if (deal.bid_price) addLabelValue(ws, "Bid Price", deal.bid_price, CURRENCY_FMT);
  addLabelValue(ws, "Source", deal.source);
  if (deal.year_built) addLabelValue(ws, "Year Built", deal.year_built);
  addLabelValue(ws, "Scenario", scenarioName);
  ws.addRow([]);

  // Key Metrics
  addSectionHeader(ws, "Key Metrics", 5);
  const m = result.metrics;

  // Column C header for hurdles
  {
    const hdrRow = ws.addRow(["", "Actual", "Hurdle"]);
    hdrRow.getCell(2).font = SUBHEADER_FONT;
    hdrRow.getCell(2).fill = SUBHEADER_FILL;
    hdrRow.getCell(2).border = THIN_BORDER;
    hdrRow.getCell(3).font = SUBHEADER_FONT;
    hdrRow.getCell(3).fill = SUBHEADER_FILL;
    hdrRow.getCell(3).border = THIN_BORDER;
  }

  const totalCF = result.annual.reduce((s, a) => s + a.cash_flow, 0);
  const totalDistributions = totalCF + m.net_sale_proceeds;
  const equityMultiple = m.total_equity > 0 ? totalDistributions / m.total_equity : 0;

  addLabelValueWithHurdle(ws, "IRR", m.irr ?? 0, PCT_FMT, 0.15, true);
  addLabelValueWithHurdle(ws, "Equity Multiple", equityMultiple, MULT_FMT, 2.0, true);
  addLabelValueWithHurdle(ws, "Average Cash-on-Cash", m.average_cash_on_cash, PCT_FMT, 0.08, true);
  addLabelValueWithHurdle(ws, "Year 1 DSCR", m.year1_dscr, '0.00', 1.25, true);
  addLabelValue(ws, "Going-In Cap Rate", m.going_in_cap, PCT_FMT);
  addLabelValue(ws, "Stabilized Cap Rate", m.stabilized_cap, PCT_FMT);
  ws.addRow([]);

  // Purchase Summary
  addSectionHeader(ws, "Purchase Summary", 5);
  addLabelValue(ws, "Purchase Price", m.purchase_price, CURRENCY_FMT);
  addLabelValue(ws, "Closing Costs", m.closing_costs, CURRENCY_FMT);
  addLabelValue(ws, "Origination Fee", m.origination_fee, CURRENCY_FMT);
  addLabelValue(ws, "CapEx Reserve", m.capex_reserve, CURRENCY_FMT);
  addLabelValue(ws, "Total Cost", m.total_cost, CURRENCY_FMT);
  addLabelValue(ws, "Loan Amount", m.loan_amount, CURRENCY_FMT);
  addLabelValue(ws, "Down Payment", m.down_payment, CURRENCY_FMT);
  addLabelValue(ws, "Total Equity", m.total_equity, CURRENCY_FMT);
  addLabelValue(ws, "Monthly Debt Service", m.monthly_debt_service, CURRENCY_FMT);
  ws.addRow([]);

  // Exit Summary
  addSectionHeader(ws, "Exit Summary", 5);
  addLabelValue(ws, "Exit Value", m.exit_value, CURRENCY_FMT);
  addLabelValue(ws, "Exit NOI", m.exit_noi, CURRENCY_FMT);
  addLabelValue(ws, "Net Sale Proceeds", m.net_sale_proceeds, CURRENCY_FMT);
  addLabelValue(ws, "Total Profit", m.total_profit, CURRENCY_FMT);

  // Depreciation (if available)
  if (m.depreciation) {
    ws.addRow([]);
    addSectionHeader(ws, "Depreciation", 5);
    addLabelValue(ws, "Straight-Line (27.5 yr)", m.depreciation.straight_line_annual, CURRENCY_FMT);
    addLabelValue(ws, "Accelerated Yr 1", m.depreciation.accelerated_year1, CURRENCY_FMT);
    addLabelValue(ws, "Accelerated Yrs 2+", m.depreciation.accelerated_ongoing, CURRENCY_FMT);
    addLabelValue(ws, "% Land", m.depreciation.land_pct, PCT_FMT);
    addLabelValue(ws, "% Improvements", m.depreciation.improvement_pct, PCT_FMT);
  }
}

function buildAssumptionsSheet(wb: ExcelJS.Workbook, inputs: ScenarioInputs) {
  const ws = wb.addWorksheet("Assumptions");
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 4 }, { width: 30 }, { width: 18 }];

  addSectionHeader(ws, "Purchase Assumptions", 5);
  addInputRow(ws, "Purchase Price", inputs.purchase.purchase_price, CURRENCY_FMT);
  addInputRow(ws, "Closing Cost Rate", inputs.purchase.closing_cost_rate, PCT_FMT);
  addInputRow(ws, "Earnest Money", inputs.purchase.earnest_money, CURRENCY_FMT);
  ws.addRow([]);

  addSectionHeader(ws, "Financing Assumptions", 5);
  addInputRow(ws, "LTV", inputs.financing.ltv, PCT_FMT);
  addInputRow(ws, "Interest Rate", inputs.financing.interest_rate, PCT_FMT);
  addInputRow(ws, "Amortization (Years)", inputs.financing.amortization_years, NUMBER_FMT);
  addInputRow(ws, "Loan Term (Years)", inputs.financing.loan_term_years, NUMBER_FMT);
  addInputRow(ws, "IO Period (Months)", inputs.financing.io_period_months, NUMBER_FMT);
  addInputRow(ws, "Origination Fee Rate", inputs.financing.origination_fee_rate, PCT_FMT);
  ws.addRow([]);

  addSectionHeader(ws, "Revenue Assumptions", 5);
  addInputRow(ws, "Vacancy Rate", inputs.revenue.vacancy_rate, PCT_FMT);
  addInputRow(ws, "Bad Debt Rate", inputs.revenue.bad_debt_rate, PCT_FMT);
  addInputRow(ws, "Concessions Rate", inputs.revenue.concessions_rate, PCT_FMT);
  addInputRow(ws, "Rent Growth Rate (Annual)", inputs.revenue.rent_growth_rate, PCT_FMT);
  addInputRow(ws, "Other Income (Monthly)", inputs.revenue.other_income_monthly, CURRENCY_FMT);
  ws.addRow([]);

  addSectionHeader(ws, "Expense Assumptions", 5);

  const MODE_LABELS: Record<OpexInputMode, string> = {
    total_annual: "$/yr",
    per_unit_annual: "$/unit/yr",
    per_unit_monthly: "$/unit/mo",
    pct_egi: "% EGI",
    pct_gpr: "% GPR",
  };
  function opexLabel(name: string, oi?: OpexInput, fallbackMode?: string): string {
    const mode = oi ? MODE_LABELS[oi.mode] : (fallbackMode || "");
    return `${name} (${mode})`;
  }
  function opexValue(oi?: OpexInput, legacyVal?: number): number {
    return oi ? oi.value : (legacyVal || 0);
  }
  function opexFmt(oi?: OpexInput): string {
    if (oi && (oi.mode === "pct_egi" || oi.mode === "pct_gpr")) return PCT_FMT;
    return CURRENCY_FMT;
  }

  const oix = inputs.expenses.opex_inputs;
  addInputRow(ws, opexLabel("Management Fee", oix?.management_fees, "% EGI"), opexValue(oix?.management_fees, inputs.expenses.management_fee_rate), opexFmt(oix?.management_fees));
  addInputRow(ws, opexLabel("Payroll", oix?.payroll, "$/yr"), opexValue(oix?.payroll, inputs.expenses.payroll_annual), opexFmt(oix?.payroll));
  addInputRow(ws, opexLabel("R&M", oix?.repairs_maintenance, "$/unit/yr"), opexValue(oix?.repairs_maintenance, inputs.expenses.repairs_maintenance_per_unit), opexFmt(oix?.repairs_maintenance));
  addInputRow(ws, opexLabel("Turnover Cost", oix?.turnover, "$/unit/yr"), opexValue(oix?.turnover, inputs.expenses.turnover_cost_per_unit), opexFmt(oix?.turnover));
  addInputRow(ws, "Turnover Rate", inputs.expenses.turnover_rate ?? 0.50, PCT_FMT);
  addInputRow(ws, opexLabel("Insurance", oix?.insurance, "$/unit/yr"), opexValue(oix?.insurance, inputs.expenses.insurance_per_unit), opexFmt(oix?.insurance));
  addInputRow(ws, opexLabel("Property Tax", oix?.property_tax, "$/yr"), opexValue(oix?.property_tax, inputs.expenses.property_tax_total), opexFmt(oix?.property_tax));
  addInputRow(ws, "Tax Escalation Rate", inputs.expenses.tax_escalation_rate, PCT_FMT);
  addInputRow(ws, "Expense Escalation Rate", inputs.expenses.expense_escalation_rate || 0, PCT_FMT);
  addInputRow(ws, opexLabel("Utilities", oix?.utilities, "$/unit/yr"), opexValue(oix?.utilities, inputs.expenses.utilities_per_unit), opexFmt(oix?.utilities));
  addInputRow(ws, opexLabel("Admin/Legal/Marketing", oix?.admin_legal_marketing, "$/yr"), opexValue(oix?.admin_legal_marketing, inputs.expenses.admin_legal_marketing), opexFmt(oix?.admin_legal_marketing));
  addInputRow(ws, opexLabel("Contract Services", oix?.contract_services, "$/yr"), opexValue(oix?.contract_services, inputs.expenses.contract_services), opexFmt(oix?.contract_services));
  addInputRow(ws, opexLabel("Reserves", oix?.reserves, "$/unit/yr"), opexValue(oix?.reserves, inputs.expenses.reserves_per_unit), opexFmt(oix?.reserves));
  ws.addRow([]);

  addSectionHeader(ws, "Exit Assumptions", 5);
  addInputRow(ws, "Hold Period (Years)", inputs.exit.hold_period_years, NUMBER_FMT);
  addInputRow(ws, "Exit Cap Rate", inputs.exit.exit_cap_rate, PCT_FMT);
  addInputRow(ws, "Selling Cost Rate", inputs.exit.selling_cost_rate, PCT_FMT);
}

function buildMonthlySheet(
  wb: ExcelJS.Workbook,
  monthly: MonthlyRow[],
  holdYears: number
) {
  const ws = wb.addWorksheet("Monthly Pro Forma");
  const totalMonths = holdYears * 12;

  // Headers
  const headerLabels = ["Line Item"];
  for (let m = 1; m <= totalMonths; m++) {
    headerLabels.push(`Month ${m}`);
  }

  const headerRow = ws.addRow(headerLabels);
  styleHeaderRow(headerRow, headerLabels.length);

  // Set column widths
  ws.getColumn(1).width = 24;
  for (let i = 2; i <= totalMonths + 1; i++) {
    ws.getColumn(i).width = 12;
  }

  type LineItem = { label: string; getValue: (row: MonthlyRow) => number; negative?: boolean; bold?: boolean };

  const lineItems: LineItem[] = [
    { label: "Gross Potential Rent", getValue: r => r.gpr },
    { label: "Less: Vacancy", getValue: r => r.vacancy_loss, negative: true },
    { label: "Less: Bad Debt", getValue: r => r.bad_debt, negative: true },
    { label: "Less: Concessions", getValue: r => r.concessions, negative: true },
    { label: "Plus: Other Income", getValue: r => r.other_income },
    { label: "Effective Gross Income", getValue: r => r.egi, bold: true },
    // OpEx breakdown
    { label: "  Management Fees", getValue: r => r.opex_breakdown?.management_fees ?? 0, negative: true },
    { label: "  Payroll", getValue: r => r.opex_breakdown?.payroll ?? 0, negative: true },
    { label: "  Repairs & Maintenance", getValue: r => r.opex_breakdown?.repairs_maintenance ?? 0, negative: true },
    { label: "  Turnover", getValue: r => r.opex_breakdown?.turnover ?? 0, negative: true },
    { label: "  Insurance", getValue: r => r.opex_breakdown?.insurance ?? 0, negative: true },
    { label: "  Property Tax", getValue: r => r.opex_breakdown?.property_tax ?? 0, negative: true },
    { label: "  Utilities", getValue: r => r.opex_breakdown?.utilities ?? 0, negative: true },
    { label: "  Admin / Legal / Marketing", getValue: r => r.opex_breakdown?.admin_legal_marketing ?? 0, negative: true },
    { label: "  Contract Services", getValue: r => r.opex_breakdown?.contract_services ?? 0, negative: true },
    { label: "  Reserves", getValue: r => r.opex_breakdown?.reserves ?? 0, negative: true },
    { label: "Total Operating Expenses", getValue: r => r.total_opex, negative: true, bold: true },
    { label: "Net Operating Income", getValue: r => r.noi, bold: true },
    { label: "Less: Debt Service", getValue: r => r.debt_service, negative: true },
    { label: "Cash Flow before CapEx", getValue: r => r.cash_flow_before_capex, bold: true },
    { label: "Less: CapEx", getValue: r => r.capex, negative: true },
    { label: "Cash Flow (Before Taxes)", getValue: r => r.cash_flow, bold: true },
    { label: "Cumulative Cash Flow", getValue: r => r.cumulative_cash_flow },
  ];

  for (const item of lineItems) {
    const rowData: (string | number)[] = [item.label];
    for (let m = 0; m < totalMonths; m++) {
      const val = item.getValue(monthly[m]) ?? 0;
      rowData.push(item.negative ? -val : val);
    }
    const row = ws.addRow(rowData);

    // Style
    row.getCell(1).font = item.bold ? BOLD_FONT : NORMAL_FONT;
    for (let i = 2; i <= totalMonths + 1; i++) {
      row.getCell(i).numFmt = CURRENCY_FMT;
      row.getCell(i).font = item.bold ? BOLD_FONT : NORMAL_FONT;
      row.getCell(i).border = THIN_BORDER;
    }

    if (item.bold) {
      row.getCell(1).fill = LIGHT_FILL;
      for (let i = 2; i <= totalMonths + 1; i++) {
        row.getCell(i).fill = LIGHT_FILL;
      }
    }
  }
}

function buildAnnualSheet(
  wb: ExcelJS.Workbook,
  annual: AnnualSummary[],
  holdYears: number,
) {
  const ws = wb.addWorksheet("Annual Pro Forma");

  const headerLabels = ["Line Item"];
  for (let y = 1; y <= holdYears; y++) {
    headerLabels.push(`Year ${y}`);
  }

  const headerRow = ws.addRow(headerLabels);
  styleHeaderRow(headerRow, headerLabels.length);

  ws.getColumn(1).width = 28;
  for (let i = 2; i <= holdYears + 1; i++) {
    ws.getColumn(i).width = 16;
  }

  const lineItems: Array<{
    label: string;
    key: keyof AnnualSummary;
    negative?: boolean;
    bold?: boolean;
    pct?: boolean;
  }> = [
    { label: "Gross Potential Rent", key: "gpr" },
    { label: "Less: Vacancy", key: "vacancy_loss", negative: true },
    { label: "Less: Bad Debt", key: "bad_debt", negative: true },
    { label: "Less: Concessions", key: "concessions", negative: true },
    { label: "Plus: Other Income", key: "other_income" },
    { label: "Effective Gross Income", key: "egi", bold: true },
    { label: "Less: Operating Expenses", key: "total_opex", negative: true },
    { label: "Net Operating Income", key: "noi", bold: true },
    { label: "Less: Debt Service", key: "debt_service", negative: true },
    { label: "Cash Flow before CapEx", key: "cash_flow_before_capex", bold: true },
    { label: "Less: CapEx", key: "capex", negative: true },
    { label: "Cash Flow (Before Taxes)", key: "cash_flow", bold: true },
    { label: "Cumulative Cash Flow", key: "cumulative_cash_flow" },
    { label: "Cash-on-Cash Return", key: "cash_on_cash", pct: true },
  ];

  for (const item of lineItems) {
    const rowData: Array<string | number> = [item.label];

    for (let y = 0; y < holdYears; y++) {
      const yearData = annual[y];
      if (yearData) {
        const val = yearData[item.key] as number;
        rowData.push(item.negative ? -val : val);
      } else {
        rowData.push(0);
      }
    }

    const row = ws.addRow(rowData);
    row.getCell(1).font = item.bold ? BOLD_FONT : NORMAL_FONT;

    for (let i = 2; i <= holdYears + 1; i++) {
      const cell = row.getCell(i);
      cell.numFmt = item.pct ? PCT_FMT : CURRENCY_FMT;
      cell.font = item.bold ? BOLD_FONT : NORMAL_FONT;
      cell.border = THIN_BORDER;
    }

    if (item.bold) {
      for (let i = 1; i <= holdYears + 1; i++) {
        row.getCell(i).fill = LIGHT_FILL;
      }
    }
  }
}

function buildReturnsSheet(
  wb: ExcelJS.Workbook,
  result: UnderwritingResult,
) {
  const ws = wb.addWorksheet("Returns");
  ws.columns = [{ width: 28 }, { width: 18 }];
  const m = result.metrics;

  const totalCF = result.annual.reduce((s, a) => s + a.cash_flow, 0);
  const totalDistributions = totalCF + m.net_sale_proceeds;
  const equityMultiple = m.total_equity > 0 ? totalDistributions / m.total_equity : 0;

  addSectionHeader(ws, "Return Metrics", 2);

  addMetricRow(ws, "IRR", m.irr, PCT_FMT);
  addMetricRow(ws, "Equity Multiple", equityMultiple, MULT_FMT);
  addMetricRow(ws, "Average Cash-on-Cash", m.average_cash_on_cash, PCT_FMT);
  addMetricRow(ws, "Year 1 DSCR", m.year1_dscr, '0.00');
  addMetricRow(ws, "Going-In Cap Rate", m.going_in_cap, PCT_FMT);
  addMetricRow(ws, "Stabilized Cap Rate", m.stabilized_cap, PCT_FMT);
  ws.addRow([]);

  addSectionHeader(ws, "Cash Flow Summary", 2);

  addMetricRow(ws, "Total Equity Invested", m.total_equity, CURRENCY_FMT);
  addMetricRow(ws, "Total Cash Flow", totalCF, CURRENCY_FMT);
  addMetricRow(ws, "Net Sale Proceeds", m.net_sale_proceeds, CURRENCY_FMT);
  addMetricRow(ws, "Total Distributions", totalDistributions, CURRENCY_FMT);
  addMetricRow(ws, "Total Profit", m.total_profit, CURRENCY_FMT);

  ws.addRow([]);

  addSectionHeader(ws, "Annual Cash-on-Cash", 2);
  for (const a of result.annual) {
    const row = ws.addRow([`Year ${a.year}`]);
    row.getCell(1).font = NORMAL_FONT;
    row.getCell(2).value = a.cash_on_cash;
    row.getCell(2).numFmt = PCT_FMT;
    row.getCell(2).border = THIN_BORDER;
  }
}

function buildSensitivitySheet(
  wb: ExcelJS.Workbook,
  sensitivity: SensitivityCell[],
  basePurchasePrice: number
) {
  const ws = wb.addWorksheet("Sensitivity");
  ws.columns = [{ width: 18 }];

  const priceDeltas = [...new Set(sensitivity.map(s => s.purchase_price_delta))].sort((a, b) => a - b);
  const capRates = [...new Set(sensitivity.map(s => s.exit_cap_rate))].sort((a, b) => a - b);

  // Title
  const titleRow = ws.addRow(["IRR Sensitivity: Purchase Price vs Exit Cap Rate"]);
  titleRow.font = { bold: true, size: 12, color: { argb: "FF1E3A5F" } };
  ws.mergeCells(1, 1, 1, capRates.length + 1);
  ws.addRow([]);

  // Header row with cap rates
  const headerLabels = ["Purchase Price"];
  for (const cap of capRates) {
    headerLabels.push(`${(cap * 100).toFixed(1)}% Cap`);
    ws.getColumn(headerLabels.length).width = 14;
  }
  const headerRow = ws.addRow(headerLabels);
  styleHeaderRow(headerRow, headerLabels.length);

  // Data rows
  for (const delta of priceDeltas) {
    const price = basePurchasePrice * (1 + delta);
    const label = `$${(price / 1_000_000).toFixed(2)}M (${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}%)`;
    const rowData: Array<string | number> = [label];

    for (const cap of capRates) {
      const cell = sensitivity.find(
        s => Math.abs(s.purchase_price_delta - delta) < 0.001 &&
             Math.abs(s.exit_cap_rate - cap) < 0.001
      );
      rowData.push(cell?.irr ?? 0);
    }

    const row = ws.addRow(rowData);
    row.getCell(1).font = NORMAL_FONT;

    for (let i = 2; i <= capRates.length + 1; i++) {
      const cell = row.getCell(i);
      cell.numFmt = PCT_FMT;
      cell.border = THIN_BORDER;

      // Color-code
      const val = cell.value as number;
      if (typeof val === "number") {
        if (val >= 0.15) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
        } else if (val >= 0.08) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8D7DA" } };
        }
      }
    }

    // Highlight base case row
    if (Math.abs(delta) < 0.001) {
      row.getCell(1).font = BOLD_FONT;
    }
  }
}

function buildUnitMixSheet(wb: ExcelJS.Workbook, unitMix: ScenarioInputs["revenue"]["unit_mix"]) {
  const ws = wb.addWorksheet("Unit Mix");
  ws.columns = [
    { width: 16 }, { width: 10 }, { width: 14 },
    { width: 14 }, { width: 16 }, { width: 14 }, { width: 16 },
  ];

  const headerRow = ws.addRow([
    "Unit Type", "Count", "Current Rent", "Market Rent",
    "Reno Premium", "Renovated Rent", "Annual GPR",
  ]);
  styleHeaderRow(headerRow, 7);

  for (let i = 0; i < unitMix.length; i++) {
    const u = unitMix[i];
    const rowNum = i + 2;
    const row = ws.addRow([
      u.type,
      u.count,
      u.current_rent,
      u.market_rent,
      u.renovated_rent_premium,
    ]);

    // Renovated Rent = Market Rent + Premium (formula)
    row.getCell(6).value = { formula: `D${rowNum}+E${rowNum}` } as ExcelJS.CellFormulaValue;
    // Annual GPR = Count * Current Rent * 12 (formula)
    row.getCell(7).value = { formula: `B${rowNum}*C${rowNum}*12` } as ExcelJS.CellFormulaValue;

    for (let c = 2; c <= 7; c++) {
      row.getCell(c).numFmt = c === 2 ? NUMBER_FMT : CURRENCY_FMT;
      row.getCell(c).border = THIN_BORDER;
    }

  }

  // Totals row
  const totalRowNum = unitMix.length + 2;
  const totRow = ws.addRow(["TOTAL"]);
  totRow.getCell(1).font = BOLD_FONT;
  totRow.getCell(2).value = { formula: `SUM(B2:B${totalRowNum - 1})` } as ExcelJS.CellFormulaValue;
  totRow.getCell(2).numFmt = NUMBER_FMT;
  totRow.getCell(7).value = { formula: `SUM(G2:G${totalRowNum - 1})` } as ExcelJS.CellFormulaValue;
  totRow.getCell(7).numFmt = CURRENCY_FMT;

  for (let c = 1; c <= 7; c++) {
    totRow.getCell(c).font = BOLD_FONT;
    totRow.getCell(c).fill = LIGHT_FILL;
    totRow.getCell(c).border = THIN_BORDER;
  }
}

function buildCapexSheet(wb: ExcelJS.Workbook, capex: ScenarioInputs["capex"]) {
  const ws = wb.addWorksheet("CapEx Schedule");
  ws.columns = [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }];

  // Per-unit section
  addSectionHeader(ws, "Per-Unit Renovations", 5);
  const row2 = ws.addRow(["Cost per Unit", capex.per_unit_cost]);
  row2.getCell(2).numFmt = CURRENCY_FMT;
  const row3 = ws.addRow(["Units to Renovate", capex.units_to_renovate]);
  row3.getCell(2).numFmt = NUMBER_FMT;
  ws.addRow(["Start Month", capex.renovation_start_month || 1]);
  ws.addRow(["End Month", capex.renovation_end_month || capex.renovation_start_month || 1]);
  const span = Math.max(1, (capex.renovation_end_month || capex.renovation_start_month || 1) - (capex.renovation_start_month || 1) + 1);
  const upm = capex.units_to_renovate > 0 ? capex.units_to_renovate / span : 0;
  const upmRow = ws.addRow(["Units per Month (derived)", Math.round(upm * 10) / 10]);
  upmRow.getCell(2).numFmt = "#,##0.0";
  if (capex.renovation_downtime_enabled) {
    ws.addRow(["Renovation Downtime", `${capex.renovation_downtime_months || 1} mo/unit`]);
  }
  // Total per-unit CapEx (formula)
  const row5 = ws.addRow(["Total Per-Unit CapEx"]);
  row5.getCell(1).font = BOLD_FONT;
  row5.getCell(2).value = { formula: "B2*B3" } as ExcelJS.CellFormulaValue;
  row5.getCell(2).numFmt = CURRENCY_FMT;
  row5.getCell(2).font = BOLD_FONT;

  ws.addRow([]);
  ws.addRow([]);

  // Projects section
  addSectionHeader(ws, "Named Projects", 5);
  const projHeader = ws.addRow(["Project Name", "Cost", "Start Month", "Duration (Mo)", "Monthly Cost"]);
  styleHeaderRow(projHeader, 5);

  const projStartRow = ws.rowCount + 1;

  for (let i = 0; i < capex.projects.length; i++) {
    const p = capex.projects[i];
    const rowNum = projStartRow + i;
    const row = ws.addRow([p.name, p.cost, p.start_month, p.duration_months]);
    row.getCell(2).numFmt = CURRENCY_FMT;
    // Monthly cost = Cost / Duration (formula)
    row.getCell(5).value = { formula: `B${rowNum}/D${rowNum}` } as ExcelJS.CellFormulaValue;
    row.getCell(5).numFmt = CURRENCY_FMT;
    for (let c = 1; c <= 5; c++) {
      row.getCell(c).border = THIN_BORDER;
    }
  }

  if (capex.projects.length > 0) {
    const totalRow = ws.addRow(["TOTAL PROJECTS"]);
    totalRow.getCell(1).font = BOLD_FONT;
    const endRow = projStartRow + capex.projects.length - 1;
    totalRow.getCell(2).value = { formula: `SUM(B${projStartRow}:B${endRow})` } as ExcelJS.CellFormulaValue;
    totalRow.getCell(2).numFmt = CURRENCY_FMT;
    totalRow.getCell(2).font = BOLD_FONT;
    for (let c = 1; c <= 5; c++) {
      totalRow.getCell(c).fill = LIGHT_FILL;
      totalRow.getCell(c).border = THIN_BORDER;
    }
  }
}

function buildValidationSheet(wb: ExcelJS.Workbook, result: UnderwritingResult) {
  const ws = wb.addWorksheet("Validation");
  ws.columns = [{ width: 40 }, { width: 14 }, { width: 30 }];

  addSectionHeader(ws, "Audit Checks & Warnings", 3);

  const checks = ws.addRow(["Check", "Status", "Details"]);
  styleHeaderRow(checks, 3);

  const m = result.metrics;

  // Add validation rows
  addValidationRow(ws, "Going-In Cap Rate", m.going_in_cap >= 0.03 && m.going_in_cap <= 0.12, `${(m.going_in_cap * 100).toFixed(1)}% (target: 3-12%)`);
  addValidationRow(ws, "Year 1 DSCR", m.year1_dscr >= 1.0, `${m.year1_dscr.toFixed(2)} (min: 1.00)`);
  addValidationRow(ws, "Positive Cash Flow Year 1", result.annual.length > 0 && result.annual[0].cash_flow > 0, result.annual.length > 0 ? `$${Math.round(result.annual[0].cash_flow).toLocaleString()}` : "N/A");
  addValidationRow(ws, "IRR Calculated", m.irr !== null, m.irr !== null ? `${(m.irr * 100).toFixed(1)}%` : "Could not converge");
  addValidationRow(ws, "Equity Multiple > 1.0x", m.equity_multiple > 1.0, `${m.equity_multiple.toFixed(2)}x`);
  addValidationRow(ws, "Positive Net Sale Proceeds", m.net_sale_proceeds > 0, `$${Math.round(m.net_sale_proceeds).toLocaleString()}`);

  ws.addRow([]);

  // Warnings from the engine
  if (result.warnings.length > 0) {
    addSectionHeader(ws, "Engine Warnings", 3);
    for (const warning of result.warnings) {
      const row = ws.addRow([warning]);
      row.getCell(1).font = { ...NORMAL_FONT, color: { argb: "FFCC0000" } };
    }
  }
}

function buildDepreciationSheet(
  wb: ExcelJS.Workbook,
  inputs: ScenarioInputs,
  metrics: DealMetrics
) {
  const ws = wb.addWorksheet("Depreciation");
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }];

  const dep = metrics.depreciation!;
  const holdYears = inputs.exit.hold_period_years;

  addSectionHeader(ws, "Depreciation Analysis", 4);
  ws.addRow([]);

  addLabelValue(ws, "Purchase Price", metrics.purchase_price, CURRENCY_FMT);
  addLabelValue(ws, "% Land", dep.land_pct, PCT_FMT);
  addLabelValue(ws, "% Improvements", dep.improvement_pct, PCT_FMT);
  addLabelValue(ws, "Depreciable Basis", metrics.purchase_price * dep.improvement_pct, CURRENCY_FMT);
  ws.addRow([]);

  // Schedule headers
  const headerLabels = ["Year", "Straight-Line (27.5 yr)", "Accelerated (Cost Seg)", "Difference"];
  const headerRow = ws.addRow(headerLabels);
  styleHeaderRow(headerRow, 4);

  let cumSL = 0;
  let cumAccel = 0;

  for (let y = 1; y <= holdYears; y++) {
    const accelThisYear = y === 1 ? dep.accelerated_year1 : dep.accelerated_ongoing;
    cumSL += dep.straight_line_annual;
    cumAccel += accelThisYear;
    const row = ws.addRow([
      `Year ${y}`,
      dep.straight_line_annual,
      accelThisYear,
      accelThisYear - dep.straight_line_annual,
    ]);
    for (let c = 2; c <= 4; c++) {
      row.getCell(c).numFmt = CURRENCY_FMT;
      row.getCell(c).border = THIN_BORDER;
    }
  }

  // Totals
  const totRow = ws.addRow([
    `Total (${holdYears} yr)`,
    cumSL,
    cumAccel,
    cumAccel - cumSL,
  ]);
  for (let c = 1; c <= 4; c++) {
    totRow.getCell(c).font = BOLD_FONT;
    totRow.getCell(c).fill = LIGHT_FILL;
    totRow.getCell(c).border = THIN_BORDER;
  }
  for (let c = 2; c <= 4; c++) {
    totRow.getCell(c).numFmt = CURRENCY_FMT;
  }
}

// ─── Helper Functions ────────────────────────────────────────

function addSectionHeader(ws: ExcelJS.Worksheet, title: string, colspan: number) {
  const row = ws.addRow([title]);
  row.getCell(1).font = HEADER_FONT;
  row.getCell(1).fill = HEADER_FILL;
  if (colspan > 1) {
    for (let i = 2; i <= colspan; i++) {
      row.getCell(i).fill = HEADER_FILL;
    }
  }
}

function addLabelValue(ws: ExcelJS.Worksheet, label: string, value: string | number, fmt?: string) {
  const row = ws.addRow([label, value]);
  row.getCell(1).font = NORMAL_FONT;
  row.getCell(2).font = BOLD_FONT;
  if (fmt) row.getCell(2).numFmt = fmt;
  row.getCell(2).border = THIN_BORDER;
}

function addInputRow(ws: ExcelJS.Worksheet, label: string, value: number, fmt: string) {
  const row = ws.addRow([label, value]);
  row.getCell(1).font = NORMAL_FONT;
  row.getCell(2).font = BOLD_FONT;
  row.getCell(2).numFmt = fmt;
  row.getCell(2).border = THIN_BORDER;
  // Light yellow background to indicate editable input
  row.getCell(2).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFDE7" },
  };
}

function addMetricRow(ws: ExcelJS.Worksheet, label: string, value: number | null, fmt: string) {
  const row = ws.addRow([label, value ?? 0]);
  row.getCell(1).font = NORMAL_FONT;
  row.getCell(2).font = BOLD_FONT;
  row.getCell(2).numFmt = fmt;
  row.getCell(2).border = THIN_BORDER;
}

function addLabelValueWithHurdle(
  ws: ExcelJS.Worksheet, label: string, value: number, fmt: string,
  hurdle: number, higherIsBetter: boolean,
) {
  const row = ws.addRow([label, value]);
  row.getCell(1).font = NORMAL_FONT;
  row.getCell(2).font = BOLD_FONT;
  row.getCell(2).numFmt = fmt;
  row.getCell(2).border = THIN_BORDER;
  const meets = higherIsBetter ? value >= hurdle : value <= hurdle;
  row.getCell(2).fill = meets
    ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } }
    : { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8D7DA" } };
  row.getCell(3).value = hurdle;
  row.getCell(3).numFmt = fmt;
  row.getCell(3).font = NORMAL_FONT;
  row.getCell(3).border = THIN_BORDER;
  row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFDE7" } };
}

function addValidationRow(ws: ExcelJS.Worksheet, check: string, pass: boolean, details: string) {
  const row = ws.addRow([check, pass ? "PASS" : "FAIL", details]);
  row.getCell(1).font = NORMAL_FONT;
  row.getCell(2).font = { bold: true, color: { argb: pass ? "FF28A745" : "FFDC3545" } };
  row.getCell(2).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: pass ? "FFD4EDDA" : "FFF8D7DA" },
  };
  row.getCell(3).font = NORMAL_FONT;
  for (let c = 1; c <= 3; c++) {
    row.getCell(c).border = THIN_BORDER;
  }
}

function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
  for (let i = 1; i <= colCount; i++) {
    row.getCell(i).font = SUBHEADER_FONT;
    row.getCell(i).fill = SUBHEADER_FILL;
    row.getCell(i).border = THIN_BORDER;
  }
}

