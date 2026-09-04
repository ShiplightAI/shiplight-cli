# Contract: Engine Surface

`sdk-core` is a library, so its contract is the interface it exposes to its two
consumers — the `shiplightai` CLI (002) and the `@shiplightai/mcp` server (003) —
plus the two seams that must not drift. It is never published to npm; both consumers
inline it via tsup `noExternal`, so a change here reaches users through their
releases.

## C1 — Host supplies configuration; the engine reads no ambient environment

```
configureSdk({ env: { GOOGLE_API_KEY, ANTHROPIC_API_KEY, ... } })
```

**Obligations on the engine**
- MUST read provider configuration only from the injected config (FR-010).
- MUST NOT read `process.env` for provider settings.

**Obligations on the host**
- MUST pass an explicit, allowlisted set of variables. The CLI and the MCP server
  each own their allowlist; the engine does not police it.

**Why it matters**: this is the seam that makes the hosts' allowlists enforceable.
Breaking it silently re-exposes every ambient variable inside a long-lived MCP
server. Covered by the allowlist tests in 002/003, not here.

## C2 — Resolve one step into one action, or fail explicitly

```
generateAction(page, instruction, context) -> ActionEntity | error
```

**Guarantees**
- Exactly one concrete action, or an explicit error — never a guessed action
  (FR-001).
- Element-targeted actions carry a semantic locator plus an XPath (FR-002).
- A `verify` instruction produces a `verify` action carrying the original statement
  (FR-005).
- "No usable action", "done", "cannot complete in one step" and an invalid element
  index all surface as errors (spec US1 AC3, Edge Cases).

## C3 — Execute a captured action without a model call

```
execute(page, actionEntity, context) -> result
```

**Guarantees**
- A captured entity replays from its locator/XPath with **zero** model calls
  (FR-002, SC-003). This is the contract the transpiler's cache depends on.
- Per-statement → organization → default timeout precedence applies (FR-007).
- Variable substitution and sensitive-value handling happen before use (FR-008).

## C4 — Model selection and routing

**Guarantees**
- Direct provider key → that provider, overridable by `WEB_AGENT_MODEL` or an
  explicit `provider:model` (FR-003).
- Shiplight token + tier info → tier-selected model, with the override variables in
  `TIER_IGNORED_ENV_VARS` deliberately ignored (FR-003).
- Credential shape selects the endpoint: provider key → provider; `shp_*` token →
  the Shiplight proxy proxy; `SHIPLIGHT_API_URL` overrides the base (FR-004).
- Any other token shape resolves to **no endpoint**. An LLM call fails with an
  actionable message; callers that can degrade must do so (FR-004).
- Model ids normalise to `provider:model`; unknown prefixes are preserved (FR-003).

**Non-goal**: Vertex AI routing. It lives in the cloud service (research D3).

## C5 — Bounded execution

**Guarantees**
- Step, self-heal and modal-dismissal budgets are enforced (FR-006).
- Non-positive `maxSteps` is rejected before execution starts (US4 AC1).
- Single-step instructions take the single-step path; multi-step instructions run
  the task loop under the configured budget (US4 AC2).

## C6 — Shared vocabulary with 002 and 003

`TestFlow`, `Statement`, `ActionEntity` and the tier types live in
`packages/types` and are imported by both consumers. Changing a field name or its
meaning is a breaking change for the YAML format users have already written, and for
cached action entities on disk.

**Compatibility rules**
- `action` remains a deprecated alias for `action_data`; do not remove it without a
  migration for existing cached entities.
- AI-mode conditions MUST keep their construct tag (`"if"` / `"while"`), which
  run-usage attribution reads to separate them from `WAIT_UNTIL`. The proof for that
  emit now lives in the CLI (`apps/cli/src/yaml-transpiler/aiConditionAttribution.test.ts`).
