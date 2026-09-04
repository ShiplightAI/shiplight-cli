/**
 * Basic examples for using ActionHandler
 *
 * This file shows practical examples of using the unified ActionHandler
 * to execute actions with Playwright's Page object.
 */

import { chromium } from 'playwright';
import { createAgentContext, WebAgent, ActionEntity, ActionHandler, VariableStore } from 'sdk-core';

/**
 * Create a basic agent for use with actions
 */
function createAgent(): WebAgent {
  const variableStore = new VariableStore();
  const context = createAgentContext({
    model: process.env.MODEL || 'gemini-2.5-pro',
    variableStore,
    testDataDir: '/path/to/test-data',
  });
  return new WebAgent(context);
}

/**
 * Example 1: Navigation Actions
 *
 * Demonstrates all navigation actions from navigation.ts
 */
async function example1_Navigation() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    // 1. Go to URL - navigate to Wikipedia
    await handler.execute(page, {
      action_description: 'Navigate to Wikipedia homepage',
      action_data: {
        action_name: 'go_to_url',
        kwargs: {
          url: 'https://www.wikipedia.org',
        },
      },
    }, agent);

    console.log('Step 1: Navigated to Wikipedia homepage');
    await page.waitForTimeout(1000);

    // 2. Navigate to English Wikipedia
    await handler.execute(page, {
      action_description: 'Navigate to English Wikipedia',
      action_data: {
        action_name: 'go_to_url',
        kwargs: {
          url: 'https://en.wikipedia.org',
        },
      },
    }, agent);

    console.log('Step 2: Navigated to English Wikipedia');
    await page.waitForTimeout(1000);

    // 3. Go back - return to previous page
    await handler.execute(page, {
      action_description: 'Go back to Wikipedia homepage',
      action_data: {
        action_name: 'go_back',
        kwargs: {},
      },
    }, agent);

    console.log('Step 3: Went back to Wikipedia homepage');
    await page.waitForTimeout(1000);

    // 4. Reload page - refresh current page
    await handler.execute(page, {
      action_description: 'Reload the page',
      action_data: {
        action_name: 'reload_page',
        kwargs: {},
      },
    }, agent);

    console.log('Step 4: Reloaded the page');
    await page.waitForTimeout(1000);

    // 5. Wait - wait for 2 seconds
    await handler.execute(page, {
      action_description: 'Wait for 2 seconds',
      action_data: {
        action_name: 'wait',
        kwargs: {
          seconds: 2,
        },
      },
    }, agent);

    console.log('Step 5: Waited for 2 seconds');

    // 6. Done - marks completion (no-op action)
    await handler.execute(page, {
      action_description: 'Mark as done',
      action_data: {
        action_name: 'done',
        kwargs: {},
      },
    }, agent);

    console.log('Step 6: Done action completed');
    console.log('Navigation actions test completed successfully!');

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

/**
 * Example 2: Form Filling
 *
 * Demonstrates filling out a form with dropdown selection and text input
 */
async function example2_FormFilling() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.wikipedia.org');

    // Select language from dropdown (select_dropdown_option from form.ts)
    await handler.execute(page, {
      action_description: 'Select language dropdown',
      locator: 'getByLabel("en", { exact: true })',
      action_data: {
        action_name: 'select_dropdown_option',
        kwargs: {
          text: 'Deutsch',
        },
      },
    }, agent);

  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
}

/**
 * Example 3: Keyboard and Input Actions
 *
 * Demonstrates all input and keyboard actions from input-keyboard.ts
 */
