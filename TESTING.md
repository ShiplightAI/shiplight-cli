# Testing Strategy

Project-wide testing posture for the `test-coverage` workflow. Spend proof budget
on deterministic engine, CLI, and MCP behavior first; buy keyed-browser or
opt-in live proof only for product promises that depend on a real page, provider,
or packaged runtime seam.

This is prose guidance the coding agent reads — not a schema'd config, and not
read by Quality Center scoring.

## Contexts

- `local` — developer-local proof for fast iteration and diagnosis.
- `pr-ci` — the default pull-request gate for deterministic, repeatable checks.
- `keyed-browser` — browser lane that runs with a provider key against a
  controlled fixture page.
- `opt-in-live` — explicitly triggered live proof that may spend API budget or
  depend on external conditions.

## Posture by priority

Priority (P0–P3) is declared upstream (PRD / feature breakdown / spec), never
invented here.

- **P0 (release-critical)** — at least one deterministic `pr-ci` gate and more
  than one proof layer (defense-in-depth). For published runtime seams
  (web-agent engine, CLI, MCP server), add a keyed-browser lane when unit/
  integration proof cannot prove the user-visible promise.
- **P1** — at least one automated test, gated in `pr-ci`.
- **P2** — a dedicated or workflow-level automated test.
- **P3 / unknown** — indirect/supporting proof acceptable; absence is a noted
  gap, not a push target.

Boundary- and sensitive-data checks (`auth`, `billing`, `data`, `security`)
should be proven with direct, deterministic `contract`/`integration` evidence
regardless of priority.

## Modality preferences

- **Prefer:** `unit`, `contract`, `integration` — cheap, deterministic proof for
  changed logic.
- **Reserve (expensive):** `e2e` (fixture-backed browser, self-healing locators,
  DOM extraction/replay) and `agent` (cross-layer live, hard-to-script but
  auditable) — for browser/live/product-promise seams only.
- **Avoid by default:** `manual` — last resort / un-automatable only.

### Modality guidance

- `unit` — provider/model parsing and routing, timeout precedence and
  substitution, bounded-loop logic, error/edge-case assertions. Avoid for real
  browser execution or provider-keyed live behavior.
- `integration` — cross-module seams inside `sdk-core`; captured action replay
  without another model call. Avoid for claims that depend on a real browser
  surface.
- `e2e` — reserve for user-visible browser promises and packaged runtime seams;
  avoid for logic already proven by stable lower-cost tests.
- `agent` — investigative or live verification that still needs auditable
  evidence; not a default floor.

## Floors (non-negotiable)

- Unit coverage on core and changed logic.
- At least one `pr-ci` gate on every P1-or-higher expectation.
- P0 expectations need direct, multi-layer proof.

## Project notes

- Capability before cost: pick the cheapest modality that can actually prove the
  check.
- Shared-engine changes must be proven at the seam they actually ship through.
- Use live or keyed proof only when deterministic layers cannot prove the
  promise.
