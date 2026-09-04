/**
 * Drift guard: the `agent` common-methods code block in the YAML test
 * language spec (apps/cli/docs/YAML-TEST-LANGUAGE-SPEC.md,
 * §4.8 Code) is the supported WebAgent surface for `js:` blocks in user
 * tests. Every method the spec documents must exist on WebAgent — a
 * documented method that doesn't exist throws at runtime inside user
 * tests (this happened with waitForDownloadComplete, which only lived
 * on agentServices).
 *
 * Uses mock.module for the same modules as webAgent.maxSteps.test.ts —
 * WebAgent's import chain pulls in ?raw dom assets and browser modules
 * that fail outside bundlers.
 */

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Module-level mocks (must be set up before dynamic imports) ---

mock.module('../agentHelpers', {
  namedExports: {
    executeStep: mock.fn(),
    runTask: mock.fn(),
    evaluateStatement: mock.fn(),
    generateActionStep: mock.fn(),
  },
});

mock.module('../../dom', {
  namedExports: {
    DomService: class MockDomService {},
    HistoryTreeProcessor: class {},
  },
});

mock.module('../agentWait', {
  namedExports: {
    waitUntilStable: async () => {},
    waitUntilCondition: async () => true,
    waitForDownloadComplete: async () => {},
  },
});

mock.module('../../browser/browserUtils', {
  namedExports: {
    waitForPageAndFramesLoad: async () => {},
    getBrowserCdpUrl: async () => '',
    getPageInfo: async () => ({}),
    getPageWsUrl: () => '',
    newBrowserContext: async () => ({}),
    setWindowBounds: async () => {},
  },
});

mock.module('../../browser/tabManager', {
  namedExports: {
    TabManager: class MockTabManager {
      getCurrentPage() { return null; }
    },
  },
});

// --- Dynamic imports (after mocks are set up) ---

const { WebAgent } = await import('../webAgent');

// --- Spec parsing ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.resolve(
  __dirname,
  '../../../../../apps/cli/docs/YAML-TEST-LANGUAGE-SPEC.md',
);

const spec = fs.readFileSync(SPEC_PATH, 'utf8');
const blockMatch = spec.match(/`agent` common methods:\s*```javascript\n([\s\S]*?)```/);
const documentedMethods = blockMatch
  ? [...new Set([...blockMatch[1].matchAll(/agent\.(\w+)\(/g)].map((m) => m[1]))]
  : [];

describe('YAML spec `agent` surface drift guard', () => {
  it('finds the `agent` common-methods block in the spec', () => {
    assert.ok(
      blockMatch,
      `Could not find the "\`agent\` common methods:" javascript code block in ${SPEC_PATH}. ` +
        'If the section was renamed or moved, update this test to keep the drift guard alive.',
    );
  });

  it('extracts the documented method names', () => {
    assert.ok(
      documentedMethods.length >= 5,
      `Expected at least 5 agent.<method>() calls in the spec block, got: [${documentedMethods.join(', ')}]`,
    );
  });

  for (const name of documentedMethods) {
    it(`WebAgent implements documented method ${name}()`, () => {
      assert.strictEqual(
        typeof (WebAgent.prototype as Record<string, unknown>)[name],
        'function',
        `The YAML spec documents agent.${name}() but WebAgent has no such method — ` +
          'user js: blocks calling it will throw. Add the method to WebAgent (delegate ' +
          'to agentServices if needed) or remove it from the spec.',
      );
    });
  }
});
