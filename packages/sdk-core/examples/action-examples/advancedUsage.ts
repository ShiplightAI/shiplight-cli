/**
 * Advanced examples for using ActionHandler
 *
 * This file demonstrates more complex scenarios including:
 * - File handling
 * - Tab management
 * - Custom JavaScript execution
 * - Drag and drop operations
 * - Error handling
 */

import { chromium, Page } from 'playwright';
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
 * Example 1: File Upload and Download
 *
 * Shows how to handle file operations
 */
async function example1_FileOperations() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.shiplight.ai/upload');

    // Upload a file
    await handler.execute(page, {
      action_description: 'Upload document',
      feedback: '',
      locator: 'input[type="file"]',
      action_data: {
        action_name: 'upload_file',
        kwargs: {
          file_name: 'test-document.pdf',
        },
      },
    }, agent);

    // Navigate to download page
    await page.goto('https://www.shiplight.ai/downloads');

    // Click download button
    await handler.execute(page, {
      action_description: 'Click download button',
      feedback: '',
      locator: 'a.download-link',
      action_data: {
        action_name: 'click_download_button',
        kwargs: {},
      },
    }, agent);

    // Wait for download to complete
    await handler.execute(page, {
      action_description: 'Wait for download',
      feedback: '',
      action_data: {
        action_name: 'wait_for_download_complete',
        kwargs: {},
      },
    }, agent);

    console.log('File operations completed');

  } finally {
    await browser.close();
  }
}

/**
 * Example 2: Multi-Tab Management
 *
 * Demonstrates opening, switching, and closing tabs
 */
async function example2_TabManagement() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  // Track all pages/tabs
  const pages: Page[] = [page];

  try {
    await page.goto('https://www.shiplight.ai');

    // Listen for new pages
    context.on('page', (newPage) => {
      pages.push(newPage);
      console.log(`New tab opened: ${pages.length} total tabs`);
    });

    // Open a new tab
    await handler.execute(page, {
      action_description: 'Open help page in new tab',
      feedback: '',
      action_data: {
        action_name: 'open_tab',
        kwargs: {
          url: 'https://www.shiplight.ai/help',
        },
      },
    }, agent);

    // Switch to the new tab
    await handler.execute(page, {
      action_description: 'Switch to help tab',
      feedback: '',
      action_data: {
        action_name: 'switch_tab',
        kwargs: {
          page_id: 1,
        },
      },
    }, agent);

    console.log('Now on help page, current URL:', pages[1].url());

    // Switch back to main tab
    await handler.execute(page, {
      action_description: 'Switch back to main tab',
      feedback: '',
      action_data: {
        action_name: 'switch_tab',
        kwargs: {
          page_id: 0,
        },
      },
    }, agent);

    // Close the help tab
    await handler.execute(page, {
      action_description: 'Close help tab',
      feedback: '',
      action_data: {
        action_name: 'close_tab',
        kwargs: {
          page_id: 1,
        },
      },
    }, agent);

    console.log('Tab management completed');

  } finally {
    await browser.close();
  }
}

/**
 * Example 3: Custom JavaScript Execution
 *
 * Shows how to execute custom JavaScript code in the page context
 */
async function example3_CustomJavaScript() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.shiplight.ai');

    // Execute custom JavaScript to modify page state
    await handler.execute(page, {
      action_description: 'Set localStorage values',
      feedback: '',
      action_data: {
        action_name: 'js_code',
        kwargs: {
          code: `
            localStorage.setItem('userPreference', 'darkMode');
            localStorage.setItem('language', 'en');
            return { success: true, itemsSet: 2 };
          `,
        },
      },
    }, agent);

    // Extract page data using custom JavaScript
    await handler.execute(page, {
      action_description: 'Extract all product prices',
      feedback: '',
      action_data: {
        action_name: 'js_code',
        kwargs: {
          code: `
            const prices = Array.from(document.querySelectorAll('.price'))
              .map(el => el.textContent.trim());
            return prices;
          `,
        },
      },
    }, agent);

    console.log('Custom JavaScript executed successfully');

  } finally {
    await browser.close();
  }
}

/**
 * Example 4: Drag and Drop Operations
 *
 * Shows how to perform drag and drop interactions
 */
async function example4_DragAndDrop() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.shiplight.ai/drag-drop-demo');

    // Drag an element and drop at specific coordinates
    await handler.execute(page, {
      action_description: 'Drag item to target zone',
      feedback: '',
      locator: '.draggable-item',
      action_data: {
        action_name: 'drag_drop',
        kwargs: {
          coord_source_x: 100,
          coord_source_y: 150,
          coord_target_x: 400,
          coord_target_y: 300,
        },
      },
    }, agent);

    console.log('Drag and drop completed');

  } finally {
    await browser.close();
  }
}

