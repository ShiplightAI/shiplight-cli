# Feature Specification: shiplightai CLI & Playwright Library

**Feature Branch**: `002-shiplightai-cli`
**Created**: 2026-06-07
**Status**: Draft (reconstructed from implementation)
**Input**: Brownfield reconstruction of `apps/cli` — the published `shiplightai` npm package (CLI + Playwright library). Depends on the engine (001).

## Reconstruction Note

Reconstructed from current code + public docs. Source types:

- **[SOURCE]** — endorsed by https://docs.shiplight.ai/local/cli-reference or `apps/cli/README.md`.
- **[IMPL]** — observed from current implementation.

Quality evidence: [.quality/evidence/002-shiplightai-cli/](../../.quality/evidence/002-shiplightai-cli/quality-map.yaml).
The interactive debugger (`shiplight debug`) is owned by this feature; the hosted
testbox simply runs the same debug server. (Older testbox debugger drafts are
archived under `specs/_archive/`, anecdote only.)

## Scope Boundary

This feature owns **test authoring** — scaffolding, the normative YAML language
spec, validation, and YAML→spec transpilation — alongside test execution. The MCP
server (003) owns live browser sessions and nothing else; see its Scope Boundary.

The rule is that the artifact which _defines and validates_ a test must ship and
version with the artifact that _runs_ it. Validation living in a separately
released package let an agent validate green against one YAML schema and fail at
runtime against another, with nothing detecting the skew. Same for the language
spec: a normative document distributed on its own cadence can describe syntax the
installed parser does not accept.

Two consequences that constrain the design:

