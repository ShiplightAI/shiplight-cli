# SDK Examples

This directory contains examples demonstrating the Shiplight SDK capabilities.

## Main Example: testAgent.ts

**`testAgent.ts`** is the comprehensive test suite that demonstrates:

1. **All 28 LLM Tools** organized by category:
   - 🧭 Navigation (3): `go_to_url`, `go_back`, `reload_page`
   - 🖱️ Mouse (4): `click`, `hover`, `right_click`, `double_click`
   - ⌨️ Input (6): `fill`, `input_text`, `clear_input`, `press`, `send_keys`, `send_keys_on_element`
   - 📜 Scroll (5): `scroll_down`, `scroll_up`, `scroll_on_element`, `scroll_to_text`, `scroll`
   - 🗂️ Tabs (3): `open_tab`, `close_tab`, `switch_tab`
   - 📁 File (2): `upload_file`, `click_download_button`
   - 📋 Form (1): `select_dropdown_option`
   - 🔧 Utility (4): `wait`, `save_variable`, `js_code`, `done`

2. **Local Web Agent APIs**:
   - `executeStep()` - Single-step action execution
   - `evaluateStatement()` - Evaluation without execution
   - `runTask()` - Multi-step agent with event streaming

## Usage

### Quick Test with Custom Task

```bash
pnpm tsx examples/sdk-examples/testAgent.ts "Go to wikipedia.org and search for AI"
```

### Interactive Copilot Chat

Run an interactive chat session with the agent:

```bash
# Basic usage (logs to ./logs by default)
pnpm tsx examples/sdk-examples/copilotChat.ts

# Custom log directory
pnpm tsx examples/sdk-examples/copilotChat.ts --log-dir /path/to/logs
```

**Features:**
- Type requests and get real-time responses
- Maintains conversation context across interactions
- Slash commands: `/help`, `/history`, `/clear`, `/exit`
- LLM call logging enabled by default (saves to `./logs/`)

**Example session:**
```
👤 You: Go to GitHub
🤖 Agent: Working on it...
✅ Task completed!

👤 You: /history
📜 Shows full conversation

👤 You: Search for "web automation"
🤖 Agent: Working on it...

👤 You: /exit
👋 Goodbye!
```

### Copilot Chat History Demo

See how to maintain conversation context across multiple `runTask` calls:

```bash
pnpm tsx examples/sdk-examples/copilotChatHistory.ts
```

### Run Specific Test Category

```bash
# Test navigation tools
pnpm tsx examples/sdk-examples/testAgent.ts --category navigation

# Test mouse tools
pnpm tsx examples/sdk-examples/testAgent.ts --category mouse

# Test input & keyboard tools
pnpm tsx examples/sdk-examples/testAgent.ts --category input

# Test scroll tools
pnpm tsx examples/sdk-examples/testAgent.ts --category scroll

# Test tab management tools
pnpm tsx examples/sdk-examples/testAgent.ts --category tabs

# Test file & form tools
pnpm tsx examples/sdk-examples/testAgent.ts --category file

# Test utility tools
pnpm tsx examples/sdk-examples/testAgent.ts --category utility

# Test local agent APIs (executeStep, evaluateStatement, runTask)
pnpm tsx examples/sdk-examples/testAgent.ts --category api
```

### Run Full Test Suite

```bash
pnpm tsx examples/sdk-examples/testAgent.ts
```

## Environment Setup

The SDK supports both Google (Gemini) and Anthropic (Claude) models.

### Option 1: Google Models (Default)

1. Get your API key from: https://aistudio.google.com/app/apikey

2. Create a `.env` file:
```bash
MODEL=gemini-2.5-pro
GOOGLE_API_KEY=your_key_here
```

### Option 2: Anthropic Models

1. Get your API key from: https://console.anthropic.com/

2. Create a `.env` file:
```bash
MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-your_key_here
```

### Supported Models

| Provider | Model Names |
|----------|-------------|
| Google | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-flash-preview` |
| Anthropic | `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-opus-4-6` |

### Quick Switch

To switch models, just update the `MODEL` variable in your `.env` file:

```bash
# Use Claude Sonnet
MODEL=claude-sonnet-4-6

