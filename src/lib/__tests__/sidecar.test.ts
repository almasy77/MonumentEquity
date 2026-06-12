/**
 * Phase 3.5: the golden harness asserts the sidecar shape for every fixture —
 * the sidecar is the machine-readable contract external reviewers consume.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { calculateUnderwriting } from "../underwriting";
import type { ScenarioInputs } from "../underwriting";
import { buildSidecar } from "../sidecar";
import type { Deal } from "../validations";

const GOLDEN_DIR = join(__dirname, "golden");
const FAKE_DEAL = {
  id: "00000000-0000-0000-0000-000000000000",
  address: "Fixture St",
  city: "Columbus",
  state: "OH",
  units: 12,
  asking_price: 1,
  bid_price: undefined,
} as unknown as Deal;

describe("sidecar shape", () => {
  for (const file of readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".input.json"))) {
    it(file.replace(".input.json", ""), () => {
      const inputs = JSON.parse(readFileSync(join(GOLDEN_DIR, file), "utf8")) as ScenarioInputs;
      const result = calculateUnderwriting(inputs);
      const sc = buildSidecar(FAKE_DEAL, "Fixture", inputs, result);

      expect(sc.metadata.scenario_name).toBe("Fixture");
      expect(sc.metadata.exit_method).toMatch(/^(explicit_price|tax_loaded|naive)$/);
      expect(typeof sc.metadata.generated_at).toBe("string");
      expect(sc.inputs.purchase.purchase_price).toBeGreaterThan(0);
      expect(sc.key_outputs.annual_noi).toHaveLength(inputs.exit.hold_period_years);
      expect(sc.key_outputs.annual_property_tax).toHaveLength(inputs.exit.hold_period_years);
      expect(Array.isArray(sc.checks.items)).toBe(true);
      expect(sc.checks.items.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
      // Reconciliation identities that must hold regardless of fixture:
      const byId = Object.fromEntries(sc.checks.items.map((c) => [c.id, c]));
      expect(byId.a.pass, byId.a.detail).toBe(true); // exit method reconciles
      expect(byId.b.pass, byId.b.detail).toBe(true); // stabilized GPR ties
      expect(byId.c.pass, byId.c.detail).toBe(true); // monthly→annual NOI
      expect(byId.f.pass, byId.f.detail).toBe(true); // sources = uses
      expect(byId.g.pass, byId.g.detail).toBe(true); // tax vector tie (or n/a)
      expect(byId.i.pass, byId.i.detail).toBe(true); // net proceeds recon
    });
  }
});