- The action vocabulary has **one source** (the engine's action registry) and two
  renderers — this feature's `shiplight spec actions` and 003's action-entity
  resource. Neither may hold an authored copy.
- Documents shipped inside `shiplightai` are read in contexts with no MCP server
  at all (CI, a plain terminal, a non-MCP agent), so they may not point at
  `shiplight://` URIs.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Run YAML + Playwright tests with one command (Priority: P1)

A developer with `shiplightai` installed runs `shiplight test [flags]`. Their
`.test.yaml` files are transpiled to runnable specs and executed alongside their
existing `.test.ts` files; all Playwright flags (`--headed`, `--grep`,
`--workers`, …) are forwarded verbatim, and variable overrides (`--vars`,
`--vars-file`) are applied.

**Why this priority**: This is the primary, most-used command — the product's core
loop for running tests locally and in CI.

**Independent Test**: Run a trivial suite and confirm flag forwarding, YAML
transpilation, variable injection, and pass/fail exit-code propagation.

**Acceptance Scenarios**:

1. **Given** a project with a `.test.yaml`, **When** `shiplight test` runs, **Then** the YAML is transpiled and executed with the Playwright runner.
2. **Given** `--grep`/`--headed`/`--workers` (and escaped grep values), **When** passed, **Then** they are forwarded verbatim to Playwright.
3. **Given** `--vars k=v` / `--vars-file f.json`, **When** passed, **Then** the values reach the test context with allowlist + sensitivity semantics.
4. **Given** only `SHIPLIGHT_API_TOKEN` (no provider key), **When** `shiplight test` runs, **Then** it resolves the model tier once via a pre-test org-settings fetch (pinned for the run) and fails fast — before spawning Playwright — on an authoritative token rejection; **When** `--offline`/`SHIPLIGHT_OFFLINE` is set, **Then** the fetch is skipped and built-in per-tier defaults are used.

### User Story 2 — Scaffold a runnable project (Priority: P1)

`shiplight create <path>` scaffolds a project that installs and runs: a
`package.json`, a `playwright.config.ts` wired with `shiplightConfig()`, an
`.env.example`, a `.gitignore`, and a runnable example `.test.yaml`.

It is safe to run against a repo that already has its own `package.json`,
`.gitignore`, `.env.example`, or `.mcp.json`: files that do not exist are written,
and files that do exist are left untouched and reported as conflicts with the
template content and a per-file merge strategy, for the caller to apply.

`--json` emits that same result as a structured payload instead of prose, so a
coding agent gets the per-file template, strategy, and instructions it needs to
perform the merges itself — preserving the user's comments, formatting, and
unrelated fields better than a generic merger could.

**Why this priority**: The first-run experience; a broken template blocks every
new user. The agent-facing `--json` mode is the sole scaffolding entry point for
coding agents once 003 stops exposing a scaffold tool, so a regression here breaks
agent-driven setup entirely.

**Independent Test**: Scaffold into a temp dir and confirm the expected files and
a valid, runnable example exist; scaffold into a populated dir and confirm no
existing file is modified and every conflict is reported; run with `--json` and
confirm the payload parses and carries template + strategy per conflicted file.

**Acceptance Scenarios**:

1. **Given** `shiplight create ./x`, **When** it completes, **Then** the expected files exist and `playwright.config.ts` spreads `shiplightConfig()`.
2. **Given** a target directory that already contains a `package.json`, **When** `shiplight create .` runs, **Then** that file is not modified and it is reported as needing a merge, with the template content and a merge strategy.
3. **Given** `--json`, **When** the command completes, **Then** stdout is a single parseable object carrying files created, files skipped, and per-conflict template/strategy/instructions — and no human-formatted prose is interleaved into it.

### User Story 3 — Debug a YAML test interactively (Priority: P1)

`shiplight debug <file>` launches an interactive visual debugger on an
auto-selected free port (or `--port N`), running the target YAML in a real
browser with step-by-step inspection. Multiple concurrent invocations work
without port coordination.

**Why this priority**: A headline capability and the same engine the hosted
testbox embeds.

**Independent Test**: Boot the debugger on a fixture YAML and drive at least one
statement; assert the server binds, proxies session APIs, and serves the UI.

**Acceptance Scenarios**:

1. **Given** `shiplight debug foo.test.yaml`, **When** it starts, **Then** it binds a free port (or `--port`) and serves the debugger UI with a live session.
2. **Given** only `SHIPLIGHT_API_TOKEN`, **When** `shiplight debug` starts, **Then** it runs the same org-settings pre-flight as `shiplight test` — warning (not aborting) on a rejected token — so debug sessions use the same tier-selected model; `--offline` skips it.

### User Story 4 — Wire Shiplight into an existing Playwright project (Priority: P2)

A developer imports `{ defineConfig, shiplightConfig }` from `shiplightai` and
spreads `shiplightConfig()` into their config to enable YAML transpilation, `.env`
discovery, and the HTML reporter.

**Acceptance Scenarios**:

1. **Given** `shiplightConfig()` is spread into `playwright.config.ts`, **When** tests run, **Then** YAML support, `.env` discovery, and the reporter are active.

### User Story 5 — Reports, transpile, inspect (Priority: P2)

`shiplight report` regenerates/merges HTML reports (with cloud upload routing by
token type); `shiplight transpile` converts YAML to spec files and validates them;
`shiplight inspect` prints the parsed TestFlow JSON / stats for a YAML file.

`transpile` reports low action coverage — statements still bare DRAFTs with no
`action`/`js` — as a warning by default, because a human iterating on a test wants
to run what they have. `--strict` promotes it to a failure, because an agent
writing tests must be pushed back to the browser to capture real locators rather
than shipping a suite that re-detects every element with the model.

**Acceptance Scenarios**:

1. **Given** multiple shard report dirs, **When** `shiplight report` merges them, **Then** a single combined HTML report is produced, whatever the combined size of the shards.
2. **Given** a run whose tests carry a large variable store, **When** the report is written, **Then** each step records only the variables that changed since the previous step, and no single variable value is recorded beyond the display cap.
3. **Given** a YAML file, **When** `shiplight inspect` runs, **Then** it prints the TestFlow JSON (or `--stats`) and exits non-zero on a missing/malformed file.
4. **Given** a YAML file below the action-coverage threshold, **When** `shiplight transpile` runs without `--strict`, **Then** it warns and still emits the spec file; **When** it runs with `--strict`, **Then** it fails, reports the coverage figures, and states what to do about it.

### User Story 6 — Author tests without an MCP server (Priority: P1)

A developer or coding agent can scaffold a project, read the normative YAML
language spec and the supported action vocabulary, write `.test.yaml` files, and
validate them — using only the installed `shiplightai` package. `shiplight spec
yaml` prints the language spec; `shiplight spec actions` prints the action
vocabulary and each action's parameters.

**Why this priority**: It is what makes the 002/003 boundary real. Authoring must
not require an MCP client, and — more importantly — the spec an author reads must
be the spec the installed parser enforces. Shipping it with the CLI makes that
true by construction rather than by release coordination.

**Independent Test**: In a container with no MCP server configured, install the
package, scaffold, read both spec outputs, write a YAML test, and validate it with
`--strict` — all offline after install.

**Acceptance Scenarios**:

1. **Given** an installed `shiplightai` and no MCP server, **When** `shiplight spec yaml` runs, **Then** it prints the normative YAML language spec for that installed version.
2. **Given** the same, **When** `shiplight spec actions` runs, **Then** it prints every action the installed engine supports with its parameters, and no action it does not support.
3. **Given** any document shipped inside the package, **When** it is inspected, **Then** it contains no `shiplight://` resource URI, since those cannot resolve without an MCP server.

### Edge Cases

- The CLI MUST refuse to run from a global install and warn when a newer version is available (suppressed in CI/dev).
- Per-test context options (viewport/locale/colorScheme) override project `use`; `viewport: null` drops incompatible options.
- Closest `.env` wins over parent `.env` and over `process.env`.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001 [SOURCE]**: `shiplight test` MUST run mixed YAML + `.test.ts` suites and forward all Playwright flags verbatim.
- **FR-002 [SOURCE]**: `shiplight create` MUST scaffold a runnable project wired with `shiplightConfig()`. It MUST be safe against a populated directory: never modify a file that already exists, and report each such file with the template content and a merge strategy.
- **FR-003 [SOURCE]**: `shiplight debug` MUST launch the interactive visual debugger on an auto-selected (or `--port`) port; concurrent invocations MUST not require port coordination.
- **FR-004 [SOURCE]**: `shiplightConfig()` MUST wire YAML transpilation, `.env` discovery, and the HTML reporter into a Playwright config.
- **FR-005 [SOURCE]**: `shiplight report`, `transpile`, and `inspect` MUST be available with their documented behavior.
- **FR-006 [SOURCE]**: The CLI MUST forward only an explicit env-var allowlist into the SDK; non-allowlisted vars (PATH/HOME/GITHUB*TOKEN/AWS*\*/…) MUST be invisible to the agent.
- **FR-007 [IMPL]**: `--vars`/`--vars-file`/`SHIPLIGHT_VARS_OVERRIDE` MUST apply with allowlist + sensitive-flag semantics into the test context.
- **FR-008 [IMPL]**: `.env` discovery MUST walk to the project root with closest-wins precedence over `process.env`.
- **FR-009 [IMPL]**: The CLI MUST block running from a global install and warn (non-blocking) when behind the latest published version, suppressed in CI/dev.
- **FR-010 [IMPL]**: Report cloud upload MUST route by token type (`shp_*` → the Shiplight proxy), honoring `SHIPLIGHT_API_URL`, and promote report URLs to absolute web hosts. A token of any other shape resolves to no host: the upload MUST be skipped with an actionable message rather than posting to a dead endpoint or failing a run that has already produced its results.
- **FR-011 [IMPL]**: Action-entity locator caching MUST be a no-op without a token and key cache entries by a stable statement hash.
- **FR-012 [IMPL]**: The reporter MUST fold a per-run LLM usage summary (per operation/provider/model/routing token buckets, routing detected per provider from the `.env` stash) into `report-data.json` at report time, sum it across shards on merge, and carry it on the run-complete upload. Carries counts only — never prompt/response content. The `model` bucket key is the **bare upstream id** (any `provider:` routing prefix stripped), matching the platform's `llm_models` reconciliation. (Runner half of the cloud service spec 047; testing contract: [run-usage-summary/test-spec.md](./run-usage-summary/test-spec.md).)
- **FR-013**: `shiplight transpile` MUST validate as well as transpile, and MUST expose a strict mode. Default: insufficient action coverage is a warning and the spec file is still emitted. `--strict`: it is a failure with a non-zero exit, reporting the coverage figures and the remedy. There MUST be exactly one implementation of this rule — an agent and a human MUST NOT be able to get opposite verdicts on identical YAML.
- **FR-014**: The normative YAML language spec MUST ship inside the `shiplightai` package and be printable via `shiplight spec yaml`, so it is version-locked to the transpiler that enforces it. It MUST NOT be duplicated into the skills distribution, which releases on its own cadence.
- **FR-015**: `shiplight spec actions` MUST render the supported action vocabulary and parameters from the engine's action registry — the same source 003's action-entity resource renders from. Neither surface may hold an authored copy. Rendering MUST happen at package build time, not by importing the registry at runtime, so the command adds no bundle weight to `cli.js`.
- **FR-016**: Documents shipped inside the package MUST NOT reference `shiplight://` MCP resource URIs; they MUST point at CLI commands instead, since they are read in contexts with no MCP server.
- **FR-017**: Transpiled spec files MUST be stamped with the real `shiplightai` version. No caller may substitute a placeholder — a generated spec MUST always identify the build that produced it.
- **FR-018 [IMPL]**: TestFlow ↔ YAML conversion MUST be stable/idempotent and preserve captured locators/assertions. (Moved from 003 FR-007; the conversion is this feature's transpiler contract, not the MCP server's.)
- **FR-019**: `shiplight create --json` MUST emit FR-002's result as a single parseable object on stdout — files created, files skipped, and per-conflict path, template, merge strategy, and instructions — with no prose interleaved. This is the agent-facing scaffolding contract that replaces 003's scaffold tool; the payload MUST NOT be lossy relative to the human output.
- **FR-020 [IMPL]**: When only `SHIPLIGHT_API_TOKEN` is set (no direct provider key), `shiplight test` and `shiplight debug` MUST resolve the model tier once per run via a pre-test org-settings fetch (`GET /org-settings`, pinned for the run, token-routed like FR-010) and inject it into the spawned Playwright process. `WEB_AGENT_TIER` selects the tier. A network/5xx/timeout/404 degrades to built-in per-tier defaults; an authoritative 401/403 makes `shiplight test` **fail fast before browsers start** (when the run depends on the proxy), while `shiplight debug` warns and continues. `--offline`/`SHIPLIGHT_OFFLINE` skips the fetch. A direct provider key opts out entirely (FR-003 BYOK path). Gated on the endpoint — see `docs/design/llm-tier-selection.md`. The `.env` view is resolved with the same closest-wins precedence as FR-008 in **both** the CLI parent and the spawned child, so the token/tier the fetch sees matches the one the run executes under.
- **FR-022 [IMPL]**: `template:`/`call:` references MUST resolve during transpilation with `<<param>>` substitution, required-param validation, a depth limit, and circular-reference detection. (Held by 003 as its FR-009 until this pass; the resolution runs in the transpiler, so it versions with the parser that consumes it.)
- **FR-021 [IMPL]**: When tier selection governs a run, the reporter MUST record run-level model-tier **provenance** — the tier requested and its source (env / org-default / baked), the resolved primaries, and whether the mapping came from the server or baked defaults — into `report-data.json` and carry it on the run-complete upload. Absent for BYOK/non-tier runs; carries no secret. Server-controlled values MUST be HTML-escaped where rendered.
- **FR-023 [IMPL]**: The `shiplight debug` file tree MUST list only directories inside the project root of the invocation. Because every project's debugger is served from the same `localhost` origin, browser-persisted UI state is shared across projects and MUST be scoped per project root and stored **relative** to it, with any `..`/`.`/empty segment rejected on read, so a restored entry cannot name a path outside the current project. Enforcement today is client-side (`packages/debugger-ui/src/components/local-debugger-shell/expandedDirs.ts`); `GET /api/files` still resolves any absolute path it is handed, so this is an invariant of the shell, not of the server.
- **FR-024 [IMPL]**: Per-step variable snapshots MUST be bounded in size, in `report-data.json` and in the run-complete upload alike. Each recorded value MUST be capped, oversized values replaced by a marker naming the original size; and within one step list each snapshot MUST record only what changed since the previously recorded state, with removed variables named explicitly. The snapshots are display-only — no execution path reads them back — so the encoding MUST be lossless for display: a consumer that applies the recorded changes in order reconstructs exactly the values the run observed, up to the cap. **Both forms MUST stay readable**: a consumer detects the form per step from the fields present, a full snapshot replaces the accumulated state, and an artifact written before this requirement is read without a version negotiation. An uploaded artifact that may carry the changed-only form MUST declare `schemaVersion: 3`. The wire contract is [contracts/report-artifact.md](./contracts/report-artifact.md); testing contract: [report-artifact-size/test-spec.md](./report-artifact-size/test-spec.md).
- **FR-025 [IMPL]**: Cloud run creation MUST be idempotent. `report-data.json` MUST retain one stable client run identity, the create-run payload MUST carry it plus stable per-test identities, and retries MUST reuse the same cloud run/result slots. Shard aggregation is explicitly selected by a caller-provided `SHIPLIGHT_RUN_ID`: when it is present and Playwright reports `config.shard`, the reporter MUST derive `batchId=shard-{current}` and `expectedBatchCount=total`; `SHIPLIGHT_BATCH_ID` / `SHIPLIGHT_BATCH_COUNT` remain explicit overrides. An internally generated per-invocation Run ID MUST NOT opt into aggregation, so shards without a caller-provided shared ID remain separate Test Runs. The first accepted completion fixes that batch's results and analytics, retrying it MUST be a no-op, distinct batches MUST append to the shared run, and the reporter MUST attempt finalization after its batch is accepted so only the last completed batch closes the run. Merged reports MUST preserve the shared identity or derive a deterministic merged identity; when their inputs already used direct batch upload, merge MUST remain local and MUST NOT upload a second legacy completion for the same run.

### Key Entities

- **Fixture / TestContext**: per-test context exposing variables (proxy + methods) over a shared VariableStore.
- **SdkEnv allowlist**: the fixed set of env keys the agent may see (security seam shared with 003).
- **Debugger session**: outer server + inner Playwright process managed per `shiplight debug` invocation.
- **Scaffold plan**: the per-file decision (write / skip / needs-merge) plus, for conflicts, the template, merge strategy, and instructions. One decision layer, two renderers — human prose and `--json`. Presentation-level logic MUST NOT be duplicated per renderer; a decision either lives in the shared layer or it will drift.
- **YAML language spec**: the normative parser contract shipped in the package. Owns which statement keys are reserved and how unrecognized keys are passed through as action arguments. It does **not** enumerate actions — it defers to the action registry.
- **Step variable snapshot**: the display-only record of the test variables as a step saw them, before and after. Produced per step by the engine as a full copy of the store; recorded in the report as a bounded, changed-only delta. It is evidence, never an input — nothing replays, resumes, or asserts from it.
- **Action registry render**: build-time artifact rendering the engine's action registry to markdown for `shiplight spec actions`. Shares its source with 003's action-entity resource; a disagreement between the two surfaces means they were built from different engine versions, which is a signal worth surfacing rather than hiding.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The env-var allowlist contents and the no-bypass wiring (SDK env comes only from `buildSdkEnv()`) are proven by CI-gated tests.
- **SC-002**: YAML→spec transpilation (incl. execution annotations) is proven by CI-gated tests.
- **SC-003**: `shiplight inspect`, version/global-install guards, dotenv precedence, and context-option merge are proven by CI-gated tests.
- **SC-004**: `test` (real Playwright spawn) and `debug` (live session) are validated in the repo's e2e lane; `create` is validated to the point of a scaffolded, transpilable project. The `install → run` leg is proven separately by the public-examples gate in `.github/workflows/publish-cli.yml`, which installs the candidate tarball and runs the suite against it — an in-repo lane cannot prove installability of a package it has not packed.
- **SC-005**: `shiplight create --json` is proven to emit a parseable payload carrying every conflict the human output reports — proving the agent path is not lossy.
- **SC-006**: `transpile` strict vs default is proven to agree on the coverage figure and differ only in verdict and exit code, so agents and humans cannot be given contradictory answers on the same file.
- **SC-007**: The authoring loop is proven with no MCP server present: scaffold → read spec → write YAML → validate strict, offline after install.
- **SC-008**: Single-source rendering is proven — `shiplight spec actions` matches the live action registry, and no document shipped in the package contains a `shiplight://` URI. Both are guards that must fail on reintroduction, not one-time cleanups.
- **SC-009**: Tier selection is proven by CI-gated tests — the org-settings fetch failure policy (skip/degrade/fail-fast/offline), the tier pre-flight for `test` and `debug`, and provenance in `report-data.json` + the run-complete upload — and the CLI parent resolves the same token as the spawned child (no cold-cache split).
- **SC-010**: The report artifact stays bounded and readable at scale, proven by CI-gated tests: a full snapshot round-trips through the changed-only encoding to the same values, a consumer resolves artifacts in the full form, the changed-only form, and a mix of the two, and variable removals and attempt boundaries survive the round trip. Report writing does not fail on report size.

## Assumptions

- Node.js >= 22; the user provides at least one LLM provider key in `.env`.
- `create → install → run`, the real `test` spawn, and a live `debug` session are validated by the deferred e2e/browser lane, not the default CI unit gate.
- Cloud features activate only when a Shiplight token is present.
- The `/shiplight` skills distribution carries authoring _guidance and examples_; this package carries the _normative_ spec. Skills reference the CLI commands rather than embedding a spec copy, so the two cannot disagree about what the parser accepts.
- Moving authoring here trades away the MCP tool descriptions' ambient discoverability — an agent that never loads the skill no longer sees a "scaffold first" instruction. Accepted; see 003's Assumptions.
- Publishing implication: the YAML spec and the rendered action table become build outputs of `apps/cli`, so the existing "run the full `pnpm build`, never bare `tsup`" release rule now also gates authoring docs, not just debugger assets. A partial build ships a package whose `spec` commands are missing or stale.
