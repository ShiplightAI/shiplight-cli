/**
 * Regression tests for the "Session timed out" banner spuriously firing
 * during local debug sessions.
 *
 * Background: the local debugger runs on dedicated compute (the user's own
 * machine, or their own testbox VM). Unlike the v1 cloud runner — which
 * shares a browser pool across users and therefore has to reclaim idle
 * sessions — the local runner has nothing to reclaim. The cloud's idle-
 * timeout lifecycle simply doesn't apply.
 *
 * The bug: localIntRunnerApi.getSessionStatus existed and mapped every
 * non-2xx response and every thrown fetch to {status: "timed_out"}. The
 * polling effect in TestFlowEditorController treats "timed_out" as a real
 * timeout — it dispatches debugger:reset-session-completed with
 * showTimeoutBanner: true, ending the session and showing the banner. So
 * any transient HTTP blip (a 502 from the proxy, a brief socket hiccup,
 * one slow synchronous handler in the inner debugger) flipped the local
 * session into "timed out" even though nothing had actually timed out.
 *
 * The fix: localIntRunnerApi simply doesn't expose getSessionStatus. The
 * polling effect in TestFlowEditorController gates on its presence and
 * bails out — no heartbeat, no spurious banner.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { localIntRunnerApi } from './localIntRunner';

type SessionStatusResult = {
  status: 'active' | 'idle_warning' | 'timed_out' | 'error';
  remainingSeconds?: number;
};
type GetSessionStatus = (session: { sessionId: string; searchParams: string }) => Promise<SessionStatusResult>;

describe('local debugger — session-timeout polling', () => {
  describe('fix: localIntRunnerApi must not expose getSessionStatus', () => {
    it('omits getSessionStatus so TestFlowEditorController skips the polling effect', () => {
      // This is the load-bearing assertion. TestFlowEditorController's
      // useEffect at the polling site does
      //   const getStatus = intRunner.getSessionStatus;
      //   if (!getStatus) return;
      // so an absent function disables polling entirely. Re-adding the
      // function on this object re-enables the heartbeat — with it, the
      // banner regression returns the moment any transient blip happens.
      assert.strictEqual(
        (localIntRunnerApi as { getSessionStatus?: unknown }).getSessionStatus,
        undefined,
        'localIntRunnerApi.getSessionStatus must remain undefined to keep the local debugger polling-free',
      );
    });

    it('if anyone reintroduces getSessionStatus, it MUST NOT map transient failures to "timed_out"', async () => {
      // Future-proof guard. If a future change adds getSessionStatus back —
      // perhaps to support some legitimate local heartbeat — this test
      // ensures it can't repeat the original sin of treating a 500 or a
      // thrown fetch as a real timeout. See git history for context.
      const fn = (localIntRunnerApi as { getSessionStatus?: GetSessionStatus }).getSessionStatus;
      if (!fn) return; // current state: undefined — the assertion above guards it

      const session = { sessionId: 'pw-test', searchParams: '' };
      const originalFetch = global.fetch;
      try {
        (global as { fetch: typeof fetch }).fetch = mock.fn(async () => ({
          ok: false,
          status: 500,
          json: async () => ({ status: 'error' }),
        })) as unknown as typeof fetch;
        const r1 = await fn(session);
        assert.notStrictEqual(
          r1.status,
          'timed_out',
          'transient HTTP 5xx must NOT be reported as timed_out',
        );

        (global as { fetch: typeof fetch }).fetch = mock.fn(async () => {
          throw new Error('ECONNRESET');
        }) as unknown as typeof fetch;
        const r2 = await fn(session);
        assert.notStrictEqual(
          r2.status,
          'timed_out',
          'thrown fetch must NOT be reported as timed_out',
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('historical bug repro: pre-fix getSessionStatus mapped transient failures to "timed_out"', () => {
    // Pinned, byte-for-byte reconstruction of the pre-fix
    // localIntRunner.ts getSessionStatus. Lives here as living
    // documentation: anyone reading these tests can see exactly what was
    // wrong, why, and what shape the broken code took.
    const buggyGetSessionStatus: GetSessionStatus = async (session) => {
      try {
        const res = await fetch('/api/int-runner/session-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session }),
        });
        if (!res.ok) return { status: 'timed_out' };
        return res.json();
      } catch {
        return { status: 'timed_out' };
      }
    };

    let originalFetch: typeof fetch;
    beforeEach(() => {
      originalFetch = global.fetch;
    });
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns "timed_out" on HTTP 500 (the bug)', async () => {
      (global as { fetch: typeof fetch }).fetch = mock.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ status: 'error' }),
      })) as unknown as typeof fetch;
      const result = await buggyGetSessionStatus({ sessionId: 'pw-abcd', searchParams: '' });
      assert.strictEqual(
        result.status,
        'timed_out',
        'BUG-WITNESS: a backend hiccup was being mapped to a real timeout, firing the banner',
      );
    });

    it('returns "timed_out" on a thrown fetch (the bug)', async () => {
      (global as { fetch: typeof fetch }).fetch = mock.fn(async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch;
      const result = await buggyGetSessionStatus({ sessionId: 'pw-abcd', searchParams: '' });
      assert.strictEqual(
        result.status,
        'timed_out',
        'BUG-WITNESS: any network blip was being mapped to a real timeout, firing the banner',
      );
    });
  });

  describe('polling-effect contract (mirrors TestFlowEditorController)', () => {
    // Lightweight mirror of the polling decision tree from
    // TestFlowEditorController.tsx so we can assert on the externally
    // observable side effects (reset-event dispatch, banner) without
    // mounting React. Mirrors the source structure 1:1; if you change
    // the controller's polling logic, update this too.
    type Outcome = {
      pollExecuted: boolean;
      resetTriggered: boolean;
      showTimeoutBanner: boolean;
    };
    async function simulatePollOnce(args: {
      hasActiveSession: boolean;
      session: { sessionId: string; searchParams: string } | null;
      getSessionStatus?: GetSessionStatus;
    }): Promise<Outcome> {
      const out: Outcome = { pollExecuted: false, resetTriggered: false, showTimeoutBanner: false };

      if (!args.hasActiveSession) return out;
      const getStatus = args.getSessionStatus;
      if (!getStatus) return out;
      if (!args.session) return out;

      out.pollExecuted = true;
      const result = await getStatus(args.session);
      if (result.status === 'error') return out; // transient — skip
      if (result.status === 'timed_out') {
        out.resetTriggered = true;
        out.showTimeoutBanner = true;
      }
      return out;
    }

    const session = { sessionId: 'pw-test', searchParams: '' };

    it('local shape (no getSessionStatus) → no poll, no reset, no banner', async () => {
      const r = await simulatePollOnce({
        hasActiveSession: true,
        session,
        getSessionStatus: undefined,
      });
      assert.deepStrictEqual(r, {
        pollExecuted: false,
        resetTriggered: false,
        showTimeoutBanner: false,
      });
    });

    it('cloud shape returning "active" → polls but does not fire banner', async () => {
      const r = await simulatePollOnce({
        hasActiveSession: true,
        session,
        getSessionStatus: async () => ({ status: 'active', remainingSeconds: 9999 }),
      });
      assert.strictEqual(r.pollExecuted, true);
      assert.strictEqual(r.showTimeoutBanner, false);
    });

    it('cloud shape returning "error" (transient) → polls but does not fire banner', async () => {
      const r = await simulatePollOnce({
        hasActiveSession: true,
        session,
        getSessionStatus: async () => ({ status: 'error' }),
      });
      assert.strictEqual(r.pollExecuted, true);
      assert.strictEqual(
        r.showTimeoutBanner,
        false,
        'transient errors must be skipped, not surfaced as timeouts',
      );
    });

    it('cloud shape returning "timed_out" → fires banner (intentional cloud behavior)', async () => {
      // Sanity: the polling logic still works for genuine cloud timeouts.
      // This is what the cloud DOES want to surface.
      const r = await simulatePollOnce({
        hasActiveSession: true,
        session,
        getSessionStatus: async () => ({ status: 'timed_out' }),
      });
      assert.strictEqual(r.resetTriggered, true);
      assert.strictEqual(r.showTimeoutBanner, true);
    });

    it('no active session → no poll regardless of getSessionStatus', async () => {
      const r = await simulatePollOnce({
        hasActiveSession: false,
        session,
        getSessionStatus: async () => ({ status: 'active' }),
      });
      assert.strictEqual(r.pollExecuted, false);
    });
  });
});
