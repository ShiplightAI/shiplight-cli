/**
 * Unit tests for resolveWebAgentModelFromEnv — env-only resolver for end-user
 * (CLI/SDK) execution. Priority: WEB_AGENT_MODEL > GOOGLE > ANTHROPIC > OPENAI
 * > SHIPLIGHT_API_TOKEN.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  resolveWebAgentModelFromEnv,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_WEBAGENT_MODEL,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENAI_MODEL,
} from '../organization';

describe('resolveWebAgentModelFromEnv', () => {
  describe('explicit WEB_AGENT_MODEL override', () => {
    it('should use WEB_AGENT_MODEL when set', () => {
      const result = resolveWebAgentModelFromEnv({
        WEB_AGENT_MODEL: 'claude-opus-4-6',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
      });
      assert.strictEqual(result, 'claude-opus-4-6');
    });

    it('should support provider:model prefix in WEB_AGENT_MODEL', () => {
      const result = resolveWebAgentModelFromEnv({
        WEB_AGENT_MODEL: 'azure:gpt-4o',
      });
      assert.strictEqual(result, 'azure:gpt-4o');
    });

    it('should take priority over all API keys', () => {
      const result = resolveWebAgentModelFromEnv({
        WEB_AGENT_MODEL: 'gpt-5.4-mini',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        GOOGLE_API_KEY: 'AIza-xxx',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, 'gpt-5.4-mini');
    });
  });

  describe('auto-detect from API keys (GOOGLE > ANTHROPIC > OPENAI)', () => {
    it('detects Google when GOOGLE_API_KEY is set', () => {
      const result = resolveWebAgentModelFromEnv({ GOOGLE_API_KEY: 'AIza-xxx' });
      assert.strictEqual(result, DEFAULT_GOOGLE_MODEL);
    });

    it('detects Anthropic when only ANTHROPIC_API_KEY is set', () => {
      const result = resolveWebAgentModelFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-xxx' });
      assert.strictEqual(result, DEFAULT_ANTHROPIC_MODEL);
    });

    it('detects OpenAI when only OPENAI_API_KEY is set', () => {
      const result = resolveWebAgentModelFromEnv({ OPENAI_API_KEY: 'sk-xxx' });
      assert.strictEqual(result, DEFAULT_OPENAI_MODEL);
    });

    it('prefers Google over Anthropic', () => {
      const result = resolveWebAgentModelFromEnv({
        GOOGLE_API_KEY: 'AIza-xxx',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
      });
      assert.strictEqual(result, DEFAULT_GOOGLE_MODEL);
    });

    it('prefers Google over OpenAI', () => {
      const result = resolveWebAgentModelFromEnv({
        GOOGLE_API_KEY: 'AIza-xxx',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, DEFAULT_GOOGLE_MODEL);
    });

    it('prefers Anthropic over OpenAI when Google is absent', () => {
      const result = resolveWebAgentModelFromEnv({
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, DEFAULT_ANTHROPIC_MODEL);
    });

    it('prefers Google when all three keys are set', () => {
      const result = resolveWebAgentModelFromEnv({
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        GOOGLE_API_KEY: 'AIza-xxx',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, DEFAULT_GOOGLE_MODEL);
    });
  });

  describe('Google Vertex AI via ADC (no API key)', () => {
    it('detects Google when GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT are set', () => {
      const result = resolveWebAgentModelFromEnv({
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'example-project-494523',
      });
      assert.strictEqual(result, DEFAULT_GOOGLE_MODEL);
    });

    it('accepts the capitalized "True" flag value', () => {
      const result = resolveWebAgentModelFromEnv({
        GOOGLE_GENAI_USE_VERTEXAI: 'True',
        GOOGLE_CLOUD_PROJECT: 'proj',
      });
      assert.strictEqual(result, DEFAULT_GOOGLE_MODEL);
    });

    it('does NOT detect when the flag is set but no project', () => {
      const result = resolveWebAgentModelFromEnv({ GOOGLE_GENAI_USE_VERTEXAI: 'true' });
      assert.strictEqual(result, undefined);
    });

    it('does NOT detect when a project is set but the flag is off', () => {
      const result = resolveWebAgentModelFromEnv({ GOOGLE_CLOUD_PROJECT: 'proj' });
      assert.strictEqual(result, undefined);
    });

    it('is preferred over Anthropic/OpenAI (Google priority)', () => {
      const result = resolveWebAgentModelFromEnv({
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'proj',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
      });
      assert.strictEqual(result, DEFAULT_GOOGLE_MODEL);
    });

    it('WEB_AGENT_MODEL still wins over Vertex ADC', () => {
      const result = resolveWebAgentModelFromEnv({
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'proj',
        WEB_AGENT_MODEL: 'anthropic:claude-sonnet-5',
      });
      assert.strictEqual(result, 'anthropic:claude-sonnet-5');
    });
  });

  describe('SHIPLIGHT_API_TOKEN fallback (proxy mode)', () => {
    it('returns DEFAULT_WEBAGENT_MODEL when only SHIPLIGHT_API_TOKEN is set', () => {
      const result = resolveWebAgentModelFromEnv({ SHIPLIGHT_API_TOKEN: 'shp_pat_abc' });
      assert.strictEqual(result, DEFAULT_WEBAGENT_MODEL);
    });

    it('also fires for v1 UUID tokens', () => {
      const result = resolveWebAgentModelFromEnv({
        SHIPLIGHT_API_TOKEN: '11111111-2222-3333-4444-555555555555',
      });
      assert.strictEqual(result, DEFAULT_WEBAGENT_MODEL);
    });

    it('direct provider keys still win over Shiplight token', () => {
      const result = resolveWebAgentModelFromEnv({
        SHIPLIGHT_API_TOKEN: 'shp_pat_abc',
        OPENAI_API_KEY: 'sk-direct',
      });
      assert.strictEqual(result, DEFAULT_OPENAI_MODEL);
    });

    it('WEB_AGENT_MODEL still wins over Shiplight token', () => {
      const result = resolveWebAgentModelFromEnv({
        SHIPLIGHT_API_TOKEN: 'shp_pat_abc',
        WEB_AGENT_MODEL: 'claude-opus-4-6',
      });
      assert.strictEqual(result, 'claude-opus-4-6');
    });
  });

  describe('no model available', () => {
    it('returns undefined when env is undefined', () => {
      assert.strictEqual(resolveWebAgentModelFromEnv(undefined), undefined);
    });

    it('returns undefined when env is empty', () => {
      assert.strictEqual(resolveWebAgentModelFromEnv({}), undefined);
    });

    it('returns undefined when no recognized keys are set', () => {
      const result = resolveWebAgentModelFromEnv({
        SOME_OTHER_KEY: 'value',
      });
      assert.strictEqual(result, undefined);
    });

    it('ignores empty-string API keys', () => {
      const result = resolveWebAgentModelFromEnv({
        ANTHROPIC_API_KEY: '',
        GOOGLE_API_KEY: '',
        OPENAI_API_KEY: '',
        SHIPLIGHT_API_TOKEN: '',
      });
      assert.strictEqual(result, undefined);
    });
  });
});
