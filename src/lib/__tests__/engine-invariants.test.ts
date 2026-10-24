/**
 * Engine invariants — cross-cutting identities that MUST hold for any valid scenario,
 * checked against every golden fixture under a matrix of feature toggles (refi, capex
 * loan holdback, auto operating reserve, high LTV, each DSCR sizing basis, each exit
 * method). These are relationships the math guarantees regardless of inputs — NOI =
 * EGI − opex, the cash-flow waterfall, monthly→annual aggregation, the equity-multiple
 * and profit identities, IRR reconstructed from the documented flow stream, the exit
 * value tie, sensitivity-grid center-cell reconciliation, and tax recapture/PAL sanity.
 * A failure here means a calculation regressed, not that a number changed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { calculateAnnualXIRR } from "../irr";

const GOLDENS = ["bryden_base", "fifth_st_tax_phasein", "mobile_drive_likely"];
function load(n: string): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", `${n}.input.json`), "utf8")) as ScenarioInputs;
}
function clone(i: ScenarioInputs): ScenarioInputs { return JSON.parse(JSON.stringify(i)); }

function checkIdentities(label: string, inputs: ScenarioInputs): string[] {
  const r = calculateUnderwriting(inputs);
  const m = r.metrics;
  const price = inputs.purchase.purchase_price;
  const p: string[] = [];
  const ex = inputs.exit as unknown as { refi_enabled?: boolean; refi_year?: number; selling_cost_rate?: number; exit_cap_rate?: number; exit_method?: string; sale_price?: number };
  const holdback = (inputs.capex as unknown as { capex_funding?: { mode?: string } }).capex_funding?.mode === "loan_holdback";

  r.annual.forEach((a, y) => {
    if (Math.abs(a.noi - (a.egi - a.total_opex)) > 1) p.push(`${label} Y${y + 1} NOI!=EGI-opex`);
    // annual cash flow must equal the sum of its monthly rows (aggregation identity)
    const monthlySum = r.monthly.slice(y * 12, y * 12 + 12).reduce((s, mo) => s + mo.cash_flow, 0);
    if (Math.abs(a.cash_flow - monthlySum) > 2) p.push(`${label} Y${y + 1} annual!=sum(monthly) cf=${a.cash_flow.toFixed(0)} sum=${monthlySum.toFixed(0)}`);
    // field-level waterfall (no-holdback: capex fully equity-funded)
    if (!holdback) {
      const exp = a.noi - a.debt_service - (a.reserves ?? 0) - (a.capital_reserve ?? 0) - (a.capex ?? 0);
      if (Math.abs(a.cash_flow - exp) > 2) p.push(`${label} Y${y + 1} CF waterfall off cf=${a.cash_flow.toFixed(0)} exp=${exp.toFixed(0)}`);
    }
    if (price > 0 && Math.abs(a.cap_rate - a.noi / price) > 1e-6) p.push(`${label} Y${y + 1} cap_rate!=noi/price`);
    if ((a.loss_to_lease ?? 0) < -1) p.push(`${label} Y${y + 1} loss_to_lease<0`);
    // EGI decomposition: egi = gpr - vacancy - bad debt - concessions + other income
    const egiExp = (a.gpr ?? 0) - (a.vacancy_loss ?? 0) - (a.bad_debt ?? 0) - (a.concessions ?? 0) + (a.other_income ?? 0);
    if (Math.abs(a.egi - egiExp) > 2) p.push(`${label} Y${y + 1} EGI decomp off egi=${a.egi.toFixed(0)} exp=${egiExp.toFixed(0)}`);
    if ((a.vacancy_loss ?? 0) < -1 || (a.bad_debt ?? 0) < -1) p.push(`${label} Y${y + 1} negative vacancy/baddebt`);
  });
  // pct_marked_to_market is a share in [0,1]; it may dip during reno/turn downtime,
  // but net absorption over the hold should be non-negative (ends >= it starts).
  for (const mo of r.monthly) {
    if ((mo.pct_marked_to_market ?? 0) < -1e-9 || (mo.pct_marked_to_market ?? 0) > 1 + 1e-9) { p.push(`${label} pct_marked_to_market out of [0,1]`); break; }
  }
  if (r.monthly.length > 1 && (r.monthly[r.monthly.length - 1].pct_marked_to_market ?? 0) < (r.monthly[0].pct_marked_to_market ?? 0) - 1e-9) {
    p.push(`${label} net de-leased over hold`);
  }
  if (price > 0) {
    if (Math.abs(m.going_in_cap - r.annual[0].noi / price) > 1e-9) p.push(`${label} going_in_cap`);
    if (Math.abs(m.stabilized_cap - r.annual[r.annual.length - 1].noi / price) > 1e-9) p.push(`${label} stabilized_cap`);
  }
  if (r.annual[0].debt_service > 0 && Math.abs(m.year1_dscr - r.annual[0].noi / r.annual[0].debt_service) > 1e-6) p.push(`${label} year1_dscr`);
  if (m.total_equity_invested < m.total_equity - 1) p.push(`${label} invested<equity`);
  if (m.peak_equity < m.total_equity - 1) p.push(`${label} peak<equity`);
  if (m.total_equity_invested > 0) {
    const emId = 1 + m.total_profit / m.total_equity_invested;
    if (Math.abs(m.equity_multiple - emId) > 1e-4) p.push(`${label} EM!=1+profit/inv ${m.equity_multiple.toFixed(4)} vs ${emId.toFixed(4)}`);
  }
  // exit value tie — ONLY when the plain method is forced (auto mode tax-loads in
  // reassessment jurisdictions, which lowers exit value by design; that's P2-4).
  if (!ex.sale_price && ex.exit_method === "noi_over_cap" && (ex.exit_cap_rate ?? 0) > 0) {
    const impliedExit = m.exit_noi / (ex.exit_cap_rate as number);
    if (Math.abs(m.exit_value - impliedExit) / Math.max(1, m.exit_value) > 1e-6) p.push(`${label} exit_value!=noi/cap ${m.exit_value.toFixed(0)} vs ${impliedExit.toFixed(0)}`);
  }
  // IRR reconstruction from the engine's documented flow stream (refi-aware)
  const flows = [-m.total_equity, ...r.annual.map((a) => a.cash_flow)];
  flows[flows.length - 1] += m.net_sale_proceeds + m.return_of_operating_reserve;
  if (ex.refi_enabled && ex.refi_year) flows[ex.refi_year] += m.refi_net_proceeds;
  const reIrr = calculateAnnualXIRR(flows);
  if (m.irr != null && reIrr != null && Math.abs((m.irr as number) - reIrr) > 1e-4) p.push(`${label} IRR reconstruct engine=${((m.irr as number) * 100).toFixed(3)}% rebuilt=${(reIrr * 100).toFixed(3)}%`);
  // profit/cashReturned identity
  const opDist = r.annual.reduce((s, a) => s + Math.max(0, a.cash_flow), 0);
  const cashReturned = opDist + m.net_sale_proceeds + m.return_of_operating_reserve + (ex.refi_enabled ? m.refi_net_proceeds : 0);
  if (Math.abs(m.total_profit - (cashReturned - m.total_equity_invested)) > 2) p.push(`${label} profit identity ${m.total_profit.toFixed(0)} vs ${(cashReturned - m.total_equity_invested).toFixed(0)}`);
  // sensitivity grid center cell should reconcile to the headline IRR
  const center = (r.sensitivity ?? []).find((c) => c.purchase_price_delta === 0 && Math.abs((c.exit_cap_rate ?? 0) - (ex.exit_cap_rate ?? 0)) < 1e-9);
  if (center && center.irr != null && m.irr != null && Math.abs((center.irr as number) - (m.irr as number)) > 0.02) {
    p.push(`${label} sensitivity center ${((center.irr as number) * 100).toFixed(2)}% vs headline ${((m.irr as number) * 100).toFixed(2)}%`);
  }
  // tax sanity
  if (r.tax) {
    const t = r.tax as unknown as { years: Array<{ federal_taxable_income: number; accumulated_federal_depreciation: number; pal_carryforward: number }>; exit_tax?: { sec1245_recapture: number; sec1250_unrecaptured: number; total_exit_tax: number; after_tax_net_sale_proceeds: number }; after_tax_irr_propco: number | null };
    if (t.years.length !== inputs.exit.hold_period_years) p.push(`${label} tax years ${t.years.length} != hold ${inputs.exit.hold_period_years}`);
    let prevAcc = 0;
    t.years.forEach((ty, y) => {
      if (!Number.isFinite(ty.federal_taxable_income)) p.push(`${label} Y${y + 1} non-finite taxable income`);
      if (ty.accumulated_federal_depreciation < prevAcc - 1) p.push(`${label} Y${y + 1} accumulated depreciation decreased`);
      prevAcc = ty.accumulated_federal_depreciation;
      if (ty.pal_carryforward < -1) p.push(`${label} Y${y + 1} negative PAL carryforward`);
    });
    if (t.exit_tax) {
      const et = t.exit_tax;
      if (et.sec1245_recapture < -1) p.push(`${label} negative §1245 recapture`);
      if (et.sec1250_unrecaptured < -1) p.push(`${label} negative §1250 unrecaptured`);
      if (et.total_exit_tax < -1) p.push(`${label} negative total exit tax (should floor at 0)`);
      if (Math.abs(et.after_tax_net_sale_proceeds - (m.net_sale_proceeds - et.total_exit_tax)) > 2) p.push(`${label} after-tax sale proceeds != netSale - exitTax`);
    }
    if (t.after_tax_irr_propco != null && !Number.isFinite(t.after_tax_irr_propco)) p.push(`${label} non-finite after-tax IRR`);
  }
  return p;
}

describe("QA identity battery across toggles", () => {
  for (const name of GOLDENS) {
    it(name, () => {
      const base = load(name);
      const all: string[] = [];
      all.push(...checkIdentities(`${name}/base`, base));

      const refi = clone(base);
      const ex = refi.exit as unknown as Record<string, unknown>;
      if ((base.exit.hold_period_years ?? 0) >= 3) {
        ex.refi_enabled = true; ex.refi_year = 2; ex.refi_cap_rate = base.exit.exit_cap_rate; ex.refi_ltv = 0.65;
        all.push(...checkIdentities(`${name}/refi`, refi));
      }

      const hb = clone(base);
      (hb.capex as unknown as Record<string, unknown>).capex_funding = { mode: "loan_holdback", holdback_pct: 1 };
      all.push(...checkIdentities(`${name}/holdback`, hb));

      const auto = clone(base);
      auto.purchase.operating_reserve_mode = "auto"; auto.purchase.operating_reserve_months = 6;
      all.push(...checkIdentities(`${name}/autoReserve`, auto));

      const hiltv = clone(base);
      hiltv.financing.ltv = 0.9;
      all.push(...checkIdentities(`${name}/ltv90`, hiltv));

      for (const basis of ["in_place", "year1_projected", "manual"] as const) {
        const d = clone(base);
        d.financing.dscr_sizing_basis = basis;
        if (basis === "manual") d.financing.manual_sizing_noi = 100_000;
        all.push(...checkIdentities(`${name}/dscr:${basis}`, d));
      }

      for (const method of ["noi_over_cap", "tax_loaded"] as const) {
        const d = clone(base);
        (d.exit as unknown as Record<string, unknown>).exit_method = method;
        all.push(...checkIdentities(`${name}/exit:${method}`, d));
      }

      expect(all, `\n  ${all.join("\n  ")}\n`).toEqual([]);
    });
  }

  it("robustness: degenerate inputs do not NaN or throw", () => {
    const problems: string[] = [];
    // 100% vacancy
    const vac = load("bryden_base");
    vac.revenue.vacancy_rate = 1;
    const rv = calculateUnderwriting(vac);
    rv.annual.forEach((a, y) => { if (!Number.isFinite(a.noi) || !Number.isFinite(a.cash_flow)) problems.push(`vac Y${y + 1} non-finite`); });
    if (!Number.isFinite(rv.metrics.total_equity)) problems.push(`vac non-finite equity`);
    // zero exit cap (guard) — should not crash; exit value 0
    const zc = load("bryden_base");
    (zc.exit as unknown as Record<string, unknown>).exit_cap_rate = 0;
    const rz = calculateUnderwriting(zc);
    if (!Number.isFinite(rz.metrics.net_sale_proceeds)) problems.push(`zeroCap non-finite net sale`);
    // zero LTV (all cash)
    const ac = load("bryden_base");
    ac.financing.ltv = 0; ac.financing.size_to_dscr = false;
    const ra = calculateUnderwriting(ac);
    ra.annual.forEach((a, y) => { if (Math.abs(a.debt_service) > 1) problems.push(`allCash Y${y + 1} has debt service ${a.debt_service}`); });
    if (ra.metrics.year1_dscr !== 0 && !Number.isFinite(ra.metrics.year1_dscr)) problems.push(`allCash non-finite DSCR`);
    expect(problems, `\n  ${problems.join("\n  ")}\n`).toEqual([]);
  });
});
