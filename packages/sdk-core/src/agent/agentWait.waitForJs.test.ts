/**
 * Unit tests for agentWait.waitForJs — the in-process JS polling helper used by
 * `WAIT_UNTIL: "js:..."`. Uses a fake Page whose waitForTimeout really sleeps,
 * so the timeout path advances real wall-clock time without mocking Date.now.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForJs, formatJsWaitOutcome, JsWaitResult } from './agentWait';

interface FakePage {
  waitForTimeout: (ms: number) => Promise<void>;
  _sleeps: number[];
}

function fakePage(): FakePage {
  const sleeps: number[] = [];
  return {
    waitForTimeout: async (ms: number) => {
      sleeps.push(ms);
      await new Promise((r) => setTimeout(r, ms));
    },
    _sleeps: sleeps,
  };
}

describe('agentWait.waitForJs', () => {
  it('resolves met immediately when the predicate is already truthy (no sleep)', async () => {
    const page = fakePage();
    let calls = 0;
    const result = await waitForJs(page as never, () => {
      calls++;
      return true;
    }, 30);
    assert.equal(result.met, true);
    assert.equal(calls, 1);
    assert.equal(result.evalCount, 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.lastError, undefined);
    assert.equal(page._sleeps.length, 0);
  });

  it('polls until the predicate becomes truthy', async () => {
    const page = fakePage();
    let n = 0;
    const result = await waitForJs(page as never, () => {
      n++;
      return n >= 3;
    }, 30);
    assert.equal(result.met, true);
    assert.equal(n, 3);
    assert.equal(result.evalCount, 3);
    assert.equal(page._sleeps.length, 2); // slept between the 3 checks
  });

  it('awaits an async predicate', async () => {
    const page = fakePage();
    const result = await waitForJs(page as never, async () => Promise.resolve(1 < 2), 30);
    assert.equal(result.met, true);
  });

  it('resolves not-met on timeout with clean evaluation counts', async () => {
    const page = fakePage();
    const result = await waitForJs(page as never, () => false, 0.01);
    assert.equal(result.met, false);
    assert.ok(result.evalCount >= 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.lastError, undefined);
    assert.ok(result.elapsedMs >= 0);
  });

  it('swallows a throwing predicate, keeps polling, and counts the errors', async () => {
    const page = fakePage();
    let n = 0;
    const result = await waitForJs(page as never, () => {
      n++;
      if (n < 2) throw new Error('transient');
      return true;
    }, 30);
    assert.equal(result.met, true);
    assert.equal(n, 2);
    assert.equal(result.evalCount, 2);
    assert.equal(result.errorCount, 1);
    assert.equal(result.lastError, 'transient');
  });

  it('reports a predicate that never evaluates cleanly (all polls errored)', async () => {
    const page = fakePage();
    const result = await waitForJs(page as never, () => {
      throw new ReferenceError('document is not defined');
    }, 0.01);
    assert.equal(result.met, false);
    assert.ok(result.evalCount >= 1);
    assert.equal(result.errorCount, result.evalCount);
    assert.equal(result.lastError, 'document is not defined');
  });
});

describe('agentWait.formatJsWaitOutcome', () => {
  it('describes a met condition with elapsed time and evaluation count', () => {
    const result: JsWaitResult = { met: true, evalCount: 13, errorCount: 0, elapsedMs: 3200 };
    assert.equal(formatJsWaitOutcome(result), 'Condition met after 3.2s (13 evaluations)');
  });

  it('uses singular wording for a single evaluation', () => {
    const result: JsWaitResult = { met: true, evalCount: 1, errorCount: 0, elapsedMs: 100 };
    assert.equal(formatJsWaitOutcome(result), 'Condition met after 0.1s (1 evaluation)');
  });

  it('describes a clean timeout as not met, continuing', () => {
    const result: JsWaitResult = { met: false, evalCount: 238, errorCount: 0, elapsedMs: 60000 };
    assert.equal(
      formatJsWaitOutcome(result),
      'Condition not met within 60.0s (evaluated 238 times) — continuing',
    );
  });

  it('mentions partial errors on a mixed timeout', () => {
    const result: JsWaitResult = {
      met: false,
      evalCount: 100,
      errorCount: 12,
      lastError: 'context destroyed',
      elapsedMs: 30000,
    };
    assert.equal(
      formatJsWaitOutcome(result),
      'Condition not met within 30.0s (evaluated 100 times, 12 errored) — continuing',
    );
  });

  it('flags a never-evaluated predicate as a likely-invalid expression', () => {
    const result: JsWaitResult = {
      met: false,
      evalCount: 240,
      errorCount: 240,
      lastError: 'document is not defined',
      elapsedMs: 60000,
    };
    const message = formatJsWaitOutcome(result);
    assert.ok(message.includes('never evaluated successfully'), message);
    assert.ok(message.includes('document is not defined'), message);
    assert.ok(message.includes('continuing'), message);
  });
});
