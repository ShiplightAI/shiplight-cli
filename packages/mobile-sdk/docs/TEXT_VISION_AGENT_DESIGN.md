# Text + Vision Agent Design

This document describes the architecture for the new Text + Vision agent in the mobile-sdk, which uses accessibility tree (element tree) combined with screenshots for more reliable automation.

## Overview

The mobile-sdk supports two agent types:

| | VisionAgent (Existing) | TextVisionAgent (New) |
|---|---|---|
| **Input** | Screenshot only | Screenshot + Element Tree |
| **Model** | Gemini CUA / OpenAI CUA | Gemini 2.5 Pro |
| **Output** | Coordinates (x, y) | Selectors (resource-id, text, content-desc) |
| **Execution** | ADB (`input tap x y`) | Appium (UIAutomator2) |
| **Best for** | Dynamic UI, animations | Reliable automation, stable selectors |

## Architecture

### System Diagram

```
┌────────────────────────────────────────────────────────┐
│                  Our Node.js Process                   │
│                                                        │
│  ┌──────────────┐              ┌──────────────┐       │
│  │ VisionAgent  │              │ TextVision   │       │
│  │              │              │ Agent        │       │
│  └──────┬───────┘              └──────┬───────┘       │
│         │                             │               │
│         ▼                             ▼               │
│  ┌──────────────┐              ┌──────────────┐       │
│  │ AdbExecutor  │              │ AppiumExec.  │       │
│  │ (coords)     │              │ (selectors)  │       │
│  └──────┬───────┘              └──────┬───────┘       │
│         │                             │               │
│         │ adb shell                   │ Appium        │
│         │ input tap                   │ (in-process)  │
│         │                             │               │
└─────────┼─────────────────────────────┼───────────────┘
          │                             │
          └──────────┬──────────────────┘
                     ▼ ADB
              ┌─────────────┐
              │   Android   │
              │   Device    │
              └─────────────┘
```

### Directory Structure

```
packages/mobile-sdk/src/
├── agents/
│   ├── VisionAgent.ts              # Existing - Pure vision (coordinates)
│   └── TextVisionAgent.ts          # NEW - Text + Vision (selectors)
│
├── ai/providers/
│   ├── gemini/
│   │   ├── GeminiCUAProvider.ts    # Existing - Computer Use API
│   │   └── GeminiProProvider.ts    # NEW - Gemini 2.5 Pro
│   └── openai/
│       └── OpenAICUAProvider.ts    # Existing - OpenAI CUA
│
├── actions/                         # NEW - Action system
│   ├── types.ts                     # MobileActionEntity, IAction
│   ├── handler.ts                   # Action registry
│   └── impl/
│       ├── tap.ts
│       ├── input_text.ts
│       ├── clear_input.ts
│       ├── long_press.ts
│       ├── double_tap.ts
│       ├── swipe.ts
│       ├── scroll_to_element.ts
│       ├── back.ts
│       ├── home.ts
│       ├── press_key.ts
│       ├── wait.ts
│       └── done.ts
│
├── execution/                       # NEW - Execution backends
│   ├── types.ts                     # Executor interface
│   ├── AdbExecutor.ts              # Existing logic - coordinate-based
│   └── AppiumExecutor.ts           # NEW - selector-based via UIAutomator2
│
├── elements/
│   ├── parseUiHierarchy.ts         # Existing - parse uiautomator XML
│   ├── buildElementTree.ts         # Update: always show resource-id
│   └── types.ts                    # MobileElement types
│
└── devices/
    └── android/device.ts           # Existing - ADB wrapper
```

## Selector System

### Selector Types

Three selector strategies in priority order:

| Selector | Format | Use When |
|----------|--------|----------|
| `resource-id` | `resource-id=com.app:id/btn_login` | ID available (most stable) |
| `text` | `text=Login` | Visible text, no ID |
| `content-desc` | `content-desc=Submit button` | Icons/images with accessibility label |

### Selector Availability

Resource IDs are not always available:

| Scenario | resource-id available? |
|----------|------------------------|
| Well-developed apps with proper IDs | Yes |
| Dynamically generated views | Often no |
| Third-party SDK views (ads, analytics) | Usually no |
| System UI elements | Sometimes |
| WebViews content | No |

This is why we support all three selector types.

### Failure Handling

**On selector mismatch**: Fail immediately, return error to app, app retries with AI.

## Element Tree Format

The element tree is extracted from Android's accessibility tree via `uiautomator dump` and formatted for the LLM:

```
[0] Button text="Login" resource-id="com.app:id/btn_login" bounds=[100,200][300,250]
[1] TextField text="Email" resource-id="com.app:id/input_email" bounds=[100,300][500,350]
[2] Image content-desc="Profile" resource-id="com.app:id/icon_profile" bounds=[50,50][100,100]
[3] Button text="Submit" bounds=[100,400][300,450]
```

### Fields

