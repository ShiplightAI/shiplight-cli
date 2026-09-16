import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

interface OpenRouterOptions {
  apiKey?: string;
  compatibility?: string;
}

describe('OpenRouter provider', () => {
  afterEach(() => mock.restoreAll());

  it('constructs the official provider in strict mode with the configured key', async (t) => {
    const calls: Array<{ options: OpenRouterOptions; model: string }> = [];
    t.mock.module('@openrouter/ai-sdk-provider', {
      namedExports: {
        createOpenRouter: (options: OpenRouterOptions) => (model: string) => {
          calls.push({ options, model });
          return { modelId: model };
        },
      },
    });

    const { configureSdk } = await import('../../../config.ts');
    configureSdk({ env: { OPENROUTER_API_KEY: 'sk-or-v1-test' } });
    const { getOpenRouterModel } = await import(`../openrouter.ts?test=${Date.now()}`);
    getOpenRouterModel('openai/gpt-4o');

    assert.deepStrictEqual(calls, [
      {
        options: { apiKey: 'sk-or-v1-test', compatibility: 'strict' },
        model: 'openai/gpt-4o',
      },
    ]);
  });

  it('does not substitute a Shiplight proxy token for an OpenRouter key', async () => {
    const { configureSdk } = await import('../../../config.ts');
    configureSdk({ env: { SHIPLIGHT_API_TOKEN: 'shp_pat_test' } });
    const { getOpenRouterModel } = await import(`../openrouter.ts?missing=${Date.now()}`);

    assert.throws(
      () => getOpenRouterModel('openai/gpt-4o'),
      /OPENROUTER_API_KEY not configured/,
    );
  });
});
