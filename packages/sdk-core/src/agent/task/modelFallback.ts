/**
 * Model-fallback classification for the web agent.
 *
 * Kept in its own dependency-light module (only imports `ai`) so it is unit
 * testable without pulling in the executor's heavy transitive deps (Playwright,
 * DOM services, `?raw` asset imports).
 *
 * The AI SDK applies same-model exponential backoff (honoring Retry-After)
 * inside generateText before throwing, so by the time these run the model is
 * genuinely unavailable.
 */

import { APICallError, RetryError } from 'ai';
import { getSdkConfig } from '../../config';

/**
 * Per-model LLM request timeout (ms). A hung upstream would otherwise block the
 * whole run; bounding each attempt lets the agent fail over to the next model.
 * Override via WEB_AGENT_LLM_TIMEOUT_MS; 0 disables the timeout.
 *
 * Note the worst-case bound: a single planNextAction step can take up to
 * `timeout × chainLength` when every model in the chain hangs, and each model's
 * generateText already includes the AI SDK's own internal retries within that
 * window. In practice the sticky-index carry-forward means only one step per run
 * pays a full chain-walk (later steps start at the last working model), and
 * fallback models are typically on different providers so simultaneous hangs are
 * unlikely — but keep the chain short and the timeout sane.
 */
export const DEFAULT_LLM_TIMEOUT_MS = 150_000;

export function resolveLlmTimeoutMs(): number {
  const raw = getSdkConfig().env?.WEB_AGENT_LLM_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_LLM_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LLM_TIMEOUT_MS;
  return n;
}

/**
 * Combine an optional external (caller) abort signal with an optional per-attempt
 * timeout signal into one. Returns undefined when neither is present, the single
 * signal when only one is, else `AbortSignal.any` of both.
 */
export function combineAbortSignals(
  external: AbortSignal | undefined,
  timeout: AbortSignal | undefined,
): AbortSignal | undefined {
  const signals = [external, timeout].filter((s): s is AbortSignal => Boolean(s));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

/** HTTP status carried by an AI SDK error, if any (unwrapping RetryError). */
export function statusCodeOf(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (RetryError.isInstance(error) && APICallError.isInstance(error.lastError)) {
    return error.lastError.statusCode;
  }
  return undefined;
}

/**
 * Whether a failure on the current model warrants trying the next model in the
 * chain. This is a denylist, not an allowlist: we fall back on *every* error
 * EXCEPT a request the model rejected as malformed (400 / 422), which fails
 * identically on every backend. That deliberately includes not just the
 * availability failures the fallback exists for — rate limits, 5xx, timeouts,
 * connection drops, exhausted retries — but also auth/permission/not-found
 * (401 / 403 / 404), where routing to a different provider that may hold valid
 * credentials or host the model is the desired behavior. External aborts are
 * handled by the caller before this.
 */
export function shouldFallBackToNextModel(error: unknown): boolean {
  const status = statusCodeOf(error);
  if (status === 400 || status === 422) return false;
  return true;
}

/**
 * Run `run` against each model in `models` (order = [primary, ...fallbacks]),
 * failing over to the next on an availability error and returning the first
 * success. Throws the final error once the chain is exhausted, or immediately on
 * an error that {@link shouldFallBackToNextModel} rejects (400/422).
 *
 * A `NoObjectGeneratedError` (structured-output/no-match) is treated as terminal
 * here even though it carries no HTTP status: it fails identically on every
 * backend and is handled by the caller's own recovery path (see
 * elementBased.generateAction), so spending the chain on it would waste calls and
 * mask the real cause. It is detected by name rather than an imported class so
 * this module's `ai` surface stays minimal (test `ai` mocks needn't stub it).
 *
 * This shares the {@link shouldFallBackToNextModel} policy the task executor
 * applies per step, but is a deliberately SIMPLER, STATELESS variant for the
 * single-shot action-generation and assertion paths (which the executor loop does
 * NOT wrap). It intentionally omits three things the executor's inline loop has,
 * because the current callers don't need them and adding unused machinery would
 * be dead weight:
 *   - Sticky-index carry-forward: each call restarts at the caller's chain[0], so
 *     during a sustained primary outage a down primary is re-probed per step.
 *     Callers wanting stickiness should order `models` accordingly (e.g. put the
 *     last-known-good model first).
 *   - Per-attempt timeout: a hung upstream that never throws won't fail over here.
 *   - External-abort short-circuit: none of the current callers thread an
 *     `abortSignal` into `run`; if one ever does, an abort surfacing as a
 *     fallback-eligible error would (incorrectly) walk the chain — add an abort
 *     guard at that point.
 * The executor keeps its own loop (with all three) rather than consuming this.
 */
export async function runWithModelFallback<T>(
  models: readonly string[],
  run: (modelId: string) => Promise<T>,
  onFallback?: (failedModel: string, nextModel: string, error: unknown) => void,
): Promise<T> {
  if (models.length === 0) {
    throw new Error('runWithModelFallback: no models provided');
  }
  let lastError: unknown;
  for (let i = 0; i < models.length; i++) {
    const modelId = models[i]!;
    try {
      return await run(modelId);
    } catch (error) {
      lastError = error;
      const isLast = i === models.length - 1;
      if (isLast || isStructuredOutputError(error) || !shouldFallBackToNextModel(error)) {
        throw error;
      }
      onFallback?.(modelId, models[i + 1]!, error);
    }
  }
  // Unreachable: the final iteration always returns or throws.
  throw lastError;
}

/**
 * AI SDK `NoObjectGeneratedError` (schema validation / no-match on structured
 * output). Matched by its stable `name` to avoid importing the class.
 */
function isStructuredOutputError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AI_NoObjectGeneratedError';
}
