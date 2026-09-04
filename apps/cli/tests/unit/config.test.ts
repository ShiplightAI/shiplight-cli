import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as fs from 'fs';
import { resolveScanRoots } from '../../src/config';

// We can't import shiplightConfig directly because it calls transpileAllYamlTests.
// Instead, test the loadDotenvWalkUp behavior via shiplightConfig with the dotenv
// option. Cloud upload (formerly tested here via __SHIPLIGHT_API_KEY) now lives
// exclusively in `shiplight report` — see apps/cli/src/commands/report.ts.

function createTempDir(): string {
  const dir = join(tmpdir(), 'shiplight-config-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function withTempDir(fn: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = createTempDir();
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

test.describe('shiplightConfig', () => {
  // Save and restore env + cwd
  let originalCwd: string;
  let savedEnv: Record<string, string | undefined>;

  test.beforeEach(() => {
    originalCwd = process.cwd();
    savedEnv = {
      TEST_DOTENV_VAR: process.env.TEST_DOTENV_VAR,
      TEST_DOTENV_NESTED: process.env.TEST_DOTENV_NESTED,
      TEST_DOTENV_ROOT: process.env.TEST_DOTENV_ROOT,
      TEST_DOTENV_OUTSIDE: process.env.TEST_DOTENV_OUTSIDE,
    };
  });

  test.afterEach(() => {
    process.chdir(originalCwd);
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  test('dotenv: false skips .env loading', async () => {
    await withTempDir(async (dir) => {
      // Create .env with a test var
      writeFileSync(join(dir, '.env'), 'TEST_DOTENV_VAR=should_not_load\n');
      delete process.env.TEST_DOTENV_VAR;
      process.chdir(dir);

      const { shiplightConfig } = await import('../../src/config');
      shiplightConfig({ dotenv: false, scanDir: dir });

      expect(process.env.TEST_DOTENV_VAR).toBeUndefined();
    });
  });

  test('dotenv: true (default) loads .env file', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, '.env'), 'TEST_DOTENV_VAR=loaded_value\n');
      delete process.env.TEST_DOTENV_VAR;
      process.chdir(dir);

      const { shiplightConfig } = await import('../../src/config');
      shiplightConfig({ scanDir: dir });

      expect(process.env.TEST_DOTENV_VAR).toBe('loaded_value');
    });
  });

  test('.env walk-up finds files in parent directories', async () => {
    await withTempDir(async (dir) => {
      // Project root has a .env
      writeFileSync(join(dir, '.env'), 'TEST_DOTENV_ROOT=root_value\n');
      // Nested subdir is the scanDir
      const subDir = join(dir, 'tests', 'my-app');
      mkdirSync(subDir, { recursive: true });

      delete process.env.TEST_DOTENV_ROOT;
      process.chdir(dir);

      const { shiplightConfig } = await import('../../src/config');
      shiplightConfig({ scanDir: subDir });

      expect(process.env.TEST_DOTENV_ROOT).toBe('root_value');
    });
  });

  test('.env walk-up stops at project root (cwd), does not go higher', async () => {
    await withTempDir(async (dir) => {
      // Create a parent dir above the project root with a .env
      const parentDir = join(dir, 'parent');
      const projectDir = join(parentDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(parentDir, '.env'), 'TEST_DOTENV_OUTSIDE=should_not_load\n');

      delete process.env.TEST_DOTENV_OUTSIDE;
      process.chdir(projectDir); // project root = projectDir
      // Use process.cwd() to get the real path (macOS /tmp → /private/tmp)
      const realProjectDir = process.cwd();

      const { shiplightConfig } = await import('../../src/config');
      shiplightConfig({ scanDir: realProjectDir });

      expect(process.env.TEST_DOTENV_OUTSIDE).toBeUndefined();
    });
  });

  test('closer .env takes precedence over root .env', async () => {
    await withTempDir(async (dir) => {
      // Root .env
      writeFileSync(join(dir, '.env'), 'TEST_DOTENV_NESTED=root\n');
      // Nested .env
      const subDir = join(dir, 'sub');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, '.env'), 'TEST_DOTENV_NESTED=nested\n');

      delete process.env.TEST_DOTENV_NESTED;
      process.chdir(dir);

      const { shiplightConfig } = await import('../../src/config');
      shiplightConfig({ scanDir: subDir });

      // Closer file loaded first, dotenv won't overwrite → nested wins
      expect(process.env.TEST_DOTENV_NESTED).toBe('nested');
    });
  });
});

test.describe('resolveScanRoots', () => {
  test('no scanDir and no env → both default to cwd', () => {
    const { scanDir, projectRoot } = resolveScanRoots({}, {}, '/proj');
    expect(scanDir).toBe('/proj');
    expect(projectRoot).toBe('/proj');
  });

  test('SHIPLIGHT_PROJECT_ROOT sets projectRoot; scanDir falls back to it when absent', () => {
    const { scanDir, projectRoot } = resolveScanRoots(
      {},
      { SHIPLIGHT_PROJECT_ROOT: '/cfgdir' },
      '/invocation',
    );
    expect(projectRoot).toBe('/cfgdir');
    expect(scanDir).toBe('/cfgdir'); // no explicit scanDir → falls back to projectRoot
  });

  // Regression guard: collapsing scanDir into projectRoot changed the fallback
  // base for template:/function references and broke resolution for
  // scanDir-narrowed projects (caught in review on PR #2108). An explicit scanDir
  // must narrow ONLY the scan — projectRoot stays the true root.
  test('explicit scanDir narrows the scan but projectRoot stays the true root', () => {
    const { scanDir, projectRoot } = resolveScanRoots({ scanDir: './e2e' }, {}, '/proj');
    expect(scanDir).toBe('./e2e');
    expect(projectRoot).toBe('/proj');
  });

  test('absolute scanDir narrows the scan but projectRoot stays the true root', () => {
    const { scanDir, projectRoot } = resolveScanRoots({ scanDir: '/proj/e2e' }, {}, '/proj');
    expect(scanDir).toBe('/proj/e2e');
    expect(projectRoot).toBe('/proj');
  });

  test('explicit scanDir with env set: scanDir narrows, projectRoot is the env root', () => {
    const { scanDir, projectRoot } = resolveScanRoots(
      { scanDir: './e2e' },
      { SHIPLIGHT_PROJECT_ROOT: '/cfgdir' },
      '/invocation',
    );
    expect(scanDir).toBe('./e2e');
    expect(projectRoot).toBe('/cfgdir');
  });
});
