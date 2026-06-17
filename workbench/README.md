# Workbench

A local **control plane** that runs this repo's own AI-coding workflow — the four
phases documented in `.claude/workflow.md` — from a single epic/feature input,
streaming live execution and step-by-step deliverables to a browser cockpit.

It is a separate developer surface, not part of the Foyer app. Foyer stays a pure
client app served at `/`; the Workbench cockpit is served at `/workbench/` and is
backed by a small localhost-only Node service.

## Run it

```bash
pnpm workbench          # backend on http://127.0.0.1:4319 (localhost only)
pnpm dev                # Vite on http://localhost:5173 — open /workbench/
# or, against the production build:
pnpm build && pnpm preview   # open http://localhost:4173/workbench/
```

The Vite dev/preview server proxies `/api` and `/events` to the backend, so the
cockpit and the API share an origin.

## How it works

The backend spawns `claude -p … --output-format stream-json` once per phase and
relays its events to the cockpit over Server-Sent Events. Each phase is
least-privilege:

| Phase     | Skill             | Permission    | Tools (allowlist)                         | Gate                   |
| --------- | ----------------- | ------------- | ----------------------------------------- | ---------------------- |
| challenge | `/challenge-reqs` | `plan` (R/O)  | Read, Grep, Glob, WebFetch                | review answers → next  |
| testplan  | workflow Phase 1  | `acceptEdits` | write `tests/acceptance/**` + `trace:gen` | **approve `.feature`** |
| implement | `/tdd-implement`  | `acceptEdits` | edit + the `pnpm test/build/lint` scripts | (autonomous)           |
| ship      | `/ship`           | `acceptEdits` | git, gh, pnpm, ffmpeg (no force-push)     | (autonomous)           |

Each epic runs in its own git worktree branched off `origin/main`
(`workbench/<slug>-<id>` under `.workbench-trees/`), so epics never touch your
working tree and Phase 3 can open a PR from that branch. The challenge phase mints
the epic's session; later phases resume it.

The cockpit's verification panel is the **requirements-traceability matrix** from
`tools/trace/trace.js matrix` — the same gate CI enforces — so "did the agent build
and test what was asked?" is shown green/red, not asserted.

After the implement phase, the backend runs that gate over the agent's own
artifacts in the worktree — the agent's "done" is **independently verified**, not
trusted (a failed gate marks the phase errored). Every phase's raw stream-json
transcript is written to `.workbench/epics/<id>/<phase>.ndjson` and served at
`GET /api/epics/:id/phases/:phase/log`; `POST /api/epics/:id/cleanup` removes a
finished epic's worktree (keeping the branch so an open PR is never orphaned).

## Safety & cost

- **Your own usage.** Headless runs use your own Claude credentials and consume
  your usage/billing, bounded by per-phase `--max-budget-usd` caps and a wall-clock
  timeout. A tripped cap surfaces as `error_max_budget_usd`.
- **Localhost only.** The backend binds `127.0.0.1` and applies an `Origin`
  allowlist to state-changing requests.
- **Never bypasses permissions.** Phases use `plan` or `acceptEdits` — never
  `bypassPermissions` / `--dangerously-skip-permissions` — and ship is blocked from
  force-pushing.
- **Bounded concurrency.** One phase at a time per epic; a small global cap across
  epics.

## Configuration (env)

| Variable                 | Default       | Meaning                                                      |
| ------------------------ | ------------- | ------------------------------------------------------------ |
| `WORKBENCH_PORT`         | `4319`        | Backend port (Vite proxy target).                            |
| `WORKBENCH_EPIC_CAP`     | `45`          | Max total spend per epic (USD) before refusing.              |
| `WORKBENCH_BUDGET_DAILY` | `200`         | Max total spend across all epics per day (USD).              |
| `WORKBENCH_MODEL`        | (unset)       | Override the model, e.g. `sonnet`, for cheaper runs.         |
| `WORKBENCH_SECRET`       | (unset)       | If set, require `Authorization: Bearer <secret>` on the API. |
| `WORKBENCH_DATA`         | `.workbench`  | Where epic run-state JSON is stored.                         |
| `WORKBENCH_BASE`         | `origin/main` | Git ref each epic's worktree is branched from.               |

## Layout

```
workbench/
  server/                 # zero-dependency Node http + SSE backend
    index.js              # routes, 127.0.0.1 bind, Origin guard
    runner.js             # spawn claude, stream-json → SSE, worktree, timeout/budget
    phases.js             # the 4 phase definitions + argv builder
    store.js              # epic state in .workbench/epics/<id>.json (atomic)
    sse.js                # SSE hub (buffered replay, heartbeat)
    validate.js           # boundary validation
  index.html + main.jsx   # second Vite entry (the cockpit)
  Workbench.jsx           # root: epic list ↔ detail
  views/                  # EpicListView, EpicDetailView
  components/             # PhaseStepper, LiveRunView, TraceabilityMatrix, StatusPill, …
  lib/                    # api.js (HTTP), useRunStream.js (SSE reducer hook)
```
