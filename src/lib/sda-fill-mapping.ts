/**
 * Maps the app's deal + scenarios into the SDA template's input cells.
 *
 * The SDA is driven by its "Scenarios" sheet: each of the 8 built-in columns
 * (D, G, J, M, P, S, V, Y) is an independent mini-underwrite, and `Summary!G3`
 * selects which one feeds the detailed P&L / Returns / Exit / One-Pager sheets via
 * `CHOOSE(...)`. A handful of inputs are single-deal (not per-column) and live on the
 * Summary, Exit Strategy, and Acquisition Costs sheets — those are driven by the
 * active scenario.
 *
 * This module is intentionally exhaustive: every SDA *input* cell is either mapped to
 * a specific source in our underwriting or deliberately left at its template default
 * (documented inline). The SDA applies its own annual escalators across the 10-year
 * P&L, so we feed year-1 (pre-growth) figures and set the escalators; year 1 matches
 * the app exactly and later years track the same growth assumptions.
 *
 * Known modeling differences the SDA's structure can't represent exactly:
 *  - Rehab is funded UP FRONT as member capital in the SDA (Summary!D22), whereas the
 *    app spreads renovation across the hold. We put the app's total rehab into the
 *    SDA's Repairs input so the capital is represented; returns will differ where a
 *    deal has large rehab.
 *  - The SDA uses ONE expense escalator; the app escalates property taxes separately
 *    (and can model a reassessment). Year 1 matches; later-year taxes may drift.
 *  - The "Investor Returns" waterfall (member/manager split, preferred return) is a
 *    syndication structure the app doesn't model. We set the member split to 100%
 *    (so the SDA's investor returns equal the app's project-level returns) and leave
 *    preferred return / fees at 0. Set these on the Summary tab to model an actual raise.
 */
import type { ScenarioInputs, UnderwritingResult, CapexAssumptions } from "./underwriting";
import { getRenovationLines, applyCapexToggles } from "./underwriting";
import type { ScenarioType } from "./constants";
import type { SdaSheetWrite, SdaCellValue } from "./sda-template-fill";

/** Investor-returns waterfall inputs (from the scenario's Syndication card). */
export interface SdaSyndicationInputs {
  lp_equity_pct?: number;
  preferred_return_rate?: number;
  acquisition_fee_pct?: number;
  asset_management_fee_pct?: number;
  capital_transaction_fee_pct?: number;
}

export interface SdaScenarioColumnInput {
  name: string;
  type: ScenarioType;
  inputs: ScenarioInputs;
  result: UnderwritingResult;
  units: number;
  syndication?: SdaSyndicationInputs;
}

/** Deal-level info for the One Pager header (not per-scenario). */
export interface SdaDealInfo {
  propertyName?: string;
  location?: string; // "City, ST"
  yearBuilt?: number;
}

// The four scenario input columns on the SDA "Scenarios" sheet.
const COLS = ["D", "G", "J", "M"] as const;

/**
 * Order scenarios to match the SDA's four column headers
 * (Marketing Package → My Version → Projected → Offer), then anything else.
 */
export function orderScenariosForSda<T extends { type: ScenarioType }>(scenarios: T[]): T[] {
  const priority: Record<string, number> = { marketing: 0, current: 1, base: 2, renovation: 3 };
  return [...scenarios].sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9));
}

/**
 * Total up-front rehab the app models for a scenario: per-unit renovation lines
 * (cost × units) plus named capital projects. Mirrors the engine's `totalCapex`
 * (underwriting.ts) and respects the enable/disable toggles.
 */
export function totalRehabSpend(capex: CapexAssumptions): number {
  const c = applyCapexToggles(capex);
  const lines = getRenovationLines(c).reduce((s, l) => s + (l.per_unit_cost || 0) * (l.units_to_renovate || 0), 0);
  const projects = (c.projects || []).reduce((s, p) => s + (p.cost || 0), 0);
  return lines + projects;
}

/** True when the scenario itemizes closing costs (vs. a flat % of price). */
function isItemizedClosing(inputs: ScenarioInputs): boolean {
  const p = inputs.purchase as unknown as { closing_cost_mode?: string; closing_cost_breakdown?: Record<string, number> };
  return p.closing_cost_mode === "itemized" && !!p.closing_cost_breakdown;
}

/**
 * Build the Acquisition-Costs writes so the sheet's total (D51 → Summary!D18) equals
 * the app's closing costs, itemized when the app itemizes. Origination is added as a
 * rate in C23 (the SDA computes it off its own loan amount). Cost-seg study fee, when
 * present, rides in the "Other Costs" line so total member capital ties out.
 */
