# Action Execute Function Examples

This directory contains comprehensive examples demonstrating how to use the `execute()` functions of various action classes with Playwright's `Page` object.

## Overview

Actions in this system implement the `Action` interface with two main methods:

1. **`execute(page, actionEntity, helpers, stepId)`** - Executes the action directly using Playwright
2. **`transpile(actionEntity, stepId)`** - Converts the action to Playwright code strings

These examples focus on the `execute()` method, showing practical usage patterns.

## Files

### basic-usage.ts

Beginner-friendly examples covering:
- **Example 1**: Navigation and basic clicking
- **Example 2**: Form filling with various input types
- **Example 3**: Mouse interactions (hover, scroll, wait)
- **Example 4**: Custom helpers for sensitive data handling
- **Example 5**: Chaining multiple actions together

### advanced-usage.ts

Complex scenarios including:
- **Example 1**: Authentication with 2FA
- **Example 2**: File upload and download
- **Example 3**: Multi-tab management
- **Example 4**: Custom JavaScript execution
- **Example 5**: AI-powered content extraction
- **Example 6**: Drag and drop operations
- **Example 7**: Error handling and recovery strategies
- **Example 8**: Screenshot capture

## Key Concepts

### The Page Object

All actions receive a Playwright `Page` object as their first parameter:

```typescript
import { Page } from 'playwright';

async execute(
  page: Page,              // Playwright page instance
  actionEntity: ActionEntity,  // Action configuration
  helpers: ActionHelpers,      // Helper functions
  stepId?: string              // Optional step identifier
): Promise<void>
```

### ActionEntity Structure

Every action is configured via an `ActionEntity` object:

```typescript
interface ActionEntity {
  action_description: string;      // Human-readable description
  feedback: string;                // Feedback from previous attempts
  locator?: string;               // CSS selector
  xpath?: string;                 // XPath selector
  action_data?: {                 // Action-specific data
    action_name: string;
    kwargs: { [key: string]: any };
  };
}
```

### ActionHelpers Interface

Helpers provide utility functions for test execution:

```typescript
interface ActionHelpers {
  // Replace placeholders like {{user_email}} with actual values
  replaceSensitiveData: (value: string) => string;

  // Store test data for later use
  add: (key: string, value: any) => void;

  // Store sensitive data (passwords, tokens, etc.)
  addSensitive: (key: string, value: any) => void;

  // Get absolute path to test data files
  getTestDataFilePath: (fileName: string) => string;

  // Self-healing selector logic with fallbacks
  tryLocateAndAct: (
    page: Page,
    selector: string,
    action: string,
    options?: any,
    stepInfo?: string
  ) => Promise<void>;
}
```

## Common Usage Patterns

### Pattern 1: Simple Action Execution

```typescript
import { chromium } from 'playwright';
import { ClickAction } from '../index';

const browser = await chromium.launch();
const page = await browser.newPage();

const clickAction = new ClickAction();
const actionEntity = {
  action_description: 'Click button',
  feedback: '',
  locator: 'button.submit',
  action_data: {
    action_name: 'click',
    kwargs: {},
  },
};

await clickAction.execute(page, actionEntity, helpers, 'step1');
```

### Pattern 2: Action with Parameters

```typescript
import { FillAction } from '../index';

const fillAction = new FillAction();
const actionEntity = {
  action_description: 'Fill email field',
  feedback: '',
  locator: 'input#email',
  action_data: {
    action_name: 'fill',
    kwargs: {
      value: 'user@example.com',  // Parameter passed in kwargs
    },
  },
};

await fillAction.execute(page, actionEntity, helpers, 'step1');
```

### Pattern 3: Sensitive Data Handling

```typescript
const sensitiveData = {
  'user_password': 'SecretPass123!',
};

const helpers = {
  replaceSensitiveData: (value: string) => {
    return value.replace('{{user_password}}', sensitiveData['user_password']);
  },
  // ... other helper methods
};

const actionEntity = {
  // ...
  action_data: {
    action_name: 'fill',
    kwargs: {
      value: '{{user_password}}',  // Will be replaced by helper
    },
  },
};
```

### Pattern 4: Sequential Actions

```typescript
const actions = [
  { action: new GoToUrlAction(), entity: navigationEntity },
  { action: new FillAction(), entity: fillEmailEntity },
  { action: new FillAction(), entity: fillPasswordEntity },
  { action: new ClickAction(), entity: clickSubmitEntity },
];

for (let i = 0; i < actions.length; i++) {
  const { action, entity } = actions[i];
  await action.execute(page, entity, helpers, `step${i + 1}`);
}
```

### Pattern 5: Error Handling

```typescript
try {
  await clickAction.execute(page, actionEntity, helpers, 'step1');
} catch (error) {
  console.error('Action failed:', error);

  // Try fallback strategy
  const fallbackEntity = {
    ...actionEntity,
    locator: 'button[type="submit"]',  // Alternative selector
  };
  await clickAction.execute(page, fallbackEntity, helpers, 'step1_retry');
}
```

## Available Actions by Category

### Navigation Actions
- `GoToUrlAction` - Navigate to a URL
- `GoBackAction` - Navigate back in history
- `ReloadPageAction` - Reload current page
- `WaitAction` - Wait for specified time
- `DoneAction` - Mark completion

