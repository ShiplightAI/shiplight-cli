/**
 * Unit tests for the model-fallback classification used by planNextAction:
 * which failures warrant trying the next model in WEB_AGENT_FALLBACK_MODELS.
 *
 * The AI SDK has already applied same-model exponential backoff (honoring
 * Retry-After) before these run, so reaching them means the model is genuinely
 * unavailable. We fall back on availability failures (429/5xx/timeout/network)
 * but NOT on a request the model rejected as malformed (400/422), which fails
 * identically on any backend.
 */

import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { APICallError, NoObjectGeneratedError, RetryError } from 'ai';
import {
  statusCodeOf,
  shouldFallBackToNextModel,
  runWithModelFallback,
  resolveLlmTimeoutMs,
  combineAbortSignals,
  DEFAULT_LLM_TIMEOUT_MS,
} from '../modelFallback';
import sdkConfig, { configureSdk } from '../../../config';

function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://example/llm',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

describe('statusCodeOf', () => {
  it('reads the status off an APICallError', () => {
    assert.strictEqual(statusCodeOf(apiError(429, true)), 429);
  });

  it('unwraps a RetryError to its lastError status', () => {
    const retry = new RetryError({
      message: 'exhausted',
      reason: 'maxRetriesExceeded',
      errors: [apiError(503, true)],
    });
    assert.strictEqual(statusCodeOf(retry), 503);
  });

  it('is undefined for a plain network/timeout error', () => {
    assert.strictEqual(statusCodeOf(new Error('fetch failed')), undefined);
  });
});

describe('shouldFallBackToNextModel', () => {
  it('falls back on 429 (rate limit)', () => {
    assert.strictEqual(shouldFallBackToNextModel(apiError(429, true)), true);
  });

  it('falls back on 5xx', () => {
    assert.strictEqual(shouldFallBackToNextModel(apiError(503, true)), true);
  });

  it('falls back on an exhausted-retry RetryError', () => {
    const retry = new RetryError({
      message: 'exhausted',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429, true)],
    });
    assert.strictEqual(shouldFallBackToNextModel(retry), true);
  });

  it('falls back on a network/timeout error with no status', () => {
    assert.strictEqual(shouldFallBackToNextModel(new Error('terminated')), true);
  });

  it('does NOT fall back on 400 (malformed request — fails identically everywhere)', () => {
    assert.strictEqual(shouldFallBackToNextModel(apiError(400, false)), false);
  });

  it('does NOT fall back on 422', () => {
    assert.strictEqual(shouldFallBackToNextModel(apiError(422, false)), false);
  });
});

