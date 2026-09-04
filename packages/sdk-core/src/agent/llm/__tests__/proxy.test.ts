/**
 * Unit tests for resolveApiBase + per-provider baseURL builders.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
	getAnthropicProxyBaseURL,
	getGoogleProxyBaseURL,
	getOpenAIProxyBaseURL,
	isV2Token,
	resolveApiBase,
} from '../proxy';

describe('isV2Token', () => {
	it('is true for every shp_* v2 token shape', () => {
		assert.equal(isV2Token('shp_pat_abc123'), true);
		assert.equal(isV2Token('shp_org_abc123'), true);
		assert.equal(isV2Token('shp_ctx_xyz789'), true);
		// forward-compatible: any future shp_<context>_* shape is v2
		assert.equal(isV2Token('shp_foo_anything'), true);
	});

	it('is false for v1 UUID tokens and any other non-shp_ token', () => {
		assert.equal(isV2Token('11111111-2222-3333-4444-555555555555'), false);
		assert.equal(isV2Token('whatever-format-token'), false);
		assert.equal(isV2Token(''), false);
	});
});

describe('resolveApiBase', () => {
	it('routes shp_pat_* tokens to the Shiplight API', () => {
		assert.equal(resolveApiBase('shp_pat_abc123'), 'https://api.shiplight.ai');
	});

	it('routes shp_ctx_* tokens to the Shiplight API', () => {
		// shp_ctx_* are scoped runtime credentials minted by the LLM proxy for
		// sandboxed contexts (CI runs, testbox sessions). Same routing as PATs.
		assert.equal(resolveApiBase('shp_ctx_xyz789'), 'https://api.shiplight.ai');
	});

	it('routes any shp_* prefix to the Shiplight API (forward-compatible)', () => {
		// The SHP_PREFIX match is deliberately broad so future v2 token shapes
		// (shp_foo_*, etc.) reach the production API without a CLI change.
		assert.equal(resolveApiBase('shp_foo_anything'), 'https://api.shiplight.ai');
	});

	it('returns no host for a legacy UUID v1 token', () => {
		// The v1 cloud was decommissioned in August 2026. Returning null rather
		// than a dead host lets each caller apply its own policy — the action
		// cache no-ops, tier selection degrades, report upload is skipped.
		assert.equal(resolveApiBase('11111111-2222-3333-4444-555555555555'), null);
	});

	it('returns no host for any non-shp_ prefix', () => {
		assert.equal(resolveApiBase('whatever-format-token'), null);
		assert.equal(resolveApiBase(''), null);
	});

	it('lets SHIPLIGHT_API_URL override prefix routing', () => {
		assert.equal(
			resolveApiBase('shp_pat_abc', 'http://localhost:3001'),
			'http://localhost:3001',
		);
		assert.equal(
			resolveApiBase('uuid-token', 'https://staging.shiplight.ai'),
			'https://staging.shiplight.ai',
		);
	});

	it('strips trailing slash from override', () => {
		assert.equal(
			resolveApiBase('shp_pat_abc', 'http://localhost:3001/'),
			'http://localhost:3001',
		);
	});

	it('treats empty/whitespace override as unset', () => {
		assert.equal(resolveApiBase('shp_pat_abc', ''), 'https://api.shiplight.ai');
		assert.equal(resolveApiBase('shp_pat_abc', '   '), 'https://api.shiplight.ai');
	});
});

describe('per-provider baseURL builders', () => {
	it('OpenAI appends /llm/v1 to match SDK default URL shape', () => {
		assert.equal(
			getOpenAIProxyBaseURL('shp_pat_abc'),
			'https://api.shiplight.ai/llm/v1',
		);
		// A legacy v1 token has no host, and an LLM call has no degrade path,
		// so the builder fails with an actionable message instead of composing
		// a request against a host named "null".
		assert.throws(
			() => getOpenAIProxyBaseURL('uuid-token'),
			/no longer supported/,
		);
	});

	it('Anthropic appends /llm/v1 to match SDK default URL shape', () => {
		assert.equal(
			getAnthropicProxyBaseURL('shp_pat_abc'),
			'https://api.shiplight.ai/llm/v1',
		);
	});

	it('Google appends /llm/v1beta to match SDK default URL shape', () => {
		assert.equal(
			getGoogleProxyBaseURL('shp_pat_abc'),
			'https://api.shiplight.ai/llm/v1beta',
		);
		assert.throws(
			() => getGoogleProxyBaseURL('uuid-token'),
			/no longer supported/,
		);
	});

	it('all builders honor the SHIPLIGHT_API_URL override', () => {
		const override = 'http://localhost:3001';
		assert.equal(
			getOpenAIProxyBaseURL('shp_pat_abc', override),
			'http://localhost:3001/llm/v1',
		);
		assert.equal(
			getAnthropicProxyBaseURL('shp_pat_abc', override),
			'http://localhost:3001/llm/v1',
		);
		assert.equal(
			getGoogleProxyBaseURL('shp_pat_abc', override),
			'http://localhost:3001/llm/v1beta',
		);
	});

	it('expects SHIPLIGHT_API_URL to be the API root, NOT include /llm', () => {
		// Documents the value-format contract: SHIPLIGHT_API_URL is the API
		// root (https://api.shiplight.ai),
		// the same env var the action-cache and run-upload clients already
		// use. The /llm path segment is appended by these builders. If a
		// user mistakenly includes /llm in the env var, you get a broken
		// double-segment URL — flagging that here so the contract is
		// explicit and the failure mode is documented.
		const wrongOverride = 'http://localhost:3001/llm';
		assert.equal(
			getOpenAIProxyBaseURL('shp_pat_abc', wrongOverride),
			'http://localhost:3001/llm/llm/v1',
			'Documents the foot-gun: passing the LLM-proxy URL as the override produces a broken /llm/llm/v1 path. SHIPLIGHT_API_URL must be the API root.',
		);
	});
});
