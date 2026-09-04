# Hybrid Intelligent Task Agent

The hybrid task agent combines the best features from both the Copilot Agent and the original Task Agent:

## Key Features

### 1. **Gemini Native Thinking Mode**
- Uses Gemini 2.5's built-in thinking capabilities
- Configurable thinking budget (default: 512 tokens)
- Automatically enabled for Gemini models
- Provides higher quality reasoning than JSON thinking field

```typescript
await runTask(task, page, agent, onEvent, {
  useNativeThinking: true,  // Enable Gemini thinking (default: true)
  thinkingBudget: 512,      // Token budget (default: 512)
});
```

### 2. **Multi-Action Per Step**
- Execute multiple related actions in one step
- Reduces LLM calls for connected operations
- Stops execution if any action fails
- Backward compatible with single-action mode

```typescript
// Agent can now return multiple actions:
{
  "actions": [
    { "action_name": "type", "kwargs": { "text": "username" } },
    { "action_name": "press_key", "kwargs": { "key": "Tab" } },
    { "action_name": "type", "kwargs": { "text": "password" } }
  ]
}
```

### 3. **Direct Tool Access**
- All 29 browser automation tools available
- No indirection through wrapper functions
- Direct control over browser actions
- Same tool set as action generation

### 4. **Explicit Reasoning Fields**
- Structured JSON output with observable fields:
  - `thinking`: Internal reasoning
  - `evaluation_previous_goal`: Success/failure of last step
  - `memory`: Important facts to remember
  - `current_goal`: Current sub-goal
  - `actions`: Array of actions to execute
  - `completes_instruction`: Task completion flag

### 5. **Backward Compatible**
- Old single-action format automatically converted
- Existing code continues to work
- Optional feature flags for gradual adoption

## Architecture

### Execution Flow

```
Step N:
├─ Phase 1: Prepare Context
│  └─ Capture DOM state + screenshot
│
├─ Phase 2: Plan (with LLM)
│  ├─ Native thinking (if Gemini + enabled)
│  ├─ Structured JSON output
│  └─ Multiple actions planned
│
├─ Phase 3: Execute Actions
│  ├─ Action 1 → success
│  ├─ Action 2 → success
│  └─ Action 3 → stops if failed
│
└─ Phase 4: Post-Process
   ├─ Update memory
   ├─ Track evaluation
   └─ Check completion
```

## Configuration Options

```typescript
interface TaskAgentOptions {
  // Execution limits
  maxSteps?: number;          // Max steps (default: 15)
  maxFailures?: number;       // Max consecutive failures (default: 3)

  // Feature flags
  useThinking?: boolean;      // Enable thinking field (default: true)
  useMemory?: boolean;        // Enable memory tracking (default: true)
  useEvaluation?: boolean;    // Enable evaluation (default: true)
  useMultiAction?: boolean;   // Allow multiple actions/step (default: true)
  useNativeThinking?: boolean; // Use Gemini thinking (default: true)
  thinkingBudget?: number;    // Thinking token budget (default: 512)

  // Callbacks
  onStepStart?: (step: number) => void;
  onStepComplete?: (record: TaskStepRecord) => void;
}
```

## Example Usage

### Basic Usage (with defaults)
```typescript
import { runTask } from 'sdk-core';

const result = await runTask(
  'Search for "playwright" and click first result',
  page,
  agent
);
```

### Advanced Configuration
```typescript
const result = await runTask(
  'Complete the checkout process',
  page,
  agent,
  (event) => {
    if (event.type === 'step_start') {
      console.log(`Step ${event.step}/${event.maxSteps}`);
    }
  },
  {
    maxSteps: 20,
    useNativeThinking: true,
    useMultiAction: true,
    thinkingBudget: 1024,
    onStepComplete: (record) => {
      console.log(`Goal: ${record.goal}`);
      console.log(`Actions: ${record.actionEntities.length}`);
    }
  }
);
```

## Comparison: Old vs Hybrid

| Feature | Old Task Agent | Hybrid Agent |
|---------|----------------|--------------|
| Thinking | JSON field only | Native Gemini + JSON |
| Actions/Step | 1 | 1-N (configurable) |
| Tool Access | 29 tools | 29 tools |
| LLM Calls | 1 per action | 1 per step (multiple actions) |
| Memory | Implicit in conversation | Explicit + conversation |
| Reasoning Quality | Good | Better (native thinking) |
| Efficiency | Good | Better (action batching) |

## Benefits

### Performance
- **Fewer LLM calls**: Batch related actions in one step
- **Lower latency**: Native thinking is faster than JSON generation
- **Better cost**: Fewer requests = lower API costs

### Quality
- **Better reasoning**: Native thinking produces higher quality decisions
- **Observable state**: Explicit JSON fields for debugging
- **Goal tracking**: Clear sub-goal decomposition

### Flexibility
- **Backward compatible**: Existing code works unchanged
- **Gradual adoption**: Enable features one at a time
- **Provider agnostic**: Works with any LLM (thinking mode optional)

## Migration Guide

### From Old Task Agent
No changes required! The hybrid agent is fully backward compatible:

```typescript
// This still works exactly as before
await runTask(task, page, agent);
```

### Enable New Features
Gradually enable new features:

```typescript
// Step 1: Enable native thinking
await runTask(task, page, agent, undefined, {
  useNativeThinking: true
});

// Step 2: Enable multi-action
await runTask(task, page, agent, undefined, {
  useNativeThinking: true,
  useMultiAction: true
});
```

## When to Use Multi-Action vs Single-Action

### Use Multi-Action When:
- All actions execute on the CURRENT page state
- Last action can cause navigation (e.g., click submit), but no actions after it
- Examples:
  - ✅ Type username → Tab → Type password → Click submit (all on same page)
  - ✅ Click checkbox 1 → Click checkbox 2 → Click checkbox 3
  - ✅ Fill form fields → Click "Next" button
- Performance is critical (minimize LLM calls)

### Use Single-Action When:
- Need to observe page state changes after navigation
- Actions span different pages (e.g., click link then interact with new page)
- Examples:
  - ❌ Click "Next" → Verify on new page (need fresh DOM)
  - ❌ Click link → Type on new page (cannot batch across navigation)
  - ✅ Click link (alone, then next step interacts with new page)
- Maximum control and visibility required

**Important**: The last action in a batch can cause page navigation, but you cannot batch actions that span across a navigation boundary. After navigation, the agent needs fresh page state in the next step.

## Testing

Run the test script:
```bash
cd examples/sdk-examples

# With Google Generative AI (fallback mode)
GEMINI_API_KEY=your_key pnpm tsx testHybridAgent.ts

# With Google Vertex AI (native thinking mode)
GOOGLE_CLOUD_PROJECT=your-project-id \
GOOGLE_CLOUD_LOCATION=us-central1 \
pnpm tsx testHybridAgent.ts
```

## Implementation Details

See the source code:
- `types.ts` - Type definitions
- `prompts.ts` - System prompts and formatting
- `messageManager.ts` - Conversation management
- `service.ts` - Main execution loop
