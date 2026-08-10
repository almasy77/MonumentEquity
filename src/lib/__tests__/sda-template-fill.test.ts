/**
 * SDA template-fill — verifies that injecting inputs into the real SDA template
 * (1) writes the target cells, (2) forces a recalc on open, (3) drops the stale
 * calc chain, and (4) preserves the template's advanced features (conditional
 * formatting, worksheets) byte-for-byte everywhere we didn't touch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { fillSdaTemplate } from "../sda-template-fill";
import { buildSdaWrites, orderScenariosForSda, type SdaScenarioColumnInput } from "../sda-fill-mapping";
import type { ScenarioInputs, UnderwritingResult } from "../underwriting";

const TEMPLATE = readFileSync(join(process.cwd(), "src/lib/sda/sda-template.xlsx"));

async function unzip(buf: Buffer) {
  return JSZip.loadAsync(buf);
}

describe("fillSdaTemplate — cell injection + fidelity", () => {
  it("writes numeric and string cells into the Scenarios sheet", async () => {
    const out = await fillSdaTemplate(TEMPLATE, [
      { sheet: "Scenarios", cells: { D6: 1_500_000, D8: 24, D3: "My Base Case" } },
    ]);
    const zip = await unzip(out);
    const xml = await zip.file("xl/worksheets/sheet3.xml")!.async("string");
    expect(xml).toContain("<v>1500000</v>");
    expect(xml).toContain("<v>24</v>");
    expect(xml).toContain("My Base Case"); // inline string
    // The style attribute on D6 must survive (formatting preserved).
    expect(/<c r="D6"[^>]*\bs="\d+"/.test(xml)).toBe(true);
  });

  it("forces full recalc on open and removes the calc chain", async () => {
    const out = await fillSdaTemplate(TEMPLATE, [{ sheet: "Summary", cells: { G3: 2 } }]);
    const zip = await unzip(out);
    const wb = await zip.file("xl/workbook.xml")!.async("string");
    expect(wb).toContain('fullCalcOnLoad="1"');
    expect(zip.file("xl/calcChain.xml")).toBeNull();
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).not.toContain("calcChain.xml");
  });

  it("preserves conditional formatting and all worksheets", async () => {
    const origZip = await unzip(TEMPLATE);
    const origSheets = Object.keys(origZip.files).filter((f) => /xl\/worksheets\/sheet\d+\.xml$/.test(f)).length;
    const origCf = (await origZip.file("xl/worksheets/sheet4.xml")!.async("string")).match(/<conditionalFormatting/g)?.length ?? 0;

    const out = await fillSdaTemplate(TEMPLATE, [{ sheet: "Summary", cells: { G3: 1 } }]);
    const zip = await unzip(out);
    const sheets = Object.keys(zip.files).filter((f) => /xl\/worksheets\/sheet\d+\.xml$/.test(f)).length;
    const cf = (await zip.file("xl/worksheets/sheet4.xml")!.async("string")).match(/<conditionalFormatting/g)?.length ?? 0;

    expect(sheets).toBe(origSheets);
    expect(cf).toBe(origCf);
    expect(origCf).toBeGreaterThan(0);
  });

  it("skips undefined values (leaves the template default) instead of crashing", async () => {
    const before = await (await unzip(TEMPLATE)).file("xl/worksheets/sheet6.xml")!.async("string");
    const f7Before = /<c r="F7"[^>]*>[\s\S]*?<\/c>/.exec(before)?.[0];
    // P&L!F7 undefined must not throw and must not change the cell.
    const out = await fillSdaTemplate(TEMPLATE, [{ sheet: "P&L", cells: { F7: undefined as unknown as number, F6: 0.03 } }]);
    const after = await (await unzip(out)).file("xl/worksheets/sheet6.xml")!.async("string");
    expect(/<c r="F7"[^>]*>[\s\S]*?<\/c>/.exec(after)?.[0]).toBe(f7Before); // unchanged
    expect(after).toContain("<v>0.03</v>"); // F6 still written
  });

  it("throws for an unknown worksheet name", async () => {
    await expect(fillSdaTemplate(TEMPLATE, [{ sheet: "Nope", cells: { A1: 1 } }])).rejects.toThrow(/worksheet/);
  });
});

// ── Mapping: build writes from scenario columns ──

function fakeColumn(name: string, type: SdaScenarioColumnInput["type"], overrides?: Partial<{ price: number; loan: number; goingIn: number }>): SdaScenarioColumnInput {
  const price = overrides?.price ?? 2_000_000;
  const loan = overrides?.loan ?? 1_500_000;
  const goingIn = overrides?.goingIn ?? 0.06;
  const inputs = {
    purchase: { closing_cost_mode: "rate", closing_cost_rate: 0.02 },
    financing: { io_period_months: 0, interest_rate: 0.055, amortization_years: 30, origination_fee_rate: 0.01 },
    revenue: { rent_growth_rate: 0.03 },
    expenses: { expense_escalation_rate: 0.02 },
    capex: {
      per_unit_cost: 5_000,
      units_to_renovate: 10,
      projects: [{ name: "Roof", cost: 40_000, enabled: true }],
      renovation_start_month: 1,
    },
    exit: { hold_period_years: 5, exit_cap_rate: 0.065, selling_cost_rate: 0.03 },
  } as unknown as ScenarioInputs;
  const result = {
    metrics: {
      purchase_price: price,
      loan_amount: loan,
      going_in_cap: goingIn,
      capex_reserve: 50_000,
      closing_costs: 60_000,
      origination_fee: loan * 0.01,
      cost_seg_study_cost: 0,
    },
    annual: [
      {
        gpr: 300_000,
        vacancy_loss: 15_000,
        bad_debt: 3_000,
        concessions: 2_000,
        other_income: 12_000,
        opex_breakdown: {
          management_fees: 12_000,
          payroll: 20_000,
          repairs_maintenance: 10_000,
          turnover: 4_000,
          insurance: 8_000,
          property_tax: 30_000,
          utilities: 15_000,
          admin_legal_marketing: 5_000,
          contract_services: 6_000,
        },
      },
    ],
  } as unknown as UnderwritingResult;
  return { name, type, inputs, result, units: 24 };
}

describe("buildSdaWrites — scenario → SDA cells", () => {
  it("orders scenarios to match the SDA column headers", () => {
    const ordered = orderScenariosForSda([
      { type: "renovation" as const },
      { type: "base" as const },
      { type: "marketing" as const },
      { type: "current" as const },
    ]);
    expect(ordered.map((s) => s.type)).toEqual(["marketing", "current", "base", "renovation"]);
  });

  it("maps the first scenario into column D and sets globals", () => {
    const cols = [fakeColumn("Marketing", "marketing"), fakeColumn("Base", "base", { goingIn: 0.058 })];
    const writes = buildSdaWrites(cols, 1); // active = Base (index 1)

    const scen = writes.find((w) => w.sheet === "Scenarios")!.cells;
    expect(scen.D6).toBe(2_000_000); // asking = purchase
    expect(scen.D8).toBe(24); // units
    expect(scen.D10).toBeCloseTo(1 - 1_500_000 / 2_000_000, 6); // down % → loan matches
    expect(scen.D14).toBe(5_000 * 10 + 40_000); // Repairs = per-unit reno + projects
    expect(scen.D15).toBe(50_000); // Operating Reserves ← capex_reserve (was hardcoded 0)
    expect(scen.D21).toBe(300_000); // GPR
    expect(scen.D22).toBe(-15_000); // vacancy (negative dollars)
    expect(scen.D35).toBe(30_000); // Real Estate Taxes ← property_tax
    expect(scen.AE42).toBe(0); // phantom reserve killed
    // Second column lands in G.
    expect(scen.G6).toBe(2_000_000);

    const summary = writes.find((w) => w.sheet === "Summary")!.cells;
    expect(summary.G3).toBe(2); // active index 1 → scenario #2
    expect(summary.C19).toBe(0); // no acquisition fee (app doesn't model one)
    expect(summary.D41).toBe(1); // member equity 100% → SDA returns == project returns

    const exit = writes.find((w) => w.sheet === "Exit Strategy")!.cells;
    expect(exit.D5).toBe(5); // sale year
    expect(exit.G13).toBe(0.03); // selling cost rate
    // capBump solves (exit 6.5% − goingIn 5.8%) / 5 years.
    expect(exit.I9).toBeCloseTo((0.065 - 0.058) / 5, 6);

    const acq = writes.find((w) => w.sheet === "Acquisition Costs")!.cells;
    expect(acq.C23).toBe(0.01); // origination fee rate
    expect(acq.D13).toBe(60_000); // flat-rate closing → single labeled line = m.closing_costs
    expect(acq.B13).toBe("Estimated Closing Costs");

    const pnl = writes.find((w) => w.sheet === "P&L")!.cells;
    expect(pnl.F6).toBe(0.03); // rent growth
    expect(pnl.F7).toBe(0.02); // expense growth
  });

  it("itemizes closing costs when the scenario itemizes, footing to the app total", () => {
    const col = fakeColumn("Base", "base");
    (col.inputs.purchase as unknown as Record<string, unknown>).closing_cost_mode = "itemized";
    (col.inputs.purchase as unknown as Record<string, unknown>).closing_cost_breakdown = {
      title_insurance: 10_000,
      legal_fees: 8_000,
      property_costs: 5_000,
      prorations: 4_000,
      third_party_reports: 3_000,
      transfer_taxes: 6_000,
      reserves_escrow: 2_000,
      other_closing: 1_000,
    };
    const acq = buildSdaWrites([col], 0).find((w) => w.sheet === "Acquisition Costs")!.cells;
    expect(acq.D28).toBe(10_000); // title
    expect(acq.D13).toBe(8_000); // legal
    expect(acq.D31).toBe(6_000); // transfer taxes
    // The mapped lines sum to the app's total closing.
    const sum = ["D13", "D18", "D19", "D28", "D31", "D38", "D39", "D48"].reduce((s, k) => s + (acq[k] as number), 0);
    expect(sum).toBe(39_000);
  });
});
