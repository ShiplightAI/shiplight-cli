import { defineConfig } from '@playwright/test';
import { shiplightConfig } from './src/config';

// E2E: AI-agent browser tests under tests/examples. These drive a real browser
// via shiplightai/fixture's `agent` and need an LLM key (GOOGLE_API_KEY) plus
// `playwright install chromium`. Browser-free logic tests live in their own
// config (playwright.logic.config.ts) so they can run without a browser.
// Single source of truth: the same path feeds shiplight's YAML scan (scanDir)
// and Playwright's test discovery (testDir), so they can't drift apart.
const testDir = './tests/examples';

export default defineConfig({
  ...shiplightConfig({ scanDir: testDir }),
  testDir,
  testMatch: ['**/*.yaml.spec.ts'],
  // These tests do multiple live-AI VERIFY/agent steps against real sites, each
  // a model round-trip. A single test runs ~15s locally, leaving little headroom
  // under Playwright's 30s default — an LLM/network latency spike in CI tips it
  // over and the whole gate flakes on a timeout. 120s gives comfortable margin.
  timeout: 120_000,
});
