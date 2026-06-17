# Foyer

## Project Overview

Foyer is a small internal welcome screen. People sign in, see the home banner, and (if they are admins) configure it.

## Architecture

The app is intentionally small. From the inside out:

- **`app/lib/`** — domain helpers: `auth.js` (sign-in lookup), `session.js` (localStorage session), `banner.js` (banner read/write).
- **`app/components/`** — presentational React components.
- **`app/views/`** — top-level views: `LoginView`, `HomeView`, `SettingsView`.
- **`app/App.jsx`** — owns the app state (`view`, `session`) and renders the right view.

Persistence lives entirely in `localStorage`. There is no server, no DB, no router library.

## Key Commands

All project commands are defined in `package.json` under `scripts`. Run `pnpm run` to list them.

## Workbench (control plane)

`workbench/` is a separate developer surface — **not** part of the Foyer app — that drives this repo's own four-phase workflow from an epic. Foyer stays a pure client app; the Workbench adds a localhost-only Node backend that runs Claude Code headless.

- **`workbench/server/`** — a zero-dependency Node `http` + SSE service. `pnpm workbench` starts it on `127.0.0.1:4319`. It spawns `claude -p` per phase (challenge → test plan → implement → ship) with per-phase least-privilege tool allowlists, `--permission-mode acceptEdits` (never `bypassPermissions`), `--max-budget-usd` caps, a wall-clock timeout, and one git worktree per epic (branched off `origin/main`).
- **`workbench/` (frontend)** — a second Vite entry served at `/workbench/` (Foyer stays at `/`). Epic intake → phase stepper with the workflow's STOP gates → live agent stream (SSE) → per-phase deliverables → the verified traceability matrix panel.
- **Run it:** `pnpm workbench` (backend) + `pnpm dev`, then open `/workbench/`; or `pnpm build && pnpm preview` for the production build.
- **Cost & safety:** each phase consumes **your own** Claude usage/billing up to the budget caps (configurable via `WORKBENCH_*` env; set `WORKBENCH_MODEL` to run a cheaper model). The backend binds localhost only and never force-pushes. See `workbench/README.md`.

The requirements-traceability gate (`tools/trace/trace.js`) underpins both CI and the cockpit's matrix panel — see `.claude/testing_rules.md`.

## Implementation (TDD)

**Always use the `/tdd-implement` skill** when starting Phase 2 of the workflow — i.e. when implementing a feature whose `.feature` scenarios from Phase 1 are approved. The skill enforces the TDD discipline (implementation checklist via TaskCreate, opportunistic test-first on non-trivial pure units, mandatory reflection step after each task) that's hard to maintain by hand. See `.claude/skills/tdd-implement/SKILL.md` for the full procedure.

## Shipping (PR Workflow)

**Always use the `/ship` skill** when creating or updating a pull request that includes code changes. Never create or push a code PR without going through `/ship`. Documentation-only PRs (CLAUDE.md, skill files, workflow docs) can be pushed directly. See `.claude/skills/ship/SKILL.md` for trigger conditions and the full workflow.

When `/ship` invokes code review, report **all** issues to the user regardless of confidence score — do not filter or discard issues. The `/code-review` skill's internal scoring and threshold logic must not override this: the user will triage the issues themselves.

## Guidelines

Before starting work, read the sub-file(s) relevant to your task:

- **`.claude/git_workflow.md`** — Read before any commit, push, PR creation, or merge
- **`.claude/design_system_rules.md`** — Read before creating or modifying UI components, working with colors, typography, or spacing
- **`.claude/testing_rules.md`** — Read before writing or modifying any tests (dev, acceptance)
- **`.claude/coding_patterns.md`** — Read before working on app code (persistence boundary, component variants, conventions)
- **`.claude/workflow.md`** — You MUST read this file before starting any code change and follow its phases. No exceptions.
