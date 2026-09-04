# Chat History Support for Local Web Agent

## Overview

The local web agent now supports **chat history** for building copilot-style interfaces where conversation context is maintained across multiple `runTask` calls.

## Two Types of History

### 1. Execution History (Playwright Tests)
**Purpose**: Provide cached actions for test replay
**Type**: `Array<[string, string]>` - List of `(task, feedback)` pairs
**Use Case**: Playwright tests where ActionEntity objects are pre-generated and replayed

```typescript
const executionHistory = [
  ["Navigate to github.com", "Successfully navigated"],
  ["Click login button", "Login form appeared"],
  ["Fill username field", "Username entered"],
];

await runTask(task, page, agent, onEvent, { executionHistory });
```

### 2. Chat History (Copilot)
**Purpose**: Maintain conversational context across multiple interactions
**Type**: `ChatMessage[]` - Full conversation messages (user + assistant)
**Use Case**: Copilot where user can inject messages and have ongoing conversation

```typescript
const chatHistory: ChatMessage[] = [];

chatHistory.push({ role: 'user', content: 'please login to github' });
const result = await runTask('login to github', page, agent, onEvent, { chatHistory });
chatHistory.push({ role: 'assistant', content: result.chatSummary });

chatHistory.push({ role: 'user', content: 'create a PR from latest commit' });
const result2 = await runTask('create PR', page, agent, onEvent, { chatHistory });
```

## Architecture

### Within a Single `runTask` Call

Each `runTask` already generates multiple assistant messages internally:
- Step 1: LLM generates action → executes → sees result
- Step 2: LLM generates action → executes → sees result
- ...until goal is complete or maxSteps reached

### Across Multiple `runTask` Calls

Chat history preserves context between calls by storing:
1. User messages
2. Condensed summary of each runTask execution (not all intermediate steps)

## Chat Summary Format

`runTask` now returns a `chatSummary` field with this structure:

```
Steps taken:
1. go_to_url({url: "https://github.com"}) → ✓ successful
2. fill({index: 3, text: "username"}) → ✓ successful
3. fill({index: 5, text: "password"}) → ✓ successful
4. click({index: 7}) → ✗ failed: The page says the username/password doesn't exist

Status: ✗ Failed at step 4: Invalid credentials
```

**Status variations**:
- `✓ Goal completed in N step(s)` - Success
- `✗ Failed at step N: <error>` - Error during execution
- `⚠️ Reached maximum steps (N) without completing goal` - Max steps limit

## Implementation Details

### Types Added

```typescript
// Chat message for conversation history
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// StepResult now includes chatSummary
export interface StepResult {
  status: 'success' | 'error';
  completed: boolean;
  actionEntity: ActionEntity;
  explanation?: string;
  error?: string;
  chatSummary?: string; // NEW: Summary for chat history
}

// AgentOptions now includes chatHistory
export interface AgentOptions {
  maxSteps?: number;
  model?: string;
  temperature?: number;
  timeout?: number;
  executionHistory?: Array<[string, string]>; // For Playwright tests
  chatHistory?: ChatMessage[]; // NEW: For copilot
  sensitiveData?: Record<string, string>;
  variables?: Record<string, any>;
}
```

### How It Works

1. **Chat history is passed to LLM** (agentCore.ts):
   ```typescript
   // Build messages array - include chat history if provided
   const messages: any[] = [];

   if (options.chatHistory && options.chatHistory.length > 0) {
     for (const msg of options.chatHistory) {
       if (msg.role === 'user') {
         messages.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
       } else if (msg.role === 'assistant') {
         messages.push({ role: 'assistant', content: [{ type: 'text', text: msg.content }] });
       }
     }
   }

   // Add current user message with screenshot
   messages.push({
     role: 'user',
     content: [
       { type: 'text', text: userPrompt },
       { type: 'image', image: `data:image/png;base64,${screenshot}` },
     ],
   });
   ```

2. **Steps are tracked during execution** (localWebAgent.ts):
   ```typescript
   const stepSummaries: string[] = [];

   for (currentStep = 0; currentStep < maxSteps; currentStep++) {
     const result = await executeStep(statement, page, agent, options);

     // Track step for chat summary
     if (result.status === 'success') {
       stepSummaries.push(`${stepNum}. ${actionDesc} → ✓ ${explanation}`);
     } else {
       stepSummaries.push(`${stepNum}. ${actionDesc} → ✗ ${error}`);
     }
   }
   ```

3. **Chat summary is built when runTask completes**:
   ```typescript
   const chatSummary = `Steps taken:\n${stepSummaries.join('\n')}\n\nStatus: ✓ Goal completed in ${stepNum} steps`;
   return { ...result, chatSummary };
   ```

## Usage Example

See `examples/sdk-examples/copilotChatHistory.ts` for a complete demo:

```typescript
import { runTask, ChatMessage } from 'sdk-core';

const chatHistory: ChatMessage[] = [];

// Interaction 1
chatHistory.push({ role: 'user', content: 'Go to GitHub' });
const result1 = await runTask('Navigate to github.com', page, agent, onEvent, { chatHistory });
chatHistory.push({ role: 'assistant', content: result1.chatSummary });

// Interaction 2 - has context from Interaction 1
chatHistory.push({ role: 'user', content: 'Search for web automation' });
const result2 = await runTask('Use search to find "web automation"', page, agent, onEvent, { chatHistory });
chatHistory.push({ role: 'assistant', content: result2.chatSummary });

// Interaction 3 - knows we're on GitHub and searched
chatHistory.push({ role: 'user', content: 'Click the first result' });
const result3 = await runTask('Click first search result', page, agent, onEvent, { chatHistory });
```

## Benefits

1. **Token Efficient**: Single message per runTask (not per step)
2. **Context Preservation**: LLM sees full conversation history
3. **Clean Conversation**: Natural user ↔ assistant turn-taking
4. **Detailed Tracking**: Each step's success/failure is recorded
5. **Flexible**: Works with or without chat history

## Testing

Run the example:
```bash
GEMINI_API_KEY=your_key pnpm tsx examples/sdk-examples/copilotChatHistory.ts
```

## Future Enhancements

Potential improvements:
- **History compression**: Automatically compress old messages when token limit is reached
- **Message prioritization**: Keep important messages, summarize less critical ones
- **Streaming updates**: Stream chat summary as steps complete
- **Rich formatting**: Support markdown/structured data in chat summaries
