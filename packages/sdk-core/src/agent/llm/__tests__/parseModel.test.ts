/**
 * Unit tests for LLM provider dispatcher: parseModel, detectProvider, getModel, getProviderOptions
 *
 * Tests the LiteLLM-style "provider:model" parsing and auto-detection logic
 * without making actual API calls (model factories are mocked).
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseModel, getProviderOptions, getModel } from '../index';

// ---------------------------------------------------------------------------
// parseModel — "provider:model" parsing
// ---------------------------------------------------------------------------

describe('parseModel', () => {
  describe('model names without provider prefix', () => {
    it('should return undefined provider for plain model names', () => {
      const result = parseModel('claude-sonnet-4-6');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'claude-sonnet-4-6' });
    });

    it('should return undefined provider for Gemini models', () => {
      const result = parseModel('gemini-3.1-pro-preview');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'gemini-3.1-pro-preview' });
    });

    it('should return undefined provider for OpenAI GPT models', () => {
      const result = parseModel('gpt-5.4-mini');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'gpt-5.4-mini' });
    });

    it('should return undefined provider for o-series reasoning models', () => {
      const result = parseModel('o3-mini');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'o3-mini' });
    });

    it('should return undefined provider for o1 model', () => {
      const result = parseModel('o1');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'o1' });
    });

    it('should return undefined provider for unknown model names', () => {
      const result = parseModel('llama-3-70b');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'llama-3-70b' });
    });
  });

  describe('model names with known provider prefix', () => {
    it('should parse anthropic:model', () => {
      const result = parseModel('anthropic:claude-sonnet-4-6');
      assert.deepStrictEqual(result, { provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
    });

    it('should parse google:model', () => {
      const result = parseModel('google:gemini-2.5-pro');
      assert.deepStrictEqual(result, { provider: 'google', modelId: 'gemini-2.5-pro' });
    });

    it('should parse openai:model', () => {
      const result = parseModel('openai:gpt-5.4-mini');
      assert.deepStrictEqual(result, { provider: 'openai', modelId: 'gpt-5.4-mini' });
    });

    it('should parse an OpenRouter vendor-qualified model', () => {
      const result = parseModel('openrouter:anthropic/claude-sonnet-4.6');
      assert.deepStrictEqual(result, {
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4.6',
      });
    });

    it('should parse vertex:model for Anthropic models on Vertex', () => {
      const result = parseModel('vertex:claude-sonnet-4-6');
      assert.deepStrictEqual(result, { provider: 'vertex', modelId: 'claude-sonnet-4-6' });
    });

    it('should parse vertex:model for Google models on Vertex', () => {
      const result = parseModel('vertex:gemini-2.5-pro');
      assert.deepStrictEqual(result, { provider: 'vertex', modelId: 'gemini-2.5-pro' });
    });

    it('should parse azure:model', () => {
      const result = parseModel('azure:gpt-4o');
      assert.deepStrictEqual(result, { provider: 'azure', modelId: 'gpt-4o' });
    });

    it('should parse bedrock:model with vendor prefix', () => {
      const result = parseModel('bedrock:anthropic.claude-sonnet-4-6-v1');
      assert.deepStrictEqual(result, { provider: 'bedrock', modelId: 'anthropic.claude-sonnet-4-6-v1' });
    });

    it('should parse bedrock:model with ARN', () => {
      const result = parseModel('bedrock:arn:aws:bedrock:us-east-2:123456789:inference-profile/opus-prod');
      assert.deepStrictEqual(result, {
        provider: 'bedrock',
        modelId: 'arn:aws:bedrock:us-east-2:123456789:inference-profile/opus-prod',
      });
    });
  });

  describe('model names with unknown provider prefix (not split)', () => {
    it('should NOT split OpenAI fine-tuned model IDs (ft:model:org)', () => {
      const result = parseModel('ft:gpt-4o:my-org:custom-suffix:id');
      assert.deepStrictEqual(result, {
        provider: undefined,
        modelId: 'ft:gpt-4o:my-org:custom-suffix:id',
      });
    });

    it('should NOT split model names with unknown prefix', () => {
      const result = parseModel('mistral:mistral-large');
      assert.deepStrictEqual(result, {
        provider: undefined,
        modelId: 'mistral:mistral-large',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle model string with no colon', () => {
      const result = parseModel('o4-mini');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'o4-mini' });
    });

    it('should handle openai:fine-tuned model with colons in model ID', () => {
      const result = parseModel('openai:ft:gpt-4o:my-org');
      assert.deepStrictEqual(result, { provider: 'openai', modelId: 'ft:gpt-4o:my-org' });
    });

    it('should handle provider prefix with empty model ID', () => {
      // "openai:" → colonIndex=6, prefix="openai", modelId=""
      const result = parseModel('openai:');
      assert.deepStrictEqual(result, { provider: 'openai', modelId: '' });
    });

    it('should handle string starting with colon (colonIndex=0)', () => {
      // ":" → colonIndex=0, which is NOT > 0, so no split
      const result = parseModel(':model');
      assert.deepStrictEqual(result, { provider: undefined, modelId: ':model' });
    });

    it('should handle chatgpt model names', () => {
      const result = parseModel('chatgpt-4o-latest');
      assert.deepStrictEqual(result, { provider: undefined, modelId: 'chatgpt-4o-latest' });
    });
  });
});

// ---------------------------------------------------------------------------
// getProviderOptions — provider option routing
// ---------------------------------------------------------------------------

describe('getProviderOptions', () => {
  it('should return anthropic options for claude models', () => {
    const opts = getProviderOptions('claude-sonnet-4-6', 1);
    assert.ok('anthropic' in opts);
  });

  it('should return anthropic options for vertex:claude models', () => {
    const opts = getProviderOptions('vertex:claude-sonnet-4-6', 1);
    assert.ok('anthropic' in opts);
  });

  it('should return empty options for openai models', () => {
    const opts = getProviderOptions('gpt-5.4-mini', 1);
    // OpenAI provider options are empty {}
    assert.deepStrictEqual(opts, {});
  });

  it('should return empty options for OpenRouter models', () => {
    assert.deepStrictEqual(getProviderOptions('openrouter:openai/gpt-4o', 1), {});
  });

  it('should return empty options for azure:gpt models', () => {
    const opts = getProviderOptions('azure:gpt-4o', 1);
    assert.deepStrictEqual(opts, {});
  });

  it('should return google options for gemini models', () => {
    const opts = getProviderOptions('gemini-2.5-pro', 1);
    assert.ok('google' in opts || 'vertex' in opts);
  });

  it('should return empty options for o-series OpenAI models', () => {
    const opts = getProviderOptions('o3-mini', 1);
    assert.deepStrictEqual(opts, {});
  });

  it('should return anthropic options for bedrock:anthropic models', () => {
    const opts = getProviderOptions('bedrock:anthropic.claude-sonnet-4-6-v1', 1);
    assert.ok('anthropic' in opts);
  });
});

// ---------------------------------------------------------------------------
// getModel — error cases (no API keys needed, just testing routing/validation)
// ---------------------------------------------------------------------------

describe('getModel error handling', () => {
  it('should throw for unimplemented vertex provider', () => {
    assert.throws(
      () => getModel('vertex:gemini-2.5-pro'),
      /Provider "vertex" is not yet implemented/,
    );
  });

  it('should throw for unimplemented azure provider', () => {
    assert.throws(
      () => getModel('azure:gpt-4o'),
      /Provider "azure" is not yet implemented/,
    );
  });

  it('should throw for unimplemented bedrock provider', () => {
    assert.throws(
      () => getModel('bedrock:anthropic.claude-sonnet-4-6-v1'),
      /Provider "bedrock" is not yet implemented/,
    );
  });

  it('should throw for unknown model prefix with no provider', () => {
    assert.throws(
      () => getModel('llama-3-70b'),
      /Cannot determine provider for model/,
    );
  });

  it('should throw for empty model ID after provider prefix', () => {
    assert.throws(
      () => getModel('openai:'),
      /Empty model ID/,
    );
  });

  it('should throw an actionable error when OpenRouter has no API key', () => {
    assert.throws(
      () => getModel('openrouter:openai/gpt-4o'),
      /OPENROUTER_API_KEY not configured/,
    );
  });
});
