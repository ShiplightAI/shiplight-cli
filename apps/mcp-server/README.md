# @shiplightai/mcp

UI automation MCP for agentic development workflows. Lets AI coding agents (Claude Code, Cursor, Windsurf, etc.) verify the UI changes they make — closing the build-verify loop automatically. Every interaction is captured as a human-readable step, producing rerunnable regression tests.

## Quick Start

### Claude Code

```bash
claude mcp add shiplight -e PWDEBUG=console -- npx -y @shiplightai/mcp@latest
```

### Cursor / Windsurf / Other MCP Clients

Add to your MCP config (e.g., `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "shiplight": {
      "command": "npx",
      "args": ["-y", "@shiplightai/mcp@latest"]
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PWDEBUG` | Yes | Must be set to `console`. Enables Playwright semantic locator generation (e.g., `getByRole`, `getByTestId`) for action entities. Without this, only XPath locators are available. |

**No AI API key is required.** Every tool this server exposes is deterministic:
actions are driven by the element indices returned from `inspect_page`, not by a
model. Your coding agent supplies the intelligence; this server supplies the
browser.

Pass environment variables through your MCP config:

```json
{
  "mcpServers": {
    "shiplight": {
      "command": "npx",
      "args": ["-y", "@shiplightai/mcp@latest"],
      "env": {
        "PWDEBUG": "console"
      }
    }
  }
}
```

The server resolves environment variables in this order:

1. Variables passed explicitly by your MCP client config
2. Inherited host environment variables
3. A `.env` file in the current working directory where the MCP server starts

Existing environment variables are never overridden by `.env`, so project-local `.env` values act as a fallback.

## What It Does

Once connected, your AI coding agent can:

- **Verify its own UI changes** — Open pages, interact with elements, and assert visual conditions using AI ("Verify the success message is displayed")
- **Debug UI issues** — Inspect console errors and network failures directly from the browser session
- **Generate regression tests** — Every action returns replay-ready locator data (`locator`/`xpath`/`frame_path`) you embed into `.test.yaml` files authored with the `shiplightai` CLI, for fast, deterministic replay
- **Attach to existing Chrome tabs** — Control your existing Chrome tabs via the Shiplight AI extension without recreating login state or complex setups

## Telemetry

The server sends one anonymous event when an MCP client opens a browser
session (`new_session`): the server version, your OS, CPU architecture and Node
version. Nothing else — no page content, URLs, tool arguments or account data.
Runs are grouped by a one-way SHA-256 hash of host, user, platform and
architecture; the inputs to that hash are never transmitted. The `shiplightai`
CLI reports under the same hash, so one machine counts once.

Opt out with either `SHIPLIGHT_TELEMETRY=0` or `DO_NOT_TRACK=1`.

## Links

- [Shiplight](https://www.shiplight.ai) — home page
- [shiplightai npm package](https://www.npmjs.com/package/shiplightai) — Playwright plugin for running `.test.yaml` files locally
