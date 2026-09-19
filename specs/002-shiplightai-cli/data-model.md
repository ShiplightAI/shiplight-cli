# Phase 1 Data Model: shiplightai CLI & Playwright Library

The CLI owns files on the user's disk, not a database. These are the artifacts it
reads and writes, and the shapes that cross its boundaries.

## Authored input — `*.test.yaml`

The user- or agent-authored test. Its grammar is normative and ships in the package
(`shiplight spec yaml`, FR-014).

| Element               | Meaning                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal`                | What the test proves.                                                                                                                                    |
| `base_url`            | Target origin. Note: `base_url`, never `url`.                                                                                                            |
| `statements[]`        | Ordered steps: `DRAFT` (natural language), action statements carrying an `action_entity`, `STEP` groups, and control flow (`if`, `while`, `wait_until`). |
| `template:` / `call:` | Reuse of a shared step file or a TypeScript helper export.                                                                                               |
| suite files           | `beforeEach` / `afterEach` / named tests, flattened at run time.                                                                                         |

**Validation rules**

- Validation and transpilation are the same implementation; strict mode changes only
  the verdict and exit code (FR-013).
- A statement's captured `action_entity` preserves its locator and assertion across
  a YAML round trip (FR-018).

## Generated output — `*.yaml.spec.ts`

| Property       | Rule                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Version stamp  | The real `shiplightai` version; a placeholder is forbidden (FR-017).                                                |
| Regeneration   | Driven by mtime of the YAML, its referenced templates, and the transpiler version.                                  |
| Fixture import | `import { test, expect } from 'shiplightai/fixture'`.                                                               |
| AI conditions  | Emitted with their construct tag (`"if"` / `"while"`) so run-usage attribution can separate them from `wait_until`. |

## Run configuration

| Source                                               | Precedence                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `--vars` / `--vars-file` / `SHIPLIGHT_VARS_OVERRIDE` | Applied into the test context with allowlist and sensitive-flag semantics (FR-007). |
| `.env` discovery                                     | Walks to the project root, closest wins, over `process.env` (FR-008).               |
| SDK env                                              | Only the explicit allowlist, assembled by `buildSdkEnv()` (FR-006, SC-001).         |

> **Invariant**: the CLI parent and the spawned child resolve the same `.env` view —
> walk up to the project root, closest file wins, `.env` overrides the shell. The parent
> installs it via `applyShiplightEnvToProcess`. FR-020 depends on this: when the two
> disagreed, the tier fetch read a different token than the run executed under, and
> parent-side readers silently downgraded the action cache to Local.

## Report artifacts

| Artifact              | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-data.json`    | Per-run results, a stable `clientRunId` for idempotent cloud upload, optional `batchId` / `expectedBatchCount` for direct shard upload (FR-025), plus the LLM usage summary — token buckets keyed by operation, provider, bare model id and routing (FR-012). A caller-provided shared Run ID plus Playwright `config.shard` enables automatic batch identity; internally generated IDs keep shards independent. Counts only, never prompt or response content. |
| Model-tier provenance | Present only when tier selection governed the run: tier requested, its source (env / org-default / baked), resolved primaries, and whether the map came from the server (FR-021). Server-controlled values are HTML-escaped where rendered.                                                                                                                                                                                                                     |
| Cloud upload          | Routed by token type: `shp_*` → the Shiplight proxy (FR-010). Any other shape resolves to no host, so the upload is skipped with a message. The create payload carries `clientRunId`, one stable `clientTestId` per test, and in direct-shard mode `batchId` plus `expectedBatchCount`; completion is idempotent per batch and every shard attempts the shared run's completion barrier (FR-025).                                                               |

## Action-entity locator cache

| Rule     | Detail                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| No token | The cache is a no-op (FR-011).                                               |
| Key      | A stable statement hash, so an edited statement does not read a stale entry. |
| Effect   | A cache hit replays without a model call, inheriting 001's SC-003.           |

## Scaffolding result (`shiplight create --json`)

A single parseable object on stdout, no interleaved prose (FR-019):

| Field         | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| files created | Paths written.                                            |
| files skipped | Paths that already existed — never modified (FR-002).     |
| per conflict  | Path, template content, merge strategy, and instructions. |

**Validation rule**: the JSON payload must not be lossy relative to the human output
(SC-005) — it is the agent-facing replacement for the MCP scaffold tool.
