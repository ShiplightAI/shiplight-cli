/**
 * Tests for action entity cache integration in the YAML transpiler.
 *
 * Verifies that:
 * 1. The transpiler uses cached action entities from the store when available
 * 2. Cached entities take priority over inline entities
 * 3. The pipeline passes the store through to the transpiler correctly
 * 4. Tests without a store work identically to before (no regression)
 */

import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { transpileYamlContent } from './pipeline';
import { parseYamlTestFile } from './yamlParser';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ActionEntityStore } from 'shiplight-types';
import type { Action } from 'shiplight-types';

const tmpDir = join(tmpdir(), 'action-entity-cache-test-' + Date.now());

describe('actionEntityStore integration in transpiler', () => {
  mkdirSync(tmpDir, { recursive: true });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Helper: parse YAML, build store for a specific statement, transpile with store */
  function transpileWithCache(
    yaml: string,
    fileName: string,
    stmtIndex: number,
    cachedEntity: { action_name: string; kwargs?: Record<string, unknown>; locator?: string },
  ) {
    const filePath = join(tmpDir, fileName);
    writeFileSync(filePath, yaml);

    // Parse once to get stable UIDs
    const parsed = parseYamlTestFile(yaml, filePath);
    const testFlow = parsed.testFlow!;
    const stmtUid = testFlow.statements![stmtIndex].uid;

    // Build store keyed by that UID
    const store: ActionEntityStore = {
      version: '1.0',
      entries: {
        [stmtUid]: {
          action_entity: {
            action_description: (testFlow.statements![stmtIndex] as Action).description || '',
            action_data: { action_name: cachedEntity.action_name, kwargs: cachedEntity.kwargs || {} },
            ...(cachedEntity.locator ? { locator: cachedEntity.locator } : {}),
          },
          updated_at: new Date().toISOString(),
          updated_by: { source: 'runner', test_run_id: 1 },
        },
      },
    };

    // Transpile with pre-parsed result and store (single parse, UIDs match)
    const result = transpileYamlContent(yaml, filePath, {
      version: '0.0.1-test',
      actionEntityStore: store,
      parsed,
    });

    assert.equal(result.valid, true, 'transpilation should succeed');
    return readFileSync(result.specFile!, 'utf-8');
  }

  it('should use cached locator from store instead of inline locator', () => {
    const content = transpileWithCache(
      `goal: Test
statements:
  - intent: Click login button
    action: click
    locator: "getByRole('button', { name: 'Login' })"
`,
      'cached-locator.test.yaml',
      0,
      { action_name: 'click', locator: "getByTestId('login-btn')" },
    );

    assert.ok(content.includes("getByTestId('login-btn')"), 'should use cached locator');
    assert.ok(!content.includes("getByRole('button', { name: 'Login' })"), 'should not use original locator');
  });

  it('should use cached action name from store', () => {
    const content = transpileWithCache(
      `goal: Test
statements:
  - intent: Click the button
    action: click
    locator: "#btn"
`,
      'cached-action.test.yaml',
      0,
      { action_name: 'double_click', locator: '#btn' },
    );

    assert.ok(content.includes('double_click'), 'should use cached action name');
  });

  it('should fall back to inline entity when store has no entry for the UID', () => {
    const yaml = `goal: Test
statements:
  - intent: Click login button
    action: click
    locator: "getByRole('button', { name: 'Login' })"
`;
    const filePath = join(tmpDir, 'no-cache-entry.test.yaml');
    writeFileSync(filePath, yaml);

    const parsed = parseYamlTestFile(yaml, filePath);

    // Empty store
    const result = transpileYamlContent(yaml, filePath, {
      version: '0.0.1-test',
      actionEntityStore: { version: '1.0', entries: {} },
      parsed,
    });

    assert.equal(result.valid, true);
    const content = readFileSync(result.specFile!, 'utf-8');
    assert.ok(content.includes("getByRole('button', { name: 'Login' })"), 'should use inline locator');
  });

  it('should work identically without a store (no regression)', () => {
    const yaml = `goal: Test
statements:
  - intent: Click login button
    action: click
    locator: "getByRole('button', { name: 'Login' })"
`;
    const filePath = join(tmpDir, 'no-store.test.yaml');
    writeFileSync(filePath, yaml);

    const result = transpileYamlContent(yaml, filePath, { version: '0.0.1-test' });

    assert.equal(result.valid, true);
    const content = readFileSync(result.specFile!, 'utf-8');
    assert.ok(content.includes("getByRole('button', { name: 'Login' })"), 'should use inline locator');
  });

  it('should only override the statement with a cache entry', () => {
    const yaml = `goal: Test
statements:
  - intent: Click login
    action: click
    locator: "getByRole('button', { name: 'Login' })"
  - intent: Click submit
    action: click
    locator: "getByRole('button', { name: 'Submit' })"
`;
    const filePath = join(tmpDir, 'mixed-cache.test.yaml');
    writeFileSync(filePath, yaml);

    const parsed = parseYamlTestFile(yaml, filePath);
    const firstUid = parsed.testFlow!.statements![0].uid;

    // Only cache the first statement
    const store: ActionEntityStore = {
      version: '1.0',
      entries: {
        [firstUid]: {
          action_entity: {
            action_description: 'Click login',
            action_data: { action_name: 'click', kwargs: {} },
            locator: "getByTestId('cached-login')",
          },
          updated_at: new Date().toISOString(),
          updated_by: { source: 'runner', test_run_id: 1 },
        },
      },
    };

    const result = transpileYamlContent(yaml, filePath, {
      version: '0.0.1-test',
      actionEntityStore: store,
      parsed,
    });

    assert.equal(result.valid, true, `transpile errors: ${result.errors?.join('; ')}`);
    const content = readFileSync(result.specFile!, 'utf-8');

    assert.ok(content.includes("getByTestId('cached-login')"), 'first should use cached locator');
    assert.ok(content.includes("getByRole('button', { name: 'Submit' })"), 'second should keep original locator');
  });

  it('should handle VERIFY statement with cached js code', () => {
    const content = transpileWithCache(
      `goal: Test
statements:
  - VERIFY: Page is loaded
`,
      'cached-verify.test.yaml',
      0,
      {
        action_name: 'verify',
        kwargs: { statement: 'Page is loaded', code: "await expect(page.locator('#main')).toBeVisible()" },
      },
    );

    // The cached entity adds js code to a pure VERIFY (AI-only → enriched)
    assert.ok(content.includes("toBeVisible"), 'should include cached js code');
  });
});
