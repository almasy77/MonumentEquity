/**
 * Golden regression tests — lock calculateUnderwriting outputs for saved
 * scenario fixtures. Intentional engine changes re-baseline via:
 *   UPDATE_GOLDEN=1 npm test
 * The commit MUST name which fields moved and why.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs, UnderwritingResult } from "../underwriting";

const GOLDEN_DIR = join(__dirname, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface GoldenSnapshot {
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
  monthly_gpr_head: number[]; // first 24
  monthly_gpr_tail: number[]; // last 12
}

function snapshot(r: UnderwritingResult): GoldenSnapshot {
  const m = r.metrics;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    irr: m.irr,
    equity_multiple: m.equity_multiple,
    average_cash_on_cash: m.average_cash_on_cash,
    year1_dscr: m.year1_dscr,
    going_in_cap: m.going_in_cap,
    stabilized_cap: m.stabilized_cap,
    exit_value: round2(m.exit_value),
    exit_noi: round2(m.exit_noi),
    net_sale_proceeds: round2(m.net_sale_proceeds),
    total_equity: round2(m.total_equity),
    annual_noi: r.annual.map((a) => round2(a.noi)),
    annual_property_tax: r.annual.map((a) => round2(a.opex_breakdown.property_tax)),
    monthly_gpr_head: r.monthly.slice(0, 24).map((x) => round2(x.gpr)),
    monthly_gpr_tail: r.monthly.slice(-12).map((x) => round2(x.gpr)),
  };
}

const CURRENCY_TOL = 1; // $1
const RATIO_TOL = 1e-9;

const fixtures = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".input.json"));

describe("golden fixtures", () => {
  for (const file of fixtures) {
    it(file.replace(".input.json", ""), () => {
      const inputs = JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")) as ScenarioInputs;
      const snap = snapshot(calculateUnderwriting(inputs));
      const goldenPath = join(GOLDEN_DIR, file.replace(".input.json", ".golden.json"));

      if (UPDATE || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, JSON.stringify(snap, null, 2) + "\n");
        return;
      }

      const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenSnapshot;
      const dollar = (k: keyof GoldenSnapshot) =>
        expect(Math.abs((snap[k] as number) - (golden[k] as number)), k).toBeLessThanOrEqual(CURRENCY_TOL);
      const ratio = (k: keyof GoldenSnapshot) =>
        expect(Math.abs(((snap[k] as number) ?? 0) - ((golden[k] as number) ?? 0)), k).toBeLessThanOrEqual(RATIO_TOL);

      ratio("irr");
      ratio("equity_multiple");
      ratio("average_cash_on_cash");
      ratio("year1_dscr");
      ratio("going_in_cap");
      ratio("stabilized_cap");
      dollar("exit_value");
      dollar("exit_noi");
      dollar("net_sale_proceeds");
      dollar("total_equity");
      golden.annual_noi.forEach((v, i) =>
        expect(Math.abs(snap.annual_noi[i] - v), `annual_noi[${i}]`).toBeLessThanOrEqual(CURRENCY_TOL));
      golden.annual_property_tax.forEach((v, i) =>
        expect(Math.abs(snap.annual_property_tax[i] - v), `annual_property_tax[${i}]`).toBeLessThanOrEqual(CURRENCY_TOL));
      golden.monthly_gpr_head.forEach((v, i) =>
        expect(Math.abs(snap.monthly_gpr_head[i] - v), `gpr_head[${i}]`).toBeLessThanOrEqual(CURRENCY_TOL));
      golden.monthly_gpr_tail.forEach((v, i) =>
        expect(Math.abs(snap.monthly_gpr_tail[i] - v), `gpr_tail[${i}]`).toBeLessThanOrEqual(CURRENCY_TOL));
    });
  }
});
