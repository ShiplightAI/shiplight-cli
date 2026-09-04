/**
 * Integration tests for the action entity cache flow.
 *
 * Simulates the full orchestrator flow:
 * 1. Parse YAML file
 * 2. Compute statement hashes
 * 3. Build ActionEntityStore from "cloud cache" (simulated)
 * 4. Transpile with the store
 * 5. Verify generated code uses cached entities
 */

import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { transpileYamlContent } from './pipeline';
import { parseYamlTestFile } from './yamlParser';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ActionEntityStore, ActionEntity, Statement, Action, Step, IfElse, WhileLoop } from 'shiplight-types';
import { StatementType } from 'shiplight-types';
import { createHash } from 'crypto';

function computeStatementHash(filePath: string, statementPath: string, description: string): string {
  return createHash('sha256').update(`${filePath}:${statementPath}:${description}`).digest('hex').slice(0, 16);
}

const tmpDir = join(tmpdir(), 'cache-integration-test-' + Date.now());

/** Walk a statement tree and collect { hash, uid } pairs. */
function collectStatementHashes(
  statements: Statement[],
  filePath: string,
  pathPrefix: string,
): Array<{ hash: string; uid: string; description: string }> {
  const results: Array<{ hash: string; uid: string; description: string }> = [];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const stmtPath = `${pathPrefix}.${i}`;
    const desc = (stmt as Action).description || '';

    if (stmt.type === StatementType.ACTION || stmt.type === StatementType.DRAFT) {
      results.push({ hash: computeStatementHash(filePath, stmtPath, desc), uid: stmt.uid, description: desc });
    } else if (stmt.type === StatementType.STEP) {
      results.push(...collectStatementHashes((stmt as Step).statements, filePath, stmtPath));
    } else if (stmt.type === StatementType.IF_ELSE) {
      const ifElse = stmt as IfElse;
      results.push(...collectStatementHashes(ifElse.then, filePath, `${stmtPath}.then`));
      if (ifElse.else) {
        results.push(...collectStatementHashes(ifElse.else, filePath, `${stmtPath}.else`));
      }
    } else if (stmt.type === StatementType.WHILE_LOOP) {
      results.push(...collectStatementHashes((stmt as WhileLoop).body, filePath, `${stmtPath}.body`));
    }
  }
  return results;
}

/** Build an ActionEntityStore from a simulated cloud cache response. */
function buildStoreFromCache(
  hashUidPairs: Array<{ hash: string; uid: string }>,
  cloudCache: Map<string, ActionEntity>,
): ActionEntityStore {
  const store: ActionEntityStore = { version: '1.0', entries: {} };
  for (const { hash, uid } of hashUidPairs) {
    const cached = cloudCache.get(hash);
    if (cached) {
      store.entries[uid] = {
        action_entity: cached,
        updated_at: new Date().toISOString(),
        updated_by: { source: 'runner', test_run_id: 1 },
      };
    }
  }
  return store;
}

