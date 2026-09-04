import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this config file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from local .env file
dotenv.config({ path: path.resolve(__dirname, '.env') });

// The specs configure the engine with GOOGLE_API_KEY / ANTHROPIC_API_KEY
// (001 FR-003), but the Vercel AI SDK's conventional name is
// GOOGLE_GENERATIVE_AI_API_KEY, which is what this directory's .env has
// historically carried. Accept either, so the lane runs from whichever name a
// developer already has instead of failing deep inside a spec with an
// unhelpful "no API key" — the mismatch is why this lane was red locally.
if (!process.env.GOOGLE_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

// Ensure PWDEBUG=console is set for locator generation. Without it Playwright
// does not inject `playwright.generateLocator`, so every captured entity falls
// back to an xpath and the locator-quality specs measure the wrong thing
// (003 FR-011).
process.env.PWDEBUG = 'console';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false, // Run tests sequentially for browser automation
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for deterministic browser automation
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    // Base URL for test pages
    baseURL: 'https://example.com',

    // Collect trace on failure
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Disable automation detection
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled'],
        },
      },
    },
  ],

  // Timeout for each test
  timeout: 60000,

  // Timeout for expect assertions
  expect: {
    timeout: 10000,
  },
});
