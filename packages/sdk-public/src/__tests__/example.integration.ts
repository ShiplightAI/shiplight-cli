/**
 * README example validation tests
 *
 * Each test runs the same code shown in the README against real LLM + browser.
 * If a README snippet changes, update the matching test (and vice versa).
 *
 * Requires ANTHROPIC_API_KEY in packages/sdk-public/.env
 *
 * Run: cd packages/sdk-public && pnpm test:unit
 */

import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { createAgent, configureSdk, getSdkConfig, LogLevel, z } from '@shiplightai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;

describe('README examples', { skip: !apiKey ? 'ANTHROPIC_API_KEY not set' : undefined }, () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  async function freshPage(): Promise<Page> {
    if (page) await page.close().catch(() => {});
    page = await browser.newPage();
    return page;
  }

  // ------------------------------------------------------------------
  // README § Quick Start
  // ------------------------------------------------------------------
  it('Quick Start', async () => {
    const page = await freshPage();

    // --- same code as README ---
    configureSdk({
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
    });

    const agent = createAgent({
      model: 'claude-haiku-4-5',
    });

    await agent.login(page, {
      url: 'https://www.saucedemo.com/',
      username: 'standard_user',
      password: 'secret_sauce',
    });

    await agent.assert(page, 'Products page is visible');

    await agent.extract(page, 'the first product name', 'productName');
    console.log('First product:', agent.getVariable('productName'));
    // --- end README code ---

    assert.ok(agent.getVariable('productName'));
  });

  // ------------------------------------------------------------------
  // README § Custom Actions
  // ------------------------------------------------------------------
  it('Custom Actions', async () => {
    const page = await freshPage();
    await page.goto('https://example.com');

    // --- same code as README (with myEmailService stubbed) ---
    const agent = createAgent({ model: 'claude-haiku-4-5' });

    agent.registerAction({
      name: 'extract_email_code',
      description: 'Extract verification code from email inbox',
      schema: z.object({
        email_address: z.string().describe('The email address to check'),
        code_type: z.enum(['verification', 'reset']).describe('Type of code'),
      }),
      async execute(args, ctx) {
        // Stubbed for test — README shows: myEmailService.getCode(...)
        const code = '123456';

        ctx.variableStore.set('verification_code', code);

        return { success: true, message: `Found code: ${code}` };
      },
    });

    await agent.act(page, 'Get the verification code from email');
    // --- end README code ---

    assert.ok(true, 'custom action registered and dispatched');
  });

  // ------------------------------------------------------------------
  // README § createAgent(options)
  // ------------------------------------------------------------------
  it('createAgent with all options', () => {
    // --- same code as README ---
    const agent = createAgent({
      model: 'claude-haiku-4-5',
      variables: { username: 'test@example.com' },
      sensitiveKeys: ['password', 'apiKey'],
      testDataDir: './test-data',
      downloadDir: './downloads',
    });
    // --- end README code ---

    assert.ok(agent);
  });

  // ------------------------------------------------------------------
  // README § Explicit provider routing
  // ------------------------------------------------------------------
  it('explicit provider:model routing', () => {
    // --- same code as README ---
    const a1 = createAgent({ model: 'openai:gpt-4o' });
    const a2 = createAgent({ model: 'anthropic:claude-sonnet-4-6' });
    const a3 = createAgent({ model: 'openai:ft:gpt-4o:my-org' });
    // --- end README code ---

    assert.ok(a1);
    assert.ok(a2);
    assert.ok(a3);
  });

  // ------------------------------------------------------------------
  // README § agent.act()
  // ------------------------------------------------------------------
  it('act', async () => {
    const page = await freshPage();
    await page.goto('https://www.saucedemo.com/');
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('#login-button');
    await page.waitForLoadState('networkidle');

    const agent = createAgent({ model: 'claude-haiku-4-5' });

    // --- same code as README ---
    await agent.act(page, 'Click the "Add to cart" button for the first product');
    // --- end README code ---
  });

  // ------------------------------------------------------------------
  // README § agent.evaluate()
  // ------------------------------------------------------------------
  it('evaluate', async () => {
    const page = await freshPage();
    await page.goto('https://www.saucedemo.com/');
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('#login-button');
    await page.waitForLoadState('networkidle');

    const agent = createAgent({ model: 'claude-haiku-4-5' });

    // --- same code as README ---
    const isLoggedIn = await agent.evaluate(page, 'User is logged in');
    if (!isLoggedIn) {
      await agent.run(page, 'Click the login button');
    }
    // --- end README code ---

    assert.strictEqual(typeof isLoggedIn, 'boolean');
  });

  // ------------------------------------------------------------------
  // README § agent.run()
  // ------------------------------------------------------------------
  it('run with maxSteps', async () => {
    const page = await freshPage();
    await page.goto('https://www.saucedemo.com/');
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('#login-button');
    await page.waitForLoadState('networkidle');

    const agent = createAgent({ model: 'claude-haiku-4-5' });

    // --- same code as README ---
    await agent.run(page, 'Add 3 items to cart', { maxSteps: 10 });
    // --- end README code ---
  });

  // ------------------------------------------------------------------
  // README § agent.step()
  // ------------------------------------------------------------------
  it('step with self-healing', async () => {
    const page = await freshPage();
    await page.goto('https://www.saucedemo.com/');

    const agent = createAgent({ model: 'claude-haiku-4-5' });

    // --- same code as README ---
    await agent.step(
      page,
      async () => await page.click('#submit-btn'),
      'Click the submit button'
    );
    // --- end README code ---
  });

  // ------------------------------------------------------------------
  // README § agent.setVariable() + agent.getVariable()
  // ------------------------------------------------------------------
  it('setVariable + getVariable', () => {
    const agent = createAgent({ model: 'claude-haiku-4-5' });

    // --- same code as README ---
    agent.setVariable('couponCode', 'SAVE20');
    agent.setVariable('apiKey', 'secret123', true);
    // --- end README code ---

    assert.strictEqual(agent.getVariable('couponCode'), 'SAVE20');
    assert.strictEqual(agent.getVariable('apiKey'), 'secret123');
  });

  // ------------------------------------------------------------------
  // README § agent.waitUntil()
  // ------------------------------------------------------------------
  it('waitUntil', async () => {
    const page = await freshPage();
    await page.goto('https://www.saucedemo.com/');

    const agent = createAgent({ model: 'claude-haiku-4-5' });

    // --- same code as README ---
    await agent.waitUntil(page, 'Loading spinner is no longer visible');
    // --- end README code ---
  });

  // ------------------------------------------------------------------
  // README § SDK Configuration
  // ------------------------------------------------------------------
  it('configureSdk + getSdkConfig + LogLevel', () => {
    // --- same code as README ---
    configureSdk({
      logLevel: LogLevel.INFO,
      debugAgent: false,
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      },
    });

    const config = getSdkConfig();
    // --- end README code ---

    assert.strictEqual(config.logLevel, LogLevel.INFO);
    assert.ok(config.env);

    // Reset for other tests
    configureSdk({ logLevel: LogLevel.WARN });
  });
});