describe('action entity cache integration (full orchestrator flow)', () => {
  mkdirSync(tmpDir, { recursive: true });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should replace healed locators in a multi-statement test', () => {
    const relPath = 'tests/login.test.yaml';
    const yaml = `goal: Login test
statements:
  - URL: /login
  - intent: Enter username
    action: input_text
    locator: "getByRole('textbox', { name: 'Username' })"
    text: admin
  - intent: Click login
    action: click
    locator: "getByRole('button', { name: 'Login' })"
  - VERIFY: Dashboard is visible
`;
    const filePath = join(tmpDir, 'login.test.yaml');
    writeFileSync(filePath, yaml);

    // Step 1: Parse
    const parsed = parseYamlTestFile(yaml, filePath);
    const testFlow = parsed.testFlow!;

    // Step 2: Compute hashes
    const pairs = collectStatementHashes(testFlow.statements!, relPath, 'main');
    assert.ok(pairs.length >= 4, 'should have 4 statements');

    // Step 3: Simulate cloud cache — "Click login" was healed with a new locator
    const clickLoginPair = pairs.find(p => p.description === 'Click login');
    assert.ok(clickLoginPair, 'should find Click login statement');

    const cloudCache = new Map<string, ActionEntity>();
    cloudCache.set(clickLoginPair!.hash, {
      action_description: 'Click login',
      action_data: { action_name: 'click', kwargs: {} },
      locator: "getByTestId('healed-login-btn')",
    });

    // Step 4: Build store and transpile
    const store = buildStoreFromCache(pairs, cloudCache);
    assert.equal(Object.keys(store.entries).length, 1, 'store should have 1 entry');

    const result = transpileYamlContent(yaml, filePath, {
      version: '0.0.1-test',
      actionEntityStore: store,
      parsed,
    });

    assert.equal(result.valid, true, `transpile errors: ${result.errors?.join('; ')}`);

    // Step 5: Verify
    const content = readFileSync(result.specFile!, 'utf-8');

    // The healed locator should be in the output
    assert.ok(content.includes("getByTestId('healed-login-btn')"), 'should use healed locator for Click login');
    // The non-healed input_text action should keep its original locator
    assert.ok(content.includes("getByRole('textbox', { name: 'Username' })"), 'should keep original locator for Enter username');
    assert.ok(content.includes('admin'), 'should keep typed text');
    // URL and VERIFY should be unaffected
    assert.ok(content.includes('/login'), 'should keep URL');
    assert.ok(content.includes('Dashboard is visible'), 'should keep VERIFY');
  });

  it('should produce stable hashes across multiple parses of the same file', () => {
    const relPath = 'tests/stable.test.yaml';
    const yaml = `goal: Stability test
statements:
  - intent: Click button
    action: click
    locator: "getByRole('button')"
`;
    const filePath = join(tmpDir, 'stable.test.yaml');
    writeFileSync(filePath, yaml);

    // Parse twice — deterministic UIDs should be identical across parses
    const parsed1 = parseYamlTestFile(yaml, filePath);
    const parsed2 = parseYamlTestFile(yaml, filePath);

    const hashes1 = collectStatementHashes(parsed1.testFlow!.statements!, relPath, 'main');
    const hashes2 = collectStatementHashes(parsed2.testFlow!.statements!, relPath, 'main');

    assert.equal(hashes1[0].uid, hashes2[0].uid, 'deterministic UIDs should be stable across parses');
    assert.equal(hashes1[0].hash, hashes2[0].hash, 'hashes should be stable across parses');
  });

  it('should invalidate cache when description changes', () => {
    const relPath = 'tests/invalidate.test.yaml';
    const yaml1 = `goal: Test
statements:
  - intent: Click login button
    action: click
    locator: "getByRole('button')"
`;
    const yaml2 = `goal: Test
statements:
  - intent: Click the login button
    action: click
    locator: "getByRole('button')"
`;
    const filePath = join(tmpDir, 'invalidate.test.yaml');

    writeFileSync(filePath, yaml1);
    const parsed1 = parseYamlTestFile(yaml1, filePath);
    const hashes1 = collectStatementHashes(parsed1.testFlow!.statements!, relPath, 'main');

    writeFileSync(filePath, yaml2);
    const parsed2 = parseYamlTestFile(yaml2, filePath);
    const hashes2 = collectStatementHashes(parsed2.testFlow!.statements!, relPath, 'main');

    assert.notEqual(hashes1[0].hash, hashes2[0].hash, 'hash should change when description changes');
  });

  it('should handle suite files with cached entities', () => {
    const relPath = 'tests/suite.test.yaml';
    const yaml = `suite:
  tests:
    - name: Login test
      statements:
        - intent: Click login
          action: click
          locator: "getByRole('button', { name: 'Login' })"
`;
    const filePath = join(tmpDir, 'suite.test.yaml');
    writeFileSync(filePath, yaml);

    const parsed = parseYamlTestFile(yaml, filePath);
    // Suite files have testGroup, not top-level statements
    // The transpiler should still accept the store without errors
    const result = transpileYamlContent(yaml, filePath, {
      version: '0.0.1-test',
      actionEntityStore: { version: '1.0', entries: {} },
      parsed,
    });

    assert.equal(result.valid, true, `transpile errors: ${result.errors?.join('; ')}`);
  });
});
