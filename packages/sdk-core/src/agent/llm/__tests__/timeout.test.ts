/**
 * Guards the wall-clock ceiling on a single LLM call.
 *
 * The failure this exists to prevent: one generateText call ran 25m31s across
 * 5 attempts against a gateway returning 504s, then failed with AI_RetryError.
 * Nothing bounded the total, and the eventual error said nothing useful about
 * why CI had been stuck for 39 minutes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { configureSdk, getSdkConfig, DEFAULT_LLM_CALL_TIMEOUT_MS } from '../../../config';
import { getLlmCallTimeoutMs, llmAbortSignal, withLlmTimeout, LlmCallTimeoutError, LLM_MAX_RETRIES } from '../timeout';

function withConfig<T>(timeoutMs: number | undefined, run: () => T): T {
  const previous = getSdkConfig().llmCallTimeoutMs;
  configureSdk({ llmCallTimeoutMs: timeoutMs });
  try {
    return run();
  } finally {
    configureSdk({ llmCallTimeoutMs: previous });
  }
}

test('a ceiling is applied by default', () => {
  assert.equal(getSdkConfig().llmCallTimeoutMs, DEFAULT_LLM_CALL_TIMEOUT_MS);
  assert.ok(getLlmCallTimeoutMs() > 0, 'an unconfigured SDK must still bound LLM calls');
  assert.ok(llmAbortSignal() instanceof AbortSignal);
});

test('the ceiling is configurable and 0 disables it', () => {
  withConfig(5_000, () => {
    assert.equal(getLlmCallTimeoutMs(), 5_000);
    assert.ok(llmAbortSignal() instanceof AbortSignal);
  });

  // 0 means "no ceiling" and must yield undefined — the AI SDK's shape for
  // "no signal" — so call sites can spread it unconditionally.
  withConfig(0, () => {
    assert.equal(getLlmCallTimeoutMs(), 0);
    assert.equal(llmAbortSignal(), undefined);
  });
});

test('undefined falls back to the default rather than disabling the ceiling', () => {
  // The distinction matters: `undefined` is "not configured", `0` is "off".
  // Conflating them would silently remove the bound for anyone passing a
  // partial config.
  withConfig(undefined, () => {
    assert.equal(getLlmCallTimeoutMs(), DEFAULT_LLM_CALL_TIMEOUT_MS);
  });
});

test('a call that outlives the ceiling fails as LlmCallTimeoutError', async () => {
  await withConfig(50, async () => {
    const started = Date.now();
    await assert.rejects(
      withLlmTimeout(
        (signal) =>
          new Promise((_resolve, reject) => {
            // Stand-in for a provider that never answers.
            signal?.addEventListener('abort', () => reject(signal.reason));
          }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof LlmCallTimeoutError, `expected LlmCallTimeoutError, got ${String(error)}`);
        assert.equal(error.timeoutMs, 50);
        // The message must say what to do, not just that time passed.
        assert.match(error.message, /llmCallTimeoutMs/);
        return true;
      },
    );
    assert.ok(Date.now() - started < 5_000, 'must fail at the ceiling, not hang');
  });
});

test('a provider error is passed through untouched, not relabelled as a timeout', async () => {
  await withConfig(10_000, async () => {
    const providerError = Object.assign(new Error('Gateway Timeout'), { name: 'AI_APICallError' });
    await assert.rejects(
      withLlmTimeout(async () => {
        throw providerError;
      }),
      (error: unknown) => {
        assert.equal(error, providerError, 'a real provider failure must not be reported as our ceiling');
        return true;
      },
    );
  });
});

test('a fast call is unaffected', async () => {
  await withConfig(10_000, async () => {
    assert.equal(await withLlmTimeout(async () => 'ok'), 'ok');
  });
});

test('with the ceiling disabled no signal is passed to the call', async () => {
  await withConfig(0, async () => {
    assert.equal(await withLlmTimeout(async (signal) => signal), undefined);
  });
});

test('the retry budget leaves each attempt a workable share of the ceiling', () => {
  // Attempts and the ceiling share one budget: a fully-retried call divides
  // the ceiling across LLM_MAX_RETRIES + 1 attempts. The slowest agent
  // statement observed in CI was ~98s end to end (page work included), so a
  // per-attempt share below that would abort healthy work on one transient
  // retry — which is what a 3-minute ceiling would have done.
  const attempts = LLM_MAX_RETRIES + 1;
  assert.equal(attempts, 3, 'three attempts is the agreed budget');

  const perAttemptMs = DEFAULT_LLM_CALL_TIMEOUT_MS / attempts;
  assert.ok(
    perAttemptMs >= 98_000,
    `each attempt gets ${Math.round(perAttemptMs / 1000)}s, below the ~98s slowest observed statement`,
  );
});

test('a cause cycle does not blow the stack', () => {
  // A.cause = B, B.cause = A. The walk must terminate rather than recurse
  // until the stack overflows and turns a provider error into a crash.
  const a = new Error('a') as Error & { cause?: unknown };
  const b = new Error('b') as Error & { cause?: unknown };
  a.cause = b;
  b.cause = a;

  // Reached via withLlmTimeout's catch, so exercise it the way production does.
  assert.doesNotThrow(() => {
    void withLlmTimeout(async () => {
      throw a;
    }).catch(() => undefined);
  });
});
