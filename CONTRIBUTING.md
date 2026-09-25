# Contributing

Thanks for considering a contribution. This repository holds three published
products — the `shiplightai` CLI, the `@shiplightai/mcp` server, and the
`@shiplightai/sdk` — plus the packages they share.

## Getting set up

Requires **Node.js >= 22** and **pnpm 10**.

```bash
pnpm install
pnpm build          # the three published products and their dependencies
pnpm test:unit      # unit tests across the workspace
pnpm typecheck
```

Browser tests additionally need `npx playwright install chromium`.

A package-level `pnpm test:unit` or `pnpm typecheck` rebuilds that package's
workspace dependencies first, because they resolve through their built `dist/`
rather than their source — a stale `dist/` otherwise answers with old behaviour
and fails tests for reasons unrelated to your change. It costs about a second
on a warm cache. `SHIPLIGHT_SKIP_DEP_BUILD=1` skips it when you know the
dependencies are current.

## How the repository is organised

- `apps/cli` — the `shiplight` CLI
- `apps/mcp-server` — the MCP server
- `packages/sdk-core`, `packages/sdk-public` — the automation engine and its
  public wrapper
- `packages/mcp-tools`, `packages/types`, `packages/telemetry`,
  `packages/debugger-ui`, `packages/mobile-sdk` — supporting packages
- `specs/` — feature specifications; this project is developed spec-first, so a
  non-trivial change usually starts here
- `.quality/` — the quality map: what must hold, and how each claim is proven

`AGENTS.md` is the fullest description of how the codebase fits together and
the conventions it follows. It is written for coding agents but reads perfectly
well as developer documentation — start there.

## Tests

Tests use **`node:test`**, the built-in runner — not Jest or Vitest — and live
beside the code they cover (`myThing.test.ts` next to `myThing.ts`).

Every change needs tests that would fail without it. For a bug fix, write the
failing test first. If the logic is hard to reach — a closure, a side-effecting
entry point — extract it into an exported function and test that.

Run a single file with:

```bash
node --test --experimental-test-module-mocks --import tsx path/to/file.test.ts
```

## What needs credentials, and what doesn't

Most of this repository is testable with nothing configured. Only the tests
that drive a real browser through natural-language steps need a model, because
resolving "click the Add to cart button" is a live model call.

**No credentials at all:**

```bash
pnpm build
pnpm typecheck
pnpm test:unit                            # unit tests across the workspace
pnpm --filter shiplightai test:logic      # transpiler, YAML parsing, config
pnpm --filter shiplightai test:browser    # browser tests, no model involved
pnpm --filter @shiplightai/mcp test:smoke # MCP stdio API
```

That covers the great majority of changes, and it is the same set the release
pipeline runs as hard gates before it gets anywhere near a model.

**Needs a model — any one of these:**

```bash
GOOGLE_API_KEY=...      # or
ANTHROPIC_API_KEY=...   # or
OPENAI_API_KEY=...      # or
SHIPLIGHT_API_TOKEN=... # routes through Shiplight's hosted proxy (retiring Oct 31, 2026)
```

> The hosted proxy shuts down on **October 31, 2026**, so `SHIPLIGHT_API_TOKEN`
> will stop resolving a model. Prefer one of the provider keys above.

Set one and the live-AI tests run. If several are present the first match wins,
in this order (`resolveWebAgentModelFromEnv` in `packages/types/src/organization.ts`):

1. `WEB_AGENT_MODEL` — an explicit model name overrides everything
2. `GOOGLE_API_KEY`
3. Google Vertex via ADC (`GOOGLE_GENAI_USE_VERTEXAI` + `GOOGLE_CLOUD_PROJECT`)
4. `ANTHROPIC_API_KEY`
5. `OPENAI_API_KEY`
6. `SHIPLIGHT_API_TOKEN` — retiring October 31, 2026

Worth knowing if a key you forgot about is set — `GOOGLE_API_KEY` outranks
Vertex, which is exactly the shadowing the release pipeline guards against.

You may notice `.github/workflows/publish-cli.yml` authenticating to Google
Cloud and setting `GOOGLE_CLOUD_PROJECT`. That is how *this project's* release
runs its live-AI gates without storing a long-lived API key: Vertex AI reached
through GitHub's OIDC token and workload identity. It is specific to the
release pipeline, which is maintainer-only and secret-gated in any case. You do
not need a Google Cloud project to work on this repository — supply whichever
provider key you already have.

## Pull requests

- Branch from `main`; PRs target `main`.
- Keep the commit history clean and the messages descriptive. Explain *why*,
  not just what — the diff already says what.
- State your test coverage in the PR description, or give a concrete reason it
  is infeasible.
- An automated review runs on every PR. Some checks cannot run on pull requests
  from forks, because GitHub withholds repository secrets from them. A
  maintainer will run those for you; a red check on a fork PR is not
  necessarily your change.

## Things worth knowing before a large change

- **ES modules only.** No `require()`, no `module.exports`; use
  `import.meta.url` rather than `__dirname`.
- **No `any`.** Use a real type, `unknown`, or a generic.
- **User-visible strings in the debugger UI are translated.** Add keys to both
  `packages/debugger-ui/messages/en.json` and `zh-CN.json`, then run
  `pnpm --filter debugger-ui check:i18n-keys`.
- The `test:unit` lanes execute but do not typecheck. CI typechecks separately,
  so run `pnpm typecheck` before assuming green.

If you are planning something substantial, open an issue first. It is much
easier to agree on the shape of a change before it is written.

## Reporting security problems

Do not open a public issue. See [SECURITY.md](./SECURITY.md).
