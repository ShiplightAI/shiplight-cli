# Contract: CLI & Library Surface

`shiplightai` is published to npm, so these are user-facing contracts. Breaking one
breaks installed users, not just this repo.

## C1 — Commands (`bin: shiplight`)

| Command | Contract |
|---|---|
| `test` | Runs mixed YAML + `.test.ts` suites; **forwards all Playwright flags verbatim** (FR-001). Exit code propagates pass/fail. |
| `create` | Scaffolds a runnable project wired with `shiplightConfig()`. **Never modifies an existing file**; reports each conflict with template content and a merge strategy (FR-002). `--json` emits that result as one parseable object (FR-019). |
| `debug` | Launches the visual debugger on an auto-selected or `--port` port. Concurrent invocations must not need port coordination (FR-003). |
| `report` / `transpile` / `inspect` | Documented behaviour (FR-005). `transpile` validates as well as transpiles and exposes `--strict` (FR-013). |
| `spec yaml` / `spec actions` | Print the normative YAML spec and the action vocabulary. `spec actions` renders from the engine registry at build time (FR-014, FR-015). |

## C2 — Library exports

| Export | Contract |
|---|---|
| `shiplightai` | Package root. |
| `shiplightai/fixture` | The `test`/`expect` fixture generated specs import. Providing `agent`. |
| `shiplightai/debugger-pw`, `/debugger-manager`, `/debugger-server` | Debugger entry points. |
| `shiplightai/reporter` | The HTML reporter. |

`shiplightConfig()` wires YAML transpilation, `.env` discovery and the reporter into a
Playwright config (FR-004). A CJS build exists because Playwright loads configs via
`require()`.

## C3 — Environment boundary

- Only the explicit allowlist reaches the SDK, assembled by `buildSdkEnv()` (FR-006).
- Non-allowlisted variables — `PATH`, `HOME`, `GITHUB_TOKEN`, `AWS_*` — MUST be
  invisible to the agent.
- `.env` discovery walks to the project root, closest wins over `process.env` (FR-008).
- The CLI parent and the spawned child MUST resolve the same `.env` view, or the tier
  fetch reads a different token than the run uses (FR-020).

**This is the enforcement point for 001 FR-010.** The engine trusts it.

## C4 — Single-source rules that must fail on reintroduction

| Rule | Guard |
|---|---|
| `shiplight spec actions` matches the live action registry (FR-015) | SC-008 — a guard, not a cleanup |
| No document in the package contains a `shiplight://` URI (FR-016) | SC-008 |
| Strict and default transpile agree on coverage, differ only in verdict (FR-013) | SC-006 |
| Generated specs carry the real version (FR-017) | SC-002 |

## C5 — Report upload and tier selection

- Upload routes by token type: `shp_*` → the Shiplight proxy, honouring `SHIPLIGHT_API_URL`; report
  URLs promote to absolute web hosts (FR-010). Any other token shape resolves to no
  host and the upload is skipped with an actionable message — the action cache
  no-ops and tier selection degrades on the same signal.
- With only `SHIPLIGHT_API_TOKEN`, the tier resolves once per run via a pre-test
  org-settings fetch, pinned for the run and injected into the spawned process
  (FR-020). Failure policy: network/5xx/timeout/404 degrades to baked defaults;
  401/403 fails `test` fast before browsers start but only warns in `debug`;
  `--offline` skips the fetch; a direct provider key opts out entirely.
- Tier provenance lands in `report-data.json` and the run-complete upload (FR-021).

## C6 — Packaging invariants

- The version bump MUST precede the build: tsup inlines `package.json` into
  `dist/cli.js`, so a later bump ships a tarball whose `shiplight --version` lies.
- `dist/static/` and `dist/static-embedded/` MUST contain the debugger assets, built
  from `packages/debugger-ui` during tsup's `onSuccess`.
- `@playwright/test` stays peer-pinned to the devDependency version, or global installs
  get duplicate Playwright copies and fail with "Requiring @playwright/test second time".
