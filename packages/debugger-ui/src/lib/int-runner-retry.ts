/**
 * Retry utility for int-runner API operations with exponential backoff
 * Handles network failures and flaky connections with idempotency support
 */

export interface IntRunnerRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any, attemptNumber: number) => boolean;
  onRetry?: (error: any, attemptNumber: number, nextDelayMs: number) => void;
}

const DEFAULT_INT_RUNNER_OPTIONS: Required<IntRunnerRetryOptions> = {
  maxRetries: 5, // More retries for long-running operations
  initialDelayMs: 2000, // Start with 2 seconds
  maxDelayMs: 60000, // Max 1 minute between retries
  backoffMultiplier: 2,
  shouldRetry: (error: any) => {
    // IMPORTANT: For idempotent operations, only retry on network errors
    // where we're not sure if the request reached the server.
    // DO NOT retry on server errors (5xx) as the server may have processed the request.

    // Retry on network errors (TypeError with fetch usually means network failure)
    if (error.name === 'TypeError' && error.message?.toLowerCase().includes('fetch')) {
      return true;
    }

    // Retry on specific network/connection error codes
    if (error.code) {
      const networkErrorCodes = [
        'ECONNRESET',     // Connection reset
        'ETIMEDOUT',      // Connection timed out
        'ENOTFOUND',      // DNS lookup failed
        'ECONNREFUSED',   // Connection refused
        'EPIPE',          // Broken pipe
        'EHOSTUNREACH',   // Host unreachable
        'ENETUNREACH',    // Network unreachable
        'ECONNABORTED',   // Connection aborted
      ];
      if (networkErrorCodes.includes(error.code)) {
        return true;
      }
    }

    // Check for network-related error messages (more flexible matching)
    if (error.message) {
      const message = error.message.toLowerCase();

      // Only retry on clear network/connection failures
      const networkPatterns = [
        /network\s*(error|fail|unreachable)/i,
        /fetch\s*failed/i,
        /connection\s*(reset|refused|abort|timeout)/i,
        /socket\s*(hang\s*up|timeout)/i,
        /econnreset/i,
        /etimedout/i,
        /dns\s*(lookup|fail)/i,
      ];

      if (networkPatterns.some(pattern => pattern.test(message))) {
        return true;
      }
    }

    // Default: don't retry
    return false;
  },
  onRetry: (error, attemptNumber, nextDelayMs) => {
    console.log(`[Int-Runner] Retry attempt ${attemptNumber} after ${nextDelayMs}ms due to:`,
      error.message || error);
  }
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attemptNumber: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  // Exponential backoff
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attemptNumber - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (±25% randomization to prevent thundering herd)
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.round(cappedDelay + jitter);
}

/**
 * Retry wrapper for int-runner fetch operations with idempotency support
 * The idempotency key ensures that retries won't cause duplicate operations
 *
 * @param fetchFn - Function that returns a fetch promise
 * @param options - Retry configuration options
 * @returns The fetch response
 *
 * @example
 * const response = await retryIntRunnerRequest(
 *   () => fetch('/api/int-runner/execute-code', {
 *     method: 'POST',
 *     headers: createIdempotentHeaders(),
 *     body: JSON.stringify(data)
 *   })
 * );
 */
export async function retryIntRunnerRequest<T>(
  fetchFn: () => Promise<T>,
  options: IntRunnerRetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_INT_RUNNER_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      // Attempt the fetch
      const result = await fetchFn();

      // Check if Response object with non-ok status
      if (result && typeof result === 'object' && 'ok' in result && 'status' in result) {
        const response = result as any;
        if (!response.ok && opts.shouldRetry({ status: response.status }, attempt)) {
          throw { status: response.status, message: `HTTP ${response.status}` };
        }
      }

      return result;

    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt > opts.maxRetries || !opts.shouldRetry(error, attempt)) {
        throw error;
      }

      // Calculate delay for next attempt
      const delayMs = calculateDelay(
        attempt,
        opts.initialDelayMs,
        opts.maxDelayMs,
        opts.backoffMultiplier
      );

      // Notify about retry
      opts.onRetry(error, attempt, delayMs);

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // Should never reach here, but just in case
  throw lastError;
}

/**
 * Check if int-runner retry is disabled
 */
export function isIntRunnerRetryDisabled(): boolean {
  return process.env.NEXT_PUBLIC_DISABLE_INT_RUNNER_RETRY === 'true';
}

/**
 * Wrapper that conditionally applies retry logic based on environment
 */
export async function withIntRunnerRetry<T>(
  fetchFn: () => Promise<T>,
  options?: IntRunnerRetryOptions
): Promise<T> {
  // Skip retry if disabled
  if (isIntRunnerRetryDisabled()) {
    return fetchFn();
  }

  return retryIntRunnerRequest(fetchFn, options);
}