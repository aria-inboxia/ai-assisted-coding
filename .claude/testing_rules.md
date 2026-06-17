# Testing Rules

## Testing Strategy

Two suites, each with a distinct purpose. Choose the right one for what you're verifying:

| Suite          | Tool             | Location                 | Purpose                                                                   |
| -------------- | ---------------- | ------------------------ | ------------------------------------------------------------------------- |
| **Dev tests**  | Vitest (+ jsdom) | `app/**/*.test.{js,jsx}` | Fast tests for pure logic and non-trivial component invariants            |
| **Acceptance** | Playwright-BDD   | `tests/acceptance/`      | Gherkin scenarios derived from approved requirements — the canonical behaviour spec |

## Dev Tests (Vitest)

Fast, browser-free tests. Use for:

- Pure logic in `app/lib/` (auth lookup, banner default, session round-trip)
- Non-trivial component invariants where an acceptance test would be overkill (e.g., a specific `useEffect` restoring state after an error)

```bash
pnpm test:dev
```

Runs via `vitest.config.js` with the jsdom environment.

### Component tests

Use `@testing-library/react` to render components in isolation. Don't use component tests to re-verify business behaviour that's already covered by acceptance scenarios — they should target internals (hooks, effects, state invariants) that aren't user-observable from a Gherkin scenario.

## Acceptance Testing (BDD)

The canonical behaviour spec. Scenarios are written **before** implementation from approved requirements (see Phase 1 of `.claude/workflow.md`).

```bash
pnpm bddgen      # Generate test files from .feature files (required first)
pnpm exec playwright test --config=playwright-acceptance.config.js
```

Or, in one shot: `pnpm test:acceptance`.

### Authentication

Tag-based, configured in `tests/acceptance/fixtures.js`:

- `@manualLogin` — no auto-login (for scenarios that exercise the login flow itself)
- `@adminLogin` — explicit admin login
- `@userLogin` — explicit regular-user login
- (no tag) — defaults to admin auto-login

### Writing scenarios

- Keep Gherkin free of test data — express business requirements only.
- If the source requirements are numbered (e.g., `R.1`, `R.2`), tag each scenario with its requirement ID (`@R.1`, `@R.2`, …). Skip the tag when requirements aren't numbered.
- The traceability matrix is **generated**, not hand-written: run `pnpm trace:gen` after changing a spec or a scenario's `@R.N` tags to refresh `tests/acceptance/test-plan.yaml` and `TRACEABILITY.md`.
- Use page objects from `tests/acceptance/pages/` (one per view) to encapsulate selectors and common actions.

### Requirements traceability

`tools/trace/trace.js` reconciles three sources — the `- **R.N** —` requirement bullets in `docs/specs/*.md`, the `@R.N` tags on scenarios, and the acceptance run's JSON results — into `tests/acceptance/test-plan.yaml` + `TRACEABILITY.md`.

- `pnpm trace:gen` regenerates both artifacts (commit them).
- `pnpm trace:check` fails on an **uncovered** requirement (no `@R.N` scenario), an **orphan** `@R.N` tag (no such requirement), a **stale** committed artifact, and — with `--results` — a **covered scenario that did not pass**.

CI runs the structural check in the static job and the results-aware check after the acceptance run, so "every requirement is covered by a passing scenario" is enforced, not assumed.

## Writing Robust Tests

These rules apply to any Playwright-based test:

- **NEVER use `page.waitForTimeout()`** — always wait for a meaningful DOM condition (e.g., `waitForSelector("h1", { state: "visible" })`).
- **Use `getByRole`** over CSS selectors when the element has a clear ARIA role.
- **Use page objects** to encapsulate selectors and common actions.
- For state stored in `localStorage`, clear it between tests in the fixture (`page.evaluate(() => localStorage.clear())`).
