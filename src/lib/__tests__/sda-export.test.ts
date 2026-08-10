/**
 * SDA export — adapter mapping + end-to-end workbook generation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { buildSyndicationInput, generateSdaWorkbook, defaultSyndicationAssumptions } from "../sda-export";
import type { Deal } from "../validations";

function bryden(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}
const DEAL = { id: "d1", address: "1650 Bryden Rd", city: "Columbus", state: "OH", units: 12, asking_price: 1_000_000 } as unknown as Deal;

describe("buildSyndicationInput (adapter)", () => {
  const inputs = bryden();
  const result = calculateUnderwriting(inputs);
  const a = defaultSyndicationAssumptions();
  const syn = buildSyndicationInput(inputs, result, a);

  it("LP capital = total equity + acquisition fee", () => {
    const acqFee = a.acquisition_fee_pct * inputs.purchase.purchase_price;
    expect(syn.initial_lp_capital).toBeCloseTo(result.metrics.total_equity + acqFee, 2);
  });

  it("one operating year per hold year, with EGI and distributable CF", () => {
    expect(syn.years).toHaveLength(inputs.exit.hold_period_years);
    expect(syn.years[0].egi).toBeCloseTo(result.annual[0].egi, 2);
    expect(syn.years[0].distributable_cash_flow).toBeCloseTo(result.annual[0].cash_flow_before_capex, 2);
  });

  it("net sale equity includes the returned operating reserve", () => {
    expect(syn.net_sale_equity).toBeCloseTo(
      result.metrics.net_sale_proceeds + (result.metrics.return_of_operating_reserve ?? 0),
      2,
    );
    expect(syn.sale_year).toBe(inputs.exit.hold_period_years);
  });
});

describe("generateSdaWorkbook (end-to-end)", () => {
  it("produces a valid workbook with the SDA sheets and finite headline returns", async () => {
    const inputs = bryden();
    const result = calculateUnderwriting(inputs);
    const buffer = await generateSdaWorkbook(DEAL, "Base Case", inputs, result);
    expect(buffer.length).toBeGreaterThan(1000);

    const wb = new ExcelJS.Workbook();
    // Cast to load's exact param type — avoids a cross-version @types/node
    // Buffer<ArrayBufferLike> vs Buffer<ArrayBuffer> mismatch (CI vs local).
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(["Summary", "P&L", "Exit Strategy", "Returns", "One Pager"]);

    // The P&L waterfall rows exist and the cash-flow-for-distribution row is populated.
    const pnl = wb.getWorksheet("P&L")!;
    let foundDistrib = false;
    pnl.eachRow((row) => {
      if (String(row.getCell(1).value ?? "").includes("Total Distributions to Members")) {
        foundDistrib = true;
        const y1 = Number(row.getCell(2).value);
        expect(Number.isFinite(y1)).toBe(true);
      }
    });
    expect(foundDistrib).toBe(true);

    // Returns sheet carries a finite IRR / equity multiple.
    const returns = wb.getWorksheet("Returns")!;
    let foundEm = false;
    returns.eachRow((row) => {
      if (String(row.getCell(1).value ?? "") === "Equity Multiple") {
        foundEm = true;
        expect(Number.isFinite(Number(row.getCell(4).value))).toBe(true);
      }
    });
    expect(foundEm).toBe(true);
  });
});
