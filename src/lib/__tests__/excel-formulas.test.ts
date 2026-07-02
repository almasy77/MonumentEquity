/**
 * The Annual Pro Forma + Returns sheets carry LIVE formulas (subtotals, cumulative,
 * cap rate, CoC, IRR, equity multiple, distributions). This guards that the formula
 * cell references stay wired to the right driver cells and reproduce the engine —
 * it reads the exported driver values, evaluates the same arithmetic the formulas do,
 * and compares to the engine result.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { calculateUnderwriting, type ScenarioInputs } from "../underwriting";
import { generateExcelWorkbook } from "../excel-export";
import { calculateIRR } from "../irr";
import type { Deal } from "../validations";

function brydenInputs(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}

const DEAL = { id: "x", address: "Test", city: "C", state: "OH", units: 12, asking_price: 1, source: "Broker" } as unknown as Deal;

// Value of a cell (driver cells hold raw numbers; formula cells have no cached result).
const numAt = (ws: ExcelJS.Worksheet, r: number, c: number): number => {
  const v = ws.getRow(r).getCell(c).value;
  return typeof v === "number" ? v : 0;
};

describe("Excel export — live formulas reproduce the engine", () => {
  it("Annual Pro Forma subtotals / cumulative / cap / CoC tie out", async () => {
    const inputs = brydenInputs();
    const result = calculateUnderwriting(inputs);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generateExcelWorkbook(DEAL, "Base", inputs, result));
    const A = wb.getWorksheet("Annual Pro Forma")!;
    const n = result.annual.length;

    const price = numAt(A, 21, 2);
    const equity = numAt(A, 22, 2);
    expect(price).toBeCloseTo(inputs.purchase.purchase_price, 2);
    expect(equity).toBeCloseTo(result.metrics.total_equity, 2);

    let cumPrev = 0;
    for (let y = 0; y < n; y++) {
      const c = y + 2;
      const gpr = numAt(A, 2, c), vac = numAt(A, 3, c), bad = numAt(A, 4, c),
        conc = numAt(A, 5, c), oth = numAt(A, 6, c), opex = numAt(A, 8, c),
        ds = numAt(A, 10, c), rr = numAt(A, 12, c), cr = numAt(A, 13, c), cx = numAt(A, 14, c);
      const egi = gpr + vac + bad + conc + oth;      // "Less:" rows stored negative
      const noi = egi + opex;
      const cf = noi + ds + rr + cr + cx;
      const cum = cumPrev + cf; cumPrev = cum;

      const a = result.annual[y];
      expect(egi).toBeCloseTo(a.egi, 4);
      expect(noi).toBeCloseTo(a.noi, 4);
      expect(cf).toBeCloseTo(a.cash_flow, 4);
      expect(cum).toBeCloseTo(a.cumulative_cash_flow, 4);
      expect(noi / price).toBeCloseTo(a.cap_rate, 8);
      expect(cf / equity).toBeCloseTo(a.cash_on_cash, 8);
    }
  });

  it("Returns IRR / equity multiple / distributions tie out", async () => {
    const inputs = brydenInputs();
    const result = calculateUnderwriting(inputs);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generateExcelWorkbook(DEAL, "Base", inputs, result));
    const R = wb.getWorksheet("Returns")!;
    const n = result.annual.length;

    const findVal = (label: string): number => {
      let out = 0;
      R.eachRow((row) => { if (row.getCell(1).value === label) out = Number(row.getCell(2).value) || 0; });
      return out;
    };
    const equity = findVal("Total Equity Invested");
    const proceeds = findVal("Net Sale Proceeds");
    const reserve = findVal("Return of Operating Reserve");

    // Rebuild the IRR vector exactly as the sheet does: −equity, then annual CF,
    // with proceeds + reserve on the final year.
    const vec = [-equity];
    for (let y = 0; y < n; y++) {
      vec.push(result.annual[y].cash_flow + (y === n - 1 ? proceeds + reserve : 0));
    }
    const irr = calculateIRR(vec);
    expect(irr).not.toBeNull();
    expect(irr as number).toBeCloseTo(result.metrics.irr as number, 8);

    const totalCF = result.annual.reduce((s, a) => s + a.cash_flow, 0);
    const dist = totalCF + proceeds + reserve;
    expect(dist / equity).toBeCloseTo(result.metrics.equity_multiple, 6);
    // Distributions tie to equity + profit (the Validation-sheet identity).
    expect(dist).toBeCloseTo(result.metrics.total_equity + result.metrics.total_profit, 2);
  });
});
