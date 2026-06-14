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
import { computeReconciliationChecks, allChecksPass, exitMethodFor, exitEffectiveTaxRate, capexGuardrailWarning } from "./checks";
import type { ReconciliationCheck } from "./checks";

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

// Brand fonts (owner spec): numbers/calculations in DM Mono, row labels and
// descriptions in DM Sans, column/section headers in DM Serif Display.
// .xlsx cannot embed fonts — viewers without the DM family installed fall
// back to Excel's default.
const FONT_SERIF = "DM Serif Display";
const FONT_SANS = "DM Sans";
const FONT_MONO = "DM Mono";

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
  name: FONT_SERIF,
};

const SUBHEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 10,
  name: FONT_SERIF,
};

const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, name: FONT_SANS };
const NORMAL_FONT: Partial<ExcelJS.Font> = { size: 10, name: FONT_SANS };

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

  const reconChecks = computeReconciliationChecks(deal, inputs, result);
  buildSummarySheet(wb, deal, scenarioName, result, inputs, reconChecks);
  buildAssumptionsSheet(wb, inputs, result);
  buildMonthlySheet(wb, result.monthly, inputs.exit.hold_period_years);
  buildAnnualSheet(wb, result.annual, inputs.exit.hold_period_years);
  buildRentMatrixSheet(wb, result, inputs);
  buildReturnsSheet(wb, result);
  buildSensitivitySheet(wb, result.sensitivity, inputs.purchase.purchase_price);
  buildUnitMixSheet(wb, inputs.revenue.unit_mix);
  buildCapexSheet(wb, inputs.capex);
  if (result.metrics.depreciation) {
    buildDepreciationSheet(wb, inputs, result.metrics);
  }
  buildValidationSheet(wb, result, reconChecks, deal, inputs);
  if (result.tax && inputs.tax) {
    buildTaxSheet(wb, result.tax, inputs.tax);
  }
  if (result.property_tax_vectors && inputs.expenses.property_tax_v2) {
    buildTaxDetailSheet(wb, result, inputs);
  }
  buildReadmeSheet(wb);

  applyBrandFonts(wb);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Brand-font pass (owner spec): every cell that hasn't been explicitly
 * branded gets DM Mono if it holds a number/formula (calculations), DM Sans
 * otherwise (labels, descriptions). Headers keep DM Serif Display via their
 * explicitly-named font constants, which this pass skips.
 */
function applyBrandFonts(wb: ExcelJS.Workbook) {
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const existing = (cell.font ?? {}) as Partial<ExcelJS.Font>;
        const v = cell.value;
        const isNumeric =
          typeof v === "number" ||
          (v !== null && typeof v === "object" && "formula" in (v as unknown as Record<string, unknown>));
        if (isNumeric) {
          // Calculations always render in mono — overrides the sans constants
          // that double as value fonts at many call sites.
          cell.font = { ...existing, size: existing.size ?? 10, name: FONT_MONO };
        } else if (!existing.name) {
          // Unbranded text → sans. Serif headers / sans labels keep their name.
          cell.font = { ...existing, size: existing.size ?? 10, name: FONT_SANS };
        }
      });
    });
  });
}

