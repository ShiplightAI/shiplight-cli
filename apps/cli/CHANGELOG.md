# Changelog

All notable changes to `shiplightai` are documented here. This file is generated automatically at release time from the commits that touch the published package and its bundled SDK.

## 0.1.103 (2026-09-02)

### Features

- **telemetry:** add CLI command telemetry, share one client with the MCP server (bc3ba52)
- **cli:** replace login/logout with setup-api-token, retire legacy proxy hosts (4460953)

### Bug Fixes

- **telemetry:** name both opt-out switches in the first-run notice (5344464)
- **telemetry:** track setup-api-token, not the retired login/logout (df97829)
- **cli:** unify URL self-healing policy (0f8333c)
- **cli:** disable self-healing for URL navigation (86fe8d5)

### Other Changes

- **telemetry:** split the two opt-out switches, unexport the collector constants (a52c8cf)
- rebuild workspace dependencies before package-level test and typecheck (9ada4a3)

## 0.1.102 (2026-08-27)

### Features

- **reporter:** include cached action per step (20d9d59)

### Bug Fixes

- **reporter:** bound per-step variable snapshots and stream the report write (559d6e2)

### Other Changes

- **reporter:** cover per-attempt encoding; clean up a stranded temp file (28d28bb)

## 0.1.101 (2026-08-24)

### Features

- **sdk-core:** resolve variables in email filters (7f69e2a)

### Bug Fixes

- **debugger-ui:** handle Windows paths and stop migrating during render (b1a373e)
- **cli:** cache durable locators and scope the post-test entity scan (fd821c6)
- **debugger-ui:** scope file-tree state to the current project (6b0288a)
- **cli:** refresh scaffold example form flow (ace7f40)
- **cli:** stop scaffolding example environment (22355dc)

### Other Changes

- **cli:** document extension action popup fixture (f7d9693)
- add trusted publishing for devtools assets (77f313c)

## 0.1.100 (2026-08-18)

### Features

- **frontend:** remove the deprecated copilot feature (09e71ad)

### Bug Fixes

- **cli:** capture JS assertion result screenshots (591cdc0)
- **sdk-core:** preserve explicit action instructions (0983703)
- **cli:** report tags from Playwright and restore console output (8c376eb)
- **cli:** repoint the remaining transpiler tests at the real entry point (6d6556a)
- **cli:** resolve the same .env view in the parent as the spawned child (1201bfb)
- **types:** substitute variables in one pass so values are never rescanned (54b6e99)
- **sdk-core:** drop the dead v1 cloud route and read env only from SdkConfig (c755ce1)
- address code review of the workspace trim (b8f4318)

### Other Changes

- Resolve runtime variables in step descriptions (e8ad884)
- **cli:** cover the report console-output and YAML-cache paths (beb0549)
- cover locator generation, the act surface and extension packaging (d3e96e3)
- **cli:** drop the transpile wrapper no shipping code path used (fbd1bf2)
- **cli:** drop nine dependencies with no import site (d5440ea)
- **types:** remove five modules no consumer imports (f0fe08b)
- **cli:** fold the yaml-transpiler into apps/cli, drop shiplight-tools (efe2c8c)
- extract the debugger UI into packages/debugger-ui, drop the internal shared package (995da96)
- remove the unreachable export surface from shiplight-tools (c923356)
- remove the retired hosted-product workspaces (e033cef)

## 0.1.99 (2026-08-10)

### Features

- **transpiler:** emit YAML tags as Playwright tag option (445258c)
- **cli:** expose extension action popup fixture (5f025a9)

### Bug Fixes

- **cli:** pass launch options to extension contexts (89642fb)

## 0.1.98 (2026-08-06)

### Features

- **cli:** report action-entity cache effect over executed statements (239782d)
- **cli:** add report --trigger and store enum trigger values (a2ee3cc)

### Bug Fixes

- **cli:** suppress the swallowed-folder warning when a folder survives (803e137)

### Other Changes

- **cli:** pin the single-dash missing-value rule for --vars (b2d98ba)

## 0.1.97 (2026-08-05)

### Bug Fixes

- **cli:** anchor the inline fingerprint map to projectRoot (ad9b85a)
- **cli:** key statements by repo-relative path so the cache travels (e17a200)
- **cli:** stop a superseded cache entry from shadowing an edited statement (775fa7a)
- **cli:** keep upload testDataDir on the old anchor, and type the debug use block (4cd99b0)
- **cli:** anchor extensionDir to the project root and fail fast on a bad path (c49878e)
- **yaml:** honor a suite file's base_url and stop masking self-heal failures (1ae845c)
- **sdk-core:** correct strict-schema null handling and MCP-unsafe guidance (c788fc3)
- **sdk-core:** make LLM structured output valid under OpenAI strict mode (0ce94b5)
- **sdk-core:** exclude unsupported Gemini browser actions (614f311)
- **sdk-core:** route LLM calls through withLlmTimeout, not the bare signal (252a799)
- **sdk-core:** bound a single LLM call and cap it at 3 attempts (31278bf)
- **lint:** make the lint lane actually run (aaa4718)

### Other Changes

- remove dead statement-hash and action-entity resolution helpers (f24fd3d)
- unexport resolveLegacyProjectRoot and flag the AI SDK pattern match (0c8e3c7)
- drop remaining any usages and harden the temp-profile assertions (155a98f)
- **test-fixtures:** enable module mocks flag on the node:test scripts (7343797)
- standardize on node:test, drop jest and vitest (70d0fc1)
- remove sdk-internal and its dead mailgun code (f134de0)
- remove the BitGo extract_activation_code action (518ed46)

## 0.1.96 (2026-07-30)

### Features

- **cli:** report action-entity cache effectiveness and per-test LLM totals (ec8b570)

### Bug Fixes

- **sdk-core:** send screenshots as file parts, not deprecated image parts (f53e70d)
- **sdk:** resolve variable placeholders in custom action arguments (682c254)
- **deps:** migrate ai and @ai-sdk/* to latest to clear the undici advisory (190dddf)
- **cli:** keep run finalization when the platform rejects the metrics (0aa6ea5)
- **cli:** stop login tests from hijacking the default browser (f2c53b6)
- upgrade sharp and harden release verification (e8c8cd3)
- **cli:** sum failed across shards instead of taking the max (e3e20a0)
- **cli:** omit the structurally-zero failed bucket from the upload (c16e33a)
- **transpiler:** give suite test statements deterministic UIDs (0715c49)
- **cli:** apply the staged action-entity cache in CI (c6fe473)
- **sdk-core:** handle already satisfied actions (ffc1b07)

### Other Changes

- **cli:** make the openBrowser unsafe-URL test able to fail (cfdd972)
- test code action description updates (d67a12a)
- fix debugger code step descriptions (2cc986f)
- fix debugger function call handling (d61b5b8)
- **cli:** pin the upload spreads; fix mixed-version shard merge (37aa8bc)

## 0.1.95 (2026-07-23)

### Features

- **types,sdk-core,cli:** LLM tier selection (6c9fa4c)

### Bug Fixes

- **cli:** retry org-settings fetch once on transport failure (f936385)
- **sdk-core,sdk-internal:** sanitize LLM-extracted verification codes (dbb1553)

### Other Changes

- **release:** generate per-release CHANGELOG.md for shiplightai and @shiplightai/mcp (5c6445f)
