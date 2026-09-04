/**
 * Unit tests for resolveComputerUseModelFromEnv and resolveModels — the
 * resolvers that pick a computer-use (CUA) model. End-user callers use the
 * env-only variant; internal callers use resolveModels with org + env.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  resolveComputerUseModelFromEnv,
  resolveModels,
  DEFAULT_OPENAI_COMPUTER_USE_MODEL,
  DEFAULT_GEMINI_COMPUTER_USE_MODEL,
  DEFAULT_COMPUTER_USE_MODEL,
  DEFAULT_COPILOT_MODEL,
  DEFAULT_WEBAGENT_MODEL,
  type OrganizationSettings,
} from '../organization';

describe('resolveComputerUseModelFromEnv', () => {
  describe('explicit COMPUTER_USE_MODEL override', () => {
    it('uses COMPUTER_USE_MODEL when set', () => {
      const result = resolveComputerUseModelFromEnv({
        COMPUTER_USE_MODEL: 'gemini-3-flash-preview',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, 'gemini-3-flash-preview');
    });

    it('takes priority over every API key', () => {
      const result = resolveComputerUseModelFromEnv({
        COMPUTER_USE_MODEL: 'custom-cua-model',
        GOOGLE_API_KEY: 'AIza-xxx',
        OPENAI_API_KEY: 'sk-xxx',
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
      });
      assert.strictEqual(result, 'custom-cua-model');
    });

    it('accepts arbitrary provider-prefixed identifiers', () => {
      const result = resolveComputerUseModelFromEnv({
        COMPUTER_USE_MODEL: 'azure:gpt-5.4',
      });
      assert.strictEqual(result, 'azure:gpt-5.4');
    });
  });

  describe('auto-detect from API keys (GOOGLE > OPENAI, Anthropic skipped)', () => {
    it('picks Gemini when GOOGLE_API_KEY is set', () => {
      const result = resolveComputerUseModelFromEnv({ GOOGLE_API_KEY: 'AIza-xxx' });
      assert.strictEqual(result, DEFAULT_GEMINI_COMPUTER_USE_MODEL);
    });

    it('picks OpenAI when only OPENAI_API_KEY is set', () => {
      const result = resolveComputerUseModelFromEnv({ OPENAI_API_KEY: 'sk-xxx' });
      assert.strictEqual(result, DEFAULT_OPENAI_COMPUTER_USE_MODEL);
    });

    it('prefers Gemini over OpenAI when both keys are set', () => {
      const result = resolveComputerUseModelFromEnv({
        GOOGLE_API_KEY: 'AIza-xxx',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, DEFAULT_GEMINI_COMPUTER_USE_MODEL);
    });

    it('ignores ANTHROPIC_API_KEY — Anthropic has no supported CUA model', () => {
      const result = resolveComputerUseModelFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-xxx' });
      assert.strictEqual(result, undefined);
    });

    it('still prefers GOOGLE over OPENAI when ANTHROPIC is also set', () => {
      const result = resolveComputerUseModelFromEnv({
        ANTHROPIC_API_KEY: 'sk-ant-xxx',
        GOOGLE_API_KEY: 'AIza-xxx',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, DEFAULT_GEMINI_COMPUTER_USE_MODEL);
    });
  });

  describe('Google Vertex AI via ADC (no API key)', () => {
    it('picks the Gemini CUA model on Vertex (flag + project)', () => {
      const result = resolveComputerUseModelFromEnv({
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'example-project-494523',
      });
      assert.strictEqual(result, DEFAULT_GEMINI_COMPUTER_USE_MODEL);
    });

    it('does NOT detect when the flag is set but no project', () => {
      assert.strictEqual(
        resolveComputerUseModelFromEnv({ GOOGLE_GENAI_USE_VERTEXAI: 'true' }),
        undefined,
      );
    });

    it('is preferred over OpenAI (Google priority)', () => {
      const result = resolveComputerUseModelFromEnv({
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'proj',
        OPENAI_API_KEY: 'sk-xxx',
      });
      assert.strictEqual(result, DEFAULT_GEMINI_COMPUTER_USE_MODEL);
    });
  });

  describe('no model available', () => {
    it('returns undefined when env is undefined', () => {
      assert.strictEqual(resolveComputerUseModelFromEnv(undefined), undefined);
    });

    it('returns undefined when env is empty', () => {
      assert.strictEqual(resolveComputerUseModelFromEnv({}), undefined);
    });

    it('returns undefined when only unrelated keys are set', () => {
      assert.strictEqual(
        resolveComputerUseModelFromEnv({ SOME_OTHER_KEY: 'value' }),
        undefined,
      );
    });

    it('ignores empty-string API keys', () => {
      const result = resolveComputerUseModelFromEnv({
        COMPUTER_USE_MODEL: '',
        GOOGLE_API_KEY: '',
        OPENAI_API_KEY: '',
      });
      assert.strictEqual(result, undefined);
    });
  });

  it('DEFAULT_COMPUTER_USE_MODEL aliases the Gemini constant', () => {
    assert.strictEqual(DEFAULT_COMPUTER_USE_MODEL, DEFAULT_GEMINI_COMPUTER_USE_MODEL);
    assert.strictEqual(DEFAULT_COMPUTER_USE_MODEL, 'gemini-3-flash-preview');
  });
});

describe('resolveModels', () => {
  const orgWithAll: OrganizationSettings = {
    models: {
      copilot: 'org-copilot',
      webagent: 'org-webagent',
      computer_use: 'org-cua',
    },
  };
  const orgEmpty: OrganizationSettings = { models: {} };

  describe('precedence: org > env > default', () => {
    it('uses org settings when all slots configured', () => {
      const result = resolveModels(orgWithAll, {
        COPILOT_MODEL: 'env-copilot',
        WEB_AGENT_MODEL: 'env-webagent',
        COMPUTER_USE_MODEL: 'env-cua',
      });
      assert.deepStrictEqual(result, {
        copilot: 'org-copilot',
        webagent: 'org-webagent',
        computer_use: 'org-cua',
      });
    });

    it('uses env vars when org has no model settings', () => {
      const result = resolveModels(orgEmpty, {
        COPILOT_MODEL: 'env-copilot',
        WEB_AGENT_MODEL: 'env-webagent',
        COMPUTER_USE_MODEL: 'env-cua',
      });
      assert.deepStrictEqual(result, {
        copilot: 'env-copilot',
        webagent: 'env-webagent',
        computer_use: 'env-cua',
      });
    });

    it('uses hardcoded defaults when nothing is configured', () => {
      const result = resolveModels(null, {});
      assert.deepStrictEqual(result, {
        copilot: DEFAULT_COPILOT_MODEL,
        webagent: DEFAULT_WEBAGENT_MODEL,
        computer_use: DEFAULT_COMPUTER_USE_MODEL,
      });
    });

    it('mixes sources per slot', () => {
      const result = resolveModels(
        { models: { webagent: 'org-webagent' } },
        { COMPUTER_USE_MODEL: 'env-cua' },
      );
      assert.strictEqual(result.copilot, DEFAULT_COPILOT_MODEL);
      assert.strictEqual(result.webagent, 'org-webagent');
      assert.strictEqual(result.computer_use, 'env-cua');
    });
  });

  describe('null/undefined tolerance', () => {
    it('handles null org', () => {
      const result = resolveModels(null, { WEB_AGENT_MODEL: 'env-webagent' });
      assert.strictEqual(result.webagent, 'env-webagent');
    });

    it('handles undefined org', () => {
      const result = resolveModels(undefined, { COPILOT_MODEL: 'env-copilot' });
      assert.strictEqual(result.copilot, 'env-copilot');
    });
  });
});