/**
 * Example 5: Advanced Mouse Actions
 *
 * Demonstrates various mouse interactions
 */
async function example5_AdvancedMouse() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.shiplight.ai');

    // Move mouse to specific coordinates
    await handler.execute(page, {
      action_description: 'Move mouse to position',
      feedback: '',
      action_data: {
        action_name: 'mouse_move',
        kwargs: {
          x: 500,
          y: 300,
        },
      },
    }, agent);

    // Right-click on element
    await handler.execute(page, {
      action_description: 'Right-click menu',
      feedback: '',
      locator: 'div.menu-trigger',
      action_data: {
        action_name: 'right_click_on_element',
        kwargs: {},
      },
    }, agent);

    // Double-click on element
    await handler.execute(page, {
      action_description: 'Double-click item',
      feedback: '',
      locator: 'div.file-item',
      action_data: {
        action_name: 'double_click_on_element',
        kwargs: {},
      },
    }, agent);

    console.log('Advanced mouse actions completed');

  } finally {
    await browser.close();
  }
}

/**
 * Example 6: Error Handling and Recovery
 *
 * Demonstrates proper error handling when using actions
 */
async function example6_ErrorHandling() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    await page.goto('https://www.shiplight.ai');

    // Try to click an element that might not exist
    const clickEntity: ActionEntity = {
      action_description: 'Click submit button',
      feedback: '',
      locator: 'button#submit-form',
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    };

    try {
      await handler.execute(page, clickEntity, agent);
      console.log('Click succeeded');
    } catch (error) {
      console.error('Click failed:', error);

      // Fallback: try alternative selector
      console.log('Attempting fallback strategy...');
      const fallbackEntity: ActionEntity = {
        ...clickEntity,
        locator: 'button[type="submit"]',
      };

      try {
        await handler.execute(page, fallbackEntity, agent);
        console.log('Fallback click succeeded');
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        // Final fallback: use XPath
        const xpathEntity: ActionEntity = {
          ...clickEntity,
          locator: undefined,
          xpath: '//button[contains(text(), "Submit")]',
        };
        await handler.execute(page, xpathEntity, agent);
      }
    }

  } finally {
    await browser.close();
  }
}

/**
 * Example 7: Complex Workflow
 *
 * Demonstrates a complete e-commerce checkout flow
 */
async function example7_ComplexWorkflow() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  try {
    // Navigate to product page
    await handler.execute(page, {
      action_description: 'Go to products',
      feedback: '',
      action_data: {
        action_name: 'go_to_url',
        kwargs: { url: 'https://www.shiplight.ai/products' },
      },
    }, agent);

    // Click on a product
    await handler.execute(page, {
      action_description: 'Select product',
      feedback: '',
      locator: '.product-card:first-child',
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent);

    // Add to cart
    await handler.execute(page, {
      action_description: 'Add to cart',
      feedback: '',
      locator: 'button.add-to-cart',
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent);

    // Go to checkout
    await handler.execute(page, {
      action_description: 'Go to checkout',
      feedback: '',
      action_data: {
        action_name: 'go_to_url',
        kwargs: { url: 'https://www.shiplight.ai/checkout' },
      },
    }, agent);

    // Fill shipping information
    await handler.execute(page, {
      action_description: 'Fill address',
      feedback: '',
      locator: 'input#address',
      action_data: {
        action_name: 'fill',
        kwargs: { value: '123 Main St' },
      },
    }, agent);

    await handler.execute(page, {
      action_description: 'Fill city',
      feedback: '',
      locator: 'input#city',
      action_data: {
        action_name: 'fill',
        kwargs: { value: 'San Francisco' },
      },
    }, agent);

    // Complete checkout
    await handler.execute(page, {
      action_description: 'Submit order',
      feedback: '',
      locator: 'button.submit-order',
      action_data: {
        action_name: 'click',
        kwargs: {},
      },
    }, agent);

    console.log('Complex workflow completed successfully');

  } catch (error) {
    console.error('Workflow failed:', error);
  } finally {
    await browser.close();
  }
}

// Export all advanced examples
export {
  example1_FileOperations,
  example2_TabManagement,
  example3_CustomJavaScript,
  example4_DragAndDrop,
  example5_AdvancedMouse,
  example6_ErrorHandling,
  example7_ComplexWorkflow
};

