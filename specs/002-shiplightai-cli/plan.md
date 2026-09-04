# Implementation Plan: shiplightai CLI & Playwright Library

**Branch**: `feng/workspace` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-shiplightai-cli/spec.md`

**Note**: Reconstructed from the implementation. `shiplightai` ships on npm today;
this plan records the approach that was built and the invariants a change must not
break, not a proposal for unbuilt work.

## Summary

Give a developer one command that runs YAML and Playwright tests together
(FR-001), and give an agent the same authoring loop with no MCP server present
(FR-014..FR-016, SC-007). The package is both a CLI (`shiplight`) and a Playwright
library (`shiplightConfig()`, the `agent` fixture), published from `apps/cli`.

Three constraints shape everything else. **Authoring and running ship together**:
the transpiler that validates a test and the runtime that executes it are one
artifact, so an agent cannot validate green against one schema and fail against
another. **The action vocabulary has one source** — the engine's registry — with two
renderers, and neither may hold an authored copy (FR-015). **The CLI owns the
environment boundary**: only an explicit allowlist reaches the SDK (FR-006), which is
the seam that makes the engine's "no ambient env" rule (001 FR-010) enforceable.

## Technical Context

**Language/Version**: TypeScript 5.5, ESM (with a CJS build for Playwright's `require()` path), Node.js >= 22

**Primary Dependencies**: `playwright` / `@playwright/test` (peer-pinned to avoid duplicate installs), `express` (debug server), `glob`, `yaml`, `open`, `dotenv`, `sharp`, `zod`; `sdk-core` and `shiplight-types` are bundled via tsup `noExternal` rather than shipped as separate packages

**Storage**: The user's project on disk — `.test.yaml` sources, generated `*.yaml.spec.ts`, `report-data.json`, and the action-entity locator cache. No database.

**Testing**: four lanes — `test:unit` (`tsx --test`, includes the yaml-transpiler suite), `test:logic` (Playwright, `playwright.logic.config.ts`), `test:browser` (`*.e2e.test.ts`), and `test:e2e` (real spawn); plus the public examples suite as a release gate

**Target Platform**: developer machines and CI runners; published to npm as `shiplightai` with `bin: shiplight`

**Project Type**: CLI + library, single package with seven entry points (`.`, `./fixture`, `./debugger-pw`, `./debugger-manager`, `./debugger-server`, `./reporter`, plus `bin`)

**Performance Goals**: transpilation is mtime-cached so unchanged YAML costs nothing; a captured action replays with zero model calls (inherited from 001)

**Constraints**: tsup inlines `package.json` into `dist/cli.js`, so a version bump must precede the build. The debugger's static assets come from `packages/debugger-ui` via `scripts/build-debugger-ui.mts` during tsup's `onSuccess`. Documents shipped in the package may not reference `shiplight://` URIs (FR-016).

**Scale/Scope**: 216 tracked files / ~59k lines in `apps/cli`; 23 runtime dependencies

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v2.0.0.*

| Principle | Status | Evidence |
|---|---|---|
| I. Code Quality & Simplicity | **PASS** | ESM-first with a deliberate CJS build for Playwright's loader; strict TypeScript; the August 2026 trim removed the unreachable export surface rather than leaving it dormant. |
| II. Testing Standards | **PASS** | Four lanes separate deterministic logic from browser behaviour; contract-style parity tests hold the transpiler against the engine's action registry. FR-013's single-implementation rule is itself a testing requirement (SC-006). |
| III. User Experience Consistency | **PASS** | Constitution 2.0.0 scopes this principle to the CLI and the debugger UI, which is exactly this feature's surface pair. Error messaging is actionable per the principle. |
| IV. Performance Requirements | **PASS** | Startup, memory discipline and cost-of-unchanged-work (mtime-cached transpilation, model-free replay) are met. The frontend bundle-size clause was removed in constitution 2.0.0 as governing a deployed web app; the debugger is served from local disk. Build performance now also requires a cached build to reproduce its outputs — met since the August 2026 fix to the debugger-ui build. |
| V. Dependency & Code Sharing | **PASS with one deliberate exception** | `apps/cli` imports only from `packages/`, never another app. The exception is build-time: it invokes `packages/debugger-ui`'s vite configs and owns their output under `apps/cli/dist/`. That is an app→package build dependency, not an import, and it exists because the assets must land inside the published tarball. |

**Gate result**: no violations. The bundle-size deviation recorded in this plan's
earlier draft was resolved by constitution 2.0.0 removing the clause.

## Project Structure

### Documentation (this feature)

```text
specs/002-shiplightai-cli/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
├── contracts/                  # CLI command + library surface contracts,
│                               #   incl. report-artifact.md (FR-024 wire contract)
└── run-usage-summary/          # existing test-spec + test-report for FR-012
```

### Source Code (repository root)

```text
apps/cli/
├── src/
│   ├── cli.ts                  # argv dispatch (raw process.argv, no parser lib)
│   ├── commands/               # test, create, debug, report, transpile, inspect, spec, login
│   ├── yaml-transpiler/        # YAML → spec (folded in from shiplight-tools, Aug 2026)
│   ├── debugger/               # express outer server, routes, PlaywrightSandbox
│   ├── reporter/               # HTML report, run usage summary, cloud upload
│   ├── scaffold/templates/     # *.tpl project scaffolding
│   ├── fixture.ts              # the Playwright `agent` fixture
│   ├── config.ts               # shiplightConfig()
│   └── dotenvSource.ts         # .env walk-up, closest-wins
├── scripts/
│   ├── build-debugger-ui.mts   # invokes packages/debugger-ui vite builds
│   └── render-spec-assets.mts  # renders spec docs from the engine registry
└── tests/                      # conformance, integration, examples, fixtures/web
```

**Structure Decision**: one package with many entry points rather than several
packages. The spec's Scope Boundary argues this directly: splitting authoring from
execution is what allowed schema skew to go undetected. The seven exports exist so
Playwright can `require()` a config while the CLI stays ESM.

## Report artifact size (FR-024)

The engine hands the reporter a full copy of the variable store for every step,
twice. That is the engine's contract and it stays: `StepExecutionResult` is a
public SDK type and its live values must be complete. The **report** is where the
data is bounded, in `apps/cli/src/reporter/` — one value cap
(`contextSnapshot.ts`) and one changed-only encoding (`contextDelta.ts`), applied
once per attempt as steps are assembled, so `report-data.json` and the cloud
upload inherit the same shape without either knowing about it.

Two invariants a change must not break:

- **The encoding is display-only and lossless for display.** Nothing replays,
  resumes, or asserts from these snapshots; a reader that applies the deltas in
  order must reconstruct exactly what was recorded, up to the cap.
- **Both forms stay readable, detected per step.** A reader must never need a
  version to parse an artifact: `report-data.json` carries no `schemaVersion`,
  and a merged report can combine shards written before and after this change.

The reader half lives in the cloud . `expandStepContexts()` is the
reference implementation it must match; the contract is
[contracts/report-artifact.md](./contracts/report-artifact.md).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| `apps/cli` drives `packages/debugger-ui`'s build and owns its output | The static assets must be inside the published tarball, and only the publisher can place them there | Having debugger-ui write its own `dist/` and be copied in was tried and produced a turbo cache that replayed an empty "success" (fixed August 2026); a second writer also raced tsup's `clean` |
| Both ESM and CJS builds | Playwright loads `playwright.config.ts` via `require()` | ESM-only breaks config loading for every user |
