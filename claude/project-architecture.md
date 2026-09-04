# Project Architecture

**Parent**: [Project Overview](../CLAUDE.md)

## High-Level Structure

```
apps/
├── cli/                # shiplightai — shiplight debug / mcp / test
├── mcp-server/         # @shiplightai/mcp — MCP server + Chrome relay extension

packages/
├── sdk-core/           # Browser automation engine with AI
├── sdk-public/         # @shiplightai/sdk — public SDK
├── mcp-tools/          # MCP tools, prompts, resources, session management
├── mobile-sdk/         # Mobile automation SDK
├── types/              # shiplight-types — shared TypeScript types
├── devtools-assets/    # Chrome DevTools static assets
└── debugger-ui/        # the debugger UI (vite), vendors its vendored models in src/common/
```

An earlier hosted product (Express API, admin dashboard, background workers,
the Playwright runner/sandbox services, and the Electron and VS Code clients)
was retired in August 2026 and is not part of this repository.

## Architectural Patterns

### Entity-Model-View Pattern

Vendored into `packages/debugger-ui/src/common/`, read only by the debugger:

- **Entities** (`src/common/entities/`): Database schema representations (snake_case)
- **Models** (`src/common/models/`): Business logic objects (camelCase) with methods
- **View Models** (`src/common/view-models/`): UI-optimized data structures

### Test Flow System

- Tree-structured test flows with conditional logic, loops, and variables
- DRAFT statements are natural language, resolved by AI at runtime
- ACTION statements carry a locator/xpath and replay deterministically
- Dynamic Playwright code generation from declarative YAML flows

### Debugger

- Outer server (port 6174): Express plus an HTTP reverse proxy
- Inner server (port 16174): runs inside `npx playwright test` with the real page and agent
- The debugger UI is built by `apps/cli`'s tsup `onSuccess`, which shells into
  `packages/debugger-ui` and runs its vite configs against source
