---
name: multi-agent-workflow
description: Run a feature through a six-role agent pipeline (PM spec, design, data, implementation, security audit, QA verification). Use when the user invokes /multi-agent-workflow or asks to run the multi-agent pipeline on a feature or change. Not for one-file fixes or questions.
argument-hint: "<feature or change request>"
disable-model-invocation: true
---

# Multi-agent workflow

You are coordinating a pipeline of specialist subagents for this request:

**$ARGUMENTS**

If the request above is empty, ask the user what to build and stop.

You are the dispatcher. You do not write specs, code, or reviews yourself; you
launch subagents with the Agent tool, pass artifacts between them by file path,
and enforce the gates below. Subagents cannot launch other subagents, so every
handoff comes back through you.

## Roles

| Stage | Subagent (`subagent_type`) | Model tier | Output |
|---|---|---|---|
| 1. Spec | `pm-fable` | Fable | `.specs/<slug>/spec.md` |
| 2. Design | `designer-sonnet` | Sonnet | `.specs/<slug>/design.md` |
| 3. Data | `data-sonnet` | Sonnet | `.specs/<slug>/data.md` |
| 4. Build | `dev-sonnet` | Sonnet | code changes + `.specs/<slug>/implementation.md` |
| 5. Security | `security-sonnet` | Sonnet | `.specs/<slug>/security.md` |
| 6. QA | `qa-haiku` | Haiku | `.specs/<slug>/qa.md` |

Each agent's model is pinned in its own file in `.claude/agents/`. Do not pass
a `model` override when launching them.

## Procedure

1. **Slug.** Pick a short kebab-case slug for the request and create
   `.specs/<slug>/`. If that directory already has a `spec.md`, ask the user
   whether to resume from it or start over.

2. **Spec (pm-fable).** Give it the request verbatim and the slug. It writes
   `spec.md` with numbered acceptance criteria (`AC-1`, `AC-2`, ...) and a
   `Stages` section stating which of design / data are needed and why.

3. **Spec gate.** Read `spec.md`. Show the user the acceptance criteria, the
   stages the PM marked as needed, and any open questions, then wait for
   approval. Everything downstream is built against this file, so a wrong
   spec is the most expensive mistake in the pipeline. Skip this gate only if
   the user said to run unattended.

4. **Design and data, in parallel.** Launch `designer-sonnet` and
   `data-sonnet` in a single message, each pointed at `spec.md`. Skip either
   one the spec marked as not needed; a backend-only change needs no
   designer, and a change that touches no stored data needs no data agent.

5. **Build (dev-sonnet).** Point it at `spec.md` plus whichever of
   `design.md` and `data.md` exist. It implements, runs the project's
   validation commands, and writes `implementation.md`.

6. **Security and QA, in parallel.** Launch `security-sonnet` and `qa-haiku`
   in a single message. Both are read-only reviewers of the working-tree
   diff. Each ends its report with a verdict line: `VERDICT: PASS` or
   `VERDICT: FAIL`.

7. **Fix loop.** If either verdict is FAIL, send the failing report path(s)
   back to `dev-sonnet` to fix, then rerun only the reviewer(s) that failed.
   Stop after two fix rounds; if it still fails, report the remaining
   findings to the user instead of looping.

8. **Report.** Tell the user: what was built, per-criterion QA results,
   security findings and how each was resolved, anything skipped, and the
   validation command output status. Do not commit, push, or open a PR
   unless the user asks.

## Rules for briefing subagents

- A subagent starts with no context. Every brief names the slug, the paths it
  must read, the path it must write, and tells it to read the repository's
  `CLAUDE.md` first.
- Pass file paths, not pasted contents.
- Never tell a reviewer what you expect it to find.
- If a subagent reports that the spec is ambiguous or wrong, do not guess:
  send the question to `pm-fable` to amend `spec.md` (it records the change
  under `Amendments`), then continue.
- If a stage is blocked on something only the user can decide, stop and ask.
