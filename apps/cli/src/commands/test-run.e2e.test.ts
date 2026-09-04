/**
 * E2E: `shiplight test` runs a real (browser) suite and propagates exit codes
 * (002 exp-test-command).
 *
 * Scaffolds a tiny project whose spec drives a real browser page (data: URL, no
 * agent → no LLM key needed) and runs the built CLI. Proves the Playwright spawn
 * and pass/fail exit-code propagation. Needs Chromium; skips if dist not built.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, '../..');
const CLI_DIST = path.join(CLI_ROOT, 'dist', 'cli.js');

function writeConfig(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'playwright.config.ts'),
    `import { defineConfig, shiplightConfig } from 'shiplightai';
export default defineConfig({
  ...shiplightConfig(),
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { headless: true },
});
`,
    'utf-8',
  );
}

function writeSpec(dir: string, expected: string): void {
  fs.writeFileSync(
    path.join(dir, 'page.spec.ts'),
    `import { test, expect } from 'shiplightai/fixture';
test('renders the heading', async ({ page }) => {
  await page.goto('data:text/html,<h1>Hello</h1>');
  await expect(page.locator('h1')).toHaveText(${JSON.stringify(expected)});
});
`,
    'utf-8',
  );
}

function runTest(dir: string): number | null {
  return spawnSync(
    process.execPath,
    [CLI_DIST, 'test', `--config=${path.join(dir, 'playwright.config.ts')}`, '--reporter=line'],
    { cwd: dir, encoding: 'utf-8', timeout: 120_000 },
  ).status;
}

function scaffold(prefix: string): string {
  const root = path.join(CLI_ROOT, '.e2e-scratch');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, prefix));
  writeConfig(dir);
  return dir;
}

describe('shiplight test (end-to-end, real browser)', () => {
  before(() => {
    if (!fs.existsSync(CLI_DIST)) {
      throw new Error(`Built CLI not found at ${CLI_DIST}. Run \`pnpm build\` in apps/cli first.`);
    }
  });

  it('exits 0 when the browser spec passes', () => {
    const dir = scaffold('run-pass-');
    try {
      writeSpec(dir, 'Hello');
      assert.equal(runTest(dir), 0, 'passing suite should exit 0');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits non-zero when the browser spec fails', () => {
    const dir = scaffold('run-fail-');
    try {
      writeSpec(dir, 'Goodbye'); // assertion will fail
      assert.notEqual(runTest(dir), 0, 'failing suite must propagate a non-zero exit code');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
