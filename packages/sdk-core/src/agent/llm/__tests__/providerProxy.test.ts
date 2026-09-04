/**
 * Integration tests for SHIPLIGHT_API_TOKEN routing through each provider.
 *
 * Verifies that:
 *   - Direct provider key (e.g. OPENAI_API_KEY) takes precedence over the
 *     Shiplight token (no proxy used)
 *   - When only SHIPLIGHT_API_TOKEN is set, the provider is constructed with
 *     the proxy baseURL and the Shiplight token as apiKey
 *   - Supported token prefixes route through the Shiplight API
 *   - SHIPLIGHT_API_URL overrides the prefix routing
 *   - Missing keys still throw the original error
 */

import assert from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

interface CreatorCall {
  apiKey?: string;
  baseURL?: string;
}

let openaiCalls: CreatorCall[] = [];
let anthropicCalls: CreatorCall[] = [];
let googleCalls: CreatorCall[] = [];

function makeFakeProvider(): (modelName: string) => unknown {
  return (modelName: string) => ({ modelId: modelName });
}

describe('provider proxy routing via SHIPLIGHT_API_TOKEN', () => {
  let configureSdk: typeof import('../../../config').configureSdk;
  let getOpenAIModel: typeof import('../openai').getOpenAIModel;
  let getAnthropicModel: typeof import('../anthropic').getAnthropicModel;
  let getGoogleModel: typeof import('../google').getGoogleModel;
  let importCounter = 0;

  beforeEach(async (t) => {
    openaiCalls = [];
    anthropicCalls = [];
    googleCalls = [];
    t.mock.module('@ai-sdk/openai', {
      namedExports: {
        createOpenAI: (opts: CreatorCall) => {
          openaiCalls.push(opts);
          return makeFakeProvider();
        },
      },
    });
    t.mock.module('@ai-sdk/anthropic', {
      namedExports: {
        createAnthropic: (opts: CreatorCall) => {
          anthropicCalls.push(opts);
          return makeFakeProvider();
        },
      },
    });
    t.mock.module('@ai-sdk/google', {
      namedExports: {
        createGoogleGenerativeAI: (opts: CreatorCall) => {
          googleCalls.push(opts);
          return makeFakeProvider();
        },
        GoogleGenerativeAIProviderOptions: undefined,
      },
    });
    t.mock.module('@ai-sdk/google-vertex/anthropic', {
      namedExports: {
        createVertexAnthropic: () => makeFakeProvider(),
      },
    });
    t.mock.module('@ai-sdk/google-vertex', {
      namedExports: {
        createVertex: () => makeFakeProvider(),
      },
    });
    // Cache-bust the provider modules so each test re-imports them and picks
    // up the freshly-installed @ai-sdk mocks. Do NOT cache-bust config.ts —
    // providers resolve `'../../config'` to the unqueried path, so the test's
    // configureSdk must hit the same singleton instance that providers read.
    const cacheBust = `?v=${++importCounter}`;
    const configMod = await import(`../../../config.ts`);
    configureSdk = configMod.configureSdk;
    const openaiMod = await import(`../openai.ts${cacheBust}`);
    getOpenAIModel = openaiMod.getOpenAIModel;
    const anthropicMod = await import(`../anthropic.ts${cacheBust}`);
    getAnthropicModel = anthropicMod.getAnthropicModel;
    const googleMod = await import(`../google.ts${cacheBust}`);
    getGoogleModel = googleMod.getGoogleModel;
    // Each test sets `env` explicitly via configureSdk; no global reset needed
    // because updateConfig() shallow-merges and tests overwrite `env` whole.
  });

  afterEach(() => {
    mock.restoreAll();
  });

  // -------------------------------------------------------------------
  // OpenAI
  // -------------------------------------------------------------------

  describe('OpenAI', () => {
    it('uses direct OPENAI_API_KEY when set (no proxy)', () => {
      configureSdk({ env: { OPENAI_API_KEY: 'sk-direct' } });
      getOpenAIModel('gpt-4o-mini');
      assert.equal(openaiCalls.length, 1);
      assert.equal(openaiCalls[0]!.apiKey, 'sk-direct');
      assert.equal(openaiCalls[0]!.baseURL, undefined);
    });

    it('respects OPENAI_BASE_URL alongside OPENAI_API_KEY', () => {
      configureSdk({
        env: { OPENAI_API_KEY: 'sk-direct', OPENAI_BASE_URL: 'http://local-llm:8080/v1' },
      });
      getOpenAIModel('gpt-4o-mini');
      assert.equal(openaiCalls[0]!.baseURL, 'http://local-llm:8080/v1');
    });

    it('routes via the Shiplight API when only shp_pat_ token is set', () => {
      configureSdk({ env: { SHIPLIGHT_API_TOKEN: 'shp_pat_abc123' } });
      getOpenAIModel('gpt-4o-mini');
      assert.equal(openaiCalls.length, 1);
      assert.equal(openaiCalls[0]!.apiKey, 'shp_pat_abc123');
      assert.equal(openaiCalls[0]!.baseURL, 'https://api.shiplight.ai/llm/v1');
    });

    it('fails actionably when only a legacy UUID token is set', () => {
      // The v1 cloud was decommissioned in August 2026, so there is no host to
      // route to and no degrade path for an LLM call.
      configureSdk({ env: { SHIPLIGHT_API_TOKEN: '11111111-2222-3333-4444-555555555555' } });
      assert.throws(() => getOpenAIModel('gpt-4o-mini'), /no longer supported/);
    });

    it('OPENAI_API_KEY wins over SHIPLIGHT_API_TOKEN', () => {
      configureSdk({
        env: { OPENAI_API_KEY: 'sk-direct', SHIPLIGHT_API_TOKEN: 'shp_pat_abc' },
      });
      getOpenAIModel('gpt-4o-mini');
      assert.equal(openaiCalls[0]!.apiKey, 'sk-direct');
      assert.equal(openaiCalls[0]!.baseURL, undefined);
    });

    it('SHIPLIGHT_API_URL overrides production routing', () => {
      configureSdk({
        env: {
          SHIPLIGHT_API_TOKEN: 'shp_pat_abc',
          SHIPLIGHT_API_URL: 'http://localhost:3001',
        },
      });
      getOpenAIModel('gpt-4o-mini');
      assert.equal(openaiCalls[0]!.baseURL, 'http://localhost:3001/llm/v1');
    });

    it('throws when neither key is set', () => {
      configureSdk({ env: {} });
      assert.throws(() => getOpenAIModel('gpt-4o-mini'), /OPENAI_API_KEY not configured/);
      assert.equal(openaiCalls.length, 0);
    });
  });

  // -------------------------------------------------------------------
  // Anthropic
  // -------------------------------------------------------------------

  describe('Anthropic', () => {
    it('uses direct ANTHROPIC_API_KEY when set', () => {
      configureSdk({ env: { ANTHROPIC_API_KEY: 'sk-ant-direct' } });
      getAnthropicModel('claude-sonnet-4-6');
      assert.equal(anthropicCalls.length, 1);
      assert.equal(anthropicCalls[0]!.apiKey, 'sk-ant-direct');
      assert.equal(anthropicCalls[0]!.baseURL, undefined);
    });

    it('routes via the Shiplight API when only shp_pat_ token is set', () => {
      configureSdk({ env: { SHIPLIGHT_API_TOKEN: 'shp_pat_anthropic' } });
      getAnthropicModel('claude-sonnet-4-6');
      assert.equal(anthropicCalls.length, 1);
      assert.equal(anthropicCalls[0]!.apiKey, 'shp_pat_anthropic');
      assert.equal(anthropicCalls[0]!.baseURL, 'https://api.shiplight.ai/llm/v1');
    });

    it('fails actionably when only a legacy UUID token is set', () => {
      configureSdk({ env: { SHIPLIGHT_API_TOKEN: 'uuid-token' } });
      assert.throws(() => getAnthropicModel('claude-sonnet-4-6'), /no longer supported/);
    });

    it('ANTHROPIC_API_KEY wins over SHIPLIGHT_API_TOKEN', () => {
      configureSdk({
        env: { ANTHROPIC_API_KEY: 'sk-ant-direct', SHIPLIGHT_API_TOKEN: 'shp_pat_abc' },
      });
      getAnthropicModel('claude-sonnet-4-6');
      assert.equal(anthropicCalls[0]!.apiKey, 'sk-ant-direct');
      assert.equal(anthropicCalls[0]!.baseURL, undefined);
    });

    it('throws when neither key is set', () => {
      configureSdk({ env: {} });
      assert.throws(
        () => getAnthropicModel('claude-sonnet-4-6'),
        /ANTHROPIC_API_KEY not configured/,
      );
    });

    it('Vertex AI flag still wins over Shiplight token', () => {
      configureSdk({
        env: {
          ANTHROPIC_MODELS_USE_VERTEXAI: 'true',
          GOOGLE_CLOUD_PROJECT: 'my-project',
          GOOGLE_CLOUD_LOCATION: 'us-east5',
          SHIPLIGHT_API_TOKEN: 'shp_pat_abc',
        },
      });
      getAnthropicModel('claude-sonnet-4-6');
      assert.equal(anthropicCalls.length, 0);
    });
  });

  // -------------------------------------------------------------------
  // Google
  // -------------------------------------------------------------------

  describe('Google', () => {
    it('uses direct GOOGLE_API_KEY when set', () => {
      configureSdk({ env: { GOOGLE_API_KEY: 'goog-direct' } });
      getGoogleModel('gemini-2.5-flash');
      assert.equal(googleCalls.length, 1);
      assert.equal(googleCalls[0]!.apiKey, 'goog-direct');
      assert.equal(googleCalls[0]!.baseURL, undefined);
    });

    it('routes via the Shiplight API with /v1beta suffix', () => {
      configureSdk({ env: { SHIPLIGHT_API_TOKEN: 'shp_pat_goog' } });
      getGoogleModel('gemini-2.5-flash');
      assert.equal(googleCalls.length, 1);
      assert.equal(googleCalls[0]!.apiKey, 'shp_pat_goog');
      assert.equal(googleCalls[0]!.baseURL, 'https://api.shiplight.ai/llm/v1beta');
    });

    it('fails actionably when only a legacy UUID token is set', () => {
      configureSdk({ env: { SHIPLIGHT_API_TOKEN: 'uuid-token' } });
      assert.throws(() => getGoogleModel('gemini-2.5-flash'), /no longer supported/);
    });

    it('GOOGLE_API_KEY wins over SHIPLIGHT_API_TOKEN', () => {
      configureSdk({
        env: { GOOGLE_API_KEY: 'goog-direct', SHIPLIGHT_API_TOKEN: 'shp_pat_abc' },
      });
      getGoogleModel('gemini-2.5-flash');
      assert.equal(googleCalls[0]!.apiKey, 'goog-direct');
      assert.equal(googleCalls[0]!.baseURL, undefined);
    });

    it('throws when neither key is set', () => {
      configureSdk({ env: {} });
      assert.throws(() => getGoogleModel('gemini-2.5-flash'), /Google API key is missing/);
    });

    it('Vertex AI flag still wins over Shiplight token', () => {
      configureSdk({
        env: {
          GOOGLE_GENAI_USE_VERTEXAI: 'true',
          GOOGLE_CLOUD_PROJECT: 'my-project',
          GOOGLE_CLOUD_LOCATION: 'us-central1',
          SHIPLIGHT_API_TOKEN: 'shp_pat_abc',
        },
      });
      getGoogleModel('gemini-2.5-flash');
      assert.equal(googleCalls.length, 0);
    });
  });
});
