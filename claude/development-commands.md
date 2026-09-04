# Common Development Commands

**Parent**: [Project Overview](../CLAUDE.md)

## Build and Development

```bash
# Install all dependencies
pnpm install

# Run development servers (from root)
pnpm dev

# Build the three published products (shiplightai, @shiplightai/mcp, @shiplightai/sdk)
pnpm build

# Build every workspace (apps/cli builds the debugger UI as part of its own build)
pnpm build:all

# Run a specific app in development (from app directory)
cd packages/debugger-ui && pnpm dev

# Build a specific app/package
pnpm build --filter=shiplightai
pnpm build --filter=@shiplightai/mcp
pnpm --filter debugger-ui build:debugger-ui   # rarely needed

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Clean build artifacts
pnpm turbo clean
```

## Testing

```bash
# Run tests (from package/app directory)
pnpm test

# Run a single test file
node --test --experimental-test-module-mocks --import tsx path/to/file.test.ts
```

Tests use `node:test`, not Jest or Vitest. See the Testing section in
[AGENTS.md](../AGENTS.md) for the lane layout (`test:unit` vs `test:browser`).

## Rebuild chains

Several packages bundle their dependency's **dist**, not its source, so editing
the dependency alone measures nothing:

```bash
# sdk-core change that must reach the MCP server bundle
cd packages/sdk-core && pnpm build \
  && cd ../mcp-tools && pnpm build \
  && cd ../../apps/mcp-server && pnpm build
```

## Important Notes

- This monorepo uses **PNPM workspaces** with **Turborepo** for build orchestration
- Dependencies are automatically linked
- Turborepo handles build order and caching for optimal development experience
- You need to **recompile `packages/common`** after changes for other modules to pick them up
  - Compile with: `pnpm build` (from `packages/common` directory)
- There is no Docker development environment. The `ship` CLI, the compose files,
  and the image-build workflow were removed with the v1 services in August 2026.