async function example3_KeyboardInput() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.wikipedia.org');

    // 1. Fill action - fills input with value (clears and sets)
    await handler.execute(page, {
      action_description: 'Fill search input',
      locator: 'getByRole("searchbox")',
      action_data: {
        action_name: 'fill',
        kwargs: {
          value: 'Playwright',
        },
      },
    }, agent);

    await page.waitForTimeout(3000);
    // 2. Clear input action
    await handler.execute(page, {
      action_description: 'Clear search input',
      locator: 'getByRole("searchbox")',
      action_data: {
        action_name: 'clear_input',
        kwargs: {},
      },
    }, agent);

    await page.waitForTimeout(3000);

    // 3. Input text action - types text character by character
    await handler.execute(page, {
      action_description: 'Type text into search',
      locator: 'getByRole("searchbox")',
      action_data: {
        action_name: 'input_text',
        kwargs: {
          text: 'Browser automation',
        },
      },
    }, agent);

    await page.waitForTimeout(3000);

    // 4. Press action on element - press Enter key
    await handler.execute(page, {
      action_description: 'Press Enter on search input',
      locator: 'getByRole("searchbox")',
      action_data: {
        action_name: 'press',
        kwargs: {
          index: 0,
          keyComb: 'Enter',
        },
      },
    }, agent);

    await page.waitForTimeout(2000);

    // Navigate back for next tests
    await page.goBack();
    await page.waitForTimeout(3000);

    // 5. Send keys on element - alternative way to send keys
    await handler.execute(page, {
      action_description: 'Send Escape key on search input',
      locator: 'getByRole("searchbox")',
      action_data: {
        action_name: 'send_keys_on_element',
        kwargs: {
          keys: 'Escape',
        },
      },
    }, agent);

    await page.waitForTimeout(1000);

    // 6. Send keys globally (not on specific element)
    await handler.execute(page, {
      action_description: 'Send Tab key globally',
      action_data: {
        action_name: 'send_keys',
        kwargs: {
          keys: 'Tab',
        },
      },
    }, agent);

    await page.waitForTimeout(1000);

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

/**
 * Example 4: Mouse Interactions
 *
 * Shows various mouse actions like hover, click, right-click, and mouse movement
 */
