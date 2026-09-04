# Technology Stack

**Parent**: [Project Overview](../CLAUDE.md)

## Runtime and tooling

- **Runtime**: Node.js >= 22, TypeScript, ESM only
- **Monorepo**: PNPM workspaces + Turborepo
- **Bundling**: tsup for the published packages, vite for the debugger UI
- **Tests**: `node:test` (not Jest or Vitest), with `t.mock.module()` for mocking

## Test execution

- **Automation**: Playwright for browser automation
- **AI**: multi-provider LLM access for DRAFT statement resolution and the
  natural-language action loop
- **Protocol**: MCP (Model Context Protocol) for the agent-facing tool surface

## Debugger UI

- **Framework**: React + TypeScript, built by vite against `packages/debugger-ui` source
- **UI Library**: Mantine
- **State Management**: Zustand
- **Styling**: Tailwind CSS

An earlier hosted stack (Express, Supabase, AWS S3/SQS, JWT auth, EC2 test
execution) was retired in August 2026 and is not part of this repository.