| Field | Purpose | Keep? |
|-------|---------|-------|
| **index** | Element reference, future SoM support | Yes |
| **bounds** | Future SoM support, layout context | Yes |
| **resource-id** | Primary selector (most stable) | Always show when present |
| **text** | Visible text, fallback selector | Show when present |
| **content-desc** | Accessibility label, fallback selector | Show when present |

## Action Space

### Mobile Actions

| Action | Selector Required | Parameters |
|--------|-------------------|------------|
| `tap` | Yes | selector |
| `double_tap` | Yes | selector |
| `long_press` | Yes | selector, duration? |
| `input_text` | Yes | selector, text |
| `clear_input` | Yes | selector |
| `swipe` | No | direction (up/down/left/right) |
| `scroll_to_element` | Yes | selector |
| `back` | No | - |
| `home` | No | - |
| `press_key` | No | keyCode |
| `wait` | No | seconds |
| `done` | No | success, message |

### Action Entity Structure

```typescript
interface MobileActionEntity {
  selector?: string;              // "resource-id=com.app:id/btn_login"
  action_data: {
    action_name: string;          // "tap", "input_text", etc.
    kwargs: Record<string, any>;  // { text: "hello" } for input_text
  };
  action_description: string;     // Human-readable description
}
```

## Execution Backends

### AdbExecutor (Existing - VisionAgent)

Uses ADB shell commands with coordinates:

```bash
adb shell input tap 450 320
adb shell input text "hello"
adb shell input keyevent 4  # back
```

- Simple, no dependencies
- Coordinate-based only
- Used by VisionAgent

### AppiumExecutor (New - TextVisionAgent)

Uses Appium with UIAutomator2 driver for native selector support:

```typescript
// Appium runs in-process (Node.js)
await driver.$('android=new UiSelector().resourceId("com.app:id/login")').click();
await driver.$('android=new UiSelector().text("Login")').click();
await driver.$('android=new UiSelector().description("Submit")').click();
```

- Native selector support
- No coordinate conversion needed
- Appium server runs in-process (same Node.js process)
- Used by TextVisionAgent

## TextVisionAgent Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Execute Step                         │
│                                                         │
│  1. Take screenshot                                     │
│  2. Get UI hierarchy (uiautomator dump)                │
│  3. Parse elements → element tree string               │
│  4. Send to Gemini 2.5 Pro:                            │
│     - Image: screenshot                                 │
│     - Text: element tree + task                        │
│  5. Gemini returns:                                    │
│     { action_name: "tap",                              │
│       selector: "resource-id=com.app:id/login" }       │
│  6. AppiumExecutor executes via UIAutomator2           │
│  7. If success → continue to next step                 │
│  8. If failure → retry or stop (see Retry Strategy)    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Retry Strategy

To prevent infinite loops on persistent failures:

```
┌─────────────────────────────────────────────────────────┐
│                    Execute Step                         │
│                                                         │
│  Attempt 1: Screenshot → AI → Execute                   │
│      │                                                  │
│      ├─► Success → Done ✅                              │
│      │                                                  │
│      └─► Failure → Retry                                │
│                                                         │
│  Attempt 2: Screenshot → AI → Execute                   │
│      │                                                  │
│      ├─► Success → Done ✅                              │
│      │                                                  │
│      └─► Failure → Stop ❌ (max retries reached)        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxRetries` | 1 | Max retry attempts after initial failure |
| `maxStepsPerTask` | 40 | Max total steps for a task |

**Total attempts per step**: 1 initial + 1 retry = 2 attempts

### Failure Types

| Failure Type | Cause | Retry with AI? |
|--------------|-------|----------------|
| **Selector not found** | Element doesn't exist on current screen | Yes |
| **Element not interactable** | Disabled, covered, off-screen | Yes |
| **Stale element** | Screen changed during action | Yes |
| **Action timeout** | Element slow to respond | Maybe |
| **Appium/ADB error** | Connection lost, server crash | No (infrastructure) |

### Failure Response

```typescript
{
  success: false,
  error: "Element not found after 2 attempts",
  attempts: [
    { selector: "resource-id=com.app:id/btn_login", error: "Not found" },
    { selector: "text=Login", error: "Not found" }
  ]
}
```

## Dependencies

```json
{
  "dependencies": {
    "appium": "^2.x",
    "webdriverio": "^8.x",
    "@google/genai": "^1.x",
    "appium-adb": "^11.x"
  }
}
```

## Future Considerations

### Set-of-Mark (SoM) Support

The element tree includes `index` and `bounds` to support future SoM processing:

1. Overlay numbered labels on screenshot
2. LLM can reference by index: "tap element 5"
3. System resolves index to coordinates from bounds

This provides a fallback when selectors aren't available.

### Hybrid Execution

Future optimization could use both backends:

- Try selector-based (Appium) first
- Fall back to coordinate-based (ADB) if selector fails
- Use vision agent for elements without stable selectors
