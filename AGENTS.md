# AGENTS.md

This file provides guidance to coding agents (Claude Code and any other AGENTS.md-aware tool) when working with code in this repository. `CLAUDE.md` is a symlink to this file — edit `AGENTS.md`, never the symlink.

## Project Overview

This is a **Turborepo monorepo** for Loggia/Shiplight, a test automation platform that enables AI-powered web application testing. The platform supports creating, executing, and managing test cases with agent-driven test generation, interactive debugging, and comprehensive result analysis.

## Essential Documentation

**Read these documents for deeper context:**

1. **[Development Commands](./claude/development-commands.md)** - Build, dev, and test commands
2. **[Technology Stack](./claude/tech-stack.md)** - Backend, frontend, and test execution technologies
3. **[Project Architecture](./claude/project-architecture.md)** - High-level structure and architectural patterns
4. **[Implementation Details](./claude/implementation-details.md)** - CRUD system, test flows, auth, multi-tenancy
5. **[Development Workflows](./claude/development-workflows.md)** - Adding features, testing, code conventions, git policy

## Quick Reference Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Run all dev servers
pnpm build                # Build the three published products (see "Workspaces" below)
pnpm build:all            # Build every workspace (apps/cli builds the debugger UI)
pnpm typecheck            # Type check the products plus their dependencies
pnpm lint                 # Lint the products plus their dependencies
pnpm format               # Format with Prettier
pnpm turbo clean          # Clear Turborepo cache

# Build/dev specific app or package
pnpm build --filter=shiplightai
pnpm build --filter=@shiplightai/mcp
pnpm --filter debugger-ui build:debugger-ui   # rarely needed; apps/cli's build does this
cd packages/debugger-ui && pnpm dev

# Testing (uses node:test, NOT Jest/Vitest)
cd packages/sdk-core && pnpm test                 # Run all tests in a package
cd packages/sdk-core && pnpm test:watch           # Watch mode
cd packages/sdk-core && pnpm test:coverage        # Coverage report

