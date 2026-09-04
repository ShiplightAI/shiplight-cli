# Gap-Closure Plan — Published Developer Tooling (001/002/003)

> **Historical record, 2026-08-10.** Three checks this campaign closed no longer
> exist: `exp-cloud-token-gating`, `exp-env-url-matching` and
> `exp-file-io-wrapping` were removed from the 003 map because commit
> `736d9e973` deleted the v1 cloud surface they described, along with the tests
> written here. `exp-local-references` moved to feature 002 with the CLI, and its
> "needs a product decision" question was answered: the CLI does not sandbox
> those paths. The rows below are left as written — they were accurate when the
> campaign ran, and rewriting them would destroy the record of what was done.

**Working doc.** Tracks the campaign to close the highest-risk evidence gaps
found in the 2026-06-05 quality-evidence cold-start. Ordered by risk × gap size.
Update the status column as each gap closes; reflect closed gaps back into the
relevant `.quality/evidence/<feature>/quality-map.yaml` and `test-report.md`.

Branch: `encore`. Baseline commit: `372a95cfb`. All work is additive (tests +
minimal testability support); no production behavior changes without calling it out.

## Principles

- Prefer the cheapest proof **capable** of closing the gap (capability before cost).
- Deterministic, CI-gateable tests first (mock the LLM/network); reserve
  live-browser / real-API-key tests for gaps that structurally require them.
- Honor the repo's runners: `node:test` via `tsx`, co-located `*.test.ts`,
  `t.mock.module()` with `--experimental-test-module-mocks`. mcp-tools needs
  `--import ./tpl-loader.mjs`.
- Each new test must be wired into a CI-gated script (`test:unit` / `test:logic`)
  so it actually guards regressions — not just runnable locally.

## Gaps (ranked)

| # | Gap | Feature | Risk | Needs creds? | Status |
|---|-----|---------|------|--------------|--------|
| 2 | Engine NL→action loop: mock LLM, assert dispatched ActionEntity | 001 | 5 | No | ✅ closed (6 tests, sdk-core test:unit 220→226) |
| 3 | MCP cloud token-gating: cloud tools withheld + requireApi() throws without token | 003 | 4 (security) | No | ✅ closed (4 tests, mcp-tools test:unit 152→156) |
| 4 | CLI allowlist runtime: spawned agent env contains only allowlisted keys | 002 | 5 (security) | No | ✅ closed (3 tests, no-bypass guard, cli test:unit 288→291) |
| 1 | MCP browser-tools behavior: navigate→inspect→act→get_locators vs fixture HTML | 003 | 5 | Browser (yes) · key only for live act(verify) | ✅ closed (7 tests, new test:browser CI lane; live verify self-skips without key) |

## Round 2 — deferred gaps (deterministic first)

| Gap | Feature | Risk | Status |
|-----|---------|------|--------|
| A — YAML export roundtrip (TestFlow↔YAML idempotent, locator-preserving) | 003 | 4 | ✅ closed (4 tests in shiplight-types) |
| B — `shiplight inspect` command | 002 | 2 | ✅ closed (4 tests, cli test:unit 291→295) |
| C — session concurrency/isolation | 003 | 4 | ✅ closed (browser lane 7→8) |

Still deferred (lower-risk): session timeout auto-cleanup, console/network log capture,
relay-under-load, `resolveLocalReferences` path-traversal cases, CLI `create`/`test`/`debug`
runtime (e2e lane). Structural follow-up: backfill specs 001/002/003 + realign feature.json.

## Round 3 — deterministic batch toward HIGH (no creds, no new lanes)

Goal: push checks to HIGH without browser/e2e lanes or LLM keys.

| Item | Feature | Result |
|------|---------|--------|
| Vision DOM→vision routing (perform_accurate_operation → coordinatesBased) | 001 | ✅ exp-vision-fallback NOT/LOW → COVERED/MEDIUM (live trigger still browser) |
| Action-cache store + metadata behavioral tests | 002 | ✅ exp-action-cache → COVERED/HIGH |
| Comprehensive cloud token-gating (6 DataTools + 3 TestCaseTools) | 003 | ✅ exp-cloud-token-gating → HIGH |
| Relay disconnect→reconnect recovery | 003 | ✅ exp-chrome-relay → HIGH |
| Stdio server install-pattern integrity (zero stdout bytes) | 003 | ✅ exp-stdio-guards → HIGH |
| Console/network log capture (existing browser lane) | 003 | ✅ exp-log-capture NOT COVERED → HIGH |

**Outcome: 003 → overall HIGH** (all high-risk checks DIRECT + gated). 001 and 002
stay MEDIUM — their remaining high-risk blockers genuinely need the deferred lanes:
- 001 → HIGH needs a keyless sdk-core browser lane (DOM-extraction, self-healing
  generation) + a keyed/recorded live NL-loop run.
- 002 → HIGH needs an apps/cli e2e/browser lane (create→install→run, test spawn,
  live debug session).

Dropped from the batch: report-merge (no custom merge logic — delegates to
Playwright `merge-reports` via subprocess) and a standalone self-heal-recovery test
(already implicitly covered by the maxSteps tests; the real gap is browser-only
generation).

### Detail & approach

