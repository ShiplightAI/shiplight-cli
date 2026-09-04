import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

interface GeminiRequest {
  config?: {
    tools?: Array<{
      computerUse?: {
        excludedPredefinedFunctions?: string[];
      };
    }>;
  };
}

function getExcludedFunctions(request: unknown): string[] {
  const typedRequest = request as GeminiRequest;
  return typedRequest.config?.tools?.[0]?.computerUse?.excludedPredefinedFunctions ?? [];
}

class MockGoogleGenAI {
  readonly models = {
    generateContent: async (request: unknown) => {
      const excludedFunctions = getExcludedFunctions(request);
      const unsupportedFunction = ['open_web_browser', 'wait_5_seconds'].find(
        (functionName) => !excludedFunctions.includes(functionName),
      );
      const functionCall = unsupportedFunction
        ? { name: unsupportedFunction, args: {} }
        : { name: 'click_at', args: { x: 500, y: 500 } };

      return {
        candidates: [
          {
            content: {
              parts: [{ functionCall }],
            },
          },
        ],
      };
    },
  };
}

mock.module('@google/genai', {
  namedExports: {
    GoogleGenAI: MockGoogleGenAI,
    Environment: { ENVIRONMENT_BROWSER: 'ENVIRONMENT_BROWSER' },
  },
});
mock.module('../../../../config', {
  namedExports: {
    getSdkConfig: () => ({ env: { GOOGLE_API_KEY: 'test-key' } }),
  },
});
mock.module('../../../llm', {
  namedExports: {
    isUsingVertexAI: () => false,
  },
});
mock.module('../../../llm/proxy', {
  namedExports: {
    getGoogleGenAIProxyBaseURL: () => 'https://example.invalid/llm',
  },
});
mock.module('../../../../utils/agentLogger', {
  namedExports: {
    agentLogger: {
      log: () => undefined,
      error: () => undefined,
    },
  },
});
mock.module('../../../../utils/logger', {
  defaultExport: {
    debug: () => undefined,
  },
});
mock.module('../shared', {
  namedExports: {
    buildActionEntity: (
      statement: string,
      actionData: { action_name: string; kwargs: Record<string, unknown> },
      locatorInfo: { locator?: string; xpath?: string; frame_path?: string[] },
    ) => ({
      action_description: statement,
      action_data: actionData,
      ...locatorInfo,
    }),
    convertToElementAnchoredCoordinates: async () => ({
      relative_x: 0,
      relative_y: 0,
      element: null,
    }),
    getElementLocatorInfo: async () => ({
      locator: undefined,
      xpath: undefined,
      frame_path: [],
    }),
  },
});

const { runGeminiCua } = await import('../gemini');

describe('runGeminiCua unsupported predefined actions', () => {
  it('excludes predefined actions that the Gemini mapper cannot execute', async () => {
    const result = await runGeminiCua({
      statement: 'Click the submit button',
      page: {} as never,
      screenshotB64: 'screenshot',
      viewportWidth: 1280,
      viewportHeight: 800,
      modelId: 'gemini-3-flash-preview',
    });

    assert.strictEqual(result.status, 'success', result.status === 'error' ? result.error : undefined);
  });
});
