/**
 * The schema `generateAction` actually submits must be strict-valid.
 *
 * The strict transform itself is covered in llm_tools/__tests__/strictSchema.test.ts,
 * but that proves nothing about whether the call site uses it. Reverting
 * elementBased.ts to `Output.object({ schema: actionResponseSchema })` left the
 * entire suite green while restoring the outage:
 *
 *   AI_APICallError: Invalid schema for response_format 'response':
 *   In context=('properties','action','anyOf','0','properties','click'),
 *   'required' is required to be supplied and to be an array including every key
 *   in properties. Missing 'timeout_ms'.
 *
 * So this captures what is handed to `Output.object` and runs the strict-mode
 * validator over the JSON Schema that would go on the wire. The union is built
 * from real tool schemas carrying real `.optional()` fields, so the assertion
 * fails if the transform is dropped, bypassed, or stops covering a construct.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import { jsonSchema } from 'ai';
import { z } from 'zod';

import { ClickToolSchema } from '../../../actions/impl/click';
import { GoToUrlToolSchema } from '../../../actions/impl/go_to_url';
import { ScrollOnElementToolSchema } from '../../../actions/impl/scroll_on_element';
import { validateStrictMode } from '../../../llm_tools/schema';

/** What the mocked `Output.object` was last given. */
let capturedOutput: { schema?: unknown } | undefined;

mock.module('ai', {
  namedExports: {
    // The real helper: strictSchema.ts builds its submission schema with it, and
    // this mock only stands in for the LLM boundary.
    jsonSchema,
    generateText: async () => ({
      output: { thought: 't', description: 'd', action: { click: { element_index: 5 } }, completes_instruction: true },
      usage: undefined,
      reasoningText: '',
      finishReason: 'stop',
      text: '',
    }),
    // Capture instead of discarding: the schema handed here is the whole point.
    Output: {
      object: (cfg: { schema?: unknown }) => {
        capturedOutput = cfg;
        return cfg;
      },
    },
    NoObjectGeneratedError: class extends Error {
      static isInstance() {
        return false;
      }
    },
    APICallError: class extends Error {
      static isInstance() {
        return false;
      }
    },
    RetryError: class extends Error {
      static isInstance() {
        return false;
      }
    },
  },
});

mock.module('../../../utils/pageContext', {
  namedExports: {
    buildPageContext: async () => ({
      screenshotBase64: '',
      domState: { selectorMap: new Map<number, unknown>([[5, { tagName: 'button' }]]) },
      pageContext: { elementsText: '' },
    }),
  },
});

const actualLlm = await import('../../llm');
mock.module('../../llm', {
  namedExports: {
    resolveTemperature: actualLlm.resolveTemperature,
    getModel: (m: string) => m,
    getProviderOptions: () => ({}),
  },
});

mock.module('../../../llm_tools/utils', {
  namedExports: {
    getActionEntityLocatorInfo: async () => ({ locator: "getByRole('button')", xpath: '//button[1]' }),
  },
});

/**
 * A union shaped like the real one, from real tool schemas: `click` carries an
 * optional `timeout_ms` (the field that broke the original request) and
 * `scroll_on_element` carries optional deltas, so a regression in either the
 * transform or the call site shows up here.
 */
mock.module('../../../llm_tools/registry', {
  namedExports: {
    toolRegistry: {
      buildActionUnionSchema: () =>
        z.union([
          z.object({ click: ClickToolSchema }),
          z.object({ scroll_on_element: ScrollOnElementToolSchema }),
          z.object({ go_to_url: GoToUrlToolSchema }),
        ]),
    },
  },
});

mock.module('../../../llm_tools/providers/openai', {
  namedExports: {
    OpenAIToolProvider: class {
      getToolDefinitions() {
        return [];
      }
    },
  },
});

mock.module('../actionPrompts', {
  namedExports: {
    getActionGenerationSystemPrompt: () => 'system',
    getActionGenerationUserPrompt: () => 'user',
  },
});

// Coordinates-based fallback (only used for perform_accurate_operation); stubbed
// so its Gemini provider wiring is not pulled in behind the mocked '../../llm'.
mock.module('../coordinatesBased', {
  namedExports: {
    generateAction: async () => ({
      status: 'success',
      actionEntity: { action_description: 'coords', action_data: { action_name: 'click', kwargs: {} } },
    }),
  },
});

const { generateAction } = await import('../elementBased');

function fakeContext() {
  return {
    statement: 'click the login button',
    page: {} as any,
    agentServices: {
      getModel: () => 'test-model',
      getFallbackModels: () => [],
      retrieveKnowledges: async () => [],
      isSlicedScreenshotsEnabled: () => false,
      isResizeSlicedScreenshotsEnabled: () => false,
      isKnowledgeImagesEnabled: () => false,
      isAccessibilityTreeEnabled: () => false,
      isActionIntentFilteringEnabled: () => false,
    } as any,
    variables: {},
    executionHistory: [],
    sensitiveKeys: [],
  } as any;
}

describe('generateAction submits a strict-valid schema', () => {
  beforeEach(() => {
    capturedOutput = undefined;
  });

  it('hands Output.object a schema whose JSON Schema passes strict mode', async () => {
    await generateAction('click the login button', fakeContext(), { model: 'gpt-5.4-mini' });

    assert.ok(capturedOutput, 'Output.object was never called — the test harness no longer matches the code');

    const submitted = capturedOutput.schema as { jsonSchema?: unknown } | undefined;
    assert.ok(
      submitted && typeof submitted === 'object' && 'jsonSchema' in submitted,
      'the schema passed to Output.object is not a strict submission schema — ' +
        'toStrictOutputSchema was probably dropped from the call site, which ' +
        'restores the AI_APICallError for every AI-generated action',
    );

    const errors = validateStrictMode(submitted.jsonSchema);
    assert.deepStrictEqual(
      errors,
      [],
      `the submitted JSON Schema is not valid under OpenAI strict mode, so the ` +
        `request fails before the model is consulted. Errors: ${errors.join('; ')}`,
    );
  });

  it('lists every optional tool field in required, nullable', async () => {
    await generateAction('click the login button', fakeContext(), { model: 'gpt-5.4-mini' });

    const json = (capturedOutput?.schema as { jsonSchema: Record<string, any> }).jsonSchema;
    const click = json.properties.action.anyOf[0].properties.click;

    assert.ok(
      click.required.includes('timeout_ms'),
      'timeout_ms is missing from required — this is the exact key the API named when the outage was reported',
    );
    assert.deepStrictEqual(click.properties.timeout_ms.type, ['number', 'null']);
  });

  it('keeps the response parsing tolerant of keys the model omits', async () => {
    // Gemini and Anthropic are in the same fallback chain and honour `required`
    // by convention only, so a response without thought/description must still parse.
    await generateAction('click the login button', fakeContext(), { model: 'gpt-5.4-mini' });

    const submitted = capturedOutput?.schema as {
      validate: (v: unknown) => Promise<{ success: boolean; value?: unknown }>;
    };
    const result = await submitted.validate({ action: { click: { element_index: 5 } } });

    assert.strictEqual(result.success, true, 'a response omitting the defaulted keys was rejected');
    assert.deepStrictEqual(result.value, {
      thought: '',
      description: '',
      action: { click: { element_index: 5 } },
      completes_instruction: true,
    });
  });
});
