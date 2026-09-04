# Test Spec: shiplightai CLI & Playwright Library

**Scope**: `feature`
**Source material**:
- [Feature spec](../../specs/002-shiplightai-cli/spec.md)
- [Project map feature entry](../../project-map.yaml)
- https://docs.shiplight.ai/local/cli-reference
- [Published package README](../../apps/cli/README.md)
- `apps/cli`
**Quality policy**: [../../TESTING.md](../../TESTING.md)
**Test report**: [test-report.md](./test-report.md)

This file defines the durable testing contract for the published `shiplightai`
package: the CLI commands and the Playwright library that wraps the shared engine
(001) into a runnable local-tooling product. It describes what must be trusted
about the package and which proof strategies are worth buying.

## Testing What

### Product Behaviors

- `shiplight test` runs mixed YAML + `.test.ts` suites, forwards Playwright flags
  verbatim, applies variable overrides, and propagates pass/fail exit codes.
- `shiplight create` scaffolds a valid, runnable project wired with
  `shiplightConfig()`; against a populated directory it never modifies an existing
  file and reports each conflict with the template and a merge strategy; `--json`
  emits the same result as one parseable object (the agent-facing contract that
  replaced the MCP scaffold tool).
- `shiplight debug` boots the interactive debugger on a free (or `--port`) port,
  proxies the session API, and serves the embedded UI.
- `shiplightConfig()` wires YAML transpilation, `.env` discovery, and the HTML
  reporter into a Playwright config.
- `shiplight report`, `transpile`, and `inspect` behave as documented; `transpile`
  validates as well as transpiles, warning on low action coverage by default and
  failing (non-zero exit, same figures) under `--strict`.
- `shiplight spec yaml` / `spec actions` print the authoring references shipped
  inside the package, so the whole authoring loop — scaffold, read spec, write
  YAML, validate strict — works offline with no MCP server.

### Implementation / System Invariants

- YAML transpiles to a correct Playwright spec (header, imports, fixture
  signature, agent calls, execution annotations) and fails loudly on bad YAML.
- The testContext Proxy resolves variables and override semantics over the shared
  VariableStore.
- Per-test context options override project `use`, and a drift guard fails if
  Playwright adds an unclassified context option.
- `.env` discovery walks to the project root with closest-wins precedence over
  `process.env`.
- Action-entity caching no-ops without a token and keys entries on a stable
  statement hash.
- The scaffolded `package.json` pins `shiplightai` to `^<running CLI version>` —
  never a floating dist-tag — in BOTH the fresh-write path and the agent-merge
  template; the version comes from the CLI's own package.json, not a placeholder.
- The action-coverage rule has exactly one implementation
  (`isBelowCoverageThreshold` in shiplight-types); strict and default modes agree
  on the figures and differ only in verdict and exit code.
- TestFlow ↔ YAML conversion is stable, idempotent, and preserves captured
  locators/assertions (moved here from 003 with the transpiler).
- Shipped spec documents contain no `shiplight://` URI; `spec actions` renders
  from the engine's action registry at build time, filtered to transpilable
  actions, and never advertises `element_index` (live-session-only) as a YAML
  kwarg.
- Post-scaffold env guidance presents both credential paths token-first
  (`npx shiplight login` → `SHIPLIGHT_API_TOKEN`, then provider keys), with the
  human prose and the `--json` instruction in lockstep per state.
- The debugger file tree lists only directories under the project root of the
  invocation. Its persisted expansion state is keyed per root and stored relative
  to it, so state left by another project — all projects share one `localhost`
  origin, hence one browser storage bucket — can never make the CLI scan outside
  the current directory.

### Risk-Based Behaviors

- Only the explicit env-var allowlist reaches the agent SDK; shell/CI secrets
  (PATH/HOME/GITHUB_TOKEN/AWS_*/NPM_TOKEN/…) are never visible to the agent, and
  the SDK env is sourced exclusively from `buildSdkEnv()` with no `process.env`
  bypass.
- Cloud report upload routes by token type (`shp_pat_*`/`shp_ctx_*` → the Shiplight proxy, UUID
  → v1) and never hits the wrong host.
- The CLI blocks running from a global install and warns (non-blocking) on stale
  versions, suppressed in CI/dev.
- Scaffolding into an existing repo must never overwrite the user's config — it
  surfaces conflicts for merge and rejects path escapes (data-loss guard, moved
  here from 003 with the scaffolder).
