# Development Workflows

**Parent**: [Project Overview](../CLAUDE.md)

## Working with AI Assistants (Claude Code)

**IMPORTANT: Git Commit Policy**
- **NEVER create git commits unless the user explicitly requests it**
- Only commit when the user specifically asks you to "create a commit", "commit the changes", or similar direct requests
- Do not proactively commit after completing tasks, even if the changes seem complete
- This policy ensures the user maintains full control over what gets committed and when

## Adding New Features

1. Add or extend types in `packages/types` (`shiplight-types`)
2. Implement the behavior in the owning package (`sdk-core` for engine work,
   `apps/cli/src/yaml-transpiler` for YAML work, `mcp-tools` for MCP surface)
3. Expose it through the product that needs it (`apps/cli` or `apps/mcp-server`)
4. Rebuild the chain — consumers bundle their dependency's **dist**, not source
5. Add tests in the owning package; co-locate them with the source

## Browser Verification

You have access to browser automation tools via the Shiplight MCP server. Use them to verify UI changes during development instead of asking the user to check manually.

**When to use:** After implementing or modifying frontend features — verify your changes work by launching a browser session, interacting with the UI, and inspecting the results.

**Workflow:**
1. `new_session(starting_url, storage_state_path)` — launch a browser. Use a saved storage state to skip login (e.g., `~/.shiplight/storage-states/staging.json`)
2. If login was required, use `save_storage_state(session_id, path)` immediately after to cache the session for future use
3. `inspect_page` — get DOM tree with element indices + screenshot
4. `act` — interact with elements (click, type, etc.) to exercise your changes
5. `inspect_page` — check the result (read DOM first, view screenshot only when needed)
6. Clean up any test data you created during verification (e.g., delete test cases, remove test accounts)
7. `close_session` — clean up when done
8. If verification passed, save a YAML test flow to `test-flows/` with all action entities from `act` responses. Read `shiplight://schemas/testflow-v1.2.0` for the format. These test flows can be uploaded to Shiplight cloud for continuous regression testing.

Use the `browser-session-basics` MCP prompt and `shiplight://schemas/action-entity` resource for action parameter details.

## Testing Strategy

- Unit tests (`test:unit`) for deterministic logic, co-located with the source
- Browser tests (`test:browser`) for behavior that needs a real Chromium
- Workflow guard tests in `scripts/__tests__/` for CI/publish invariants
- See [TESTING.md](../TESTING.md) for where to spend proof budget

## Working with Test Flows

When modifying test execution logic:

1. Update flow definitions in `packages/types/src/test-flow/testFlow.ts`
2. Adjust conversion utilities in
   `packages/debugger-ui/src/common/steps_json/conversionUtils.ts` — vendored
   support code for the legacy `action_steps[]` format, not a place to add
   features
3. Update Playwright code generation in `apps/cli/src/yaml-transpiler/`
4. Test with both legacy and modern flow formats

## Code Conventions

### Import Patterns

```typescript
// Shared package imports
import { TestCase } from '@/common/models/testCase'
import { TestCaseEntity } from '@/common/entities/testCaseEntity'

// Service layer imports
import { testCaseDbService } from '../db/testCaseDbService'
import { testCaseService } from '../app/testCaseService'
```

### Error Handling

Use consistent error responses with appropriate HTTP status codes. DB services should throw errors that are caught and transformed by controllers.

### Type Safety

Leverage TypeScript strictly. Use proper typing for:
- API request/response objects
- Database entity transformations
- Component props and state
- Service method signatures
