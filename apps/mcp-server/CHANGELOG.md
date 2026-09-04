# Changelog

All notable changes to `@shiplightai/mcp` are documented here. This file is generated automatically at release time from the commits that touch the published package and its bundled SDK.

## 0.2.1 (2026-08-05)

### Features

- **mcp:** automate MCP registry publishing after npm release (6f1e0aa)

### Bug Fixes

- **mcp:** do not require a signing key to validate the manifest (63a93f6)
- **yaml:** honor a suite file's base_url and stop masking self-heal failures (1ae845c)
- **mcp:** update the server.json guard for the omitted repository field (b1a766f)
- **mcp:** do not block a release on a transient 4xx repository check (3197686)
- **mcp:** drop the private repository link from the registry manifest (5a70142)
- **sdk-core:** correct strict-schema null handling and MCP-unsafe guidance (c788fc3)
- **sdk-core:** make LLM structured output valid under OpenAI strict mode (0ce94b5)
- **sdk-core:** exclude unsupported Gemini browser actions (614f311)

### Other Changes

- unexport resolveLegacyProjectRoot and flag the AI SDK pattern match (0c8e3c7)
- drop remaining any usages and harden the temp-profile assertions (155a98f)
- **mcp:** constrain the repository-link fetch to https (6d9b5b9)
- **mcp:** clarify the repository-link verdicts (13aba55)

## 0.2.0 (2026-07-31)

### ⚠ Breaking Changes

- **mcp-server:** browser-only server, drop the v1 cloud surface (736d9e9)

### Features

- **cli:** report action-entity cache effectiveness and per-test LLM totals (ec8b570)
- **types,sdk-core,cli:** LLM tier selection (6c9fa4c)

### Bug Fixes

- **mcp-tools:** stop advertising act actions that cannot be executed (c1737c0)
- **sdk-core:** route LLM calls through withLlmTimeout, not the bare signal (252a799)
- **sdk-core:** bound a single LLM call and cap it at 3 attempts (31278bf)
- **lint:** make the lint lane actually run (aaa4718)
- **sdk-core:** send screenshots as file parts, not deprecated image parts (f53e70d)
- **sdk:** resolve variable placeholders in custom action arguments (682c254)
- **deps:** migrate ai and @ai-sdk/* to latest to clear the undici advisory (190dddf)
- upgrade sharp and harden release verification (e8c8cd3)
- **transpiler:** give suite test statements deterministic UIDs (0715c49)
- **sdk-core:** handle already satisfied actions (ffc1b07)
- **sdk-core,sdk-internal:** sanitize LLM-extracted verification codes (dbb1553)

### Other Changes

- **mcp-tools:** fail honestly if Zod internals change shape (8b3f583)
- **mcp-server:** declare mcpName for the MCP registry, release 0.2.0 (89ee8b2)
- **test-fixtures:** enable module mocks flag on the node:test scripts (7343797)
- standardize on node:test, drop jest and vitest (70d0fc1)
- remove sdk-internal and its dead mailgun code (f134de0)
- remove the BitGo extract_activation_code action (518ed46)
- fix debugger function call handling (d61b5b8)
- **release:** generate per-release CHANGELOG.md for shiplightai and @shiplightai/mcp (5c6445f)
