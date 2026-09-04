# Phase 1 Data Model: AI Web-Agent Automation Engine

The engine persists nothing. These are in-memory shapes plus the YAML-addressable
vocabulary it shares with the CLI (002) and the MCP server (003). Field names below
match the implementation, because consumers serialise these into `.test.yaml` files
and cached action entities.

## ActionEntity

A resolved action. Defined in `packages/types/src/test-flow/actionEntity.ts` and
carried through the transpiler and the caches.

| Field | Purpose |
|---|---|
| `action_description` | Human-readable description. The only required field. |
| `action_data` | The action name plus its kwargs. `action` is a deprecated alias kept for backward compatibility. |
| `locator` | Semantic Playwright locator, preferring `getByRole`/`getByTestId` (FR-002). |
| `xpath` | Fallback address when the semantic locator stops matching. |
| `css_selector`, `unique_selector`, `selector_uniqueness_validated` | Alternate addressing and the flag recording whether uniqueness was checked. |
| `frame_path` | Ordered frame chain for elements inside iframes. |
| `highlight_index` | Index into the extracted element list used during resolution. |
| `text`, `tag`, `class` | Captured element context, used for self-healing and diagnostics. |
| `url` | Page URL at capture time. |
| `feedback`, `artifacts` | Execution feedback and attachments (screenshots and similar). |

**Validation rules**
- A negative or otherwise invalid `highlight_index` MUST error rather than act
  (spec Edge Cases).
- Element-targeted actions MUST carry both a semantic locator and an XPath (FR-002).
- A `verify` action MUST carry the original natural-language statement as its
  assertion (FR-005).

**State transition**: `DRAFT` (natural language, no entity) → resolved (entity with
locator + XPath, one model call) → replay (entity reused, **zero** model calls,
SC-003). Replay is what the whole shape exists to enable.

## AgentContext

Per-run state owned by the host and threaded through the engine.

| Field | Purpose |
|---|---|
| model / provider routing | Resolved per D1 and D2 in [research.md](./research.md). |
| variable store | Values plus their sensitive flags. |
| execution history | Prior steps, used as conversation context for multi-step tasks. |
| token usage | Accumulated per-run accounting, folded into the run usage summary. |

**Validation rules**
- Variables in `{{var}}`, `${var}`, `$var` and `<secret>var</secret>` MUST be
  substituted before use; unmatched variables are preserved verbatim (FR-008).
- Values flagged sensitive MUST stay sensitive in the context and in logs (FR-008).
- Timeout precedence is per-statement → organization → default (FR-007).

> **Invariant**: substitution is one left-to-right pass over a single alternation, so
> a substituted value is never rescanned. This matters most for credentials, which are
> the usual carriers of `$` — under the previous four-pass implementation a password
> `P$word` substituted from `{{pw}}` was rewritten to `PZZZ` when a variable named
> `word` existed. A change here must preserve the single-pass property; adding a
> second pass reintroduces the corruption.

## TestFlow / Statement

The YAML-addressable representation shared with 002 and 003. Defined in
`packages/types/src/test-flow/`.

- **Statement kinds**: `DRAFT` (natural language, resolved at runtime), `ACTION`
  (carries an `ActionEntity`, replays deterministically), `STEP` (a named group),
  and control flow (`IF_ELSE`, `WHILE_LOOP`).
- **Conditions** are either `JS_CODE` (evaluated directly) or `AI_MODE` (evaluated by
  the agent). AI-mode conditions are tagged with their construct — `"if"` or
  `"while"` — so run-usage attribution can separate them from `WAIT_UNTIL`.
- **Caching**: `actionEntityCache` and `actionEntityFingerprint` decide when a
  captured entity may be reused instead of re-resolved.

## LLM tier vocabulary

`packages/types/src/llmTiers.ts` carries the payload the proxy path depends on.

| Element | Meaning |
|---|---|
| `LlmTier` | `'lite' \| 'standard' \| 'pro'`. |
| `TierModelMap` / `TierModelSlot` | Tier → primary and fallback model ids. |
| `BAKED_TIER_MODEL_MAP` | The default map compiled into the engine. |
| `TIER_ENV_VAR` (`WEB_AGENT_TIER`) | Selects the tier. |
| `TIER_MODEL_MAP_ENV_VAR` (`SHIPLIGHT_TIER_MAP`) | Injects an override map. |
| `TIER_IGNORED_ENV_VARS` | The overrides deliberately ignored on the proxy path (D1). |

**Validation rules**
- Model ids normalise to `provider:model`; an unknown prefix is preserved as the
  model id rather than rejected (FR-003).
- Tier resolution precedence is `WEB_AGENT_TIER` → org default → baked default.
