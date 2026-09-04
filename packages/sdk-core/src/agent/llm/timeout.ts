/**
 * Wall-clock ceiling for a single LLM call.
 *
 * The AI SDK retries internally, so one `generateText` call can span several
 * attempts plus exponential backoff. Nothing bounded that total: a call once
 * ran 25m31s across 5 attempts against a gateway returning 504s before failing
 * with `AI_RetryError`, which turned a 12-minute CI gate into a 39-minute
 * failure whose cause was invisible until someone read the raw log.
 *
 * `abortSignal` is applied at the call level rather than as a transport
 * timeout on purpose. The gateway *was* responding — with 504s, slowly — so
 * every individual HTTP request completed. Only a ceiling over the whole
 * retry sequence catches that shape of failure.
 *
 * The consequence is that the AI SDK's retries draw from the same budget, so
 * the ceiling has to be several times a single healthy generation rather than
 * a tight bound on one request. See DEFAULT_LLM_CALL_TIMEOUT_MS for the
 * sizing.
 */
import { getSdkConfig, DEFAULT_LLM_CALL_TIMEOUT_MS } from '../../config';

/**
 * Retries the AI SDK performs inside one call, i.e. 3 attempts total.
 *
 * Deliberately equal to the AI SDK's own default, so the sites that do not set
 * it explicitly get the same budget. action-generation previously used 4 (5
 * attempts); combined with slow 504s that is what let one call reach 25m31s.
 *
 * Attempts and the wall-clock ceiling draw from the same budget — at
 * DEFAULT_LLM_CALL_TIMEOUT_MS a fully-retried call gets roughly a third of the
 * ceiling per attempt — so these two values are set together on purpose.
 */
export const LLM_MAX_RETRIES = 2;

/** Marker so callers can distinguish "we gave up" from a provider error. */
export class LlmCallTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `LLM call exceeded the ${Math.round(timeoutMs / 1000)}s ceiling (SdkConfig.llmCallTimeoutMs). ` +
        'This bounds the whole call including the AI SDK\'s internal retries and backoff, so the ' +
        'provider was most likely slow or degraded rather than the request being malformed. ' +
        'Raise llmCallTimeoutMs for genuinely long generations, or set it to 0 to disable the ceiling.',
    );
    this.name = 'LlmCallTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** The configured ceiling, or 0 when disabled. */
export function getLlmCallTimeoutMs(): number {
  const configured = getSdkConfig().llmCallTimeoutMs;
  // `undefined` means "not set" and falls back to the default; 0 means "off".
  return configured === undefined ? DEFAULT_LLM_CALL_TIMEOUT_MS : configured;
}

/**
 * An AbortSignal that fires once the ceiling elapses, or `undefined` when the
 * ceiling is disabled — `undefined` is what the AI SDK expects for "no signal",
 * so callers can spread this unconditionally.
 */
export function llmAbortSignal(): AbortSignal | undefined {
  const timeoutMs = getLlmCallTimeoutMs();
  if (timeoutMs <= 0) return undefined;
  return AbortSignal.timeout(timeoutMs);
}

/**
 * Runs an LLM call under the ceiling and rewrites the resulting abort into
 * `LlmCallTimeoutError`.
 *
 * The AI SDK surfaces an aborted call as a bare `AbortError`/`TimeoutError`,
 * which reads like a bug in our code rather than a provider that ran long.
 * Callers that only need the signal can use `llmAbortSignal()` directly.
 */
export async function withLlmTimeout<T>(run: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
  const timeoutMs = getLlmCallTimeoutMs();
  const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;

  try {
    return await run(signal);
  } catch (error) {
    if (signal?.aborted && isAbortLike(error)) {
      throw new LlmCallTimeoutError(timeoutMs);
    }
    throw error;
  }
}

/**
 * `AbortSignal.timeout` rejects with a DOMException named `TimeoutError`, but
 * the AI SDK may wrap or re-emit it, so match on shape rather than identity.
 */
function isAbortLike(error: unknown, seen = new Set<unknown>()): boolean {
  if (typeof error !== 'object' || error === null) return false;
  // A cause chain can cycle (A.cause = B, B.cause = A); walking it unguarded
  // would recurse until the stack blew, turning a provider error into a crash.
  if (seen.has(error)) return false;
  seen.add(error);

  const name = (error as { name?: unknown }).name;
  if (name === 'TimeoutError' || name === 'AbortError') return true;

  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && isAbortLike(cause, seen);
}
