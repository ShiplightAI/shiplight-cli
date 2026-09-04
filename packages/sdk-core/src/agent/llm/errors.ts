/**
 * Errors shared by the LLM provider resolvers.
 */

/**
 * No usable credentials for the requested provider — no direct API key and no
 * Shiplight token.
 *
 * A distinct class rather than a plain Error because callers need to tell "the
 * AI subsystem was never configured" apart from "the AI tried and failed".
 * Self-healing depends on that distinction: an unconfigured provider surfacing
 * as an ordinary failure is what let an LLM-client setting masquerade as a test
 * failure in issue #2209. Matching on message text is fragile — each provider
 * words its own message differently — so the type carries the meaning.
 */
export class LLMProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMProviderNotConfiguredError';
  }
}
