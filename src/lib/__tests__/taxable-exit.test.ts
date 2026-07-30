/**
 * Fully-taxable exit (exit_via_1031 === false): depreciation recapture + capital
 * gains + NIIT + state modeled at sale. Gated strictly on the flag — the 1031
 * default path must stay byte-identical (existing golden/tax tests cover it).
 *
 * The waterfall figures below are hand-computed from the fixture's own
 * accumulated-depreciation memo and the documented rates; see each assertion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";

function bryden(): ScenarioInputs {
  return JSON.parse(readFileSync(join(__dirname, "golden", "bryden_base.input.json"), "utf8")) as ScenarioInputs;
}

const FED = 0.37;
const STATE = 0.1478;
const LTCG = 0.2;
const SEC1250 = 0.25;
const NIIT = 0.038;

describe("taxable exit — waterfall (REPS on, personal property NOT worthless)", () => {
  it("matches a hand-computed recapture/LTCG waterfall and total exit tax", () => {
    const inp = bryden();
    // REPS on every year ⇒ no suspended PAL at exit (pal_released must be 0).
    inp.tax = {
      ...inp.tax!,
      exit_via_1031: false,
      personal_property_worthless_at_exit: false,
    };
    const r = calculateUnderwriting(inp);
    const t = r.tax!;
    const et = t.exit_tax!;
    expect(et).toBeDefined();

    // Primitives the engine reports (accumulated depreciation + adjusted basis).
    const accum1245 = t.deferred_gain_memo.sec1245_depreciation;
    const accum1250 = t.deferred_gain_memo.sec1250_depreciation;
    const basis = t.deferred_gain_memo.adjusted_basis_at_exit;
    const sellingCosts = r.metrics.exit_value * inp.exit.selling_cost_rate;
    const totalGain = Math.max(0, r.metrics.exit_value - sellingCosts - basis);

    // Hand-compute the waterfall independently from those primitives.
    const sec1245 = Math.min(accum1245, totalGain); // not worthless ⇒ full §1245
    const unrecap1250 = Math.min(accum1250, Math.max(0, totalGain - sec1245));
    const ltcg = Math.max(0, totalGain - sec1245 - unrecap1250);
    expect(t.pal_carryforward_at_exit).toBe(0); // REPS on ⇒ nothing suspended

    expect(et.total_gain).toBeCloseTo(totalGain, 2);
    expect(et.sec1245_recapture).toBeCloseTo(sec1245, 2);
    expect(et.sec1250_unrecaptured).toBeCloseTo(unrecap1250, 2);
    expect(et.ltcg_gain).toBeCloseTo(ltcg, 2);
    expect(et.pal_released).toBe(0);
    expect(et.niit).toBe(0); // REPS on in the exit year shields the gain from NIIT

    const federal = sec1245 * FED + unrecap1250 * SEC1250 + ltcg * LTCG;
    const state = totalGain * STATE; // pal = 0 ⇒ full gain taxed by the state
    expect(et.federal_tax).toBeCloseTo(federal, 2);
    expect(et.state_tax).toBeCloseTo(state, 2);
    expect(et.total_exit_tax).toBeCloseTo(federal + state, 2);

    // After-tax proceeds = pre-tax net sale proceeds − the exit tax.
    expect(et.after_tax_net_sale_proceeds).toBeCloseTo(r.metrics.net_sale_proceeds - et.total_exit_tax, 2);
  });

  it("after-tax IRR is LOWER than the same deal taken via a 1031", () => {
    const taxable = bryden();
    taxable.tax = { ...taxable.tax!, exit_via_1031: false };
    const like1031 = bryden();
    like1031.tax = { ...like1031.tax!, exit_via_1031: true };

    const rt = calculateUnderwriting(taxable).tax!;
    const r31 = calculateUnderwriting(like1031).tax!;

    expect(rt.after_tax_irr_propco!).toBeLessThan(r31.after_tax_irr_propco!);
    expect(rt.after_tax_irr_household!).toBeLessThan(r31.after_tax_irr_household!);
  });
});

describe("taxable exit — PAL release + NIIT (REPS off)", () => {
  it("releases suspended PALs against the gain (ordinary first) and applies exit NIIT", () => {
    const inp = bryden();
    inp.tax = {
      ...inp.tax!,
      exit_via_1031: false,
      personal_property_worthless_at_exit: false,
      reps_status: [false, false, false, false, false], // suspend every year ⇒ PAL at exit
    };
    const r = calculateUnderwriting(inp);
    const t = r.tax!;
    const et = t.exit_tax!;

    const pal = t.pal_carryforward_at_exit;
    expect(pal).toBeGreaterThan(0);
    expect(et.pal_released).toBeGreaterThan(0);
    // PAL applied ordinary (§1245) first, then §1250, then LTCG.
    const pal1245 = Math.min(pal, et.sec1245_recapture);
    const taxed1245 = et.sec1245_recapture - pal1245;
    let rem = pal - pal1245;
    const pal1250 = Math.min(rem, et.sec1250_unrecaptured);
    const taxed1250 = et.sec1250_unrecaptured - pal1250;
    rem -= pal1250;
    const palLtcg = Math.min(rem, et.ltcg_gain);
    const taxedLtcg = et.ltcg_gain - palLtcg;

    // NIIT hits the post-PAL §1250 + LTCG base only (never the §1245 ordinary part).
    const niit = (taxed1250 + taxedLtcg) * NIIT;
    expect(et.niit).toBeCloseTo(niit, 2);

    const federal = taxed1245 * FED + taxed1250 * SEC1250 + taxedLtcg * LTCG + niit;
    const state = (taxed1245 + taxed1250 + taxedLtcg) * STATE;
    expect(et.federal_tax).toBeCloseTo(federal, 2);
    expect(et.state_tax).toBeCloseTo(state, 2);
    expect(et.total_exit_tax).toBeCloseTo(federal + state, 2);
  });
});

describe("1031 exit path is unchanged (byte-identical gating)", () => {
  it("exit_via_1031: true ⇒ exit_tax undefined, deferred memo present, proceeds pre-tax", () => {
    const inp = bryden(); // fixture default is exit_via_1031: true
    const r = calculateUnderwriting(inp);
    const t = r.tax!;
    expect(t.exit_tax).toBeUndefined();
    expect(t.deferred_gain_memo.deferred_gain).toBeGreaterThan(0);
  });

  it("the taxable-exit rate inputs are INERT while exit_via_1031 is true", () => {
    const baseline = bryden();
    const absurdRates = bryden();
    // Nonsense rates that would swing a taxable exit wildly — must not touch 1031.
    absurdRates.tax = { ...absurdRates.tax!, federal_ltcg_rate: 0.99, sec1250_recapture_rate: 0.99 };

    const b = calculateUnderwriting(baseline).tax!;
    const a = calculateUnderwriting(absurdRates).tax!;
    expect(a.after_tax_irr_propco).toBe(b.after_tax_irr_propco);
    expect(a.after_tax_irr_household).toBe(b.after_tax_irr_household);
    expect(a.exit_tax).toBeUndefined();
  });
});
