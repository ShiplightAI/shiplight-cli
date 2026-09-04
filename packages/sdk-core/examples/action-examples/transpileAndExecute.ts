/**
 * Transpile and Execute Examples
 *
 * This file demonstrates:
 * 1. Transpiling actions to JavaScript code
 * 2. Executing the transpiled code
 * 3. Verifying the results
 *
 * This approach allows you to see exactly what code is generated
 * and test that it executes correctly.
 */

import { chromium, Page } from 'playwright';
import { ActionHandler, WebAgent, createAgentContext, VariableStore } from 'sdk-core';

/**
 * Create a basic agent for use with actions
 */
function createAgent(): WebAgent {
  const variableStore = new VariableStore();
  // Set initial sensitive data
  variableStore.set('otp_secret', 'JBSWY3DPEHPK3PXP', true); // Example TOTP secret (test key)
  const context = createAgentContext({
    model: process.env.MODEL || 'gemini-2.5-pro',
    variableStore,
    testDataDir: '/path/to/test-data',
  });
  return new WebAgent(context);
}

/**
 * Execute transpiled code as a single block
 *
 * This utility function takes transpiled code lines and executes them
 * as a single async function block, with proper variable scope.
 *
 * @param transpiledLines - Array of code lines from handler.transpile()
 * @param context - Execution context with page, agent, and timeout constants
 */
async function executeTranspiledCode(
  transpiledLines: string[],
  context: {
    page?: Page;
    agent: WebAgent;
  }
): Promise<void> {
  // Filter out comment-only lines for cleaner execution
  const codeLines = transpiledLines.filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('//');
  });

  // Join all code lines into a single block
  const codeBlock = codeLines.join('\n');

  // Extract context variables
  const { page, agent } = context;

  // Execute the entire code block as a single async function
  // Note: Timeout constants are already embedded in the transpiled code
  const executeFunc = new Function(
    'page',
    'agent',
    `return (async () => {
${codeBlock}
    })();`
  );

  await executeFunc(page, agent);
}

/**
 * Example 1: Generate 2FA Code - Transpile and Execute
 *
 * Demonstrates:
 * 1. Transpiling generate_2fa_code action to JavaScript
 * 2. Executing the transpiled code
 * 3. Verifying the code was generated and saved to variables
 */
async function example1_Generate2faCode() {
  const handler = new ActionHandler();
  const agent = createAgent();

  console.log('=== Example 1: Generate 2FA Code ===\n');

  // Step 1: Transpile the action
  const actionEntity = {
    action_description: 'Generate 2FA code from secret',
    action_data: {
      action_name: 'generate_2fa_code',
      kwargs: {
        otp_secret_key: '<secret>otp_secret</secret>',
      },
    },
  };

  const transpiledCode = handler.transpile(actionEntity, 'step_1');

  console.log('📝 Transpiled Code:');
  console.log('─'.repeat(60));
  transpiledCode.forEach(line => console.log(line));
  console.log('─'.repeat(60));
  console.log();

  // Step 2: Execute the transpiled code
  console.log('▶️  Executing transpiled code...\n');

  try {
    await executeTranspiledCode(transpiledCode, { agent });

    console.log('✓ Code executed successfully\n');

    // Step 3: Verify the results
    console.log('✅ Verification:');
    console.log('─'.repeat(60));

    const savedCode = agent.agentServices.readVariable('otp_code');
    if (savedCode) {
      console.log(`✓ 2FA code generated: ${savedCode}`);
      console.log(`✓ Code length: ${savedCode.length} digits`);
      console.log(`✓ Code saved to variable: otp_code`);

      // Verify it's a 6-digit number
      if (/^\d{6}$/.test(savedCode)) {
        console.log('✓ Code format is valid (6 digits)');
      } else {
        console.log('✗ Code format is invalid (expected 6 digits)');
      }
    } else {
      console.log('✗ No code found in variables');
    }
    console.log('─'.repeat(60));
    console.log();

    console.log('✨ Example 1 completed successfully!\n');

  } catch (error: any) {
    console.error('❌ Error executing transpiled code:', error.message);
    throw error;
  }
}

/**
 * Example 2: Multiple Actions - Transpile and Execute Sequence
 *
 * Demonstrates transpiling and executing a sequence of actions:
 * 1. Save a variable
 * 2. Generate 2FA code
 * 3. Verify both variables are accessible
 */
