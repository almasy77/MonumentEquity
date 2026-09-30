# Underwriting engine changelog

Every change to `src/lib/underwriting.ts` (or anything it depends on) that can move a
scenario's returns — IRR, cash-on-cash, DSCR, NOI, equity multiple, cap rates — gets
a new engine version here and a bump of `ENGINE_VERSION` in `src/lib/engine-version.ts`.

When `ENGINE_VERSION` changes, scenarios stamped with an older version are recomputed
on their next read, their prior metrics are captured in `previous_metrics`, and a
"results changed" banner surfaces the move. The version's one-line reason (shown in
that banner) lives in `ENGINE_CHANGE_REASONS`.

| Version | Date | What changed | Typical effect on returns |
|---|---|---|---|
| 1 | 2026-09-30 | Baseline version stamp. First release that records which engine produced a scenario's stored metrics. No math change of its own; on first read each scenario is recomputed on the current engine, so any results that were stale from an earlier (un-stamped) engine are corrected and the delta is surfaced. | None by itself; stale stored metrics are corrected to the current engine. |

<!--
Template for the next entry (add a row ABOVE is fine, but keep versions ascending):

| 2 | YYYY-MM-DD | <what changed and why> | <e.g. "IRR typically down ~1-3 pts on lease-up deals"> |

Steps when you add a version:
1. Bump ENGINE_VERSION in src/lib/engine-version.ts.
2. Add its one-line reason to ENGINE_CHANGE_REASONS[<version>].
3. Add the row here.
-->
