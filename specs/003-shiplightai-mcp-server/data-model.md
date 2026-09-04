# Phase 1 Data Model: @shiplightai/mcp UI-Automation Server

Nothing is persisted. These are the in-memory shapes and the payloads that cross the
JSON-RPC boundary.

## Session

The unit of ownership. Everything this server offers hangs off one.

| Element | Meaning |
|---|---|
| session id | Opaque handle the agent passes back on every call. |
| page | The live Playwright `Page`, held open across agent turns. |
| browser lifecycle | Owned by the server, or external when attached to Chrome via the relay. |
| storage state | Optional saved auth, loaded at creation and savable back. |
| recording | Backs `generate_html_report` for a closed session. |

**Validation rules**
- Sessions MUST be isolated: distinct ids and pages, independently closable (FR-006).
- An operation on a closed session MUST fail clearly, not silently no-op (FR-006).
- Sessions MUST be disposed on close — the process is long-lived (constitution IV).

**State transition**: `new_session` → active (navigate / inspect / act / logs) →
`close_session` → closed. `generate_html_report` is valid only in the closed state,
which is what keeps it session-bound and therefore in scope (FR-012).

## ActionEntity (returned, not owned)

Defined once in `packages/types` and reused — this server MUST NOT hold a second
authored definition (FR-016).

| Field | Why an agent needs it |
|---|---|
| `locator` | Semantic Playwright locator for a deterministic replay. |
| `xpath` | Fallback address. |
| `frame_path` | Frame chain for elements inside iframes. |
| `action_description` | Human-readable summary. |

**Contract**: every located action returns data sufficient for an agent to author a
deterministic `.test.yaml` statement (FR-002). Transpiling and validating that YAML is
002's job, not this server's.

## Tool surface

| Group | Tools |
|---|---|
| Session | `new_session`, `close_session`, `save_storage_state` |
| Page | `navigate`, `inspect_page`, `get_page_info`, `act` |
| Capture | `get_locators` |
| Diagnostics | `get_browser_console_logs`, `get_browser_network_logs` |
| Relay | `attach_to_browser` |
| Evidence | `generate_html_report` (closed session only) |

**Validation rules**
- Registration MUST be complete — every definition has a backing handler — and an
  unknown tool MUST error (FR-010).
- The surface MUST stay session-bound; no scaffolding, YAML validation or
  transpilation tools (FR-012), enforced by a guard (SC-006).
- `act` MUST execute only the actions it advertises.

## Resources

| Resource | Rule |
|---|---|
| action-entity | Generated from the live action registry (FR-014); documents only what this server produces and points at `npx shiplight spec yaml` for the YAML contract (FR-015). |

Prompts are user-invoked slash commands and are not readable by the agent, which is
why anything an agent must read is exposed as a resource too.

## Channel discipline

| Stream | Use |
|---|---|
| stdout | JSON-RPC only. Never logs (FR-008). |
| stderr | All logging, EPIPE handled, throwables formatted safely. |