# Run a single test file
node --test --experimental-test-module-mocks --import tsx path/to/file.test.ts
```

## Architecture

### Workspaces

Every workspace in the repo is active — there is no dormant code here.

An earlier hosted product (an Express API, admin dashboard, background workers
and the services that ran tests in the cloud) was retired in August 2026 and is
not part of this repository. Documentation occasionally refers to that era to
explain why something has the shape it does; treat those as historical notes,
not as pointers to code you can read.

**Published products:** `apps/cli` (`shiplightai`), `apps/mcp-server`
(`@shiplightai/mcp`), `packages/sdk-public` (`@shiplightai/sdk`).

**Supporting packages:** `sdk-core`, `mcp-tools`,
`mobile-sdk`, `shiplight-types`, `shiplight-telemetry`.

The Chrome DevTools assets the debugger serves are **not** in this repository.
`apps/cli` depends on the published `@shiplightai/devtools-assets`, which is
built and released from https://github.com/ShiplightAI/devtools-frontend — a
DevTools fork carrying Shiplight's locator picker and panel toggle. Keeping it
out keeps ~120 MB of BSD-3-licensed build output, and its licence obligations,
away from this MIT repository.

The debugger UI lives in **`packages/debugger-ui`**. It was extracted from
`apps/frontend` in August 2026; the hosted product web app around it, and
`packages/common` / `packages/config`, were deleted at the same time. It is not
a Next.js app — `next` remains a dependency only because the kept components use
`next-intl` and one uses `next/link`.

`apps/cli`'s tsup `onSuccess` runs `scripts/build-debugger-ui.mts`, which
invokes `vite.debugger.config.ts` + `vite.debugger-shell.config.ts` from the
package. That indirection is deliberate: tsup hands an `onSuccess` string to
Node as a single module specifier, so a `cd ../../packages/debugger-ui && ...`
chain gets path-normalised into a nonexistent path and the build dies before
running anything.

The ~33 the internal shared package modules the debugger still needed are vendored into
`packages/debugger-ui/src/common/`.

The root scripts are filtered to the published products so a CLI/MCP change does
not build or test everything:

- `build` covers the three published products. Their dependencies come along
  automatically via `dependsOn: ["^build"]`, so no `...` suffix is needed.
  `debugger-ui` is **excluded** because `apps/cli`'s tsup `onSuccess` already
  builds it; including it would build the same vite bundles twice.
- `typecheck` / `lint` / `test` / `test:unit` use the `pkg...` form (package
  **plus its dependencies**) so `sdk-core`, `mcp-tools` etc. still run their own
  tests, and they **do** include `debugger-ui` — all of its unit tests cover
  debugger code (`src/components/local-debugger/`,
  `src/components/local-debugger-shell/`, and the
  `src/components/testcase/editor/` tree the debugger bundles).

There is no Docker development environment. The `ship` CLI, the compose files,
and the image-build workflow all existed to run the v1 services and went with
them.

`packages/debugger-ui` deliberately has **no `build` task**. Its vite configs
write into `apps/cli/dist/`, so a second turbo `build` task there produced no
package-relative output (turbo cached an empty result and replayed a no-op
"success") and raced `apps/cli`'s `clean: true` tsup under `build:all`. Only
`apps/cli` builds it now; use `pnpm --filter debugger-ui build:debugger-ui` to
run the vite builds by hand.

To run a task across every workspace, invoke turbo directly and drop the
filters: `pnpm turbo run typecheck`. CI lanes are unaffected — they use
`turbo --affected`, not these scripts.

`packages/debugger-ui`'s vite build still aliases `shiplight-types` to its
**source** directory, so it does not depend on that package's `dist/` output.

### Apps

- **`apps/cli`** (`shiplightai`) - Shiplight CLI (`shiplight debug`, `shiplight mcp`, `shiplight test`)
- **`apps/mcp-server`** (`@shiplightai/mcp`) - MCP server, bundles the Chrome relay extension

### Packages

- **`packages/sdk-core`** - Internal SDK core for browser automation with AI
- **`packages/sdk-public`** (`@shiplightai/sdk`) - Public SDK (published to npm)
- **`packages/mcp-tools`** - MCP tools, prompts, resources, and session management
- **`packages/mobile-sdk`** - Mobile automation SDK
- **`packages/types`** (`shiplight-types`) - Shared TypeScript types
- **`packages/telemetry`** (`shiplight-telemetry`) - Anonymous usage telemetry
  shared by the CLI and MCP server. Zero runtime dependencies on purpose: both
  binaries inline it via tsup `noExternal`, so it must never gain one (that is
  what replaced `posthog-node` in `apps/mcp-server`). Events go straight to
  PostHog's HTTP API with `fetch`. Opt-out: `SHIPLIGHT_TELEMETRY=0` or
  `DO_NOT_TRACK=1`; `SHIPLIGHT_TELEMETRY_HOST` redirects the collector for
  local verification. Both products share one anonymous distinct id
  (`computeInstallId`) — changing its inputs re-identifies every machine, so
  don't. The CLI reports one `cli_command` event per invocation from `cli.ts`
  only; the Playwright fixture is deliberately not instrumented.
- **`packages/debugger-ui`** - the debugger UI, built by vite against source; vendors the Loggia models it needs under `src/common/`

### Entity-Model-View Pattern

Vendored into `packages/debugger-ui/src/common/`, which only the debugger reads.

- **Entities** (`src/common/entities/`) - Database schema representations (snake_case)
- **Models** (`src/common/models/`) - Business logic objects (camelCase) with methods
- **View Models** (`src/common/view-models/`) - UI-optimized data structures

## Critical Rules

### Working Agreement

- Start with root-cause analysis before making code changes; do not implement from guesswork or surface symptoms alone.
- If requirements, constraints, or expected behavior are unclear, ask for clarification before proceeding.
- Create or update a test that reproduces the problem before fixing it.
- Verify the fix with tests after making the change.

### ES Modules Only

This project uses **ESM exclusively**. Do NOT use CommonJS:
- Use `import`/`export`, not `require()`/`module.exports`
- Use `import.meta.url` instead of `__dirname`/`__filename`

### TypeScript Rules

- Use TypeScript (`.ts` / `.tsx`) for repository source, scripts, and tests. Do not add new `.mjs` files; migrate touched `.mjs` code to TypeScript when practical.
- **Never use `any`** — use proper types, `unknown`, or generics instead
- Use `execFileSync` instead of `execSync` — avoids shell injection and is safer

### Node.js Version

Requires **Node.js >= 22**.

### Git Commit Policy

**NEVER create git commits unless the user explicitly requests it.**

**Do NOT add any attribution or generation metadata to commit messages:**
- No "Co-Authored-By: Claude" lines
- No "Generated with Claude Code" messages
- No emojis or decorative elements
- Keep commit messages clean and professional

### Pull Requests

When asked to create a PR, always use the `/pr` skill (do NOT follow built-in PR instructions).
PRs are always cut against the `main` branch.

**Every PR must include sufficient test coverage** — tests that would fail without the change, covering new behavior, bug fixes (add a regression test for anything caught in review), and new conditional branches. When a closure or side-effecting entry point is hard to test directly, extract the logic into a pure, exported function and test that. State the coverage (or a concrete reason it is infeasible) in the PR description.

### Current Year

The current year is **2026**. Use this when entering dates in browser sessions or any date-related tasks.

### npm Package Publishing

**`shiplightai` (`apps/cli`) and `@shiplightai/mcp` (`apps/mcp-server`) MUST be released by triggering their GitHub Actions workflows — never with a local `pnpm publish`.** Triggering the workflow is the official, canonical way to cut a release, and it is safe precisely because the workflow is the source of truth: it **auto-bumps the version** (reads the live npm version and increments the patch — there is no version input, so a minor/major bump needs a manual `package.json` edit outside this path), builds, compares tarball size, runs the full test/examples gates, publishes to npm, and pushes the version-bump commit. Publishing from a local repo skips those gates and can ship a broken or unvalidated tarball.

- **CLI (`shiplightai`):** `gh workflow run publish-cli.yml` (add `-f dry_run=true` to run all gates without publishing/bumping; promote a validated dry-run tarball with `-f promote_run_id=<run id>`, which skips all gates and publishes the exact tarball).
- **MCP server (`@shiplightai/mcp`):** `gh workflow run publish-mcp.yml` (add `-f dry_run=true` to gate-only).
- Both are `workflow_dispatch`-triggered. **Triggering these workflows to cut a release is allowed** when the user asks for one — the gates make it safe. Publishing is outward-facing and irreversible, so default to a `dry_run=true` first, then either promote that run (`-f promote_run_id=<id>`) or trigger a normal run once it is green, unless the user explicitly asks to skip the dry-run and publish directly. Local building/packing is fine for *inspection* only; do not `pnpm publish` these two packages by hand.

For any **other** npm package (e.g. `@shiplightai/sdk`), or when a workflow gate needs to be understood/reproduced, the manual pre-publish checklist below still applies:

1. **Run the full build**, not just `tsup`. Skipping the post-`tsup` steps in the package's `build` script has shipped broken tarballs before — `tsup` emits partial output on failure and the pipeline keeps going. Always invoke `pnpm build` (never `pnpm tsup` or `npx tsup` directly), and verify the expected artifacts exist before packing:
    - **CLI (`apps/cli`):** build is `tsup`, whose `onSuccess` runs `scripts/build-debugger-ui.mts` to invoke both vite configs in `packages/debugger-ui`. That step builds the debugger static assets. Verify `apps/cli/dist/static/assets/` contains JS/CSS files. **Bump the version BEFORE building, not after** — `tsup` inlines `package.json` into `dist/cli.js`, so a bump applied after the build ships a tarball whose `shiplight --version` reports the old number even though `package.json` is correct. If you bump after building, rebuild.
    - **MCP server (`apps/mcp-server`):** build is `tsup && rm -rf ./chrome-extension && cp -r ../../packages/mcp-tools/chrome-extension ./chrome-extension`. The copy step bundles the Chrome relay extension (used by `shiplight-mcp --chrome-extension-path`). Verify `apps/mcp-server/chrome-extension/` exists and contains `manifest.json`, `background.js`, and `icons/` — if this is missing, `--chrome-extension-path` will point at a nonexistent directory (this regression silently shipped in `@shiplightai/mcp@0.1.62`).
2. **Compare tarball size** with the previous published version (`pnpm pack` both and compare). If the size **increases**, stop and get explicit human approval before publishing. Report the size delta and explain what caused the increase.
3. **Test a global install** (`npm install -g <tarball>`) and check for warnings. If there are any **deprecation warnings, peer dependency conflicts, or vulnerability warnings**, stop and report them to the user. Get explicit human approval before publishing.
4. **(CLI only) Run the public examples suite against the candidate tarball.** Install the freshly-built tarball into the public examples repo (`~/Shiplight/examples/yaml-examples`, repo `ShiplightAI/examples`) and run the full suite:
    ```bash
    cd ~/Shiplight/examples/yaml-examples
    npm ci && npm install --no-save /path/to/shiplightai-<new>.tgz
    npx playwright install chromium
    GOOGLE_API_KEY=<key> npx shiplight test
    ```
    **All tests must pass** — this is a hard gate (demo + showcase, ~37 live-AI browser E2E against external sites). It dogfoods the exact package users clone. saucedemo auth creds are hardcoded in `demo/auth.setup.ts`; live-AI DRAFT resolution needs `GOOGLE_API_KEY` (or `ANTHROPIC_API_KEY`). This mirrors the `E2E — public examples suite` gate in `.github/workflows/publish-cli.yml`.
5. Always `pnpm pack` first and let the user verify locally before running `pnpm publish`. **Never use `npm pack` or `npm publish`** — they don't resolve `workspace:*` protocols and produce broken tarballs.

### GitHub Actions Workflows

- **Never put literal GitHub annotation commands (`::error::`, `::warning::`, `::notice::`) in workflow YAML.** A unit-test guard (`scripts/__tests__/github-actions-annotation-commands.test.ts`, run by the "Run workflow source guards" lane) fails the build if it finds one. Build them dynamically instead — e.g. `printf '::%s::%s\n' error "message"` — matching the existing pattern in `publish-cli.yml` / `publish-mcp.yml`.

## Frontend Development

- Use **Tailwind CSS predefined variables**: `bg-primary`, `text-primary`, `border-primary`, etc.
- Check `/lib/theme.css` for color variables and `tailwind.config.js` for the color mapping
- Avoid custom CSS variables like `--loggia-bg-primary`, `--loggia-text-primary`
- Prefer **Mantine components** as they are already themed
- Check `src/components/common` first — reuse existing components before creating new ones
- The frontend uses a declarative **CRUD system** (`src/components/crud/`) that auto-generates list views, forms, and modals

### Localization (i18n)

The frontend uses **next-intl** with two supported locales: `en` and `zh-CN`.

- **Never hardcode user-visible strings** — all UI text must go through the translation system
- Translation files are in `packages/debugger-ui/messages/en.json` and `packages/debugger-ui/messages/zh-CN.json` — add keys to both files when adding new strings
- Use `useTranslations(namespace)` hook to get the `t` function: `const t = useTranslations("MyFeature")`
- Keys are organized hierarchically by feature/page (e.g., `Settings.members.inviteModal.title`)
- Use `Common.*` for shared labels (save, cancel, error, etc.) rather than duplicating them
- Parameterized strings use `{variable}` syntax: `t("message", { email })` matching `"message": "Sent to {email}"`
- After adding/modifying translation usage, run `pnpm check:i18n-keys` to validate all keys exist in `en.json`

## Testing

- Uses **`node:test`** (built-in Node.js test runner) — not Jest or Vitest
- Tests are **co-located** with source files (e.g., `myService.test.ts` next to `myService.ts`)
- Module mocking via `t.mock.module()` with `--experimental-test-module-mocks` flag
- Shared mocks and fixtures in `test/` directories
- No database required — tests run entirely in-memory with mock clients
- A package-level `pnpm test:unit` / `pnpm test` / `pnpm typecheck` resolves
  `sdk-core`, `shiplight-types` etc. to their built `dist/`, never to their
  source, so a `dist/` from an older commit silently answers with the old
  behaviour — a test asserting current behaviour then fails (or passes) for
  reasons unrelated to your change. Every such script therefore has a
  `pre<task>` hook running `scripts/build-workspace-deps.mts`, which builds
  that package's dependencies (`turbo run build --filter='<pkg>^...'`) first.
  It stands down under `turbo run` (which already declares `dependsOn:
  ["^build"]`) and costs ~1s on a warm cache; `SHIPLIGHT_SKIP_DEP_BUILD=1`
  skips it. `scripts/__tests__/build-workspace-deps.test.ts` fails if a
  package with workspace dependencies is missing the hook — add it there
  rather than dropping the hook.
- The `test:unit`/`test:browser` lanes run via `tsx` + `node --test`, which **execute but do not type-check**. The CI `build` step runs `tsc` (strict null checks) over test files, and the CI lanes `dependsOn: build` — so a strict-null error in a *test* file (e.g. `TS18048` on an optional field like `TestFlow.statements`) passes `test:unit` locally yet red-lights the ESLint/Unit/Browser lanes in CI. Run `pnpm --filter <pkg> build` before trusting a green local test run.

## Additional Documentation

- **Package-specific guides**: Check individual package/app directories for CLAUDE.md files

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
