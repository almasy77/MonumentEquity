# Monument Equity — Calculation QA Report

**Date:** 2026-10-24
**Scope:** Full inputs → outputs audit of the underwriting calculation engine and the surfaces that display/export its numbers.

## Bottom line

**No new calculation bugs found.** The engine is internally consistent and its conventions are sound. Every identity that *must* hold if the math is correct holds across all three reference deals and across a matrix of feature toggles. The two real bugs found earlier in this review cycle (GRM denominator, auto‑reserve determinism) are already fixed and shipped.

To keep it that way, this QA added a **permanent engine‑invariants regression suite** that re‑checks all of these relationships on every future change.

---

## How it was audited

Rather than only reading code (which misses interaction bugs), the audit drives the real engine (`calculateUnderwriting`) on the three golden fixtures — `bryden_base`, `fifth_st_tax_phasein`, `mobile_drive_likely` — and asserts a battery of **invariants**: relationships the math guarantees regardless of inputs. Each invariant was checked under a matrix of feature toggles so interactions are exercised, not just the happy path:

- base, **cash‑out refinance**, **capex loan holdback (100%)**, **auto operating reserve**, **LTV 90%**, **DSCR sizing basis** (in‑place / year‑1 / manual), **exit method** (NOI÷cap / tax‑loaded).

Plus degenerate‑input robustness (100% vacancy, zero exit cap, all‑cash).

## What was validated (all pass)

| Area | Invariant checked |
|---|---|
| NOI definition | `NOI = EGI − operating opex` (reserves/capex are **below** NOI, never in it) |
| EGI build | `EGI = GPR − vacancy − bad debt − concessions + other income` |
| Cash‑flow waterfall | `CF = NOI − debt service − reserves − capital reserve − capex`; and annual `CF = Σ monthly CF` |
| Cap rates | per‑year `cap = NOI ÷ price`; going‑in = Y1 NOI÷price; stabilized = last‑yr NOI÷price |
| DSCR | Y1 DSCR = Y1 NOI ÷ Y1 debt service (NOI **before** reserves) |
| Equity | `total_equity_invested = equity at close + capital calls ≥ equity`; peak ≥ equity |
| Equity multiple | `EM = 1 + total_profit ÷ total_equity_invested` |
| Profit | `profit = cash returned − invested`, with cash returned = distributions + refi + net sale + reserve return |
| IRR | rebuilt independently from the documented dated flow stream (−equity at close, each year's CF, +sale/reserve/refi) matches the engine's IRR |
| Exit value | `exit value = exit NOI ÷ exit cap` on the plain method |
| Lease‑up | loss‑to‑lease ≥ 0; % marked‑to‑market stays in [0,1] and nets positive over the hold |
| Sensitivity grid | the center cell (0 price / 0 cap delta) reconciles to the headline IRR |
| Tax | depreciation accumulates monotonically; §1245/§1250 recapture ≥ 0; exit tax floored at 0; after‑tax sale proceeds = net sale − exit tax; PAL carryforward ≥ 0 |

### Conventions spot‑checked by reading the code
- **Reserves excluded from NOI / cap** (institutional convention); **cash‑on‑cash after** reserves. Verified engine, pro‑forma, Excel export, one‑pager all agree. *(This was your earlier question — confirmed correct, no change needed.)*
- **Exit tax recapture** (`tax.ts`): §1245 ordinary recapture → unrecaptured §1250 at 25% → residual LTCG at 20%; suspended passive losses applied highest‑rate‑first; NIIT 3.8% on the capital‑gain portions gated on REPS; 1031 path skips exit tax entirely; total floored at 0. **Textbook‑correct.**
- **Auto‑mode exit tax‑loading** (P2‑4): in reassessment jurisdictions the auto method tax‑loads the exit `(NOI + exit tax) ÷ (cap + tax rate)`, which correctly lowers exit value vs the plain method. Intended behavior, not a discrepancy.

---

## Already fixed earlier this cycle (for the record)
1. **GRM on market/renovated rent → current rent.** Pricing Views' Gross Rent Multiplier multiplied by the ramped/market Year‑1 rent; now uses current in‑place gross scheduled rent, basis‑independent.
2. **Auto operating reserve determinism.** The engine read the reserve from a UI‑synced field, so identical inputs gave different IRRs by save history; the engine now derives it from year‑1 carry. (Engine v3 → v4.)

## Minor observations (not bugs)
- **Annual rows omit the holdback breakdown.** When the capex loan holdback is used, monthly rows carry `capex_equity_funded` / holdback interest + balance, but the **annual** summary doesn't. The annual *cash flow* is still correct (verified by aggregation); this is only a reporting‑granularity gap if an export needs to show equity‑funded vs holdback‑funded capex by year. Low priority.
- **Documented simplifications** (all labeled in code, all reasonable): property‑tax payment timing / Ohio arrears not modeled; late‑turn rents slightly overstated (uniform annual growth, no per‑unit catch‑up); the sensitivity grid uses a flat turnover approximation during lease‑up (center cell still reconciles within tolerance); v1 reassessment assumes reassess‑to‑price (the v2 path models jurisdictions properly); excess suspended PAL at exit isn't credited (conservative); `proration_method` is a memo field, not modeled.

## Deliverable
- **`src/lib/__tests__/engine-invariants.test.ts`** — the invariant battery above, made permanent (runs on every change; 4 fixtures × the toggle matrix). Full suite: **373 passing**.

## Recommendation
The engine is in good shape. The highest‑value ongoing protection is the new invariant suite (shipping now). If you want, the one worthwhile follow‑up is surfacing the holdback capex breakdown on annual rows/exports — but only if you actually use the loan‑holdback feature on live deals.
