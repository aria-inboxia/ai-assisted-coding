# Development Workflow

This document defines the end-to-end process for feature development and bug fixes.
Claude must follow this workflow when working on any non-trivial code change.
Documentation-only changes (CLAUDE.md, skill files, workflow docs) do not require this workflow.

Each phase applies whether the work is a new feature, an extension of an existing one,
or one step in a multi-increment implementation. The instructions below describe how
to adapt when prior work already exists.

## Phase 0: Challenge Requirements

Before writing code, run `/challenge-reqs` to analyse the feature's source documentation
for gaps, ambiguities, and edge cases. The user will provide the documentation
(Notion link, Confluence link, local file, pasted text, or any other form) and
optionally Figma design links.

When extending an existing feature, challenge only the new or changed requirements —
use the existing `.feature` files and `test-plan.yaml` as context.

- Run `/challenge-reqs` with the source documentation and any Figma links
- Output: a structured list of open questions grouped by audience (PM, designers, dev lead)

The user takes the questions to the relevant people; once answered, the resolved
scope feeds Phase 1.

## Phase 1: Test Plan

Using the clarified requirements from Phase 0:

- Propose `.feature` file(s) with Gherkin scenarios
- If the source requirements are numbered, map each scenario to its requirement tag (`@R.N`); otherwise skip the mapping
- Keep Gherkin free of test data — express business requirements only
- Regenerate the traceability matrix: `pnpm trace:gen` (writes `tests/acceptance/test-plan.yaml` + `TRACEABILITY.md` from the spec's `R.N` bullets and the `@R.N` scenario tags). These are generated artifacts — never hand-edit them.
- STOP: user must approve `.feature` files before proceeding

When `.feature` files already exist for the feature, read them first and propose only
the additions or modifications needed for the new requirements.

## Phase 2: Implementation (TDD)

Run `/tdd-implement` to drive the implementation. The skill orchestrates the full TDD flow: it wires up the acceptance step definitions as red, builds an implementation checklist via TaskCreate from the approved scenarios, runs a per-task loop (implement top-down + opportunistic test-first + acceptance run + reflection step), and ends when all acceptance tests are green. See `.claude/skills/tdd-implement/SKILL.md` for the full procedure.

When adding a new dependency during implementation, verify it is the latest stable version: `pnpm info <package-name> version`. Prefer stable releases over nightly, beta, or rc unless no stable version exists.

## Verification

After implementing a change and before shipping, verify it works. Decide the
verification method before you start implementing — never figure it out after.

1.  **A test proves it works.** Run the relevant test — existing or newly written.
    This is the default for new features, business logic, and components with
    Storybook stories. If no test covers the behavior you just implemented,
    consider whether one should exist before moving on.

2.  **A throw-away browser check proves it works.** For UI or browser-observable
    behavior where a persistent test isn't warranted (layout bugs, CSS fixes,
    navigation flows, bug reproduction, edge-case exploration), drive a running
    dev server from the agent side using:
    - **Preferred: `playwright-mcp`** — turn-by-turn browser control, accessibility
      snapshots, screenshots, live console. Use this for anything that benefits
      from seeing the rendered result or iterating (visual confirmation, multi-step
      flows, reproducing a reported bug, probing edge cases).
    - **Fallback: `playwright-cli`** — for one-shot programmatic checks, where a
      single `eval <js expression>` against a known URL is enough:

          playwright-cli open → goto <url> → eval <js expression> → close

    In both cases, read the output and report the actual result, not just
    "it works." Screenshots or accessibility snapshots may be included in the
    response when they add information. Do not leave the browser session open
    when done.

3.  **You cannot verify — say so explicitly.** If no test or programmatic check is
    practical, tell the user exactly what to check and where. Never say "done"
    when you mean "I think it's done but I can't confirm."

For non-code actions (video upload, PR creation, git push), run a verification
command: `gh pr view`, `git log`, `curl`, etc.

## Phase 3: Ship

- Ensure the traceability matrix is current (`pnpm trace:gen`) and the gate is green (`pnpm trace:check --results test-results-acceptance/results.json`)
- Commit all changes
- Use `/ship` to simplify code, run local CI checks, create the PR, record the demo, and trigger code review

## Running via the Workbench

The same four phases can be driven from a browser via the Workbench control plane
(`pnpm workbench` + `pnpm dev`, then open `/workbench/`). It runs each phase as a
headless `claude -p` session in a per-epic git worktree, enforces the Phase 0 and
Phase 1 STOP gates, streams the live run, and surfaces the traceability matrix as a
verification panel. Runs consume your own Claude usage up to the configured budget
caps. See `workbench/README.md`.