### Click/Mouse Actions
- `ClickAction` - Click on element
- `HoverAction` - Hover over element
- `RightClickElementAction` - Right-click on element
- `DoubleClickElementAction` - Double-click on element
- `ClickByCoordinatesAction` - Click at coordinates
- `RightClickByCoordinatesAction` - Right-click at coordinates
- `DoubleClickByCoordinatesAction` - Double-click at coordinates
- `DragElementMoveAction` - Drag element by delta
- `DragDropAction` - Drag and drop operation
- `MouseMoveAction` - Move mouse to coordinates

### Input Actions
- `FillAction` - Fill input field (clear then type)
- `InputTextAction` - Type text without clearing
- `ClearInputAction` - Clear input field
- `PressAction` - Press keyboard key on element
- `SendKeysAction` - Send keyboard keys globally
- `SendKeysOnElementAction` - Send keys to element

### Form Actions
- `SelectOptionsAction` - Select dropdown option
- `CheckboxAction` - Check/uncheck checkbox

### Scroll Actions
- `ScrollDownAction` - Scroll page down
- `ScrollUpAction` - Scroll page up
- `ScrollOnElementAction` - Scroll within element
- `ScrollToTextAction` - Scroll to text content
- `ScrollAction` - Generic scroll action

### File Actions
- `UploadFileAction` - Upload file to input
- `DownloadFileAction` - Download file from link
- `ScreenshotAction` - Take screenshot

### Tab Management Actions
- `OpenTabAction` - Open new tab
- `CloseTabAction` - Close tab
- `SwitchTabAction` - Switch between tabs

### Authentication Actions
- `LoginAction` - Automated login flow
- `Generate2faCodeAction` - Generate TOTP 2FA code
- `ExtractEmailContentAction` - Extract content from email
- `ExtractActivationCodeAction` - Extract code from file

### Utility Actions
- `JsCodeAction` - Execute custom JavaScript
- `ExtractContentAction` - AI-powered content extraction

## Running Examples

You can run these examples by importing and calling them:

```typescript
import { example1_NavigationAndClick } from './basic-usage';

// Run the example
await example1_NavigationAndClick();
```

Or create your own test file:

```typescript
import { chromium } from 'playwright';
import { ClickAction, FillAction } from '../index';
import { ActionHelpers } from '../types';

async function myTest() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const helpers: ActionHelpers = {
    replaceSensitiveData: (value) => value,
    add: () => {},
    addSensitive: () => {},
    getTestDataFilePath: (name) => `/path/${name}`,
    tryLocateAndAct: async () => {},
  };

  try {
    // Your test logic here using actions
  } finally {
    await browser.close();
  }
}

myTest();
```

## Best Practices

1. **Always provide proper helpers**: Even if minimal, implement all helper methods
2. **Use stepId for debugging**: Pass meaningful step identifiers
3. **Handle errors gracefully**: Wrap action executions in try-catch blocks
4. **Close browser resources**: Always close browser/context in finally blocks
5. **Use sensitive data helpers**: Never hardcode passwords or secrets
6. **Implement self-healing**: Use `tryLocateAndAct` for robust selector strategies
7. **Chain actions logically**: Group related actions together
8. **Add delays when needed**: Use `WaitAction` between actions if necessary

## Tips for Custom Implementations

### Implementing Custom Helpers

```typescript
class TestContext {
  private data: Map<string, any> = new Map();
  private sensitive: Map<string, string> = new Map();

  getHelpers(): ActionHelpers {
    return {
      replaceSensitiveData: (value: string) => {
        let result = value;
        this.sensitive.forEach((val, key) => {
          result = result.replace(`{{${key}}}`, val);
        });
        return result;
      },
      add: (key: string, value: any) => {
        this.data.set(key, value);
      },
      addSensitive: (key: string, value: any) => {
        this.sensitive.set(key, value);
      },
      getTestDataFilePath: (fileName: string) => {
        return path.join(__dirname, 'test-data', fileName);
      },
      tryLocateAndAct: async (page, selector, action, options, stepInfo) => {
        // Implement retry and fallback logic
      },
    };
  }
}
```

### Building Action Sequences

```typescript
class ActionSequence {
  private actions: Array<{ action: Action; entity: ActionEntity }> = [];

  add(action: Action, entity: ActionEntity) {
    this.actions.push({ action, entity });
    return this;
  }

  async execute(page: Page, helpers: ActionHelpers) {
    for (let i = 0; i < this.actions.length; i++) {
      const { action, entity } = this.actions[i];
      await action.execute(page, entity, helpers, `step${i + 1}`);
    }
  }
}
```

## Additional Resources

- See `../types.ts` for complete type definitions
- Check individual action files for implementation details
- Refer to Playwright documentation for Page API: https://playwright.dev/docs/api/class-page
- See test files in `../__tests__/` for more examples

## Troubleshooting

### Common Issues

**Issue**: `TypeError: Cannot read property 'action_name' of undefined`
- **Solution**: Ensure `action_data` is provided in `ActionEntity`

**Issue**: `Error: No locator found for action`
- **Solution**: Provide either `locator`, `xpath`, or coordinates as required by the action

**Issue**: `TimeoutError: Timeout waiting for element`
- **Solution**: Increase timeout or ensure element exists before action execution

**Issue**: Sensitive data not replaced
- **Solution**: Check that helper's `replaceSensitiveData` properly handles placeholders

## Contributing

When adding new examples:
1. Use clear, descriptive function names
2. Add comments explaining what each section does
3. Include error handling
4. Show realistic use cases
5. Keep examples focused on one concept

## License

Part of the Shiplight test automation platform.
