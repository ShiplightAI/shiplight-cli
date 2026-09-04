/**
 * Shiplight LLM Proxy Resolver
 *
 * Picks the proxy base URL given a Shiplight token, then builds per-provider
 * baseURLs that match each Vercel AI SDK provider's expected path layout.
 *
 * Token routing (used to pick the API base host):
 *   - shp_*  → Shiplight API (https://api.shiplight.ai)
 *     Covers every v2 token shape:
 *       - shp_pat_*: personal access tokens created at /account/tokens
 *         (must carry the `llm:invoke` scope, or full-inherit).
 *       - shp_ctx_*: scoped runtime credentials minted by the LLM proxy
 *         for sandboxed contexts (CI runs, testbox sessions).
 *     Scope, billing, and credit enforcement happen server-side; the CLI
 *     does not pre-validate. The shared `shp_` prefix is deliberate — any
 *     future v2 token shape lands on the same host automatically.
 *     Public client guide: the LLM proxy API guide
 *   - else → unsupported. The v1 cloud was decommissioned in August 2026;
 *     a legacy UUID token now fails with an actionable message. Strict subset
 *     of the v2 surface — no idempotency, no credit accounting, no
 *     problem+json errors.
 *   - SHIPLIGHT_API_URL env override wins over both. Same env var as the
 *     other Shiplight HTTP clients (action-cache, run-upload) — one knob
 *     points the whole CLI at a different host.
 *
 * The LLM proxy is mounted at `/llm/*` on whichever base; per-provider
 * suffix matches each Vercel AI SDK's default URL shape so the upstream
 * proxy serves identical paths to the providers' own APIs:
 *   - OpenAI    → `${base}/llm/v1`     (SDK appends /chat/completions etc.)
 *   - Anthropic → `${base}/llm/v1`     (SDK appends /messages)
 *   - Google    → `${base}/llm/v1beta` (SDK appends /models/<id>:<op>)
 *
 * Note: the official `@anthropic-ai/sdk` (NOT @ai-sdk/anthropic) wants
 * baseURL without the /v1 suffix because it appends /v1/messages itself.
 * This module is for sdk-core, which uses Vercel's @ai-sdk/anthropic — the
 * /v1 suffix is correct here.
 */

export { resolveApiBase, isV2Token } from '../../utils/resolveApiBase';

import { resolveApiBase, UNSUPPORTED_TOKEN_MESSAGE } from '../../utils/resolveApiBase';

/**
 * Resolve the proxy base or fail with an actionable message. An LLM call has
 * no degrade path — without a host there is nothing to call — so an
 * unsupported token must surface here rather than produce a request to a
 * host named "null".
 */
function requireApiBase(token: string, override?: string): string {
	const base = resolveApiBase(token, override);
	if (base === null) throw new Error(UNSUPPORTED_TOKEN_MESSAGE);
	return base;
}

export function getOpenAIProxyBaseURL(token: string, override?: string): string {
	return `${requireApiBase(token, override)}/llm/v1`;
}

export function getAnthropicProxyBaseURL(token: string, override?: string): string {
	return `${requireApiBase(token, override)}/llm/v1`;
}

export function getGoogleProxyBaseURL(token: string, override?: string): string {
	return `${requireApiBase(token, override)}/llm/v1beta`;
}

/**
 * Base URL for @google/genai (GoogleGenAI) clients — the SDK appends /v1beta
 * itself, so we stop at /llm (unlike getGoogleProxyBaseURL which is for the
 * Vercel AI SDK's createGoogleGenerativeAI that does not append /v1beta).
 */
export function getGoogleGenAIProxyBaseURL(token: string, override?: string): string {
	return `${requireApiBase(token, override)}/llm`;
}
