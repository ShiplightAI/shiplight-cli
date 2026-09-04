# Test Spec: <Feature Name>

**Feature**: `<feature-directory-name>`
**Source of truth**: [spec.md](./spec.md)
**Test report**: [test-report.md](./test-report.md)

This file defines the durable testing contract for this feature: what needs
confidence and which evidence strategies are acceptable. Automated tests are one
implementation of the contract, not the contract itself.

## Testing What

Testing what is broader than product requirements. Include product behavior,
implementation/system invariants, operational behavior, risk areas, and
stakeholder confidence goals that matter for trusting this feature.

### Product Behaviors

- <User-visible behavior, workflow, or product promise to verify.>

### Implementation / System Invariants

- <Important API, schema, transaction, audit, permission, data ownership,
  cleanup, idempotency, routing, or architecture invariant.>

### Risk-Based Behaviors

- <Security, privacy, billing, data integrity, regression, or high-blast-radius
  behavior.>

### Operational / Release Behaviors

- <Migration, job, telemetry, rollout, rollback, live-env, performance, or
  release-gate behavior.>

### Stakeholder Confidence Goals

- <What product, support, compliance, release, or customer stakeholders need to
  trust if this passes.>

## Evidence Strategy

| What | Risk | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| <behavior/invariant> | <impact if broken> | <unit, contract, integration, e2e, agent, manual, telemetry> | <chosen proof> | <confidence/cost/stability rationale> | <remaining gap> |

## Scope

- User stories covered:
- Primary requirements covered:
- Success criteria covered:
- Implementation/system invariants covered:
- Out of scope:

## Test Cases

### <FEATURE>-T01 <Capability / Behavior Name>

- Testing what:
- User stories:
- Requirements:
- Success criteria:
- Preconditions:
  - Required account / role:
  - Required data:
  - Required external services:
- Automated checks:
  ```bash
  # Add focused unit, contract, integration, e2e, script, typecheck, or lint
  # commands that are useful diagnostics for this test case.
  ```
- Steps:
  1. <Action the executor performs through API, DB, UI, browser, logs, script,
     telemetry, or manual observation.>
  2. <Next action.>
- Optional stronger evidence:
  - DB:
  - API:
  - Logs:
  - Browser / UI automation:
  - Agent test:
  - External dashboard / telemetry:
- Pass criteria:
  - <Observable result that proves the requirement or invariant.>
- Cleanup:
  - <Rows, accounts, external resources, sessions, or files to remove.>
- If not executable:
  - Mark `SKIPPED` when the environment lacks required fixtures or access.
  - Mark `HUMAN_REQUIRED` when no available agent/tool can verify it.
  - Mark `DEFERRED` when the proof belongs to a later release/live-env sweep.

### <FEATURE>-T02 <Next Capability / Behavior Name>

- Testing what:
- User stories:
- Requirements:
- Success criteria:
- Preconditions:
- Automated checks:

  ```bash

  ```

- Steps:
  1. <Action.>
- Optional stronger evidence:
- Pass criteria:
- Cleanup:
- If not executable:

## Fixtures

Fixtures describe how to bind the portable test cases to concrete environments.
Do not put secrets in this file. Describe secret availability without printing
values.

### Local Development

- Web URL:
- Admin URL:
- API URL:
- Accounts / roles:
- Data fixtures:
- External service fixtures:
- Environment setup:
- Mutation policy: `seeded_fixtures_only` unless explicitly allowed.
- Known local limitations:

### Dev

- Web URL:
- Admin URL:
- API URL:
- Accounts / roles:
- Data fixtures:
- External service fixtures:
- Mutation policy:
- Known limitations:

### Staging

- Web URL:
- Admin URL:
- API URL:
- Accounts / roles:
- Data fixtures:
- External service fixtures:
- Mutation policy:
- Known limitations:

### Production

- Web URL:
- Admin URL:
- API URL:
- Accounts / roles:
- Data fixtures:
- External service fixtures:
- Mutation policy: `read_only` by default.
- Known limitations:

## Report Expectations

- Stable report path: `specs/<feature-directory-name>/test-report.md`.
- Report every test case as `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, `SKIPPED`,
  `HUMAN_REQUIRED`, or `DEFERRED`.
- Put blocking failures first in `## Findings` or `## Deferred / Residual Risk`.
- Record commands run, evidence collected, cleanup performed, and resources
  intentionally left behind.
- Never include passwords, API keys, cookies, tokens, database URLs, or raw
  secret fixture payloads.

## Coverage Notes

- Map every important testing what to at least one selected evidence strategy.
- If an automated test already covers a case, include the exact command to run
  it and the expected pass signal.
- If a case cannot be automated, specify how an agent, human, telemetry query,
  or live-env check can verify it.
- If a case depends on environment capabilities, keep the test case portable and
  document the environment-specific binding under `## Fixtures`.
