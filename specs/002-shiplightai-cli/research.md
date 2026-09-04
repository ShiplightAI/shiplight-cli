# Phase 0 Research: shiplightai CLI & Playwright Library

Reconstructed. No open `NEEDS CLARIFICATION`; the decisions below are observable in
`apps/cli` and are recorded so a future change knows which are load-bearing.

## D1 — Authoring and execution ship as one artifact

**Decision**: The YAML language spec, the validator, the transpiler and the runtime
all live in `shiplightai` and version together (FR-013, FR-014).

**Rationale**: Validation released separately let an agent validate green against one
schema and fail at runtime against another, with nothing detecting the skew. Same for
the language spec: a normative document on its own cadence can describe syntax the
installed parser rejects.

**Alternatives considered**: A separate `shiplight-tools` package — this was the real
prior state and was folded back into `apps/cli` in August 2026 once it had exactly one
consumer. A schema-version negotiation protocol — rejected as more machinery than
shipping one artifact.

## D2 — One source for the action vocabulary, rendered at build time

**Decision**: `shiplight spec actions` renders from the engine's action registry at
package build time (`scripts/render-spec-assets.mts`), not by importing the registry
at runtime (FR-015).

**Rationale**: Two authored copies drift. Importing the registry at runtime would drag
the whole engine barrel into `cli.js` and inflate the tarball for a documentation
command.

**Alternatives considered**: Runtime import — rejected on bundle weight. A checked-in
authored copy — rejected as the drift this decision exists to prevent.

## D3 — The CLI owns the environment boundary

**Decision**: Only an explicit allowlist reaches the SDK, via `buildSdkEnv()`
(FR-006). `.env` discovery walks to the project root with closest-wins precedence
(FR-008).

**Rationale**: This is the other half of the engine's "no ambient env" rule (001
FR-010). Without a single choke point, `PATH`, `HOME`, `GITHUB_TOKEN` and `AWS_*`
would be visible to an agent driving a browser.

**Alternatives considered**: A denylist — rejected: it fails open on every new
variable. Letting the engine filter — rejected: puts the boundary in a package that
cannot know the host's context.

## D4 — Raw `process.argv` instead of an argument parser

**Decision**: `src/cli.ts` dispatches on `process.argv` directly.

**Rationale**: Every Playwright flag must forward verbatim (FR-001). A parser that
understands flags would have to be taught each one and would reject unknown flags that
Playwright accepts.

**Alternatives considered**: `commander` — it was a declared dependency but never
imported, and was removed in August 2026. Pass-through mode in a parser — more
configuration than the dispatch it replaces.

## D5 — Transpile with mtime caching and a version stamp

**Decision**: Generated specs are stamped with the real `shiplightai` version
(FR-017) and regenerated only when the YAML, a referenced template, or the transpiler
version changes.

**Rationale**: The stamp makes a generated file identify its producer, which is what
lets the cache invalidate correctly across upgrades.

**Alternatives considered**: Always regenerate — rejected on cost for large suites. A
placeholder version — explicitly forbidden by FR-017.

## D6 — Strict and default transpile share one implementation

**Decision**: `--strict` changes only the verdict and exit code; the coverage figure
is computed once (FR-013, SC-006).

**Rationale**: An agent and a human must not get opposite verdicts on identical YAML.
Two code paths would drift.

**Alternatives considered**: A separate strict validator — the exact failure mode the
requirement forbids.

## D7 — Debugger as an outer/inner server pair

**Decision**: An outer Express server (port 6174) reverse-proxies an inner server
(16174) running inside `npx playwright test`, which holds the real page and agent.

**Rationale**: The agent must run inside Playwright's process to hold a live `Page`,
but the UI needs a stable long-lived host that survives test restarts.

**Alternatives considered**: One server inside Playwright — dies with the test run.
One server outside — cannot reach the live page.

## D8 — Shipped documents never reference MCP URIs

**Decision**: Documents inside the package point at CLI commands, never
`shiplight://` resources (FR-016), enforced by a guard rather than review.

**Rationale**: They are read in CI, plain terminals, and by non-MCP agents where no
resolver exists.

**Alternatives considered**: Conditional text — unverifiable. Review discipline —
rejected; SC-008 requires a guard that fails on reintroduction.