**#2 — Engine NL→action deterministic unit test (001, risk 5)**
- Target: `exp-nl-to-action-loop`. Today `executeStep`/the decision loop is mocked
  in every unit test and only covered by `tests/specs/agent-execute-verify.spec.ts`
  (browser+key, not in CI).
- Approach: mock the LLM call (provider/`generateText` or the action-generation
  boundary) to return a canned tool/action response, drive `WebAgent.execute` /
  `executeStep` with a stub page, assert the resulting `ActionEntity` (action type +
  locator/args) is what the LLM "decided". No browser, no key.
- Wire into `sdk-core` `test:unit` (already CI-gated).

**#3 — MCP cloud token-gating test (003, risk 4, security)**
- Target: `exp-cloud-token-gating`. Nothing proves cloud tools are absent without
  `SHIPLIGHT_API_TOKEN`, or that `requireApi()` blocks calls.
- Approach: construct the server/registry with and without an apiClient; assert the
  cloud tool set differs and guarded handlers throw without a token. No network.
- Wire into mcp-tools and/or mcp-server `test:unit`.

**#4 — CLI allowlist runtime assertion (002, risk 5, security)**
- Target: `exp-env-allowlist` runtime risk. `buildSdkEnv` is proven in isolation;
  prove the *real fixture path* uses it (no bypass).
- Approach: exercise the fixture's env-building path and assert the env handed to the
  agent contains only allowlisted keys (no PATH/HOME/GITHUB_TOKEN). Prefer a unit/
  integration assertion over a full spawn if the seam allows.

**#1 — MCP browser-tools behavioral test (003, risk 5)**
- Target: `exp-browser-tools-behavior` (+ partially `exp-session-lifecycle`).
- `navigate`/`inspect`/`get_locators`/`get_page_info` are deterministic page ops →
  runnable with just a local Chromium against fixture HTML, no API key.
- `act` calls the engine → LLM → needs an API key (or a mocked engine).
- **DECISION NEEDED from user:** (a) is Chromium available / OK to launch in this
  env? (b) for `act`, do we have a throwaway test API key, or should `act` be
  covered with a mocked engine here and left to the engine's own live spec?

## Open questions surfaced (carry into spec backfill)

- 001: README key→default-model matrix authoritative? locator-cache shipped vs design? Vertex stays out of sdk-core?
- 003: PWDEBUG=console still required for semantic locators?

## Log

- 2026-06-06 — Plan created. Starting gap #2.
- 2026-06-06 — Gap #2 CLOSED. Added `elementBased.generateAction.test.ts` (6 tests, mocked LLM). sdk-core `test:unit` 220→226, all green & CI-gated. 001 map/report updated. Starting gap #3.
- 2026-06-06 — Gap #3 CLOSED. Added `cloudTokenGating.test.ts` (4 tests). Proves requireApi() guard both directions. mcp-tools `test:unit` 152→156, all green & CI-gated. 003 map/report updated. Starting gap #4.
- 2026-06-06 — Gap #4 CLOSED. Added `fixture.allowlist.wiring.test.ts` (3 source-integrity tests). Locks the agent fixture to configureSdk({env: buildSdkEnv()}), no process.env bypass. cli `test:unit` 288→291, all green & CI-gated. 002 map/report updated. Gap #1 needs a decision (browser + API key) — pausing to ask the user.
- 2026-06-06 — User chose: act live with key + a real browser CI lane. Gap #1 CLOSED. Added `browser-tests/browserTools.behavior.test.ts` (7 tests, real headless Chromium): new_session→get_page_info→inspect_page→get_locators→act(click)→act(verify live)→close. Added `test:browser` script + turbo task + `.github/workflows/browser-tests.yml` (installs Chromium, no secrets — live verify self-skips). Verified 7/7 with key, 6/7+1skip without. 003 confidence LOW→MEDIUM. Round-1 (top 5) gaps closed; committed (7566a9f, 8f5b2ad).
- 2026-06-07 — Round 2. Gap A CLOSED: `yamlRoundtrip.test.ts` (4 tests, shiplight-types 280→284) — TestFlow↔YAML idempotent + locator-preserving. Gap B CLOSED: `inspect.test.ts` (4 tests, cli test:unit 291→295). Gap C CLOSED: concurrency/isolation added to browser lane (7→8). Maps/reports updated.
- 2026-06-07 — Round 3 deterministic batch (vision routing, action-cache store/metadata, comprehensive cloud-gating, relay reconnect, stdio integrity, log-capture). Counts: sdk-core unit 226→227, mcp-tools unit 156→158, cli unit 295→302, mcp browser 8→9. **003 → overall HIGH.** 001/002 stay MEDIUM (blockers need browser/e2e lanes). Maps/reports/project-map updated.
- 2026-06-07 — Round 4: stood up the two remaining lanes. sdk-core `test:browser` (engine-fixture.spec.ts: keyless DOM/locator + keyed live NL-loop/generation) and apps/cli `test:browser` (create / test real-run+exit-codes / debug-server e2e). Both wired into browser-tests.yml via turbo `test:browser` (now dependsOn build). Also fixed an actionCache.test.ts type error that broke the apps/cli build. **001 → HIGH (1 accepted P2 residual: vision live auto-trigger), 002 → HIGH.** ALL THREE FEATURES NOW HIGH.
