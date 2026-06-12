# Golden fixtures

`*.input.json` — `ScenarioInputs` for `calculateUnderwriting`.
`*.golden.json` — locked key outputs. Regenerate intentionally with
`UPDATE_GOLDEN=1 npm test` and explain WHICH fields moved and WHY in the commit.

PROVENANCE: the two seed fixtures are synthetic reconstructions of
738 Bryden "Base Case" and 65 S 5th "Property Tax Phase-in" as documented
2026-06-12 (per-unit rows, ramp schedule mode, reassessment on). Replace with
live captures via `node scripts/capture-fixtures.mjs` (needs BASE_URL + COOKIE
of an admin session); re-save scenarios first so post-#72 tax_assumptions persist.