async function example2_MultipleActions() {
  const handler = new ActionHandler();
  const agent = createAgent();

  console.log('=== Example 2: Multiple Actions Sequence ===\n');

  const actions = [
    {
      action_description: 'Save user email',
      action_data: {
        action_name: 'save_variable',
        kwargs: {
          name: 'user_email',
          value: 'test@example.com',
        },
      },
    },
    {
      action_description: 'Generate 2FA code',
      action_data: {
        action_name: 'generate_2fa_code',
        kwargs: {
          otp_secret_key: '<secret>otp_secret</secret>',
        },
      },
    },
  ];

  console.log('📝 Transpiling action sequence...\n');

  // Transpile all actions
  const allCode: string[] = [];
  actions.forEach((action, index) => {
    const stepId = `step_${index + 1}`;
    const code = handler.transpile(action, stepId);

    console.log(`Step ${index + 1}: ${action.action_description}`);
    code.forEach(line => console.log(`  ${line}`));
    console.log();

    allCode.push(...code);
  });

  // Execute all transpiled code
  console.log('▶️  Executing action sequence...\n');

  try {
    await executeTranspiledCode(allCode, { agent });

    console.log('✓ Sequence executed successfully\n');

    // Verify results
    console.log('✅ Verification:');
    console.log('─'.repeat(60));

    const userEmail = agent.agentServices.readVariable('user_email');
    const otpCode = agent.agentServices.readVariable('otp_code');

    console.log(`✓ user_email = ${userEmail}`);
    console.log(`✓ otp_code = ${otpCode}`);
    console.log('─'.repeat(60));
    console.log();

    console.log('✨ Example 2 completed successfully!\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

/**
 * Example 3: Live Browser Test - Transpile and Execute with Playwright
 *
 * Demonstrates transpiling and executing actions in a real browser context
 */
async function example3_LiveBrowserTest() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  console.log('=== Example 3: Live Browser Test ===\n');

  try {
    // Navigation action
    const navAction = {
      action_description: 'Navigate to Wikipedia',
      action_data: {
        action_name: 'go_to_url',
        kwargs: {
          url: 'https://www.wikipedia.org',
        },
      },
    };

    console.log('📝 Transpiling navigation action...\n');
    const navCode = handler.transpile(navAction, 'step_1');
    navCode.forEach(line => console.log(line));
    console.log();

    console.log('▶️  Executing in browser...\n');

    await executeTranspiledCode(navCode, { page, agent });

    console.log('✓ Navigation completed\n');

    await page.waitForTimeout(2000);

    // Generate 2FA code (no page required)
    const tfaAction = {
      action_description: 'Generate 2FA code',
      action_data: {
        action_name: 'generate_2fa_code',
        kwargs: {
          otp_secret_key: '<secret>otp_secret</secret>',
        },
      },
    };

    console.log('📝 Transpiling 2FA generation...\n');
    const tfaCode = handler.transpile(tfaAction, 'step_2');
    tfaCode.forEach(line => console.log(line));
    console.log();

    console.log('▶️  Executing 2FA generation...\n');

    await executeTranspiledCode(tfaCode, { agent });

    const otpCode = agent.agentServices.readVariable('otp_code');
    console.log(`✓ Generated code: ${otpCode}\n`);

    console.log('✨ Example 3 completed successfully!\n');

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

/**
 * Example 4: Click and Fill - Common Form Interaction
 *
 * Demonstrates transpiling and executing common form interactions:
 * 1. Navigating to a page
 * 2. Clicking an element
 * 3. Filling an input field
 */
async function example4_ClickAndFill() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  console.log('=== Example 4: Click and Fill ===\n');

  try {
    const actions = [
      {
        action_description: 'Navigate to example form',
        action_data: {
          action_name: 'go_to_url',
          kwargs: {
            url: 'https://www.wikipedia.org',
          },
        },
      },
      {
        action_description: 'Click on search input',
        locator: 'getByRole("searchbox")',
        action_data: {
          action_name: 'click',
          kwargs: {
            index: 0,
          },
        },
      },
      {
        action_description: 'Fill search query',
        locator: 'getByRole("searchbox")',
        action_data: {
          action_name: 'fill',
          kwargs: {
            value: 'Artificial Intelligence',
          },
        },
      },
    ];

    console.log('📝 Transpiling actions...\\n');

    const allCode: string[] = [];
    actions.forEach((action, index) => {
      const stepId = `step_${index + 1}`;
      const code = handler.transpile(action, stepId);

      console.log(`Step ${index + 1}: ${action.action_description}`);
      code.forEach(line => console.log(`  ${line}`));
      console.log();

      allCode.push(...code);
    });

    console.log('▶️  Executing in browser...\\n');

    await executeTranspiledCode(allCode, { page, agent });

    console.log();
    console.log('✨ Example 4 completed successfully!\\n');

    await page.waitForTimeout(2000);

  } finally {
    await browser.close();
  }
}

/**
 * Example 5: Scroll Actions
 *
 * Demonstrates transpiling and executing scroll actions
 */
async function example5_ScrollActions() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  console.log('=== Example 5: Scroll Actions ===\\n');

  try {
    const actions = [
      {
        action_description: 'Navigate to long page',
        action_data: {
          action_name: 'go_to_url',
          kwargs: {
            url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
          },
        },
      },
      {
        action_description: 'Scroll down 500px',
        action_data: {
          action_name: 'scroll_down',
          kwargs: {
            amount: 500,
          },
        },
      },
      {
        action_description: 'Wait to see scroll effect',
        action_data: {
          action_name: 'wait',
          kwargs: {
            seconds: 1,
          },
        },
      },
      {
        action_description: 'Scroll up 300px',
        action_data: {
          action_name: 'scroll_up',
          kwargs: {
            amount: 300,
          },
        },
      },
    ];

    console.log('📝 Transpiling scroll actions...\\n');

    const allCode: string[] = [];
    actions.forEach((action, index) => {
      const stepId = `step_${index + 1}`;
      const code = handler.transpile(action, stepId);

      console.log(`Step ${index + 1}: ${action.action_description}`);
      code.forEach(line => console.log(`  ${line}`));
      console.log();

      allCode.push(...code);
    });

    console.log('▶️  Executing scroll sequence...\\n');

    await executeTranspiledCode(allCode, { page, agent });

    console.log();
    console.log('✨ Example 5 completed successfully!\\n');

    await page.waitForTimeout(2000);

  } finally {
    await browser.close();
  }
}

/**
 * Example 6: Tab Management
 *
 * Demonstrates transpiling and executing tab management actions
 */
async function example6_TabManagement() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  console.log('=== Example 6: Tab Management ===\\n');

  try {
    const actions = [
      {
        action_description: 'Open first tab',
        action_data: {
          action_name: 'go_to_url',
          kwargs: {
            url: 'https://www.wikipedia.org',
          },
        },
      },
      {
        action_description: 'Open second tab',
        action_data: {
          action_name: 'open_tab',
          kwargs: {
            url: 'https://github.com',
          },
        },
      },
      {
        action_description: 'Wait to see new tab',
        action_data: {
          action_name: 'wait',
          kwargs: {
            seconds: 1,
          },
        },
      },
      {
        action_description: 'Switch to first tab',
        action_data: {
          action_name: 'switch_tab',
          kwargs: {
            page_id: 0,
          },
        },
      },
      {
        action_description: 'Wait on first tab',
        action_data: {
          action_name: 'wait',
          kwargs: {
            seconds: 1,
          },
        },
      },
      {
        action_description: 'Switch to second tab',
        action_data: {
          action_name: 'switch_tab',
          kwargs: {
            page_id: 1,
          },
        },
      },
    ];

    console.log('📝 Transpiling tab management actions...\\n');

    const allCode: string[] = [];
    actions.forEach((action, index) => {
      const stepId = `step_${index + 1}`;
      const code = handler.transpile(action, stepId);

      console.log(`Step ${index + 1}: ${action.action_description}`);
      code.forEach(line => console.log(`  ${line}`));
      console.log();

      allCode.push(...code);
    });

    console.log('▶️  Executing tab management sequence...\\n');

    await executeTranspiledCode(allCode, { page, agent });

    console.log();
    console.log('✨ Example 6 completed successfully!\\n');

    await page.waitForTimeout(2000);

  } finally {
    await browser.close();
  }
}

/**
 * Example 7: Complete User Flow
 *
 * Demonstrates a realistic user flow combining multiple action types:
 * 1. Navigation
 * 2. Variable management
 * 3. 2FA code generation
 * 4. Form interactions
 * 5. Verification
 */
async function example7_CompleteUserFlow() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const handler = new ActionHandler();
  const agent = createAgent();

  console.log('=== Example 7: Complete User Flow ===\\n');

  try {
    const actions = [
      {
        action_description: 'Save username variable',
        action_data: {
          action_name: 'save_variable',
          kwargs: {
            name: 'username',
            value: 'test_user@example.com',
          },
        },
      },
      {
        action_description: 'Generate 2FA code for login',
        action_data: {
          action_name: 'generate_2fa_code',
          kwargs: {
            otp_secret_key: '<secret>otp_secret</secret>',
          },
        },
      },
      {
        action_description: 'Navigate to login page',
        action_data: {
          action_name: 'go_to_url',
          kwargs: {
            url: 'https://www.wikipedia.org',
          },
        },
      },
    ];

    console.log('📝 Transpiling complete user flow...\\n');

    const allCode: string[] = [];
    actions.forEach((action, index) => {
      const stepId = `step_${index + 1}`;
      const code = handler.transpile(action, stepId);

      console.log(`Step ${index + 1}: ${action.action_description}`);
      code.forEach(line => console.log(`  ${line}`));
      console.log();

      allCode.push(...code);
    });

    console.log('▶️  Executing complete flow...\\n');

    await executeTranspiledCode(allCode, { page, agent });

    console.log();

    // Verify all variables were saved correctly
    console.log('✅ Verification:');
    console.log('─'.repeat(60));

    const username = agent.agentServices.readVariable('username');
    const otpCode = agent.agentServices.readVariable('otp_code');

    console.log(`✓ username = ${username}`);
    console.log(`✓ otp_code = ${otpCode}`);
    console.log(`✓ Page navigated to: ${page.url()}`);
    console.log('─'.repeat(60));
    console.log();

    console.log('✨ Example 7 completed successfully!\\n');

    await page.waitForTimeout(2000);

  } finally {
    await browser.close();
  }
}

// Export examples
export {
  example1_Generate2faCode,
  example2_MultipleActions,
  example3_LiveBrowserTest,
  example4_ClickAndFill,
  example5_ScrollActions,
  example6_TabManagement,
  example7_CompleteUserFlow,
};
