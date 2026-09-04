/**
 * End-to-end test for `shiplight test --vars` / `--vars-file`.
 *
 * Scaffolds a tiny Playwright project that uses `shiplightai`'s fixtures and
 * asserts a runtime variable inside a real Playwright test, then invokes the
 * compiled `dist/cli.js` against it. The test passes only if the override
 * flows all the way through: CLI → SHIPLIGHT_VARS_OVERRIDE env → fixture →
 * VariableStore → testContext.
 *
 * Does NOT touch the agent fixture (and therefore doesn't need an AI model
 * env var or a browser): the spec consumes only `{ testContext }`.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_ROOT = path.resolve(__dirname, '../..');
const CLI_DIST = path.join(CLI_ROOT, 'dist', 'cli.js');

/**
 * Create the scratch project as a subdirectory of `apps/cli/` so that ESM
 * resolution walks up into `apps/cli/node_modules` for both `@playwright/test`
 * and `shiplightai` (self-reference via the package's own exports map).
 *
 * If we put the scratch in `os.tmpdir()` with symlinks, Playwright loads its
 * own copy of `@playwright/test` from a different resolution path than the
 * fixture's import does, which trips Playwright's duplicate-version guard.
 * Keeping the scratch inside the cli package sidesteps that entirely.
 */
function scaffold(): string {
  const scratchRoot = path.join(CLI_ROOT, '.e2e-scratch');
  fs.mkdirSync(scratchRoot, { recursive: true });
  return fs.mkdtempSync(path.join(scratchRoot, 'vars-'));
}

function writeConfig(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'playwright.config.ts'),
    `
import { defineConfig, shiplightConfig } from 'shiplightai';

export default defineConfig({
  ...shiplightConfig(),
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    variables: {
      MY_VAR: 'declared',
      MY_SECRET: { value: 'declared_secret', sensitive: true },
    },
  },
});
`,
    'utf-8',
  );
}

function writeSpec(dir: string, expectations: Record<string, string>): void {
  const lines = Object.entries(expectations).map(
    ([k, v]) => `  if (testContext.${k} !== ${JSON.stringify(v)}) throw new Error('expected ${k}=' + ${JSON.stringify(v)} + ' but got ' + JSON.stringify(testContext.${k}));`,
  );
  fs.writeFileSync(
    path.join(dir, 'vars.spec.ts'),
    `
import { test } from 'shiplightai/fixture';

test('runtime variables match expectations', ({ testContext }) => {
${lines.join('\n')}
});
`,
    'utf-8',
  );
}

function runShiplight(dir: string, extraArgs: string[]): { status: number | null; stdout: string; stderr: string } {
  // Strip env vars that would leak into the child run and cause divergence.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SHIPLIGHT_VARS_OVERRIDE;
  delete env.SHIPLIGHT_MAGIC;

  // Pass --config as an ABSOLUTE path. Playwright resolves a relative --config
  // against an unexpected base when invoked via `npx`, so it ends up loading
  // apps/cli/playwright.config.ts (the parent dir's config) instead of the
  // scratch dir's config. An absolute path sidesteps that entirely.
  const configPath = path.join(dir, 'playwright.config.ts');
  const result = spawnSync(
    process.execPath,
    [CLI_DIST, 'test', `--config=${configPath}`, '--reporter=line', ...extraArgs],
    {
      cwd: dir,
      env,
      encoding: 'utf-8',
      timeout: 60_000,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('shiplight test --vars (end-to-end)', () => {
  before(() => {
    if (!fs.existsSync(CLI_DIST)) {
      throw new Error(
        `Built CLI not found at ${CLI_DIST}. Run \`pnpm build\` in apps/cli first.`,
      );
    }
  });

  it('uses project-declared variables when no override is given', () => {
    const dir = scaffold();
    try {
      writeConfig(dir);
      writeSpec(dir, { MY_VAR: 'declared', MY_SECRET: 'declared_secret' });

      const result = runShiplight(dir, []);
      assert.equal(
        result.status,
        0,
        `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overrides a declared variable when --vars KEY=VAL is passed', () => {
    const dir = scaffold();
    try {
      writeConfig(dir);
      writeSpec(dir, { MY_VAR: 'overridden', MY_SECRET: 'declared_secret' });

      const result = runShiplight(dir, ['--vars', 'MY_VAR=overridden']);
      assert.equal(
        result.status,
        0,
        `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overrides via comma-separated --vars and a --vars-file', () => {
    const dir = scaffold();
    try {
      writeConfig(dir);
      writeSpec(dir, { MY_VAR: 'from-flag', MY_SECRET: 'from-file' });
      const varsFile = path.join(dir, 'overrides.json');
      fs.writeFileSync(
        varsFile,
        JSON.stringify({ MY_VAR: 'from-file', MY_SECRET: 'from-file' }),
      );

      // --vars wins over --vars-file for overlapping keys (MY_VAR);
      // MY_SECRET only set by --vars-file should remain from-file.
      const result = runShiplight(dir, [
        '--vars-file',
        'overrides.json',
        '--vars',
        'MY_VAR=from-flag',
      ]);
      assert.equal(
        result.status,
        0,
        `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails the spec when override does not match (negative control)', () => {
    const dir = scaffold();
    try {
      writeConfig(dir);
      // Spec asserts MY_VAR === 'expected-X' but we pass MY_VAR=wrong-value.
      writeSpec(dir, { MY_VAR: 'expected-X' });

      const result = runShiplight(dir, ['--vars', 'MY_VAR=wrong-value']);
      assert.notEqual(
        result.status,
        0,
        `expected non-zero exit (spec should have failed), but exit was 0\nstdout:\n${result.stdout}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
