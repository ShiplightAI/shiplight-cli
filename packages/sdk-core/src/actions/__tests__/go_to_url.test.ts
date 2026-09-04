/**
 * Unit tests for go_to_url action – configurable timeout
 */

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import { GoToUrlAction, GoToUrlToolSchema } from '../impl/go_to_url';
import { ActionHelper } from '../actionHelper';
import { ActionEntity } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPage(opts?: { recordCalls?: boolean }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const page: any = {
    goto: mock.fn(async (...args: unknown[]) => { calls.push({ method: 'goto', args }); }),
    context: () => ({
      newPage: async () => page, // returns itself for simplicity
    }),
  };
  return { page, calls };
}

function makeMockAgentServices() {
  return {
    replaceVariables: (s: string) => s,
    setPage: () => {},
  } as any;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('GoToUrlToolSchema', () => {
  it('should accept url only', () => {
    const result = GoToUrlToolSchema.safeParse({ url: 'https://example.com' });
    assert.strictEqual(result.success, true);
  });

  it('should accept url with timeout_seconds', () => {
    const result = GoToUrlToolSchema.safeParse({ url: 'https://example.com', timeout_seconds: 10 });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.timeout_seconds, 10);
    }
  });

  it('should reject non-positive timeout_seconds', () => {
    const result = GoToUrlToolSchema.safeParse({ url: 'https://example.com', timeout_seconds: 0 });
    assert.strictEqual(result.success, false);
  });

  it('should reject negative timeout_seconds', () => {
    const result = GoToUrlToolSchema.safeParse({ url: 'https://example.com', timeout_seconds: -5 });
    assert.strictEqual(result.success, false);
  });

  it('should allow omitting timeout_seconds', () => {
    const result = GoToUrlToolSchema.safeParse({ url: 'https://example.com' });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.timeout_seconds, undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// GoToUrlAction.execute – timeout behaviour
// ---------------------------------------------------------------------------

describe('GoToUrlAction.execute', () => {
  const action = new GoToUrlAction();

  it('should use default GOTO_TIMEOUT (20000ms) when no timeout_seconds', async () => {
    const { page, calls } = makeMockPage();
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: 'https://example.com' } },
    };

    await action.execute(page, entity, makeMockAgentServices());

    const gotoCall = calls.find(c => c.method === 'goto');
    assert(gotoCall, 'goto should have been called');
    assert.deepStrictEqual((gotoCall.args[1] as any).timeout, 20000);
  });

  it('should use custom timeout when timeout_seconds is provided', async () => {
    const { page, calls } = makeMockPage();
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: 'https://example.com', timeout_seconds: 10 } },
    };

    await action.execute(page, entity, makeMockAgentServices());

    const gotoCall = calls.find(c => c.method === 'goto');
    assert(gotoCall, 'goto should have been called');
    assert.deepStrictEqual((gotoCall.args[1] as any).timeout, 10000);
  });

  it('should use custom timeout of 60 seconds', async () => {
    const { page, calls } = makeMockPage();
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: 'https://slow-site.com', timeout_seconds: 60 } },
    };

    await action.execute(page, entity, makeMockAgentServices());

    const gotoCall = calls.find(c => c.method === 'goto');
    assert.deepStrictEqual((gotoCall!.args[1] as any).timeout, 60000);
  });
});

// ---------------------------------------------------------------------------
// GoToUrlAction.execute – relative URL resolution
// ---------------------------------------------------------------------------

describe('GoToUrlAction.execute – relative URLs', () => {
  const action = new GoToUrlAction();

  it('should resolve relative URL against current page origin', async () => {
    const { page, calls } = makeMockPage();
    page.url = () => 'https://www.example.com/some/page';
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: '/inventory.html' } },
    };

    await action.execute(page, entity, makeMockAgentServices());

    const gotoCall = calls.find(c => c.method === 'goto');
    assert(gotoCall, 'goto should have been called');
    assert.strictEqual(gotoCall.args[0], 'https://www.example.com/inventory.html');
  });

  it('should not prepend "null" when page is about:blank', async () => {
    const { page, calls } = makeMockPage();
    page.url = () => 'about:blank';
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: '/inventory.html' } },
    };

    await action.execute(page, entity, makeMockAgentServices());

    const gotoCall = calls.find(c => c.method === 'goto');
    assert(gotoCall, 'goto should have been called');
    // Should remain relative, NOT "null/inventory.html"
    assert.strictEqual(gotoCall.args[0], '/inventory.html');
  });

  it('should pass absolute URLs through unchanged', async () => {
    const { page, calls } = makeMockPage();
    page.url = () => 'about:blank';
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: 'https://example.com/path' } },
    };

    await action.execute(page, entity, makeMockAgentServices());

    const gotoCall = calls.find(c => c.method === 'goto');
    assert(gotoCall, 'goto should have been called');
    assert.strictEqual(gotoCall.args[0], 'https://example.com/path');
  });
});

// ---------------------------------------------------------------------------
// GoToUrlAction.transpile – code generation
// ---------------------------------------------------------------------------

describe('GoToUrlAction.transpile', () => {
  const action = new GoToUrlAction();

  it('should not include timeout_seconds when not provided', () => {
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: 'https://example.com' } },
    };

    const lines = action.transpile(entity);
    const code = lines.join('\n');
    assert(!code.includes('timeout_seconds'), 'should not contain timeout_seconds');
    assert(code.includes('"https://example.com"'), 'should contain the url');
  });

  it('should include timeout_seconds when provided', () => {
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: 'https://example.com', timeout_seconds: 10 } },
    };

    const lines = action.transpile(entity);
    const code = lines.join('\n');
    assert(code.includes('timeout_seconds: 10'), 'should contain timeout_seconds: 10');
  });

  it('should include both new_tab and timeout_seconds when both provided', () => {
    const entity: ActionEntity = {
      action_description: 'Navigate',
      action_data: { action_name: 'go_to_url', kwargs: { url: 'https://example.com', new_tab: true, timeout_seconds: 30 } },
    };

    const lines = action.transpile(entity);
    const code = lines.join('\n');
    assert(code.includes('new_tab: true'), 'should contain new_tab: true');
    assert(code.includes('timeout_seconds: 30'), 'should contain timeout_seconds: 30');
  });
});

describe('go_to_url self-healing classification', () => {
  const entity: ActionEntity = {
    action_description: 'Navigate to an invalid URL',
    action_data: { action_name: 'go_to_url', kwargs: { url: 'http://[::1' } },
  };

  it('classifies go_to_url as non-self-healable', () => {
    assert.strictEqual(ActionHelper.canSelfHeal(entity), false);
  });
});
