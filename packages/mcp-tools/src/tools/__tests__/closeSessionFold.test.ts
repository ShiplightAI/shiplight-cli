/**
 * close_session folds in the former close_all tool: calling it without a
 * session_id (omitted entirely) closes ALL open sessions instead of one.
 * A concrete session_id still closes just that session. A provided-but-empty
 * session_id is rejected — it never silently mass-closes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionTools } from '../sessionTools.js';

function fakeBackend() {
  const calls: string[] = [];
  return {
    calls,
    backend: {
      getSessionCount: () => 3,
      closeAllSessions: async () => {
        calls.push('closeAll');
      },
      closeSession: async (id: string) => {
        calls.push(`close:${id}`);
        return {};
      },
    } as never,
  };
}

describe('close_session folds in close_all', () => {
  it('closes all sessions when session_id is omitted', async () => {
    const { backend, calls } = fakeBackend();
    const tools = new SessionTools(backend);

    const out = await tools.closeSession({});

    assert.deepEqual(calls, ['closeAll']);
    assert.match(out, /Closed 3 session\(s\)/);
  });

  it('closes all sessions when session_id is null (LLM "absent" shape)', async () => {
    const { backend, calls } = fakeBackend();
    const tools = new SessionTools(backend);

    await tools.closeSession({ session_id: null });

    assert.deepEqual(calls, ['closeAll']);
  });

  it('rejects a provided-but-empty session_id instead of mass-closing', async () => {
    const { backend, calls } = fakeBackend();
    const tools = new SessionTools(backend);

    await assert.rejects(
      () => tools.closeSession({ session_id: '' }),
      /session_id was empty/
    );
    await assert.rejects(
      () => tools.closeSession({ session_id: '   ' }),
      /session_id was empty/
    );
    // Crucially: neither closeAll nor a single close fired.
    assert.deepEqual(calls, []);
  });

  it('closes only the named session when session_id is provided', async () => {
    const { backend, calls } = fakeBackend();
    const tools = new SessionTools(backend);

    await tools.closeSession({ session_id: 'sess-1' });

    assert.deepEqual(calls, ['close:sess-1']);
  });
});
