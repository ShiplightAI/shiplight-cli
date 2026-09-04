import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PageContext } from '../action-generation/actionPrompts.js';

/**
 * exp-variable-substitution (001) — redaction at the serialized-prompt and
 * step-logging layers.
 *
 * Variable substitution + sensitive flagging is already proven at the
 * agentContextUtils layer. This closes the documented proof gap: a value flagged
 * sensitive (e.g. `<secret>password</secret>`) must NOT appear in either the
 * prompt sent to the LLM or the masked variables used for step logging. A leak
 * here ships a real secret to a third party or writes it to a log.
 */

// webAgent.ts pulls the dom module's `?raw` bundle import, which fails outside a
// bundler. Mock it (and the browser deps in its import graph) before importing —
// the same pattern as webAgent.maxSteps.test.ts. maskSensitiveVariables is a pure
// helper, unaffected by the stubs.
mock.module('../../dom', {
  namedExports: { DomService: class {}, HistoryTreeProcessor: class {} },
});
mock.module('../agentWait', {
  namedExports: { waitUntilStable: async () => {}, waitUntilCondition: async () => true },
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
  namedExports: { TabManager: class { getCurrentPage() { return null; } } },
});

const { getActionGenerationUserPrompt } = await import('../action-generation/actionPrompts.js');
const { maskSensitiveVariables } = await import('../webAgent.js');

const SECRET_VALUE = 'hunter2-SUPER-SECRET-pw';
const PLAIN_VALUE = 'alice@example.com';

const PAGE_CONTEXT: PageContext = {
  elementsText: '[0]<button>Login</button>',
  currentUrl: 'https://example.test/login',
  currentTitle: 'Login',
  currentTabText: 'Tab 0: Login',
  tabsText: '[0] Login',
};

function promptText(
  content: ReturnType<typeof getActionGenerationUserPrompt>,
): string {
  return (content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

function buildPrompt(
  placeholderData: Record<string, unknown>,
  sensitiveKeys: Set<string>,
): string {
  return promptText(
    getActionGenerationUserPrompt(
      PAGE_CONTEXT,
      'log in',
      placeholderData,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      sensitiveKeys,
    ),
  );
}

describe('sensitive value redaction — prompt serialization', () => {
  it('never serializes a sensitive value into the action-generation prompt', () => {
    const text = buildPrompt({ password: SECRET_VALUE, email: PLAIN_VALUE }, new Set(['password']));
    assert.equal(text.includes(SECRET_VALUE), false, 'secret value leaked into the LLM prompt');
    assert.match(text, /password: \[SENSITIVE - value hidden\]/);
  });

  it('still serializes non-sensitive placeholder values (substitution not over-broad)', () => {
    const text = buildPrompt({ password: SECRET_VALUE, email: PLAIN_VALUE }, new Set(['password']));
    assert.ok(text.includes(PLAIN_VALUE), 'non-sensitive value should be visible to the agent');
    assert.ok(text.includes('email'), 'non-sensitive key should be listed');
  });

  it('redacts even when EVERY placeholder is sensitive', () => {
    const text = buildPrompt(
      { password: SECRET_VALUE, token: 'tok-SECRET-123' },
      new Set(['password', 'token']),
    );
    assert.equal(text.includes(SECRET_VALUE), false);
    assert.equal(text.includes('tok-SECRET-123'), false);
  });
});

describe('sensitive value redaction — step logging (maskSensitiveVariables)', () => {
  it('replaces sensitive values with ***** and leaves others intact', () => {
    const masked = maskSensitiveVariables(
      { password: SECRET_VALUE, email: PLAIN_VALUE },
      new Set(['password']),
    );
    assert.equal(masked.password, '*****');
    assert.equal(masked.email, PLAIN_VALUE);
  });

  it('never lets a sensitive value survive anywhere in the masked output', () => {
    const masked = maskSensitiveVariables(
      { a: SECRET_VALUE, b: PLAIN_VALUE, c: 'tok-SECRET-123' },
      new Set(['a', 'c']),
    );
    const serialized = JSON.stringify(masked);
    assert.equal(serialized.includes(SECRET_VALUE), false);
    assert.equal(serialized.includes('tok-SECRET-123'), false);
    assert.ok(serialized.includes(PLAIN_VALUE));
  });

  it('does not mutate the input object', () => {
    const input = { password: SECRET_VALUE };
    maskSensitiveVariables(input, new Set(['password']));
    assert.equal(input.password, SECRET_VALUE);
  });
});