- The authoring references must not mislead agents into valid-but-broken tests:
  a parameter advertised by `spec actions` that the transpiler silently drops
  (the `element_index` class) produces statements that validate clean and run
  with no target.

### Operational / Release Behaviors

- Release-critical and P1 logic has at least one deterministic `pr-ci` gate.
- Command-level runtime (`create`, real `test` spawn, `debug` boot) is exercised
  by a keyless browser lane that runs in CI.
- The env-allowlist security seam shared with the MCP server (003) stays provable
  on the CLI side.

### Stakeholder Confidence Goals

- The published package can ship without silently leaking developer/CI secrets to
  an LLM.
- The first-run scaffold and the primary `test` command keep working across
  Playwright upgrades.
- Release reviewers can separate gated structural proof from the deferred,
  network- or key-dependent residuals.

## Evidence Strategy

| What | Risk | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Env-var allowlist + no-bypass wiring | Leaks dev/CI secrets to an LLM | unit, static, e2e | unit + static wiring guard | the boundary is deterministic; two cheap gated layers prove contents and wiring | live agent-process env is only a belt-and-suspenders e2e away |
| YAML → spec transpilation | Breaks every YAML test | unit, integration, e2e | unit + integration pipeline + roundtrip unit (from 003) | codegen is deterministic and high-signal as text | generated specs are not compiled/run inside the gate |
| `transpile --strict` verdict | Agents and humans get contradictory answers | unit | threshold unit (shiplight-types) + arg-parsing unit | one rule implementation; verdict derived from shared stats | strict e2e through built cli.js not gated |
| `spec yaml`/`spec actions` assets | Stale/wrong authoring reference ships | unit, static | asset-resolution unit + rendered-doc guards (no element_index kwarg, no shiplight:// URI, targeting note present) | render is build-time deterministic; guards negative-tested | doc guards skip when dist/spec is unbuilt (pre-build CI lane) |
| `test` command real run + exit codes | Primary command breaks for all users | unit, e2e | unit args + keyless browser e2e | arg parsing is cheap to pin; spawn/exit-code needs a real run | non-core flag forwarding is only indirect |
| `create` scaffold + merge contract + `--json` | First-run blocked; user config clobbered; agent path lossy | unit, integration, e2e | scaffolder unit (in-package now) + create command unit + create e2e | merge/path-safety and payload shape are deterministic | full create→install→run network chain is not gated |
| Version pinning (no dist-tag) | Scaffolds silently float or go stale | unit | `toDependencyRange` unit + command-seam unit (real running version) + merge-template assertion | pin policy and version resolution are deterministic | none significant |
| `debug` server boot | Headline debugger broken | unit, e2e | unit + boot e2e | server surface is unit-testable; binding/serving needs a real boot | live session SSE depth needs a keyed e2e |
| Debugger file-tree scope | Debugger scans (or ENOENTs on) sibling projects; restored state names paths outside the run | unit, e2e | storage-module unit over an injected fake `Storage` | the scoping rule is pure path logic once lifted out of the component; the repo has no DOM test lane | the React wiring that calls it is not itself gated; the server still accepts any absolute path (see FR-023) |
| Context-option merge | Silent viewport/locale drift on PW upgrade | unit | unit + drift guard | merge logic is deterministic; guard catches PW drift | guard depends on PW internal shape |
| Dotenv precedence | Wrong key/base URL for the whole run | unit | unit | discovery/merge is deterministic | load-once startup timing not asserted |
| Action-entity cache | Cache thrash or unauthenticated calls | unit, integration | unit (client + store) | hashing and no-op are deterministic | cloud path only via no-op/error tests |
| Report merge + cloud routing | Lost shard results / wrong host | unit, integration | unit routing + subprocess merge | routing is deterministic; merge delegated to PW | merged HTML content not asserted |
| Version / global-install guards | Wrongly blocks or fails to warn | unit | unit | semver/guard logic is deterministic | async fire-and-forget timing not asserted |
| `inspect` output | Low-blast diagnostic | unit | unit | parse/emit is deterministic | suite `--stats` branch not separately asserted |

## Scope

- User stories covered:
  `User Story 1`–`User Story 6`
- Primary requirements covered:
  `FR-001`–`FR-019` (`FR-018` is the roundtrip contract moved from 003 `FR-007`)
- Success criteria covered:
  `SC-001`–`SC-008`
- Implementation/system invariants covered:
  transpilation shape, context-option merge + drift guard, dotenv precedence,
  variable resolution, action-cache hashing/no-op
- Out of scope:
  the shared engine internals (owned by `001`), the live browser-session surface
  (owned by `003`), staging/prod observations, and the full create→npm install→run
  network chain. This feature now owns the entire authoring boundary — the
  scaffolder and its templates live in `apps/cli/src/scaffold/`, and the CLI has no
  `mcp-tools` dependency.

## Test Cases

### 002-SHIPLIGHTAI-CLI-T01 Env-Var Allowlist And No-Bypass Wiring

- Testing what:
  Only allowlisted env vars reach the agent SDK, and the fixture sources the SDK
  env exclusively from `buildSdkEnv()`.
- User stories:
  `User Story 1`
- Requirements:
  `FR-006`, `FR-007`
- Success criteria:
  `SC-001`
- Preconditions:
  - Required data:
    a process env containing both allowlisted and non-allowlisted keys
- Automated checks:
  ```bash
  cd apps/cli && pnpm test:unit
  ```
- Steps:
  1. Run the allowlist unit suite and assert exactly the allowlist is copied and
     secrets are stripped.
  2. Run the wiring guard and assert exactly one `configureSdk` call sourced only
     from `buildSdkEnv()`.
- Optional stronger evidence:
  - Browser / UI automation:
    e2e that observes the live spawned agent process env
- Pass criteria:
  - Non-allowlisted keys never appear in the SDK env.
  - The fixture has no `process.env` bypass.
- Cleanup:
  - none
- If not executable:
  - Mark `BLOCKED` if the unit lane cannot run.

### 002-SHIPLIGHTAI-CLI-T02 YAML Transpilation

- Testing what:
  YAML tests transpile to correct Playwright spec files and bad YAML fails loudly.
- User stories:
  `User Story 1`, `User Story 5`
- Requirements:
  `FR-001`, `FR-005`
- Success criteria:
  `SC-002`
- Preconditions:
  - Required data:
    valid and invalid sample YAML test files
- Automated checks:
  ```bash
  cd apps/cli && pnpm test:unit
  cd apps/cli && pnpm test:logic
  ```
- Steps:
  1. Run the transpile unit suite for generated header/imports/annotations.
  2. Run the integration pipeline for full YAML→spec conversion.
- Optional stronger evidence:
  - Script / static:
    gated `tsc`/run of a transpiled spec against fixture HTML
- Pass criteria:
  - Generated spec text matches the expected shape; invalid YAML throws.
- Cleanup:
  - none
- If not executable:
  - Mark `DEFERRED` for the compile/run-the-output proof until it exists.

### 002-SHIPLIGHTAI-CLI-T03 `shiplight test` Real Run And Exit Codes

- Testing what:
  Flags forward verbatim, variables apply, and the real Playwright spawn
  propagates pass/fail exit codes.
- User stories:
  `User Story 1`
- Requirements:
  `FR-001`, `FR-007`
- Success criteria:
  `SC-004`
- Preconditions:
  - Required data:
    built `dist/cli.js` and keyless fixture specs (passing + failing)
  - Required external services:
    none (keyless Chromium)
- Automated checks:
  ```bash
  cd apps/cli && pnpm test:unit
  cd apps/cli && pnpm test:browser
  ```
- Steps:
  1. Run the arg-parsing unit suite.
  2. Run the keyless browser e2e: a passing spec exits 0, a failing one exits
     non-zero; the vars e2e proves CLI→env→fixture→testContext.
- Optional stronger evidence:
  - Browser / UI automation:
    assert a forwarded `--grep` selects the expected subset end-to-end
- Pass criteria:
  - Flags forward verbatim; exit codes propagate correctly.
- Cleanup:
  - none
- If not executable:
  - Mark `SKIPPED` if the built dist is unavailable.

### 002-SHIPLIGHTAI-CLI-T04 `shiplight create` Scaffold

- Testing what:
  Scaffolding produces a valid, runnable project wired with `shiplightConfig()`.
- User stories:
  `User Story 2`, `User Story 4`
- Requirements:
  `FR-002`, `FR-004`
- Success criteria:
  `SC-004`
- Preconditions:
  - Required data:
    a writable temp directory and built `dist/cli.js`
- Automated checks:
  ```bash
  cd apps/cli && pnpm test:logic
  pnpm --filter mcp-tools test:unit
  cd apps/cli && pnpm test:browser
  ```
- Steps:
  1. Run the scaffolder-core unit suite.
  2. Run the standalone-export logic test.
  3. Run the create e2e: spawn the built CLI and assert scaffolded files, ESM
     `package.json`, and `shiplightConfig` wiring.
- Optional stronger evidence:
  - Script / static:
    nightly job that `npm install`s and runs the scaffolded example
- Pass criteria:
  - Expected files exist and the config spreads `shiplightConfig()`.
- Cleanup:
  - remove the temp scaffold directory
- If not executable:
  - Mark `DEFERRED` for the full network install→run chain.

### 002-SHIPLIGHTAI-CLI-T05 `shiplight debug` Server Boot

- Testing what:
  The debugger binds a port, serves the session API, and tears down cleanly.
- User stories:
  `User Story 3`
- Requirements:
  `FR-003`
- Success criteria:
  `SC-004`
- Preconditions:
  - Required data:
    a fixture YAML and built `dist/cli.js`
- Automated checks:
  ```bash
  cd apps/cli && pnpm test:unit
  cd apps/cli && pnpm test:browser
  ```
- Steps:
  1. Run the debugger index/manager unit suites.
  2. Run the boot e2e: bind a port, `GET /api/debugger/sessions` → `200 []`, and
     confirm clean teardown.
- Optional stronger evidence:
  - Browser / UI automation:
    keyed e2e that creates a session and runs one statement via SSE
- Pass criteria:
  - The server binds, serves the session API, and tears down.
- Cleanup:
  - terminate the spawned debug process and free the port
- If not executable:
  - Mark `DEFERRED` for the interactive live-session depth.

### 002-SHIPLIGHTAI-CLI-T06 Plumbing: Context Options, Dotenv, Cache, Version, Report, Inspect

- Testing what:
  Per-test context merge + drift guard, dotenv precedence, action-entity cache,
  version/global-install guards, report cloud routing, and `inspect` output all
  behave as specified.
- User stories:
  `User Story 4`, `User Story 5`
- Requirements:
  `FR-005`, `FR-008`, `FR-009`, `FR-010`, `FR-011`
- Success criteria:
  `SC-003`
- Preconditions:
  - Required data:
    sample configs, nested `.env` files, sample tokens, shard report dirs, and
    sample YAML
- Automated checks:
  ```bash
  cd apps/cli && pnpm test:unit
  ```
- Steps:
  1. Run the context-option, dotenv, cache, version, cloud-upload, report, and
     inspect unit suites.
  2. Inspect that override precedence, closest-wins env, stable cache hashing,
     token-type routing, and `inspect` JSON/`--stats`/error exits are covered.
- Optional stronger evidence:
  - Integration:
    stubbed-API integration for the cloud cache and report-merge content
- Pass criteria:
  - Each plumbing invariant is proven by a deterministic gated assertion.
- Cleanup:
  - none
- If not executable:
  - Mark `BLOCKED` if the unit lane cannot run.

### 002-SHIPLIGHTAI-CLI-T07 Authoring Surface Without An MCP Server

- Testing what:
  The authoring loop is CLI-complete and version-locked: `create` pins
  `^<running version>` (fresh write AND merge template, never a dist-tag),
  `create --json` emits the non-lossy agent payload with lockstep env guidance,
  `transpile --strict` fails on low coverage with the same figures the default
  mode warns with, `spec yaml`/`spec actions` resolve from the built assets, and
  the shipped docs are MCP-free with no `element_index` advertised as a YAML
  kwarg.
- User stories:
  `User Story 2`, `User Story 5`, `User Story 6`
- Requirements:
  `FR-002`, `FR-013`, `FR-014`, `FR-015`, `FR-016`, `FR-017`, `FR-018`, `FR-019`
- Success criteria:
  `SC-005`, `SC-006`, `SC-007`, `SC-008`
- Preconditions:
  - Required data:
    temp directories; `dist/spec/` built (`pnpm build` or the render script) for
    the doc guards — they self-skip pre-build
- Automated checks:
  ```bash
  cd apps/cli && pnpm test:unit
  pnpm --filter shiplight-types test
  ```
- Steps:
  1. Run the CLI unit lane: `scaffold/index.test.ts` (merge contract, path safety,
     `toDependencyRange`, no-write-on-bad-version), `commands/create.test.ts`
     (real-version pin both paths, `--json` shape, env-guidance lockstep),
     `commands/transpile.test.ts` (`--strict` arg parsing), `commands/spec.test.ts`
     (asset resolution + rendered-doc guards), `cliVersion.test.ts` (version
     resolution in all three layouts).
  2. Run the shiplight-types lane for `isBelowCoverageThreshold` (verdict agrees
     with the emitted warning; boundary/empty/absent-stats cases).
- Optional stronger evidence:
  - Script / static:
    an e2e that runs the built `dist/cli.js` through create → spec yaml →
    transpile --strict in a container with no MCP server configured (US6's
    independent test, currently exercised manually)
- Pass criteria:
  - All suites pass; the doc guards ran against a built `dist/spec/` (not skipped)
    in at least the release lane.
- Cleanup:
  - temp directories are removed by the suites
- If not executable:
  - Mark `BLOCKED` if the unit lanes cannot run.

### 002-SHIPLIGHTAI-CLI-T08 Debugger File-Tree Scope

- Testing what:
  Persisted file-tree state cannot make `shiplight debug` list directories
  outside the project root it was launched in.
- User stories:
  `User Story 3`
- Requirements:
  `FR-023`
- Success criteria:
  `SC-004`
- Preconditions:
  - Required data:
    none — the storage module takes an injected `StorageLike` fake
- Automated checks:
  ```bash
  pnpm --filter debugger-ui test:unit
  ```
- Steps:
  1. Save expanded directories under project A's root, load under project B's
     root, and assert nothing is restored.
  2. Assert the persisted JSON holds root-relative paths only, that out-of-root
     paths are dropped on save, and that a sibling directory whose name merely
     starts with the root string is treated as outside it.
  3. Assert the legacy unscoped key migrates only in-root entries and is then
     deleted, so the cross-project leak cannot recur.
  4. Assert a hand-edited entry containing a `..` segment is refused on read, on
     save, and during legacy migration, and that re-keying to a resolved root
     keeps directories toggled while the tree was still loading.
- Optional stronger evidence:
  - Browser / UI automation:
    boot the debugger in two sibling projects in one browser profile and assert
    the server logs no read outside the current root
- Pass criteria:
  - No restored or persisted path resolves outside the current project root.
- Cleanup:
  - none (in-memory fake storage)
- If not executable:
  - Mark `DEFERRED` for the two-project browser check; the unit lane still gates
    the storage rule.

## Fixtures And Environments

### Local Development

- Browser surface:
  keyless Chromium against built `dist/cli.js` and local fixture specs
- Accounts / roles:
  none
- External service fixtures:
  optional Shiplight token only for cloud-path exploration
- Mutation policy:
  `fixture_only`
- Known local limitations:
  the browser lane requires a built dist; the full network install chain is not run

### PR CI

- Browser surface:
  deterministic unit + logic suites plus the keyless `test:browser` lane
- Accounts / roles:
  none
- External service fixtures:
  none by default
- Mutation policy:
  `fixture_only`
- Known limitations:
  network installs, keyed debug sessions, and live cloud uploads are outside the gate

### Keyed / Live (Deferred)

- Browser surface:
  a real `debug` session with SSE streaming or a full create→install→run chain
- Accounts / roles:
  provider key and/or Shiplight token as required
- External service fixtures:
  npm registry, provider API, and cloud upload endpoints
- Mutation policy:
  `case_by_case`
- Known limitations:
  expensive and non-default; unsuitable as the only proof for core behavior

## Report Expectations

- Record gated unit/logic/browser results separately from deferred network/keyed
  residuals so the structural proof story stays clear.
- Put blocking failures before residual risk.
- Distinguish structural proof gaps from environment-dependent deferrals.
- Record exact commands and results; negative-path log lines are not failures.
- Never include secrets, tokens, or raw provider/cloud responses.

## Coverage Notes

- Every expectation in `quality-map.yaml` should map to at least one test case
  here and at least one executable command in the report.
- The env-allowlist seam is shared with feature `003`; keep the CLI-side proof
  explicit rather than assuming MCP coverage.
- Prefer stable ids and file paths so downstream observation/evaluation systems
  can join without heuristics.
