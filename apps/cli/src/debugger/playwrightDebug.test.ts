import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findPlaywrightConfig,
  makeIdempotentFileCleaner,
  resolveDebugUseBlock,
  spawnPlaywrightProcess,
} from './playwrightDebug.js';

describe('playwrightDebug', () => {
  describe('findPlaywrightConfig', () => {
    it('should find playwright.config.ts in the given directory', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pw-test-'));
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}');
      try {
        assert.equal(findPlaywrightConfig(dir), join(dir, 'playwright.config.ts'));
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it('should walk up to find playwright.config.ts in parent', () => {
      const parent = mkdtempSync(join(tmpdir(), 'pw-test-'));
      const child = join(parent, 'tests', 'e2e');
      mkdirSync(child, { recursive: true });
      writeFileSync(join(parent, 'playwright.config.ts'), 'export default {}');
      try {
        assert.equal(findPlaywrightConfig(child), join(parent, 'playwright.config.ts'));
      } finally {
        rmSync(parent, { recursive: true });
      }
    });

    it('should return null when no config exists', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pw-test-'));
      try {
        assert.equal(findPlaywrightConfig(dir), null);
      } finally {
        rmSync(dir, { recursive: true });
      }
    });
  });

  describe('spawnPlaywrightProcess', () => {
    it('should throw clear error when YAML file does not exist', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pw-test-'));
      writeFileSync(join(dir, 'playwright.config.ts'), 'export default {}');
      try {
        await assert.rejects(
          () => spawnPlaywrightProcess({
            yamlFilePath: join(dir, 'nonexistent.test.yaml'),
            configPath: join(dir, 'playwright.config.ts'),
            headed: true,
          }),
          (err: Error) => {
            assert.ok(err.message.includes('Please select a test file'));
            assert.ok(err.message.includes('nonexistent.test.yaml'));
            return true;
          }
        );
      } finally {
        rmSync(dir, { recursive: true });
      }
    });
  });

  describe('makeIdempotentFileCleaner', () => {
    it('deletes the file on first invocation and is a no-op on subsequent calls', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pw-cleaner-'));
      const file = join(dir, 'spec.ts');
      writeFileSync(file, 'old');
      try {
        const cleaner = makeIdempotentFileCleaner(file);
        cleaner();
        assert.equal(existsSync(file), false, 'first call should delete the file');
        // Write a new file at the same path — simulating restartInner
        // overwriting the spec for a fresh spawn.
        writeFileSync(file, 'new');
        cleaner();
        assert.equal(
          existsSync(file),
          true,
          'second call must NOT delete the freshly-written file',
        );
        assert.equal(readFileSync(file, 'utf-8'), 'new');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('produces an independent closure per call (OLD and NEW cleaners can coexist)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pw-cleaner-'));
      const file = join(dir, 'spec.ts');
      writeFileSync(file, 'first');
      try {
        // OLD spawn's cleaner. We call it (file deleted) and then forget about it.
        const oldCleaner = makeIdempotentFileCleaner(file);
        oldCleaner();
        assert.equal(existsSync(file), false);

        // NEW spawn writes a fresh file at the same path and produces its
        // own cleaner. The OLD cleaner is now stale but still callable —
        // it must remain a no-op (its closure already cleaned).
        writeFileSync(file, 'second');
        const newCleaner = makeIdempotentFileCleaner(file);

        // Simulate the OLD child's deferred close handler firing here.
        oldCleaner();
        assert.equal(
          existsSync(file),
          true,
          'OLD cleaner must not touch NEW spawn\'s file',
        );

        // NEW cleaner still works correctly for the NEW spawn.
        newCleaner();
        assert.equal(existsSync(file), false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('silently tolerates a missing file (does not throw)', () => {
      const cleaner = makeIdempotentFileCleaner('/nonexistent/path/spec.ts');
      // Must not throw — closure logs nothing and returns normally.
      assert.doesNotThrow(() => cleaner());
      assert.doesNotThrow(() => cleaner());
    });
  });
});

/**
 * Regression for the follow-up to issue #2209 — the debugger was a third,
 * independent reader of `base_url`. It saw only the top-level key, so a suite
 * written in the nested spelling (which suiteToYaml used to emit on every save)
 * launched under `shiplight debug` with no baseURL while the same file passed
 * under `shiplight test`. Both spellings must resolve identically here.
 */
describe('resolveDebugUseBlock', () => {
  it('maps a top-level base_url to baseURL', () => {
    assert.deepEqual(
      resolveDebugUseBlock({ base_url: 'https://example.com' }),
      { baseURL: 'https://example.com' },
    );
  });

  it('maps a nested suite.base_url to baseURL', () => {
    assert.deepEqual(
      resolveDebugUseBlock({ suite: { base_url: 'https://example.com', tests: [] } }),
      { baseURL: 'https://example.com' },
    );
  });

  it('lets the nested suite.base_url win over a top-level one, matching the transpiler', () => {
    assert.deepEqual(
      resolveDebugUseBlock({
        base_url: 'https://outer.example.com',
        suite: { base_url: 'https://inner.example.com', tests: [] },
      }),
      { baseURL: 'https://inner.example.com' },
    );
  });

  it('lets base_url win over use.baseURL, matching the transpiler', () => {
    assert.deepEqual(
      resolveDebugUseBlock({
        base_url: 'https://wins.example.com',
        use: { baseURL: 'https://loses.example.com' },
      }),
      { baseURL: 'https://wins.example.com' },
    );
  });

  it('preserves other use: keys alongside base_url', () => {
    assert.deepEqual(
      resolveDebugUseBlock({ base_url: 'https://example.com', use: { viewport: null } }),
      { viewport: null, baseURL: 'https://example.com' },
    );
  });

  it('returns the use block unchanged when no base_url is present', () => {
    assert.deepEqual(resolveDebugUseBlock({ use: { locale: 'en-US' } }), { locale: 'en-US' });
  });

  it('returns undefined when the file sets neither', () => {
    assert.equal(resolveDebugUseBlock({ goal: 'x' }), undefined);
  });

  it('ignores a non-object use block', () => {
    assert.equal(resolveDebugUseBlock({ use: ['not', 'an', 'object'] }), undefined);
  });

  it('tolerates a null document', () => {
    assert.equal(resolveDebugUseBlock(null), undefined);
  });
});
