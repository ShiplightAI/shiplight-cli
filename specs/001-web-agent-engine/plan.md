# Implementation Plan: AI Web-Agent Automation Engine

**Branch**: `feng/workspace` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-web-agent-engine/spec.md`

**Note**: Reconstructed from the implementation, like the spec. The engine already
exists and ships; this plan records the approach that was built and the seams a
future change must respect, not a proposal for unbuilt work.

## Summary

Resolve a natural-language step plus a live page into exactly one concrete browser
action — or an explicit error — and record a self-healing locator so the same step
replays later without a model call (FR-001, FR-002). The engine is a library
(`packages/sdk-core`) with its shared vocabulary in `packages/types`; it is bundled
into the `shiplightai` CLI (002) and the `@shiplightai/mcp` server (003) rather than
published on its own.

Two decisions dominate the design. First, **who pays selects the model**: a direct
provider key means BYOK and free choice, while a Shiplight token means tier-based
selection with model overrides deliberately ignored (FR-003, FR-004). Second, the
engine **never reads `process.env`** — configuration arrives through the SDK config
its host hands it (FR-010), which is what lets the CLI and MCP server own their own
environment allowlists.

## Technical Context

**Language/Version**: TypeScript 5.5 targeting ES2020, ESM only, Node.js >= 22

**Primary Dependencies**: `ai` (Vercel AI SDK) with `@ai-sdk/{anthropic,google,google-vertex,openai}` providers; `@google/genai` and `openai` for direct paths; `playwright` (peer, supplied by the host) for the page; `zod` + `zod-to-json-schema` for tool schemas; `sharp` for screenshot handling; `otplib` for 2FA; `p-retry`, `axios`, `yaml`, `uuid`

**Storage**: None. Action entities and variable state live in the caller's `TestFlow`/`AgentContext`; nothing is persisted by the engine.

**Testing**: `node:test` via `tsx` for the deterministic lane (`test:unit`, LLM mocked with `--experimental-test-module-mocks`); Playwright specs for the live browser lane (`test:browser`), which needs a browser and an API key and is therefore outside the default CI gate.

**Target Platform**: Node.js library embedded in a host process (CLI or MCP server); drives a Playwright `Page` the host owns.

**Project Type**: Library (single package, no service or UI of its own).

**Performance Goals**: Bounded rather than fast — step, self-heal, and modal-dismissal budgets cap worst-case token spend and wall time (FR-006). Replay of a captured action makes **zero** model calls (FR-002/SC-003), which is the engine's main latency lever.

**Constraints**: No `process.env` reads (FR-010). Exactly one credential per run, or an explicit `provider:model` override. Vertex AI routing is out of scope and lives in the separate cloud service.

**Scale/Scope**: 179 source files / ~35.7k lines in `packages/sdk-core`, plus the shared types package; 56 test files across the two lanes.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v2.0.0.*

| Principle | Status | Evidence |
|---|---|---|
| I. Code Quality & Simplicity | **PASS** | `"type": "module"`, ESM throughout; `strict: true` in tsconfig; an eslint rule bans importing internal-scope to keep the engine standalone. Build-order rule (`sdk-core → mcp-tools → mcp-server`) still holds and is documented in AGENTS.md. |
| II. Testing Standards | **PASS with a noted gap** | Deterministic unit lane mocks the LLM; contract-style parity tests exist. The live NL→action loop is proven only by the keyed browser lane, which is not CI-gated — the spec states this openly (Assumptions) and SC-001 scopes the CI claim to the mocked mapping. |
| III. User Experience Consistency | **N/A** | The engine has no user-facing surface. Its consumers (002, 003) own error presentation. |
| IV. Performance Requirements | **PASS** | The binding clauses are memory discipline, bounded agent work and cost-of-unchanged-work; the engine satisfies all three via its budget rules (FR-006) and model-free replay (SC-003). The page-load and API-latency clauses were removed in constitution 2.0.0, which this plan's earlier draft had flagged as stale. |
| V. Dependency & Code Sharing | **PASS** | `packages/sdk-core` imports nothing from `apps/`; the dependency direction is `apps → packages`. No cycle: `sdk-core → shiplight-types` only. |

**Gate result**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-web-agent-engine/
├── spec.md              # accepted product snapshot
├── plan.md              # this file
├── research.md          # Phase 0 — decisions as built
├── data-model.md        # Phase 1 — ActionEntity / AgentContext / TestFlow
├── quickstart.md        # Phase 1 — how to prove the engine works
├── contracts/           # Phase 1 — the seams consumers depend on
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code (repository root)

```text
packages/sdk-core/
├── src/
│   ├── agent/
│   │   ├── action-generation/   # NL → action (elementBased, coordinatesBased)
│   │   ├── core/                # agentCore, shared agent types
│   │   ├── llm/                 # provider clients, parseModel, proxy, timeout
│   │   ├── task/                # multi-step loop, message manager, fallback
│   │   ├── webAgent.ts          # the public agent surface
│   │   └── runUsageSummary.ts   # per-run token accounting
│   ├── actions/impl/            # one module per browser action
│   ├── browser/                 # browserManager, CDP discovery, tab management
│   ├── dom/                     # DOM/axtree extraction, locator computation
│   ├── llm_tools/               # tool registry + strict schema submission
│   ├── utils/                   # variables, logging, code validation
│   └── config.ts                # the injected-config seam (FR-010)
└── tests/specs/                 # live browser lane

packages/types/src/
├── test-flow/                   # TestFlow, Statement, ActionEntity, caches
├── llmTiers.ts                  # tier payload + resolution
└── organization.ts              # org model settings
```

**Structure Decision**: single library package plus a shared types package. The
engine deliberately owns no I/O surface: the host supplies the Playwright `Page`,
the credentials, and the environment allowlist, which is what makes the same engine
usable from a CLI process and a long-lived MCP server without divergence.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Two action-generation strategies (DOM-based and coordinates/vision) | FR-009 — DOM extraction is insufficient on canvas-heavy and shadow-DOM-heavy pages, where vision is the only path that resolves an action | A single DOM strategy fails outright on those pages; a single vision strategy costs more tokens and loses the semantic locator that FR-002/SC-003 depend on for model-free replay |