// ─── Sheet Builders ──────────────────────────────────────────

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  deal: Deal,
  scenarioName: string,
  result: UnderwritingResult,
  inputs: ScenarioInputs,
  reconChecks: ReconciliationCheck[],
) {
  const ws = wb.addWorksheet("Summary");
  ws.columns = [{ width: 28 }, { width: 18 }, { width: 14 }, { width: 28 }, { width: 18 }];

  // Title
  const titleRow = ws.addRow(["Monument Equity — Deal Summary"]);
  titleRow.font = { bold: true, size: 14, color: { argb: "FF1E3A5F" }, name: FONT_SERIF };
  ws.mergeCells("A1:E1");

  // Checks banner (fix-spec Phase 3.2): one cell, watermark on failure.
  const checksOk = allChecksPass(reconChecks);
  const banner = ws.addRow([checksOk ? "ALL CHECKS PASS" : "DRAFT — CHECKS FAILED (see Validation sheet)"]);
  banner.getCell(1).font = { bold: true, size: 12, name: FONT_SERIF, color: { argb: checksOk ? "FF28A745" : "FFFFFFFF" } };
  if (!checksOk) {
    banner.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC3545" } };
  }
  ws.mergeCells(`A${banner.number}:E${banner.number}`);
  ws.addRow([]);

  // Deal Info
  addSectionHeader(ws, "Property Information", 5);
  addLabelValue(ws, "Address", `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`);
  addLabelValue(ws, "Units", deal.units, NUMBER_FMT);
  addLabelValue(ws, "Asking Price", deal.asking_price, CURRENCY_FMT);
  // Bid Price — read the SCENARIO bid (the one that drove this scenario's
  // purchase price), not the deal-level default which goes stale the moment
  // the bid is edited in the underwriting tab. Show it only when it differs
  // from the modeled purchase price; in the normal flow the bid IS the price.
  const scenarioBid = inputs.purchase.bid_price ?? deal.bid_price;
  if (scenarioBid && Math.abs(scenarioBid - inputs.purchase.purchase_price) >= 1) {
    addLabelValue(ws, "Bid Price (not the modeled price)", scenarioBid, CURRENCY_FMT);
  }
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
  addLabelValue(
    ws,
    m.loan_sizing_constraint === "dscr" ? "Loan Amount (sized by DSCR floor)" : "Loan Amount (sized by LTV)",
    m.loan_amount,
    CURRENCY_FMT,
  );
  if (m.loan_sizing_constraint === "dscr") {
    addLabelValue(ws, "LTV Proceeds (not funded)", m.ltv_loan_amount, CURRENCY_FMT);
  }
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

  // Exit Detail (fix-spec Phase 3.1) — makes the exit method legible so the
  // tax-loaded closed form can't be misread as a bug by an external reviewer.
  {
    ws.addRow([]);
    addSectionHeader(ws, "Exit Detail (method & reconciliation)", 5);
    const method = exitMethodFor(inputs);
    const lastA = result.annual[result.annual.length - 1];
    // m.exit_noi is the STABILIZED last-year NOI (non-recurring other income
    // excluded) — the figure the closed form actually capitalizes.
    const lastNOI = m.exit_noi;
    const rawLastNOI = lastA?.noi ?? 0;
    const lastTax = lastA?.opex_breakdown.property_tax ?? 0;
    const cap = inputs.exit.exit_cap_rate;
    const rate = exitEffectiveTaxRate(inputs);
    addLabelValue(ws, "Method", method === "tax_loaded" ? "Tax-loaded closed form" : method === "explicit_price" ? "Explicit sale price" : "Naive NOI ÷ cap");
    addLabelValue(ws, "Stabilized Last-Year NOI", lastNOI, CURRENCY_FMT);
    if (Math.abs(rawLastNOI - lastNOI) >= 1) {
      addLabelValue(ws, "  (excludes non-recurring other income)", rawLastNOI - lastNOI, CURRENCY_FMT);
    }
    addLabelValue(ws, "Last-Year Property Tax", lastTax, CURRENCY_FMT);
    if (method === "tax_loaded") {
      addLabelValue(ws, "NOI excluding tax", lastNOI + lastTax, CURRENCY_FMT);
      addLabelValue(ws, "Denominator = cap + tax rate", `${(cap * 100).toFixed(2)}% + ${(rate * 100).toFixed(2)}% = ${((cap + rate) * 100).toFixed(2)}%`);
      addLabelValue(ws, "Implied buyer tax at exit value", m.exit_value * rate, CURRENCY_FMT);
      addLabelValue(ws, "Implied buyer NOI (= exit × cap)", m.exit_value * cap, CURRENCY_FMT);
      addLabelValue(ws, "Naive NOI ÷ cap (for comparison only)", cap > 0 ? lastNOI / cap : 0, CURRENCY_FMT);
    } else if (method === "naive") {
      addLabelValue(ws, "Exit = last NOI ÷ cap", cap > 0 ? lastNOI / cap : 0, CURRENCY_FMT);
    }
  }

  // Metadata (fix-spec Phase 3.4)
  {
    ws.addRow([]);
    addSectionHeader(ws, "Export Metadata", 5);
    addLabelValue(ws, "Scenario", scenarioName);
    addLabelValue(ws, "Tax Scenario In Force", result.property_tax_vectors?.scenario_in_force ?? "legacy/none");
    addLabelValue(ws, "App Version (git)", process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev");
    addLabelValue(ws, "Generated", new Date().toISOString());
  }

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

  // Key Links — clickable hyperlinks pulled from the deal page
  {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${deal.address}, ${deal.city}, ${deal.state} ${deal.zip || ""}`.trim()
    )}`;
    const links: { label: string; url?: string }[] = [
      { label: "For-Sale Listing", url: deal.source_url },
      { label: "County Tax Records", url: deal.tax_record_url },
      { label: "Google Maps", url: mapsUrl },
    ];
    const present = links.filter((l): l is { label: string; url: string } => !!l.url);
    if (present.length > 0) {
      ws.addRow([]);
      addSectionHeader(ws, "Key Links", 5);
      for (const link of present) {
        const row = ws.addRow([link.label]);
        row.getCell(1).font = NORMAL_FONT;
        const cell = row.getCell(2);
        cell.value = { text: link.url, hyperlink: link.url };
        cell.font = { size: 10, name: FONT_SANS, color: { argb: "FF0563C1" }, underline: true };
      }
    }
  }
}

function buildAssumptionsSheet(wb: ExcelJS.Workbook, inputs: ScenarioInputs, result: UnderwritingResult) {
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

  // Itemized other income (FIX: itemized-other-income). Year-1 amounts and, for
  // RUBS lines, the implied recovery ratio against the utility expense.
  const oiDetail = result.other_income_detail;
  if (oiDetail) {
    addSectionHeader(ws, "Other Income — Itemized (Year 1)", 5);
    const hdr = ws.addRow(["Line", "Type", "Annual $", "Recovery / Recurring", "Source"]);
    styleHeaderRow(hdr, 5);
    for (const line of oiDetail.lines) {
      const recoveryCol = line.kind === "rubs"
        ? `${line.implied_recovery_ratio !== undefined ? (line.implied_recovery_ratio * 100).toFixed(0) + "% of " + (line.rubs_basis ?? "utilities_total").replace("utilities_", "") : "—"}${line.recurring ? "" : " · non-recurring"}`
        : (line.recurring ? "recurring" : "non-recurring");
      const row = ws.addRow([line.label || "(unlabeled)", line.kind.toUpperCase(), Math.round(line.annual_amount), recoveryCol, line.source_note ?? ""]);
      row.getCell(3).numFmt = CURRENCY_FMT;
    }
    const totalRow = ws.addRow(["Total Other Income", "", Math.round(oiDetail.total_annual), "", ""]);
    totalRow.getCell(1).font = { bold: true, name: FONT_SANS };
    totalRow.getCell(3).numFmt = CURRENCY_FMT;
    totalRow.getCell(3).font = { bold: true, name: FONT_MONO };
    const stabRow = ws.addRow(["Stabilized (recurring only — drives exit)", "", Math.round(oiDetail.stabilized_annual), "", ""]);
    stabRow.getCell(3).numFmt = CURRENCY_FMT;
    if (oiDetail.aggregate_recovery_ratio !== null) {
      const ratioRow = ws.addRow([
        "RUBS recovery vs utilities",
        "",
        "",
        `${(oiDetail.aggregate_recovery_ratio * 100).toFixed(0)}% (${Math.round(oiDetail.rubs_total_annual).toLocaleString()} / ${Math.round(oiDetail.utilities_annual).toLocaleString()})`,
        oiDetail.aggregate_recovery_ratio > 1.0 ? "gross-up — verify source" : "",
      ]);
      if (oiDetail.aggregate_recovery_ratio > 1.0) {
        ratioRow.getCell(4).font = { name: FONT_SANS, color: { argb: "FFB8860B" } };
      }
    }
    ws.addRow([]);
  }

  // Rent Ramp (Mark-to-Market) — surfaces phase-1 inputs only when enabled.
  const ramp = inputs.revenue.rent_ramp;
  if (ramp && ramp.enabled) {
    addSectionHeader(ws, "Rent Ramp (Mark-to-Market)", 5);
    addLabelValue(ws, "Mode", ramp.mode);
    addInputRow(ws, "Absorption Months", ramp.absorption_months, NUMBER_FMT);
    addInputRow(ws, "Turn Downtime (mo)", ramp.turn_downtime_months, NUMBER_FMT);
    if (ramp.max_turns_per_month !== undefined) {
      addInputRow(ws, "Max Turns / Month", ramp.max_turns_per_month, NUMBER_FMT);
    }
    if (ramp.initial_belowmarket_units !== undefined) {
      addInputRow(ws, "Below-Market Units (override)", ramp.initial_belowmarket_units, NUMBER_FMT);
    }
    if (ramp.initial_vacant_units !== undefined) {
      addInputRow(ws, "Vacant @ Acquisition", ramp.initial_vacant_units, NUMBER_FMT);
    }
    if (ramp.vacant_leaseup_months !== undefined) {
      addInputRow(ws, "Vacant Lease-Up (mo)", ramp.vacant_leaseup_months, NUMBER_FMT);
    }
    ws.addRow([]);
  }

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
    { label: "Total Operating Expenses", getValue: r => r.total_opex, negative: true, bold: true },
    { label: "Net Operating Income", getValue: r => r.noi, bold: true },
    { label: "Less: Debt Service", getValue: r => r.debt_service, negative: true },
    { label: "Cash Flow before CapEx & Reserves", getValue: r => r.cash_flow_before_capex_and_reserves, bold: true },
    { label: "Less: Reserves", getValue: r => r.reserves, negative: true },
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

  // % Marked-to-Market — appended as a separate row because it's a percentage,
  // not a currency value like the others above.
  {
    const rowData: (string | number)[] = ["% Marked-to-Market"];
    for (let m = 0; m < totalMonths; m++) {
      rowData.push(monthly[m]?.pct_marked_to_market ?? 0);
    }
    const row = ws.addRow(rowData);
    row.getCell(1).font = NORMAL_FONT;
    for (let i = 2; i <= totalMonths + 1; i++) {
      row.getCell(i).numFmt = PCT_FMT;
      row.getCell(i).font = NORMAL_FONT;
      row.getCell(i).border = THIN_BORDER;
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
    { label: "Cash Flow before CapEx & Reserves", key: "cash_flow_before_capex_and_reserves", bold: true },
    { label: "Less: Reserves", key: "reserves", negative: true },
    { label: "Less: CapEx", key: "capex", negative: true },
    { label: "Cash Flow (Before Taxes)", key: "cash_flow", bold: true },
    { label: "Cumulative Cash Flow", key: "cumulative_cash_flow" },
    { label: "Cap Rate", key: "cap_rate", pct: true },
    { label: "Cash-on-Cash Return", key: "cash_on_cash", pct: true },
    { label: "% Marked-to-Market", key: "pct_marked_to_market", pct: true },
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
    { width: 12 }, { width: 16 }, { width: 10 }, { width: 14 },
    { width: 14 }, { width: 16 }, { width: 14 }, { width: 16 },
  ];

  const headerRow = ws.addRow([
    "Unit", "Unit Type", "Count", "Current Rent", "Market Rent",
    "Reno Premium", "Renovated Rent", "Annual GPR",
  ]);
  styleHeaderRow(headerRow, 8);

  for (let i = 0; i < unitMix.length; i++) {
    const u = unitMix[i];
    const rowNum = i + 2;
    const row = ws.addRow([
      u.unit_number ?? "",
      u.type,
      u.count,
      u.current_rent,
      u.market_rent,
      u.renovated_rent_premium,
    ]);

    // Renovated Rent = Market Rent + Premium (col E + F)
    row.getCell(7).value = { formula: `E${rowNum}+F${rowNum}` } as ExcelJS.CellFormulaValue;
    // Annual GPR = Count * Current Rent * 12 (col C * D * 12)
    row.getCell(8).value = { formula: `C${rowNum}*D${rowNum}*12` } as ExcelJS.CellFormulaValue;

    for (let c = 3; c <= 8; c++) {
      row.getCell(c).numFmt = c === 3 ? NUMBER_FMT : CURRENCY_FMT;
      row.getCell(c).border = THIN_BORDER;
    }
    // Borders for Unit # and Unit Type label cells
    row.getCell(1).border = THIN_BORDER;
    row.getCell(2).border = THIN_BORDER;
  }

  // Totals row
  const totalRowNum = unitMix.length + 2;
  const totRow = ws.addRow(["", "TOTAL"]);
  totRow.getCell(2).font = BOLD_FONT;
  totRow.getCell(3).value = { formula: `SUM(C2:C${totalRowNum - 1})` } as ExcelJS.CellFormulaValue;
  totRow.getCell(3).numFmt = NUMBER_FMT;
  totRow.getCell(8).value = { formula: `SUM(H2:H${totalRowNum - 1})` } as ExcelJS.CellFormulaValue;
  totRow.getCell(8).numFmt = CURRENCY_FMT;

  for (let c = 1; c <= 8; c++) {
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

function buildValidationSheet(wb: ExcelJS.Workbook, result: UnderwritingResult, reconChecks: ReconciliationCheck[], deal: Deal, inputs: ScenarioInputs) {
  const ws = wb.addWorksheet("Validation");
  ws.columns = [{ width: 48 }, { width: 14 }, { width: 60 }];

  // Reconciliation tie-outs (fix-spec Phase 3.2) — each one recomputes a
  // model output a second way. These gate the ALL CHECKS PASS banner.
  addSectionHeader(ws, "Reconciliation Tie-Outs", 3);
  {
    const hdr = ws.addRow(["Check", "Status", "Details"]);
    styleHeaderRow(hdr, 3);
    for (const c of reconChecks) {
      addValidationRow(ws, `(${c.id}) ${c.name}`, c.pass, c.detail);
    }
    ws.addRow([]);
    const summary = ws.addRow([allChecksPass(reconChecks) ? "ALL CHECKS PASS" : "CHECKS FAILED — export watermarked DRAFT"]);
    summary.getCell(1).font = { bold: true, size: 11, name: FONT_SANS, color: { argb: allChecksPass(reconChecks) ? "FF28A745" : "FFDC3545" } };
  }
  ws.addRow([]);

  // CapEx guardrail (Phase 4.3) — advisory, does not gate ALL CHECKS PASS
  {
    const guard = capexGuardrailWarning(deal, inputs);
    if (guard) {
      addValidationRow(ws, "CapEx guardrail (PCA / deferred maintenance)", false, guard);
      ws.addRow([]);
    }
  }

  addSectionHeader(ws, "Range Sanity Checks", 3);

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

  // Bid vs Purchase consistency (FIX: bid-price desync). PASS when the scenario
  // bid equals the modeled purchase price (the normal flow), or no bid is set.
  // Otherwise WARN with both numbers — the model is driven by purchase price.
  {
    const bid = inputs.purchase.bid_price;
    if (bid && bid > 0) {
      const consistent = Math.abs(bid - inputs.purchase.purchase_price) < 1;
      addValidationRow(
        ws,
        "Bid vs Purchase consistency",
        consistent,
        consistent
          ? `bid = modeled purchase $${Math.round(inputs.purchase.purchase_price).toLocaleString()}`
          : `bid $${Math.round(bid).toLocaleString()} ≠ modeled purchase $${Math.round(inputs.purchase.purchase_price).toLocaleString()} — model uses purchase price`,
      );
    }
  }

  // Itemized other income tie-out (FIX: itemized-other-income): stabilized
  // other income must equal the sum of recurring line items (non-recurring
  // income is received in-period but excluded from the exit valuation).
  const oiDetail = result.other_income_detail;
  if (oiDetail) {
    const recurringSum = oiDetail.lines.filter((l) => l.recurring).reduce((s, l) => s + l.annual_amount, 0);
    const tie = Math.abs(oiDetail.stabilized_annual - recurringSum) < 1;
    addValidationRow(ws, "Stabilized other income = Σ recurring lines", tie, `stabilized $${Math.round(oiDetail.stabilized_annual).toLocaleString()} vs Σ recurring $${Math.round(recurringSum).toLocaleString()}`);
    const nonRecurring = oiDetail.total_annual - oiDetail.stabilized_annual;
    if (nonRecurring > 1) {
      addValidationRow(ws, "Non-recurring other income excluded from exit", true, `$${Math.round(nonRecurring).toLocaleString()}/yr in-period only`);
    }
  }

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

// ─── Read Me sheet ───────────────────────────────────────────
// Underwriting cheat sheet — benchmarks and methodology notes.
function buildReadmeSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Read Me");
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 28;
  ws.getColumn(4).width = 32;

  // Title
  const title = ws.addRow(["Monument Equity — Underwriting Read Me"]);
  title.getCell(1).font = { ...HEADER_FONT, size: 14 };
  title.getCell(1).fill = HEADER_FILL;
  ws.mergeCells(`A${title.number}:D${title.number}`);
  ws.addRow([]);

  const intro = ws.addRow([
    "This sheet collects benchmarks for sanity-checking your underwriting. Numbers are ranges, not rules. Use judgment, especially for older small multifamily in tertiary markets.",
  ]);
  intro.getCell(1).font = { ...NORMAL_FONT, italic: true };
  ws.mergeCells(`A${intro.number}:D${intro.number}`);
  intro.getCell(1).alignment = { wrapText: true };
  intro.height = 30;
  ws.addRow([]);

  // ─── Workbook guide ───
  addSectionHeader(ws, "How to read this workbook", 4);
  const sheets: [string, string][] = [
    ["Summary", "Top-line metrics: IRR, EM, CoC, DSCR, Cap Rates. Quickest sanity check."],
    ["Assumptions", "All inputs the engine used. Editable cells are highlighted."],
    ["Monthly Pro Forma", "Cash flow built up monthly: GPR → EGI → OpEx → NOI → Debt → Reserves → CapEx → CF."],
    ["Annual Pro Forma", "Same waterfall summed by year, with Cap Rate and Cash-on-Cash by year."],
    ["Returns", "Equity waterfall, IRR/EM by hurdle, sources & uses."],
    ["Sensitivity", "IRR / CoC under different exit cap and exit timing."],
    ["Unit Mix", "Per-unit-type rents (current, market, premium) and totals."],
    ["CapEx Schedule", "Per-unit renovation pacing, downtime, and project-level CapEx by month."],
    ["Depreciation", "Cost-seg breakdown if accelerated depreciation is configured."],
    ["Validation", "Engine self-checks: GPR + premium math, NOI = EGI - OpEx, CF = NOI - DS - Reserves - CapEx."],
    ["Tax (After-Tax)", "Only when Tax Treatment is enabled: dual federal/NY schedules, per-year tax or shield, both after-tax IRRs, deferred-gain memo. Estimate — not tax advice."],
  ];
  styleHeaderRow(ws.addRow(["Sheet", "What's on it"]), 2);
  for (const [name, desc] of sheets) {
    const r = ws.addRow([name, desc]);
    r.getCell(1).font = BOLD_FONT;
    r.getCell(2).font = NORMAL_FONT;
    r.getCell(2).alignment = { wrapText: true };
    r.getCell(1).border = THIN_BORDER;
    r.getCell(2).border = THIN_BORDER;
  }
  ws.addRow([]);

  // ─── Methodology notes ───
  addSectionHeader(ws, "Methodology notes", 4);
  const notes: string[] = [
    "Reserves sit BELOW NOI (institutional convention). NOI = EGI − operating opex (no reserves). Reserves and CapEx are capital outflows shown below the line, before final Cash Flow.",
    "Cap rates use NOI ÷ purchase price. Going-in = Year 1 NOI ÷ purchase price. Stabilized = end-of-hold NOI ÷ purchase price.",
    "Operating expense ratio (OpEx ÷ EGI) excludes reserves. Add reserves back if comparing to brokers or appraisers who include them above the line.",
    "Renovation rent ramp: unrenovated units pay the unrenovated basis (current/market). Renovated units pay the renovated basis (current/market + premium). Schedule is per-unit per CapEx assumptions.",
    "Turnover cost rate only multiplies per-unit inputs. If you entered Turnover Cost as a total annual figure, no rate is applied — the entered value IS the annual cost.",
    "After-tax (when Tax Treatment is on): TWO depreciation schedules — federal takes bonus on the 5-yr and 15-yr cost-seg buckets; NY adds bonus back. Federal loss × federal rate, NY loss × NY rate — never blended.",
    "ATCF PropCo = the property's after-tax cash flow with the management fee as a real expense (what a lender/buyer underwrites). ATCF Household = PropCo + the fee recycled back through OpCo minus payroll/SE leakage (what actually lands in the owner's pocket). Household drives decisions.",
    "REPS is attested PER YEAR. ON: losses offset W-2 (capped by §461(l); excess → NOL). OFF: losses suspend as PALs — and a 1031 exit does NOT release them.",
    "1031 exit: gain and recapture are DEFERRED, not eliminated — the deferred-gain memo carries into the replacement property as reduced basis.",
  ];
  for (const n of notes) {
    const r = ws.addRow(["• " + n]);
    r.getCell(1).font = NORMAL_FONT;
    r.getCell(1).alignment = { wrapText: true };
    ws.mergeCells(`A${r.number}:D${r.number}`);
    r.height = 30;
  }
  ws.addRow([]);

  // ─── NOI Margins ───
  addSectionHeader(ws, "NOI margin (NOI ÷ EGI) — typical ranges by property class & age", 4);
  styleHeaderRow(ws.addRow(["Class / Vintage", "Typical NOI Margin", "Notes"]), 3);
  const noiMargins: [string, string, string][] = [
    ["Class A — new construction (2010+)", "60% – 65%", "Lowest R&M, highest rents, on-site staff usually allocated efficiently."],
    ["Class B — 1990s–2000s", "50% – 58%", "Mid-tier most common in value-add. Margin depends on tax/insurance burden."],
    ["Class C — 1970s–1980s", "40% – 50%", "Older systems, higher R&M and turnover. Tax abatements (if any) widen this."],
    ["Older small multifamily (pre-1970, <50 units)", "35% – 45%", "Typical Monument Equity target zone — expect higher R&M, payroll efficiency penalty for small size."],
    ["Garden / suburban", "55% – 62%", "Generally healthier margin than urban high-rise of same class."],
    ["Urban mid/high-rise", "45% – 55%", "Heavier payroll (24/7 staffing), utilities, and management overhead."],
  ];
  for (const [c, m, n] of noiMargins) {
    const r = ws.addRow([c, m, n]);
    r.getCell(1).font = NORMAL_FONT;
    r.getCell(2).font = BOLD_FONT;
    r.getCell(3).font = { ...NORMAL_FONT, italic: true };
    r.getCell(3).alignment = { wrapText: true };
    for (let i = 1; i <= 3; i++) r.getCell(i).border = THIN_BORDER;
  }
  ws.addRow([]);

  // ─── Expense ratios ───
  addSectionHeader(ws, "Expense ratios — typical ranges by line item", 4);
  styleHeaderRow(ws.addRow(["Line Item", "% of EGI", "$ Range", "Notes"]), 4);
  const exp: [string, string, string, string][] = [
    ["Real Estate Tax", "8% – 15%", "Varies widely by state", "NJ/IL/TX high; many Southern states under 5%. Re-assessment risk on sale."],
    ["Insurance", "3% – 6%", "$250 – $500/unit/yr", "Rising fast post-2022. Hurricane states + wildfire states 2–3× this."],
    ["Management Fee", "3% – 5%", "% of EGI", "Institutional 3–4%, smaller deals 4–5%. Watch for floor minimum."],
    ["Repairs & Maintenance", "5% – 8%", "$400 – $700/unit/yr", "Older small MF often $600–$900. Include only routine — capital R&M goes in CapEx."],
    ["Payroll", "6% – 10%", "$700 – $1,500/unit/yr", "Highest at small/urban properties; near zero at sub-50-unit with off-site mgmt."],
    ["Utilities (landlord-paid)", "4% – 8%", "Varies by master-meter", "If submetered to tenants: ~0–2%. RUBS recovery typically nets 50–75%."],
    ["Marketing / Admin", "1% – 3%", "$100 – $300/unit/yr", "Lower at stabilized; higher during lease-up or reno."],
    ["Turnover Costs", "—", "$500 – $1,500/unit turn", "Cosmetic $200–$500; classic light reno $1,000–$1,500; full reno $5,000–$15,000."],
    ["Reserves (below NOI)", "—", "$250 – $400/unit/yr", "Agency standard $250–$300; bridge/value-add lenders often require $400+."],
  ];
  for (const [l, p, d, n] of exp) {
    const r = ws.addRow([l, p, d, n]);
    r.getCell(1).font = BOLD_FONT;
    r.getCell(2).font = NORMAL_FONT;
    r.getCell(3).font = NORMAL_FONT;
    r.getCell(4).font = { ...NORMAL_FONT, italic: true };
    r.getCell(4).alignment = { wrapText: true };
    for (let i = 1; i <= 4; i++) r.getCell(i).border = THIN_BORDER;
  }
  ws.addRow([]);

  // ─── DSCR benchmarks ───
  addSectionHeader(ws, "Debt Service Coverage Ratio (DSCR) — lender benchmarks", 4);
  styleHeaderRow(ws.addRow(["Loan Type", "Minimum DSCR", "Target DSCR", "Notes"]), 4);
  const dscr: [string, string, string, string][] = [
    ["Agency Permanent (Fannie/Freddie)", "1.20× – 1.25×", "1.30×+", "Tightest pricing. Year-1 actual; sometimes year-1 underwritten DSCR for new construction."],
    ["Bank Permanent (life co, regional bank)", "1.25× – 1.35×", "1.35×+", "Recourse may be required below 1.25×. Stress-test at +100–200 bps."],
    ["Bridge / Value-Add", "1.15× – 1.25×", "—", "Often IO during reno. Take-out DSCR (stabilized) is the binding constraint."],
    ["Construction Takeout", "1.30× – 1.40×", "1.40×+", "Lenders model stabilized year debt service at a stressed rate."],
    ["Owner conservative target", "1.35×+", "1.50×+", "Buffer for rate shock and lease-up risk. Critical for first-time syndicators."],
  ];
  for (const [l, min, tgt, n] of dscr) {
    const r = ws.addRow([l, min, tgt, n]);
    r.getCell(1).font = BOLD_FONT;
    r.getCell(2).font = NORMAL_FONT;
    r.getCell(3).font = NORMAL_FONT;
    r.getCell(4).font = { ...NORMAL_FONT, italic: true };
    r.getCell(4).alignment = { wrapText: true };
    for (let i = 1; i <= 4; i++) r.getCell(i).border = THIN_BORDER;
  }
  ws.addRow([]);

  // ─── Cap rate / IRR / EM benchmarks ───
  addSectionHeader(ws, "Return targets — by risk profile", 4);
  styleHeaderRow(ws.addRow(["Strategy", "Going-In Cap", "Levered IRR", "Equity Multiple (5–7 yr)"]), 4);
  const returns: [string, string, string, string][] = [
    ["Core — Class A stabilized", "4.5% – 5.5%", "8% – 11%", "1.6× – 1.8×"],
    ["Core-Plus — Class A/B light value-add", "5.0% – 6.0%", "11% – 14%", "1.8× – 2.0×"],
    ["Value-Add — Class B/C with reno", "5.5% – 7.0%", "14% – 18%", "1.9× – 2.2×"],
    ["Opportunistic — heavy lift / distressed", "6.5% – 8.0%+", "18%+", "2.0×+"],
    ["Small MF value-add (Monument zone)", "6.5% – 8.5%", "16% – 22%", "1.8× – 2.3×"],
  ];
  for (const [s, c, irr, em] of returns) {
    const r = ws.addRow([s, c, irr, em]);
    r.getCell(1).font = BOLD_FONT;
    for (let i = 2; i <= 4; i++) r.getCell(i).font = NORMAL_FONT;
    for (let i = 1; i <= 4; i++) r.getCell(i).border = THIN_BORDER;
  }
  ws.addRow([]);

  // Exit cap relationship
  const exitNote = ws.addRow([
    "Exit cap rate convention: budget 50 – 100 bps wider than going-in cap as a cushion for cap rate decompression. A flat or compressed exit cap is aggressive — flag it on review.",
  ]);
  exitNote.getCell(1).font = { ...NORMAL_FONT, italic: true };
  exitNote.getCell(1).alignment = { wrapText: true };
  ws.mergeCells(`A${exitNote.number}:D${exitNote.number}`);
  exitNote.height = 30;
  ws.addRow([]);

  // Sources footer
  const src = ws.addRow([
    "Sources: CBRE Investor Intentions Survey, Marcus & Millichap Multifamily Forecast, NMHC Industry Reports, GreenStreet Cap Rate data, Fannie Mae / Freddie Mac DUS guidelines, and syndicator playbooks. Refresh annually.",
  ]);
  src.getCell(1).font = { ...NORMAL_FONT, italic: true, color: { argb: "FF6C757D" } };
  src.getCell(1).alignment = { wrapText: true };
  ws.mergeCells(`A${src.number}:D${src.number}`);
  src.height = 30;
}

// ─── Tax Treatment sheet (TAX_TREATMENT_SPEC.md) ─────────────
// Only present when the scenario has tax assumptions. Estimate — not tax advice.
function buildTaxSheet(
  wb: ExcelJS.Workbook,
  tax: NonNullable<UnderwritingResult["tax"]>,
  assumptions: NonNullable<ScenarioInputs["tax"]>,
) {
  const ws = wb.addWorksheet("Tax (After-Tax)");
  ws.columns = [
    { width: 8 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 15 },
    { width: 16 }, { width: 16 }, { width: 12 }, { width: 15 }, { width: 16 },
  ];

  const title = ws.addRow(["After-Tax Analysis — estimate, not tax advice (1031 exit: taxes deferred, not eliminated)"]);
  title.getCell(1).font = { ...HEADER_FONT, size: 12 };
  title.getCell(1).fill = HEADER_FILL;
  ws.mergeCells(`A${title.number}:J${title.number}`);
  ws.addRow([]);

  addSectionHeader(ws, "Headline", 10);
  addMetricRow(ws, "Household After-Tax IRR (fee recycled)", tax.after_tax_irr_household, PCT_FMT);
  addMetricRow(ws, "PropCo After-Tax IRR (standalone)", tax.after_tax_irr_propco, PCT_FMT);
  addLabelValue(ws, "Year-1 Federal Shield", tax.year1_federal_shield, CURRENCY_FMT);
  addLabelValue(ws, "Year-1 NY Shield", tax.year1_state_shield, CURRENCY_FMT);
  addLabelValue(ws, "Deferred Gain at Exit (memo)", tax.deferred_gain_memo.deferred_gain, CURRENCY_FMT);
  addLabelValue(ws, "  — Accumulated Federal Depreciation", tax.deferred_gain_memo.accumulated_federal_depreciation, CURRENCY_FMT);
  addLabelValue(ws, "  — §1250 share (building + land impr.)", tax.deferred_gain_memo.sec1250_depreciation, CURRENCY_FMT);
  addLabelValue(ws, "  — §1245 share (personal property)", tax.deferred_gain_memo.sec1245_depreciation, CURRENCY_FMT);
  addLabelValue(ws, "Adjusted Basis at Exit", tax.deferred_gain_memo.adjusted_basis_at_exit, CURRENCY_FMT);
  if (tax.pal_carryforward_at_exit > 0) {
    addLabelValue(ws, "Suspended PALs at Exit (NOT released by 1031)", tax.pal_carryforward_at_exit, CURRENCY_FMT);
  }
  ws.addRow([]);

  addSectionHeader(ws, "Assumptions", 10);
  addInputRow(ws, "Federal Ordinary Rate", assumptions.federal_ordinary_rate, PCT_FMT);
  addInputRow(ws, "NY + NYC Ordinary Rate", assumptions.state_local_ordinary_rate, PCT_FMT);
  addInputRow(ws, "NIIT Rate", assumptions.niit_rate, PCT_FMT);
  addInputRow(ws, "§461(l) Cap (MFJ)", assumptions.ebl_cap_mfj, CURRENCY_FMT);
  addInputRow(ws, "Federal Bonus %", assumptions.federal_bonus_pct, PCT_FMT);
  addLabelValue(ws, "NY Conforms to Bonus", assumptions.state_conforms_bonus ? "Yes" : "No (bonus added back)");
  addInputRow(ws, "Land Allocation", assumptions.land_allocation_pct, PCT_FMT);
  addInputRow(ws, "5-yr Cost-Seg", assumptions.costseg_5yr_pct, PCT_FMT);
  addInputRow(ws, "15-yr Land Improvements", assumptions.costseg_15yr_pct, PCT_FMT);
  addInputRow(ws, "Reno 5-yr Share", assumptions.reno_5yr_pct, PCT_FMT);
  addInputRow(ws, "Repairs Expensed %", assumptions.reno_repairs_expensed_pct, PCT_FMT);
  addInputRow(ws, "OpCo Fee Leakage", assumptions.opco_fee_tax_rate, PCT_FMT);
  addLabelValue(ws, "Exit via 1031", assumptions.exit_via_1031 ? "Yes" : "No");
  ws.addRow([]);

  addSectionHeader(ws, "Per-Year Detail", 10);
  const hdr = ws.addRow([
    "Year", "REPS", "Fed Dep", "NY Dep", "Fed Taxable",
    "Fed Tax/(Shield)", "NY Tax/(Shield)", "NIIT", "ATCF PropCo", "ATCF Household",
  ]);
  styleHeaderRow(hdr, 10);
  for (const y of tax.years) {
    const row = ws.addRow([
      y.year,
      y.reps_on ? "ON" : "off",
      y.federal_depreciation,
      y.state_depreciation,
      y.federal_taxable_income,
      y.federal_tax,
      y.state_tax,
      y.niit,
      y.after_tax_cash_flow_propco,
      y.after_tax_cash_flow_household,
    ]);
    for (let c = 3; c <= 10; c++) {
      row.getCell(c).numFmt = CURRENCY_FMT;
      row.getCell(c).font = NORMAL_FONT;
      row.getCell(c).border = THIN_BORDER;
    }
    row.getCell(1).font = NORMAL_FONT;
    row.getCell(2).font = NORMAL_FONT;
  }
}

// ─── Rent Matrix sheet (fix-spec Phase 1.5) ──────────────────
// Rows = units, columns = months 1..min(36, hold). Cells show the scheduled
// rent (state rent × that month's growth factor); a state-code block follows.
// The GPR total row ties to the Monthly Pro Forma GPR row EXACTLY by
// construction — both read the same unit-state schedule.
const STATE_CODES: Record<string, string> = {
  in_place: "I",
  market: "M",
  renovated: "R",
  offline_turn: "T",
  offline_reno: "N",
  vacant_leaseup: "V",
};

function buildRentMatrixSheet(
  wb: ExcelJS.Workbook,
  result: UnderwritingResult,
  inputs: ScenarioInputs,
) {
  const sched = result.unit_schedule;
  if (!sched || sched.units.length === 0) return;
  const totalMonths = inputs.exit.hold_period_years * 12;
  const months = Math.min(36, totalMonths);
  const growth = (mIdx: number) =>
    Math.pow(1 + inputs.revenue.rent_growth_rate, Math.floor(mIdx / 12));

  const ws = wb.addWorksheet("Rent Matrix");
  ws.getColumn(1).width = 12;
  for (let i = 2; i <= months + 1; i++) ws.getColumn(i).width = 9;

  const hdr = ws.addRow(["Unit", ...Array.from({ length: months }, (_, i) => `M${i + 1}`)]);
  styleHeaderRow(hdr, months + 1);

  const rentFor = (u: (typeof sched.units)[number], mIdx: number): number => {
    const st = u.states[mIdx];
    const base =
      st === "in_place" ? u.in_place_rent :
      st === "market" ? u.market_rent :
      st === "renovated" ? u.renovated_rent : 0;
    return base * growth(mIdx);
  };

  for (const u of sched.units) {
    const row = ws.addRow([u.unit_id, ...Array.from({ length: months }, (_, i) => rentFor(u, i))]);
    row.getCell(1).font = NORMAL_FONT;
    for (let c = 2; c <= months + 1; c++) {
      row.getCell(c).numFmt = CURRENCY_FMT;
      row.getCell(c).border = THIN_BORDER;
    }
  }

  // GPR tie row — must equal the Monthly Pro Forma GPR exactly.
  const totalRow = ws.addRow([
    "GPR TOTAL",
    ...Array.from({ length: months }, (_, i) => sched.gprByMonth[i] * growth(i)),
  ]);
  for (let c = 1; c <= months + 1; c++) {
    totalRow.getCell(c).font = BOLD_FONT;
    totalRow.getCell(c).fill = LIGHT_FILL;
    totalRow.getCell(c).border = THIN_BORDER;
    if (c > 1) totalRow.getCell(c).numFmt = CURRENCY_FMT;
  }

  ws.addRow([]);
  const legendRow = ws.addRow([
    "States: I = in-place · M = market · R = renovated · T = turn downtime · N = reno downtime · V = vacant lease-up",
  ]);
  legendRow.getCell(1).font = { ...NORMAL_FONT, italic: true };
  ws.mergeCells(`A${legendRow.number}:${ws.getColumn(Math.min(12, months + 1)).letter}${legendRow.number}`);

  const stateHdr = ws.addRow(["Unit", ...Array.from({ length: months }, (_, i) => `M${i + 1}`)]);
  styleHeaderRow(stateHdr, months + 1);
  for (const u of sched.units) {
    const row = ws.addRow([u.unit_id, ...Array.from({ length: months }, (_, i) => STATE_CODES[u.states[i]] ?? "?")]);
    row.getCell(1).font = NORMAL_FONT;
    for (let c = 2; c <= months + 1; c++) {
      row.getCell(c).font = NORMAL_FONT;
      row.getCell(c).alignment = { horizontal: "center" };
      row.getCell(c).border = THIN_BORDER;
    }
  }
}

// ─── Tax Detail sheet (fix-spec Phase 3.3) ───────────────────
// Parcel metadata, the abatement record, all three scenario vectors by tax
// year, the scenario in force, and Ohio reappraisal/BOR notes.
function buildTaxDetailSheet(
  wb: ExcelJS.Workbook,
  result: UnderwritingResult,
  inputs: ScenarioInputs,
) {
  const v2 = inputs.expenses.property_tax_v2!;
  const vectors = result.property_tax_vectors!;
  const ws = wb.addWorksheet("Tax Detail");
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 30 }];

  addSectionHeader(ws, "Parcel", 5);
  addLabelValue(ws, "Parcel ID", v2.parcel?.parcel_id ?? "—");
  addLabelValue(ws, "Taxing District", v2.parcel?.taxing_district ?? "—");
  addLabelValue(ws, "Property Class", v2.parcel?.property_class ?? "—");
  addLabelValue(ws, "Effective Rate Source", v2.parcel?.effective_tax_rate_source ?? "—");
  addLabelValue(ws, "As Of", v2.parcel?.as_of_date ?? "—");
  addLabelValue(ws, "Auditor Permalink", v2.parcel?.auditor_permalink ?? "—");
  addLabelValue(ws, "Closing Date", v2.closing_date ?? "—");
  ws.addRow([]);

  if (v2.abatement) {
    addSectionHeader(ws, "Abatement Record", 5);
    addLabelValue(ws, "Program", v2.abatement.program ?? "—");
    addLabelValue(ws, "Abated Annual Tax", v2.abatement.abated_annual_tax, CURRENCY_FMT);
    addLabelValue(ws, "Unabated Annual Tax", v2.abatement.unabated_annual_tax, CURRENCY_FMT);
    addLabelValue(ws, "Final Abated Tax Year", v2.abatement.final_abated_tax_year);
    addLabelValue(ws, "Transferable", v2.abatement.transferable.toUpperCase());
    if (v2.abatement.notes) addLabelValue(ws, "Notes", v2.abatement.notes);
    ws.addRow([]);
  }

  addSectionHeader(ws, `Scenario Vectors — in force: ${vectors.scenario_in_force}`, 5);
  const hdr = ws.addRow(["Tax Year", "Abated, Transfers", "Abatement Lost", "Reassessed to Price", ""]);
  styleHeaderRow(hdr, 5);
  for (const r of vectors.rows) {
    const row = ws.addRow([r.tax_year, r.abated_transfers, r.abatement_lost, r.reassessed_to_price, ""]);
    for (let c = 2; c <= 4; c++) {
      row.getCell(c).numFmt = CURRENCY_FMT;
      row.getCell(c).border = THIN_BORDER;
    }
    row.getCell(1).border = THIN_BORDER;
  }
  ws.addRow([]);

  const notes = ws.addRow([
    "Reappraisal: Franklin County triennial update 2026, sexennial reappraisal 2029 (verify tentative values when posted). BOR complaint window: Jan 1 – Mar 31 of the year after the tax year. Default scenario rule: abatement_lost whenever the transfer is not CONFIRMED.",
  ]);
  notes.getCell(1).font = { ...NORMAL_FONT, italic: true };
  notes.getCell(1).alignment = { wrapText: true };
  ws.mergeCells(`A${notes.number}:E${notes.number}`);
  notes.height = 40;
}