function buildAcquisitionCosts(active: SdaScenarioColumnInput): Record<string, SdaCellValue> {
  const m = active.result.metrics;
  const p = active.inputs.purchase as unknown as {
    closing_cost_breakdown?: Record<string, number>;
    cost_seg_study_cost?: number;
  };
  const costSeg = m.cost_seg_study_cost || p.cost_seg_study_cost || 0;
  const cells: Record<string, SdaCellValue> = {
    // 1st-mortgage origination fee as a % of the loan (SDA: D23 = C23 × Summary!D10).
    C23: active.inputs.financing.origination_fee_rate || 0,
  };

  if (isItemizedClosing(active.inputs) && p.closing_cost_breakdown) {
    // Map each breakdown field to the SDA line it belongs on; every one of these
    // funnels into the D51 total, so the sum equals the app's closing costs.
    const b = p.closing_cost_breakdown;
    cells["D13"] = b.legal_fees || 0; // Legal Fees (LLC, PPM)
    cells["D18"] = b.third_party_reports || 0; // EDR / environmental / PCA
    cells["D19"] = b.property_costs || 0; // Appraisal / survey / inspections
    cells["D28"] = b.title_insurance || 0; // Title Policy
    cells["D31"] = b.transfer_taxes || 0; // Transfer Taxes
    cells["D39"] = b.prorations || 0; // Prepaid taxes/insurance escrow
    cells["D38"] = b.reserves_escrow || 0; // Lender-held reserves
    cells["D48"] = (b.other_closing || 0) + costSeg; // Other (+ cost-seg study)
  } else {
    // Flat-rate closing: a single, clearly-labeled line that foots to D51.
    cells["B13"] = "Estimated Closing Costs";
    cells["D13"] = (m.closing_costs || 0) + costSeg;
  }
  return cells;
}

/**
 * Which pro-forma year to feed the SDA's single income column. The SDA is a
 * STABILIZED model — one income year grown over the hold; it cannot represent a
 * lease-up ramp. So for a deal that leases up (loss to lease in early years, or a
 * sub-coverage operating shortfall), feeding Year 1 would make the SDA compound
 * the lease-up hole. Feed the first STABILIZED year instead (ramp complete, debt
 * covered); the lease-up carry is separately funded by the operating reserve
 * (row 15), which is already in the SDA's uses of funds. A deal that is
 * stabilized from Year 1 returns annual[0] unchanged.
 */
type SdaAnnual = SdaScenarioColumnInput["result"]["annual"][number];
export function pickSdaBaseYear(result: SdaScenarioColumnInput["result"]): { year: SdaAnnual; index: number } {
  const annual = result.annual;
  const shortfall = (result.metrics as { operating_shortfall_total?: number }).operating_shortfall_total ?? 0;
  const hasLeaseUp = shortfall > 0 || annual.some((a) => ((a as { loss_to_lease?: number }).loss_to_lease ?? 0) > 0.005);
  if (!hasLeaseUp) return { year: annual[0], index: 0 };
  const idx = annual.findIndex(
    (a) => ((a as { loss_to_lease?: number }).loss_to_lease ?? 0) <= 0.005 && (a.cash_flow_before_capex_and_reserves ?? 0) >= 0,
  );
  const index = idx >= 0 ? idx : annual.length - 1;
  return { year: annual[index], index };
}

/**
 * SDA-9: reasons a scenario must not be written into the SDA. A negative (or
 * zero) going-in NOI or a negative cap rate makes the SDA's FMV = NOI/cap and its
 * returns nonsensical — a negative-NOI Base Case otherwise reports a positive IRR
 * and a >1x equity multiple. The exporter flags such a column and skips its
 * numeric writes rather than presenting fabricated returns.
 */
export function sdaExportBlockers(result: SdaScenarioColumnInput["result"]): string[] {
  const issues: string[] = [];
  const stab = pickSdaBaseYear(result).year;
  if ((stab.noi ?? 0) <= 0) issues.push("stabilized NOI is not positive");
  const cap = (result.metrics as { stabilized_cap?: number }).stabilized_cap ?? result.metrics.going_in_cap;
  if (cap < 0) issues.push("cap rate is negative");
  return issues;
}