# Use Gemini Pro
MODEL=gemini-2.5-pro
```

## Features Demonstrated

### DOM Extraction + SOM Screenshots

The local web agent automatically:
- Extracts DOM tree with interactive element indices
- Takes screenshots with Set-of-Mark (SOM) labels
- Provides both to the LLM for accurate element targeting

### Multi-Step Execution

The `runTask()` function:
- Executes multiple steps until goal is accomplished
- Refreshes browser state (DOM + screenshot) after each action
- Streams events for real-time progress tracking
- Stops when LLM calls the `done` tool or max steps reached

### Event Streaming

Monitor agent progress with events:
```typescript
runTask(task, page, agent, (event) => {
  if (event.type === 'step_start') {
    console.log(`Step ${event.step}/${event.maxSteps}`);
  }
  if (event.type === 'action_generated') {
    console.log(`Action: ${event.action.action_data.action_name}`);
  }
  if (event.type === 'goal_completed') {
    console.log(`Completed in ${event.totalSteps} steps`);
  }
});
```

## Deprecated Files

The following files have been consolidated into `testAgent.ts`:
- `llmTools.ts` - Now shows deprecation message
- `testAllActions.ts` - Now shows deprecation message
- `llmToolsMultiStep.ts` - Removed
- `llmToolsV2.ts` - Removed
- `testLocalAgent.ts` - Removed

## API Reference

### executeStep()

Single-step action execution:

```typescript
import { executeStep } from 'sdk-core';

const result = await executeStep(
  'Navigate to https://example.com',
  page,
  agent,
  { maxSteps: 1 }
);

console.log(result.status);      // 'success' | 'error'
console.log(result.completed);   // true if goal accomplished
console.log(result.actionEntity); // The action that was executed
```

### evaluateStatement()

Evaluation without execution:

```typescript
import { evaluateStatement } from 'sdk-core';

const result = await evaluateStatement(
  'The page title contains "Example"',
  page,
  agent
);

console.log(result.success);     // true | false
console.log(result.explanation); // LLM's explanation
```

### runTask()

Multi-step agent execution:

```typescript
import { runTask } from 'sdk-core';

const result = await runTask(
  'Go to Wikipedia and search for "Web automation"',
  page,
  agent,
  (event) => {
    // Handle streaming events
    console.log(event);
  },
  { maxSteps: 10 }
);

console.log(result.status);      // 'success' | 'error'
console.log(result.completed);   // true if goal accomplished
console.log(result.chatSummary); // Summary for chat history
```

### Chat History (Copilot Pattern)

Maintain conversation context across multiple `runTask` calls:

```typescript
import { runTask, ChatMessage } from 'sdk-core';

const chatHistory: ChatMessage[] = [];

// First interaction
chatHistory.push({ role: 'user', content: 'Go to GitHub' });
const result1 = await runTask('Navigate to github.com', page, agent, onEvent, { chatHistory });
chatHistory.push({ role: 'assistant', content: result1.chatSummary });

// Second interaction - has context from first
chatHistory.push({ role: 'user', content: 'Search for web automation' });
const result2 = await runTask('Use search box to search for "web automation"', page, agent, onEvent, { chatHistory });
chatHistory.push({ role: 'assistant', content: result2.chatSummary });

// Third interaction - knows we're on GitHub and searched already
chatHistory.push({ role: 'user', content: 'Click the first result' });
const result3 = await runTask('Click the first search result', page, agent, onEvent, { chatHistory });
```

**Chat Summary Format:**
```
Steps taken:
1. go_to_url({url: "https://github.com"}) → ✓ successful
2. click({index: 5}) → ✓ Search box focused

Status: ✓ Goal completed in 2 steps
```

### LLM Call Logging

Enable logging to see what was sent to the LLM:

```typescript
const result = await runTask(
  'Navigate to github.com',
  page,
  agent,
  onEvent,
  {
    chatHistory,
    logDir: './logs'  // Enable logging
  }
);
```

**Log Structure:**
```
logs/
└── session-2025-01-14T12-30-45/    # One session per runTask call
    ├── step-1/                      # First LLM call
    │   ├── messages.txt             # Human-readable with [IMAGE: screenshot-msg1.png]
    │   ├── messages.json            # JSON with screenshot file references
    │   ├── screenshot-msg1.png      # Current screenshot
    │   ├── response.txt             # LLM response (human-readable)
    │   ├── response.json            # Structured response (tool calls & usage)
    │   └── response-raw.json        # Complete raw LLM response (for debugging)
    ├── step-2/                      # Second LLM call
    │   ├── messages.txt
    │   ├── messages.json
    │   ├── screenshot-msg1.png
    │   ├── screenshot-msg2.png      # Previous screenshot (from chat history)
    │   ├── response.txt
    │   ├── response.json
    │   └── response-raw.json
    └── step-3/                      # Third LLM call...
        └── ...
```

**Key features**:
- One session folder per `runTask` call, step numbers increment within the session
- `response-raw.json` contains the complete raw LLM response for debugging issues

## Contributing

When adding new examples:
1. Update this README with usage instructions
2. Follow the existing code style and patterns
3. Include comprehensive comments
4. Test with real browser automation scenarios
