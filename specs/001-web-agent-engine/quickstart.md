# Quickstart: Validating the Web-Agent Engine

How to prove the engine still satisfies its spec. Two lanes: a deterministic one that
gates PRs, and a live one that needs a browser and a credential.

## Prerequisites

- Node.js >= 22, pnpm
- `pnpm install` at the repo root
- For the live lane only: `npx playwright install chromium` and one provider key
  (`GOOGLE_API_KEY` or `ANTHROPIC_API_KEY`)

`sdk-core` is consumed from source by its two hosts, but its own tests run against the
package directly — no build step is needed for the unit lane.

## Lane 1 — Deterministic (CI-gated)

```bash
pnpm --filter sdk-core test:unit
```

Mocks the LLM via `--experimental-test-module-mocks`, so it is reproducible and needs
no credential. This is the lane that proves **SC-001**: the NL→action decision
mapping, including the verify rewrite and the no-action / done / cannot-complete /
negative-index error paths.

Expected: all tests pass, no network access, no browser.

**Requirement coverage**: FR-001, FR-002, FR-005, FR-006, FR-008, and the model
selection and routing rules of FR-003/FR-004 (SC-002).

## Lane 2 — Live browser (not CI-gated)

```bash
GOOGLE_API_KEY=... pnpm --filter sdk-core test:browser
```

Drives real pages through the full NL→action loop. Needs Chromium and a credential,
which is why it is deliberately outside the default gate — see research D8.

> The `test` script (`playwright test --config=tests/playwright.config.ts`) runs the
> whole Playwright suite and reads `packages/sdk-core/tests/.env`. That file must
> define `GOOGLE_API_KEY` or `ANTHROPIC_API_KEY`; defining only
> `GOOGLE_GENERATIVE_AI_API_KEY` makes the suite fail with "No LLM model configured"
> even though a key is present.

## Lane 3 — Prove it through its consumers

The engine ships inside the CLI and the MCP server, so their lanes are the real
end-to-end proof:

```bash
pnpm --filter shiplightai test:unit      # includes the yaml-transpiler suite
pnpm turbo run test:browser              # CLI + mcp-tools browser behaviour
```

## Scenario checks mapped to the spec

| Check | How to observe |
|---|---|
| US1 — "click the Login button" yields a `click` on that element | Lane 1, `elementBased.generateAction.test.ts` |
| US1 AC3 — no usable action returns an error, not a wrong action | Lane 1, same suite |
| US2 — captured entity carries locator + XPath | Lane 1; inspect the returned `ActionEntity` |
| US2 AC2 / SC-003 — replay makes no model call | Lane 1; assert no provider call on the replay path |
| US3 — one key in isolation selects that provider and endpoint | Lane 1, provider/routing tests |
| US3 AC4 — tier path ignores `WEB_AGENT_MODEL` | Lane 1, `resolveCuaModel` / tier tests in `packages/types` |
| US4 AC1 — `maxSteps <= 0` is rejected | Lane 1, budget tests |
| FR-010 — no ambient env reads | The hosts' allowlist tests in 002/003, not here |

## What "green" does not prove

Lane 1 proves the mapping with a mocked model; it cannot prove the engine works
against a real page. Only Lane 2 does, and it is not gated. When changing action
generation, run Lane 2 before trusting a green Lane 1.