describe('runWithModelFallback', () => {
  const PRIMARY = 'google:gemini-3.1-pro-preview';
  const FALLBACK = 'anthropic:claude-sonnet-5';

  it('returns the primary result without trying fallbacks on success', async () => {
    const tried: string[] = [];
    const out = await runWithModelFallback([PRIMARY, FALLBACK], async (m) => {
      tried.push(m);
      return `ok:${m}`;
    });
    assert.strictEqual(out, `ok:${PRIMARY}`);
    assert.deepStrictEqual(tried, [PRIMARY]);
  });

  it('falls over to the next model on a 429 and returns its result', async () => {
    const tried: string[] = [];
    const fellFrom: string[] = [];
    const out = await runWithModelFallback(
      [PRIMARY, FALLBACK],
      async (m) => {
        tried.push(m);
        if (m === PRIMARY) throw apiError(429, true);
        return `ok:${m}`;
      },
      (failed) => fellFrom.push(failed),
    );
    assert.strictEqual(out, `ok:${FALLBACK}`);
    assert.deepStrictEqual(tried, [PRIMARY, FALLBACK]);
    assert.deepStrictEqual(fellFrom, [PRIMARY]);
  });

  it('unwraps an exhausted-retry RetryError (AI_RetryError) and falls over', async () => {
    const retry = new RetryError({
      message: 'Failed after 5 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429, true)],
    });
    const tried: string[] = [];
    const out = await runWithModelFallback([PRIMARY, FALLBACK], async (m) => {
      tried.push(m);
      if (m === PRIMARY) throw retry;
      return `ok:${m}`;
    });
    assert.strictEqual(out, `ok:${FALLBACK}`);
    assert.deepStrictEqual(tried, [PRIMARY, FALLBACK]);
  });

  it('does NOT fall over on a 400 — throws immediately, primary only', async () => {
    const tried: string[] = [];
    await assert.rejects(
      runWithModelFallback([PRIMARY, FALLBACK], async (m) => {
        tried.push(m);
        throw apiError(400, false);
      }),
      /status 400/,
    );
    assert.deepStrictEqual(tried, [PRIMARY]);
  });

  it('does NOT fall over on a NoObjectGeneratedError (schema/no-match), despite no status', async () => {
    const tried: string[] = [];
    const noObj = new NoObjectGeneratedError({ text: '{}', finishReason: 'stop' });
    await assert.rejects(
      runWithModelFallback([PRIMARY, FALLBACK], async (m) => {
        tried.push(m);
        throw noObj;
      }),
      (e) => NoObjectGeneratedError.isInstance(e),
    );
    assert.deepStrictEqual(tried, [PRIMARY]); // a schema failure must not burn the chain
  });

  it('tries every model and throws the last error when all fail with 429', async () => {
    const tried: string[] = [];
    await assert.rejects(
      runWithModelFallback([PRIMARY, FALLBACK], async (m) => {
        tried.push(m);
        throw apiError(429, true);
      }),
      /status 429/,
    );
    assert.deepStrictEqual(tried, [PRIMARY, FALLBACK]);
  });

  it('throws when no models are provided', async () => {
    await assert.rejects(runWithModelFallback([], async () => 'x'), /no models provided/);
  });
});

describe('resolveLlmTimeoutMs', () => {
  afterEach(() => sdkConfig.resetConfig());

  it('returns the default when WEB_AGENT_LLM_TIMEOUT_MS is unset', () => {
    configureSdk({ env: {} });
    assert.strictEqual(resolveLlmTimeoutMs(), DEFAULT_LLM_TIMEOUT_MS);
  });

  it('returns the default when the value is empty', () => {
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: '' } });
    assert.strictEqual(resolveLlmTimeoutMs(), DEFAULT_LLM_TIMEOUT_MS);
  });

  it('returns the default for a non-numeric value', () => {
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: 'soon' } });
    assert.strictEqual(resolveLlmTimeoutMs(), DEFAULT_LLM_TIMEOUT_MS);
  });

  it('returns the default for a negative value', () => {
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: '-5' } });
    assert.strictEqual(resolveLlmTimeoutMs(), DEFAULT_LLM_TIMEOUT_MS);
  });

  it('returns 0 (disabled) when set to 0', () => {
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: '0' } });
    assert.strictEqual(resolveLlmTimeoutMs(), 0);
  });

  it('returns the configured positive value', () => {
    configureSdk({ env: { WEB_AGENT_LLM_TIMEOUT_MS: '30000' } });
    assert.strictEqual(resolveLlmTimeoutMs(), 30000);
  });
});

describe('combineAbortSignals', () => {
  it('returns undefined when neither signal is present', () => {
    assert.strictEqual(combineAbortSignals(undefined, undefined), undefined);
  });

  it('returns the sole signal unchanged (external only)', () => {
    const s = new AbortController().signal;
    assert.strictEqual(combineAbortSignals(s, undefined), s);
  });

  it('returns the sole signal unchanged (timeout only)', () => {
    const s = new AbortController().signal;
    assert.strictEqual(combineAbortSignals(undefined, s), s);
  });

  it('merges two signals so aborting either aborts the combined one', () => {
    const external = new AbortController();
    const timeout = new AbortController();
    const combined = combineAbortSignals(external.signal, timeout.signal)!;
    assert.notStrictEqual(combined, external.signal);
    assert.notStrictEqual(combined, timeout.signal);
    assert.strictEqual(combined.aborted, false);
    timeout.abort();
    assert.strictEqual(combined.aborted, true);
  });
});
