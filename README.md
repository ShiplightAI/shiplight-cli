# Shiplight

AI-powered end-to-end testing for Playwright. Write tests as YAML with
natural-language steps, run them alongside your existing `.test.ts` files, and
get self-healing locators and a visual debugger.

**Documentation: [docs.shiplight.ai](https://docs.shiplight.ai)**

## What ships from this repository

| Package | What it is |
|---|---|
| [`shiplightai`](./apps/cli) | The `shiplight` CLI and the Playwright fixture you wire into `playwright.config.ts` |
| [`@shiplightai/mcp`](./apps/mcp-server) | An MCP server giving a coding agent a real browser. Every tool is deterministic — no AI API key needed |
| [`@shiplightai/sdk`](./packages/sdk-public) | The browser automation engine as a library |

## Quick start

```bash
npx shiplightai@latest create ./my-tests
cd my-tests
npm install
npx playwright install chromium
npx shiplight test
```

A test looks like this:

```yaml
goal: A shopper can add an item to the cart
base_url: https://example.com

statements:
  - URL: /products

  # Natural language: resolved by a model on the first run
  - intent: Click the "Add to cart" button on the first product

  # Once resolved, a step carries its locator and replays deterministically
  - intent: Open the cart
    action: click
    locator: "getByRole('link', { name: 'Cart' })"

  - VERIFY: The cart shows exactly one item
```


A statement written as plain intent is resolved by a model at runtime; once
resolved it carries a concrete locator, so later runs replay deterministically
and only fall back to the model when the page has changed under it.

## Working on the code

Requires Node.js >= 22 and pnpm 10.

```bash
pnpm install
pnpm build
pnpm test:unit
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow, and
[AGENTS.md](./AGENTS.md) for how the codebase fits together — it is written for
coding agents but is the most complete architectural documentation here.

This project is developed spec-first: `specs/` holds the feature
specifications, and `.quality/` holds the quality map — what must hold, and how
each claim is proven.

## Telemetry

The CLI and the MCP server send anonymous usage events: which subcommand ran,
the version, OS, CPU architecture, Node version, and whether the run looks like
CI. No arguments, file paths, URLs, test content, or account data are
collected, and a command we do not ship is reported as `unknown` rather than by
name. Runs are grouped by a one-way hash of host, user, platform and
architecture; the inputs to that hash never leave your machine.

Opt out with either:

```bash
SHIPLIGHT_TELEMETRY=0
DO_NOT_TRACK=1
```

The implementation is [`packages/telemetry`](./packages/telemetry) — about a
hundred lines, no dependencies, and every event it can send is visible there.

## Security

Please report vulnerabilities privately. See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
