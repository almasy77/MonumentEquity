# multi-agent-workflow

A Claude Code skill that runs a feature request through six specialist
subagents: PM spec, design, data, build, security audit, and QA.

## Trigger it

In Claude Code, from this repository:

```
/multi-agent-workflow add a notes field to deals, editable by admins only
```

The skill is manual-only (`disable-model-invocation: true`), so Claude will
not start a six-agent run on its own. Remove that line from `SKILL.md` if you
want Claude to launch it when a request looks like a fit.

Subagents and skills are loaded when a session starts. After pulling these
files, start a new session (or run `/agents` to confirm the six agents are
listed) before the first run.

## What happens

1. `pm-fable` writes `.specs/<slug>/spec.md` with numbered acceptance criteria.
2. Claude shows you the criteria and open questions and waits for approval.
3. `designer-sonnet` and `data-sonnet` run in parallel (each is skipped when
   the spec says it is not needed).
4. `dev-sonnet` implements and runs `tsc`, lint, and build.
5. `security-sonnet` and `qa-haiku` review the diff in parallel.
6. Failures go back to `dev-sonnet`, at most twice, then you get a report.

Nothing is committed or pushed unless you ask.

To skip the approval pause, say so in the request:
`/multi-agent-workflow <request> — run unattended`.

## Files

| Path | Purpose |
|---|---|
| `.claude/skills/multi-agent-workflow/SKILL.md` | Pipeline procedure and gates |
| `.claude/agents/pm-fable.md` | Spec author |
| `.claude/agents/designer-sonnet.md` | UI/UX and component specs |
| `.claude/agents/data-sonnet.md` | Data shapes, storage, migration plans |
| `.claude/agents/dev-sonnet.md` | Implementation and fixes |
| `.claude/agents/security-sonnet.md` | Security and privacy audit (read-only) |
| `.claude/agents/qa-haiku.md` | Acceptance-criteria check and validation commands (read-only) |

The agent files live in `.claude/agents/` rather than in the skill folder
because that is the only location Claude Code loads subagents from, and the
`model:` line in each file is what pins the model.

## Changing models

Edit the `model:` line in an agent file. `sonnet` and `haiku` are aliases
that follow the current release of each tier; a full model ID pins an exact
version.

## Using it in every project

Copy `skills/multi-agent-workflow/` to `~/.claude/skills/` and the six agent
files to `~/.claude/agents/`. The prompts read each project's `CLAUDE.md`
for its conventions, so they are not specific to this repository.

## Spec files

`.specs/` is not gitignored. Commit it if you want specs and review reports
in history; add `.specs/` to `.gitignore` if you do not.
