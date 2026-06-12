/**
 * Capture live scenario fixtures for the golden test suite.
 *
 * Usage:
 *   BASE_URL=https://<prod-domain> COOKIE='<admin session cookie>' \
 *     node scripts/capture-fixtures.mjs <scenarioId> <fixtureName> [...]
 *
 * Writes src/lib/__tests__/golden/<fixtureName>.input.json from the scenario's
 * stored assumptions (same assembly as the API routes). Re-save the scenario
 * in the app first so post-#72 tax_assumptions are persisted. Then run
 * UPDATE_GOLDEN=1 npm test to baseline.
 */
import { writeFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL;
const COOKIE = process.env.COOKIE;
if (!BASE_URL || !COOKIE) {
  console.error("BASE_URL and COOKIE env vars are required");
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2 !== 0) {
  console.error("Usage: capture-fixtures.mjs <scenarioId> <fixtureName> [...]");
  process.exit(1);
}

for (let i = 0; i < args.length; i += 2) {
  const [id, name] = [args[i], args[i + 1]];
  const res = await fetch(`${BASE_URL}/api/scenarios/${id}`, { headers: { cookie: COOKIE } });
  if (!res.ok) {
    console.error(`scenario ${id}: HTTP ${res.status}`);
    process.exit(1);
  }
  const { scenario } = await res.json();
  const inputs = {
    purchase: scenario.purchase_assumptions,
    financing: scenario.financing_assumptions,
    revenue: scenario.revenue_assumptions,
    expenses: scenario.expense_assumptions,
    capex: scenario.capex_assumptions,
    exit: scenario.exit_assumptions,
    tax: scenario.tax_assumptions ?? undefined,
    depreciation: scenario.depreciation_assumptions ?? undefined,
  };
  const path = `src/lib/__tests__/golden/${name}.input.json`;
  writeFileSync(path, JSON.stringify(inputs, null, 2) + "\n");
  console.log(`wrote ${path} (${scenario.name})`);
}
