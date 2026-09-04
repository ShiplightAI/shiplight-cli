# Important Implementation Details

**Parent**: [Project Overview](../CLAUDE.md)

## Test Flow Conversion

Test cases can be represented in two formats:
- **Legacy**: `action_steps[]` (`packages/debugger-ui/src/common/steps_json/`)
- **Modern**: `test_flow` tree structure (`packages/types/src/test-flow/testFlow.ts`)

Use `packages/debugger-ui/src/common/steps_json/conversionUtils.ts` to convert
between formats. Both paths moved in the August 2026 trim: the legacy format is
now vendored support code inside the debugger (see below), and the `test_flow`
types live in `shiplight-types`.

## Statement Types

- **DRAFT** statements are natural language, resolved by AI at runtime (slow, ~10-15s each)
- **ACTION** statements carry an `action_entity` (locator/xpath) and replay
  deterministically (~1s each)
- `computeFlowStats` — which returned stats and hints nudging agents to enrich
  DRAFT statements with real locators — was removed with the rest of the v1
  cloud surface in `736d9e973` (`packages/mcp-tools/src/tools/testCaseTools.ts`).
  Nothing defines it now; the only trace is a comment in
  `packages/types/src/test-flow/validateTestYaml.test.ts`, whose
  `countIntentStatements` covers the code path it used to share

## packages/debugger-ui scope

The debugger UI is the whole package: `src/components/local-debugger/`,
`src/components/local-debugger-shell/`, `src/components/testcase/debugger/` and
the `src/components/testcase/editor/` tree it bundles, plus the shared
components and hooks they reach. The web app that used to surround it was
retired in August 2026 and is not part of this repository.

`src/common/` holds the ~33 internal shared modules the debugger still needed,
vendored when that package was removed. Treat them as frozen support code, not
as a place to add features.