async function example4_MouseInteractions() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.wikipedia.org');

    // Hover over an element
    await handler.execute(page, {
      action_description: 'Hover over the English link',
      locator: 'getByRole("link", { name: "English" })',
      action_data: {
        action_name: 'hover',
        kwargs: {},
      },
    }, agent);

    await page.waitForTimeout(1000);

    // Click an element
    await handler.execute(page, {
      action_description: 'Click search button',
      locator: 'getByRole("button", { name: "Search" })',
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent);

    await page.waitForTimeout(1000);

    // Right-click on an element
    await handler.execute(page, {
      action_description: 'Right-click on logo',
      locator: 'getByRole("link", { name: "Wikipedia The Free Encyclopedia" })',
      action_data: {
        action_name: 'right_click_on_element',
        kwargs: {},
      },
    }, agent);

    await page.waitForTimeout(1000);

    // Move mouse to specific coordinates
    await handler.execute(page, {
      action_description: 'Move mouse to center of page',
      action_data: {
        action_name: 'mouse_move',
        kwargs: {
          x: 500,
          y: 300,
        },
      },
    }, agent);

    await page.waitForTimeout(1000);

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

/**
 * Example 5: Tab Management
 *
 * Demonstrates tab operations: open, switch, and close
 */
async function example5_TabManagement() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    // Start with Wikipedia
    await page.goto('https://www.wikipedia.org');
    console.log('Starting on Wikipedia homepage');

    await page.waitForTimeout(1000);

    // 1. Open a new tab with English Wikipedia
    await handler.execute(page, {
      action_description: 'Open English Wikipedia in new tab',
      action_data: {
        action_name: 'open_tab',
        kwargs: {
          url: 'https://en.wikipedia.org',
        },
      },
    }, agent);

    console.log('Opened tab 1: English Wikipedia');
    await page.waitForTimeout(1000);

    // 2. Open another tab with German Wikipedia
    await handler.execute(page, {
      action_description: 'Open German Wikipedia in new tab',
      action_data: {
        action_name: 'open_tab',
        kwargs: {
          url: 'https://de.wikipedia.org',
        },
      },
    }, agent);

    console.log('Opened tab 2: German Wikipedia');
    await page.waitForTimeout(1000);

    // Now we have 3 tabs: [0] Main Wikipedia, [1] English, [2] German
    const pages = page.context().pages();
    console.log(`Total tabs open: ${pages.length}`);

    // 3. Switch to tab 1 (English Wikipedia)
    await handler.execute(page, {
      action_description: 'Switch to English Wikipedia tab',
      action_data: {
        action_name: 'switch_tab',
        kwargs: {
          page_id: 1,
        },
      },
    }, agent);

    console.log('Switched to tab 1: English Wikipedia');
    await page.waitForTimeout(1000);

    // 4. Switch back to tab 0 (Main Wikipedia)
    await handler.execute(page, {
      action_description: 'Switch back to main Wikipedia tab',
      action_data: {
        action_name: 'switch_tab',
        kwargs: {
          page_id: 0,
        },
      },
    }, agent);

    console.log('Switched back to tab 0: Main Wikipedia');
    await page.waitForTimeout(1000);

    // 5. Switch to last tab (German Wikipedia) using -1
    await handler.execute(page, {
      action_description: 'Switch to last tab (German Wikipedia)',
      action_data: {
        action_name: 'switch_tab',
        kwargs: {
          page_id: -1, // -1 means last tab
        },
      },
    }, agent);

    console.log('Switched to last tab: German Wikipedia');
    await page.waitForTimeout(1000);

    // 6. Close tab 2 (German Wikipedia - current tab)
    await handler.execute(page, {
      action_description: 'Close German Wikipedia tab',
      action_data: {
        action_name: 'close_tab',
        kwargs: {
          page_id: 2,
        },
      },
    }, agent);

    console.log('Closed tab 2: German Wikipedia');
    await page.waitForTimeout(1000);

    // 7. Close tab 1 (English Wikipedia)
    await handler.execute(page, {
      action_description: 'Close English Wikipedia tab',
      action_data: {
        action_name: 'close_tab',
        kwargs: {
          page_id: 1,
        },
      },
    }, agent);

    console.log('Closed tab 1: English Wikipedia');
    await page.waitForTimeout(1000);

    console.log('Tab management completed - only main tab remains');

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

/**
 * Example 6: Scroll Actions
 *
 * Demonstrates all scroll actions from scroll.ts
 */
async function example6_ScrollActions() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    // Use a long Wikipedia article for scrolling tests
    await page.goto('https://en.wikipedia.org/wiki/Web_browser');
    console.log('Loaded Wikipedia article');
    await page.waitForTimeout(1000);

    // 1. Scroll down by default amount (one viewport height)
    await handler.execute(page, {
      action_description: 'Scroll down one viewport',
      action_data: {
        action_name: 'scroll_down',
        kwargs: {},
      },
    }, agent);

    console.log('Step 1: Scrolled down one viewport');
    await page.waitForTimeout(1000);

    // 2. Scroll down by specific amount (500 pixels)
    await handler.execute(page, {
      action_description: 'Scroll down 500 pixels',
      action_data: {
        action_name: 'scroll_down',
        kwargs: {
          amount: 500,
        },
      },
    }, agent);

    console.log('Step 2: Scrolled down 500 pixels');
    await page.waitForTimeout(1000);

    // 3. Scroll up by default amount (one viewport height)
    await handler.execute(page, {
      action_description: 'Scroll up one viewport',
      action_data: {
        action_name: 'scroll_up',
        kwargs: {},
      },
    }, agent);

    console.log('Step 3: Scrolled up one viewport');
    await page.waitForTimeout(1000);

    // 4. Scroll up by specific amount (300 pixels)
    await handler.execute(page, {
      action_description: 'Scroll up 300 pixels',
      action_data: {
        action_name: 'scroll_up',
        kwargs: {
          amount: 300,
        },
      },
    }, agent);

    console.log('Step 4: Scrolled up 300 pixels');
    await page.waitForTimeout(1000);

    // 5. Scroll to specific text
    await handler.execute(page, {
      action_description: 'Scroll to "History" section',
      action_data: {
        action_name: 'scroll_to_text',
        kwargs: {
          text: 'History',
        },
      },
    }, agent);

    console.log('Step 5: Scrolled to "History" section');
    await page.waitForTimeout(1000);

    // 6. Scroll on a specific element
    // Wikipedia main content is scrollable
    await handler.execute(page, {
      action_description: 'Scroll on main content area',
      locator: 'getByRole("main")',
      action_data: {
        action_name: 'scroll_on_element',
        kwargs: {
          delta_x: 0,
          delta_y: 200,
        },
      },
    }, agent);

    console.log('Step 6: Scrolled on main content element');
    await page.waitForTimeout(1000);

    // 7. Use scroll action (complex variant)
    await handler.execute(page, {
      action_description: 'Scroll using scroll action',
      action_data: {
        action_name: 'scroll',
        kwargs: {
          x: 0,
          y: 300,
          index: -1, // No specific element
        },
      },
    }, agent);

    console.log('Step 7: Used scroll action');
    await page.waitForTimeout(1000);

    console.log('Scroll actions test completed successfully!');

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

/**
 * Example 7: Using Transpile
 *
 * Shows how to transpile actions to Playwright code
 * Includes utility actions that are transpile-only (js_code, save_variable)
 */
async function example7_Transpile() {
  const handler = new ActionHandler();

  // Transpile a click action
  const clickCode = handler.transpile({
    action_description: 'Click submit',
    feedback: '',
    locator: 'button.submit',
    action_data: {
      action_name: 'click',
      kwargs: {},
    },
  }, 'step1');

  console.log('Click action code:');
  console.log(clickCode.join('\n'));

  // Transpile a fill action
  const fillCode = handler.transpile({
    action_description: 'Fill email',
    feedback: '',
    locator: 'input#email',
    action_data: {
      action_name: 'fill',
      kwargs: {
        value: 'user@example.com',
      },
    },
  }, 'step2');

  console.log('\nFill action code:');
  console.log(fillCode.join('\n'));

  // Transpile js_code action (utility action - transpile-only)
  const jsCode = handler.transpile({
    action_description: 'Execute custom JavaScript',
    feedback: '',
    action_data: {
      action_name: 'js_code',
      kwargs: {
        code: 'console.log("Hello from custom JS"); return 42;',
      },
    },
  }, 'step3');

  console.log('\nJavaScript code action:');
  console.log(jsCode.join('\n'));

  // Transpile save_variable action (utility action - transpile-only)
  const saveVarCode = handler.transpile({
    action_description: 'Save variable',
    feedback: '',
    action_data: {
      action_name: 'save_variable',
      kwargs: {
        name: 'userEmail',
        value: 'test@example.com',
      },
    },
  }, 'step4');

  console.log('\nSave variable action:');
  console.log(saveVarCode.join('\n'));

  // Transpile a sequence of actions
  const actions: ActionEntity[] = [
    {
      action_description: 'Go to page',
      feedback: '',
      action_data: {
        action_name: 'go_to_url',
        kwargs: { url: 'https://www.shiplight.ai' },
      },
    },
    {
      action_description: 'Click button',
      feedback: '',
      locator: 'button#submit',
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    },
  ];

  console.log('\nComplete test sequence:');
  actions.forEach((action, index) => {
    const code = handler.transpile(action, `step${index + 1}`);
    console.log(code.join('\n'));
  });
}

// Export examples for use in tests or documentation
export {
  example1_Navigation,
  example2_FormFilling,
  example3_KeyboardInput,
  example4_MouseInteractions,
  example5_TabManagement,
  example6_ScrollActions,
  example7_Transpile
};
