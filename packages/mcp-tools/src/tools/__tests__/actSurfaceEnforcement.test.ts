/**
 * act executes only what it advertises.
 *
 * The act tool DEFINITION is generated from ACT_SUPPORTED_ACTIONS (deterministic
 * DOM/navigation actions). Its runtime input schema is deliberately loose —
 * `actions: z.array(z.record(z.any()))` — because action parameter shapes vary
 * per action. Those two disagreed: any name in the sdk-core registry executed,
 * advertised or not.
 *
 * That is how the AI-driven actions stayed reachable on this browser-only
 * server, which wires no LLM model: `act(verify)` dispatched, hit
 * AgentServices.getModel(), and failed with "No LLM model configured" —
 * telling users to set an API key that would not have helped, because verify is
 * not part of this server's surface at all.
 *
 * These are negative tests: each asserts a call is REFUSED. Without the
 * allowlist check in actHandler they all fail, because the action reaches the
 * backend instead.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { actHandler } from '../browserTools.js';
import { ACT_SUPPORTED_ACTIONS } from '../../backends/sessionTypes.js';
import type { SessionManager } from '../../backends/SessionManager.js';

/**
 * Backend stub that records whether dispatch was ever reached.
 *
 * Typed as a Pick of the real SessionManager rather than a bare `as never`, so
 * renaming or re-arging getSession/act fails typecheck here instead of silently
 * passing. That failure mode is not hypothetical: the bug this file guards was
 * itself caused by a constructor losing a parameter while call sites kept
 * passing the old argument list.
 */
function fakeBackend() {
  const dispatched: unknown[][] = [];
  const stub: Pick<SessionManager, 'getSession' | 'act'> = {
    getSession: () => ({ id: 'sess-1' }) as never,
    act: async (_sessionId, actions) => {
      dispatched.push(actions as unknown[]);
      return { success: true, duration_ms: 1, results: [] } as never;
    },
  };
  return { dispatched, backend: stub as SessionManager };
}

describe('act enforces the advertised action surface', () => {
  for (const name of ['verify', 'ai_extract', 'ai_wait_until', 'login']) {
    it(`refuses the AI-driven action "${name}" without dispatching it`, async () => {
      const { backend, dispatched } = fakeBackend();

      await assert.rejects(
        () => actHandler(backend, { session_id: 'sess-1', actions: [{ [name]: { description: 'x' } }] }),
        (err: Error) => {
          assert.match(err.message, new RegExp(`Unsupported act action\\(s\\): ${name}`));
          assert.match(err.message, /deterministic browser actions only/);
          return true;
        },
      );

      assert.deepEqual(dispatched, [], 'an unsupported action must never reach the backend');
    });
  }

  it('rejects the whole batch before running any of it', async () => {
    const { backend, dispatched } = fakeBackend();

    // A valid action first, an unsupported one second: the valid one must not
    // execute, or a malformed request leaves the page half-acted-on.
    await assert.rejects(() =>
      actHandler(backend, {
        session_id: 'sess-1',
        actions: [{ click: { element_index: 1 } }, { verify: { statement: 'x' } }],
      }),
    );

    assert.deepEqual(dispatched, [], 'no action may run when any action in the batch is unsupported');
  });

  it('names every distinct unsupported action once', async () => {
    const { backend } = fakeBackend();

    await assert.rejects(
      () =>
        actHandler(backend, {
          session_id: 'sess-1',
          actions: [{ verify: {} }, { ai_extract: {} }, { verify: {} }],
        }),
      (err: Error) => {
        const listed = /Unsupported act action\(s\): ([^.]+)\./.exec(err.message)?.[1];
        assert.equal(listed, 'verify, ai_extract', 'duplicates should collapse, order preserved');
        return true;
      },
    );
  });

  it('refuses an action object with no action name', async () => {
    // {} has no key to check. Without an explicit reject it slips past the
    // allowlist and reaches the registry as `undefined`, failing with
    // "Tool not found" — which reads like a missing feature rather than a
    // malformed request.
    const { backend, dispatched } = fakeBackend();

    await assert.rejects(
      () => actHandler(backend, { session_id: 'sess-1', actions: [{}] }),
      (err: Error) => {
        assert.match(err.message, /exactly one action name as its key/);
        return true;
      },
    );

    assert.deepEqual(dispatched, [], 'a nameless action must never reach the backend');
  });

  it('still dispatches every advertised action', async () => {
    const { backend, dispatched } = fakeBackend();

    // Guards the inverse failure: an over-strict check that breaks the real
    // surface. Every advertised name must pass through untouched.
    const actions = ACT_SUPPORTED_ACTIONS.map((name) => ({ [name]: {} }));
    const result = await actHandler(backend, { session_id: 'sess-1', actions });

    assert.equal(result.success, true);
    assert.equal(dispatched.length, 1, 'the batch should reach the backend exactly once');
    assert.equal(
      (dispatched[0] as unknown[]).length,
      ACT_SUPPORTED_ACTIONS.length,
      'every advertised action must survive the check',
    );
  });
});