/** Build all input-cell writes for the SDA template from the ordered scenario columns. */
export function buildSdaWrites(columns: SdaScenarioColumnInput[], activeIndex: number, deal?: SdaDealInfo): SdaSheetWrite[] {
  const cols = columns.slice(0, 4);
  const active = cols[activeIndex] ?? cols[0];

  // ── Per-scenario columns (Scenarios sheet) ──
  const scenarioCells: Record<string, SdaCellValue> = {};
  cols.forEach((col, i) => {
    const L = COLS[i];
    const m = col.result.metrics;
    // SDA-9: never write a broken scenario's numbers (they produce fabricated
    // returns). Flag the column header and skip its numeric cells.
    const blockers = sdaExportBlockers(col.result);
    if (blockers.length > 0) {
      scenarioCells[`${L}3`] = `${col.name} — NOT SDA-SAFE: ${blockers.join("; ")}`;
      return;
    }
    // SDA is stabilized-basis: feed the stabilized year for a lease-up deal (see
    // pickSdaBaseYear), not the Year-1 hole. Stabilized deals feed Year 1 as before.
    const a0 = pickSdaBaseYear(col.result).year;
    const ob = a0.opex_breakdown;
    const price = m.purchase_price;
    const units = col.units || 1;
    const downFrac = price > 0 ? Math.max(0, Math.min(1, 1 - m.loan_amount / price)) : 0.25;

    Object.assign(scenarioCells, {
      [`${L}3`]: col.name, // column header label
      // Acquisition
      [`${L}6`]: price, // Asking Price
      [`${L}7`]: price, // Purchase (override the copy-forward formula)
      [`${L}8`]: units, // # Units
      [`${L}10`]: downFrac, // Down payment %  →  loan = price − down = m.loan_amount
      [`${L}12`]: col.inputs.financing.io_period_months ?? 0, // Interest Only (months)
      [`${L}14`]: totalRehabSpend(col.inputs.capex), // Repairs (total up-front rehab)
      [`${L}15`]: m.capex_reserve || 0, // Operating Reserves (up-front reserve at close)
      // (row 16 "Estimated closing costs" is a formula → Summary!D18; set globally below)
      // Income (year 1, pre-growth)
      [`${L}21`]: a0.gpr, // Gross Potential Rent
      [`${L}22`]: -a0.vacancy_loss, // − Vacancy (dollars; the sheet derives the %)
      [`${L}23`]: -(a0.bad_debt + a0.concessions), // − Concessions / Loss-to-Lease / Bad Debt
      [`${L}25`]: a0.other_income, // Other Income
      // Operating expenses (rows 29–41) from our opex breakdown; these nine lines sum
      // to our total operating expenses. Unmapped SDA lines stay 0.
      [`${L}29`]: 0, // Advertising
      [`${L}30`]: ob.contract_services, // Contract Services
      [`${L}31`]: ob.utilities, // Gas & Electric (all utilities)
      [`${L}32`]: ob.admin_legal_marketing, // General / Admin
      [`${L}33`]: ob.insurance, // Insurance
      [`${L}34`]: 0, // Legal
      [`${L}35`]: ob.property_tax, // Real Estate Taxes
      [`${L}36`]: 0, // Trash Removal
      [`${L}37`]: ob.management_fees, // Management Fee
      [`${L}38`]: ob.payroll, // Payroll
      [`${L}39`]: ob.repairs_maintenance, // Repairs & Maintenance
      [`${L}40`]: ob.turnover, // Turnover
      [`${L}41`]: 0, // Water & Sewer
      // Debt + valuation
      [`${L}53`]: col.inputs.financing.interest_rate, // Interest Rate
      [`${L}54`]: col.inputs.financing.amortization_years, // Amortization (years)
      // Market Cap Rate (row 60) drives both the going-in FMV cell and the exit
      // base. Use the STABILIZED cap, not the Year-1 going-in cap: the SDA is fed
      // stabilized income (pickSdaBaseYear), and on a lease-up deal the Year-1
      // going-in cap is computed on depressed lease-up NOI (~1.4% on 4443), which
      // would value stabilized NOI absurdly. Stabilized cap == going-in cap for a
      // deal that's stabilized from day 1.
      [`${L}60`]: m.stabilized_cap ?? m.going_in_cap,
    });

    // CRITICAL: the P&L reads vacancy and concessions as a PERCENT of GPR from a
    // per-column helper (Summary!C27/C28 → cols F/I/L/O rows 22/23), NOT the dollar
    // cell. In column D the % is derived from the dollar, but in columns G/J/M the %
    // is the input and the dollar derives from it — so we must set the % helper for
    // every column, or the P&L uses the template's default 10% / 5% whenever a
    // non-first scenario is active. Set both (they're consistent) for robustness.
    const pctCol = ["F", "I", "L", "O"][i];
    scenarioCells[`${pctCol}22`] = a0.gpr > 0 ? a0.vacancy_loss / a0.gpr : 0; // vacancy %
    scenarioCells[`${pctCol}23`] = a0.gpr > 0 ? (a0.bad_debt + a0.concessions) / a0.gpr : 0; // concessions %
    // Management fee is also modeled as a PERCENT (of income): the P&L computes it as
    // E27×D16 where E27 = CHOOSE(...F37/I37/L37/O37). Same column-2-4 default trap, so
    // set the % helper = mgmt$/EGI. (It then scales correctly across the P&L years.)
    scenarioCells[`${pctCol}37`] = a0.egi > 0 ? ob.management_fees / a0.egi : 0; // management fee %
  });

  // Replacement/capital reserves (SDA-2). Our engine deducts reserves BELOW NOI
  // (a capital item); the SDA deducts its row-42 reserve ABOVE NOI (in opex). If
  // we zero row 42 to make SDA NOI match ours, the SDA's cash-flow-for-
  // distribution then skips the reserve entirely and overstates CoC / IRR (the
  // 08-12 export ran ~2x CoC, +175bps IRR vs the engine). We instead write the
  // reserve to row 42 so the SDA's DISTRIBUTION ties to ours. Consequence, by
  // design: SDA NOI now sits below engine NOI by the annual reserve. We lump the
  // replacement AND capital reserve into this one line (the SDA has a single
  // reserve row); both are below-NOI in our model, so both belong in the SDA's
  // distribution deduction. Driven by the ACTIVE scenario's stabilized year
  // since row 42 is a single global $/unit assumption, not per-column.
  // SDA-11: use the engine's UNESCALATED base reserve (Year-1 replacement +
  // capital), not the stabilized/escalated year — otherwise "same inputs" isn't
  // literally true. 4443: $500/unit×24 + $7,500 = $19,500 = $812.50/unit (was
  // reading the Year-3 escalated $832.70/unit off the SDA's fed year).
  const activeUnits = active.units || 1;
  const y1Reserve = active.result.annual[0];
  const activeAnnualReserve = (y1Reserve.reserves ?? 0) + (y1Reserve.capital_reserve ?? 0);
  scenarioCells["AE42"] = activeUnits > 0 ? activeAnnualReserve / activeUnits : 0; // $/unit/yr

  // Target Rent Analysis (Scenarios AC8:AH14) — a standalone rent-roll reference on
  // the Scenarios tab (not wired into the model's GPR). Populate it from the active
  // scenario's unit mix so it shows the real rent roll instead of "Unit type" / $0
  // placeholders. AF/AH (totals) are formulas (avg × units); we only set the inputs.
  const unitMix = ((active.inputs.revenue as { unit_mix?: Array<{ type?: string; count?: number; current_rent?: number; market_rent?: number; renovated_rent_premium?: number }> }).unit_mix) ?? [];
  unitMix.slice(0, 7).forEach((u, i) => {
    const row = 8 + i;
    scenarioCells[`AC${row}`] = u.type ?? "Unit type"; // Type
    scenarioCells[`AD${row}`] = u.count ?? 0; // # Units
    scenarioCells[`AE${row}`] = u.current_rent ?? 0; // Current Rent (avg $/mo)
    // Target = market rent (or current + renovated premium when market isn't set).
    scenarioCells[`AG${row}`] = u.market_rent ?? ((u.current_rent ?? 0) + (u.renovated_rent_premium ?? 0));
  });

  // ── Global knobs, driven by the active scenario ──
  const am = active.result.metrics;
  const ax = active.inputs.exit;
  const hold = ax.hold_period_years;
  // Exit cap (SDA-1). Row 60 carries the STABILIZED cap (it also drives the going-in
  // FMV cell). The SDA reaches the EXIT cap via a per-year escalator: exit cap =
  // row60 + var_capRateBump * sale-year, so bump = (exit - stabilized) / hold. This
  // MUST be allowed to go NEGATIVE — underwriting to a lower exit cap than the
  // stabilized cap is cap COMPRESSION, and the old Math.max(0, ...) clamp silently
  // forced the SDA to exit at the stabilized cap (7.96% instead of 6.5% on 4443),
  // overstating the exit and the returns. No clamp: the SDA exits at the true cap.
  const sdaCap = am.stabilized_cap ?? am.going_in_cap;
  const capBump = hold > 0 ? (ax.exit_cap_rate - sdaCap) / hold : 0;

  // Investor-returns waterfall from the active scenario's Syndication card. When a
  // field is unset we default to a 100%-owner model (member equity 100%, no pref/fees),
  // so the SDA's investor returns equal our project-level returns until a raise is modeled.
  const syn = active.syndication ?? {};
  const summaryCells: Record<string, SdaCellValue> = {
    G3: activeIndex + 1, // "Populate with scenario #"
    C19: syn.acquisition_fee_pct ?? 0, // Acquisition Fee (% of purchase price)
    D41: syn.lp_equity_pct ?? 1, // Member Equity (members' share; Manager Equity D42 = 1 − this)
    D43: syn.preferred_return_rate ?? 0, // Preferred Return to Members
    D44: syn.asset_management_fee_pct ?? 0, // Asset Management Fee
    D45: syn.capital_transaction_fee_pct ?? 0, // Capital Transaction Fee to Mgr
  };

  // Exit Strategy: sale year, exit-cap escalation, selling cost, and (optional) refi.
  const exitCells: Record<string, SdaCellValue> = {
    D5: hold, // Sale / Disposition at end of year
    I9: capBump, // Cap-rate increase per year (var_capRateBump); exit cap = going-in + bump × years
    G13: ax.selling_cost_rate, // Sales Cost % (override the template's 3/4% rule)
  };
  if (ax.refi_enabled && ax.refi_year && ax.refi_year < hold) {
    exitCells["D4"] = ax.refi_year; // Cash-Out Re-Finance at end of year
    if (ax.refi_ltv != null) exitCells["D11"] = ax.refi_ltv; // Re-Finance LTV
    if (ax.refi_interest_rate != null) exitCells["D12"] = ax.refi_interest_rate; // Re-Fi Interest Rate
    if (ax.refi_amortization_years != null) exitCells["D13"] = ax.refi_amortization_years; // Re-Fi Amortization
    if (ax.refi_io_months != null) exitCells["D14"] = ax.refi_io_months; // Re-Fi Interest-Only months
    if (ax.refi_cost_rate != null) exitCells["C16"] = ax.refi_cost_rate; // Re-Finance Costs %
  }

  const pnlCells: Record<string, SdaCellValue> = {
    F6: active.inputs.revenue.rent_growth_rate, // Annual Income Escalator (Yr2+; later years inherit)
    F7: active.inputs.expenses.expense_escalation_rate, // Annual Expense Escalator
  };

  // One Pager — the only inputs are the deal header (D4/D5/D6); everything else is
  // formulas pulling from Summary/P&L/Returns/Exit. Merged cells: write the anchor.
  const onePagerCells: Record<string, SdaCellValue> = {
    D4: deal?.propertyName ?? "", // Property Name
    D5: deal?.location ?? "", // City, State
    D6: deal?.yearBuilt ?? 0, // Year Built
  };

  // Repairs detail tab — the app doesn't itemize interior/exterior, so we put the
  // active scenario's total rehab on one interior line (relabeled) with 0 contingency.
  // This makes Repairs!E17/E35 equal the total, so the One Pager's renovation
  // breakdown (which reads Repairs!E17/E30/E34) foots instead of showing 0.
  const rehabTotal = totalRehabSpend(active.inputs.capex);
  const repairsCells: Record<string, SdaCellValue> = {
    B4: "Renovation (from underwriting)",
    C4: rehabTotal, // cost
    D4: 1, // × units → E4 = rehabTotal
    D34: 0, // contingency % off (the app's total already includes contingency)
  };

  // 2-Minute Analysis — a rough back-of-envelope screen. Feed the active scenario's
  // stabilized income, vacancy, expense ratio, and going-in cap (stabilized year
  // for a lease-up deal, Year 1 otherwise — see pickSdaBaseYear).
  const a0 = pickSdaBaseYear(active.result).year;
  const twoMinCells: Record<string, SdaCellValue> = {
    C4: a0.gpr, // Gross Potential Annual Income
    C5: a0.gpr > 0 ? a0.vacancy_loss / a0.gpr : 0, // vacancy %
    C8: a0.egi > 0 ? a0.total_opex / a0.egi : 0, // expense ratio
    C12: am.stabilized_cap ?? am.going_in_cap, // Market Cap Rate (stabilized basis)
  };

  return [
    { sheet: "Scenarios", cells: scenarioCells },
    { sheet: "Summary", cells: summaryCells },
    { sheet: "Exit Strategy", cells: exitCells },
    { sheet: "Acquisition Costs", cells: buildAcquisitionCosts(active) },
    { sheet: "P&L", cells: pnlCells },
    { sheet: "One Pager", cells: onePagerCells },
    { sheet: "Repairs", cells: repairsCells },
    { sheet: "2-Minute Analysis", cells: twoMinCells },
  ];
}
