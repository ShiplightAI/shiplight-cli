/**
 * Regression test: pure-vision (coordinates-based) action generation.
 *
 * Exercises WebAgent.execute() with usePureVision=true, which routes through
 * the coordinatesBased CUA provider (OpenAI gpt-5.4 / Gemini gemini-3-flash-preview)
 * instead of the DOM-based action generator.
 *
 * Mirrors yaml-examples/showcase/04-pure-vision.test.yaml.
 *
 * Runs once per supported CUA provider whose API key is set. If only one key
 * is available, only that provider runs; the other is skipped. If neither is
 * available, both are skipped.
 *
 * **CI-safety**: this spec depends on a page hosted on the staging frontend
 * and on live CUA API access. To avoid silently breaking unrelated PRs when
 * staging is down or CUA models misbehave, the spec is default-skipped and
 * must be opted into explicitly by setting `RUN_PURE_VISION_LIVE=1`. Use this
 * locally or from a dedicated canary job — not in the default PR pipeline.
 *
 * Environment:
 *   RUN_PURE_VISION_LIVE=1  - REQUIRED to actually run the spec
 *   OPENAI_API_KEY          - required to run the gpt-5.4 case
 *   GOOGLE_API_KEY          - required to run the gemini-3-flash-preview case
 *   ANTHROPIC_API_KEY       - optional, used for the main agent if set
 *   COMPUTER_USE_MODEL      - optional explicit override (skips parameterization)
 */

import { test } from '@playwright/test';
import { WebAgent, createAgentContext, configureSdk } from 'sdk-core';
import { VariableStore, resolveWebAgentModelFromEnv } from 'shiplight-types';

// This URL is served from the staging frontend — if staging is down or the
// path moves, this spec becomes unusable. A future improvement is to inline
// a local HTML fixture with matching drag-and-drop behaviour so the spec is
// fully self-contained.
const DRAG_DROP_URL = 'https://app-staging.shiplight.ai/testing/interactions/drag-and-drop.html';

// 1920x1080 is required for reliable CUA drag targeting. At Playwright's default
// Desktop Chrome viewport (1280x720), CUA models consistently mis-aim the drag
// on this page.
test.use({ viewport: { width: 1920, height: 1080 } });

interface CuaCase {
  name: string;
  model: string;
  requiredEnv: 'OPENAI_API_KEY' | 'GOOGLE_API_KEY';
}

const CUA_CASES: CuaCase[] = [
  { name: 'openai gpt-5.4',             model: 'gpt-5.4',                 requiredEnv: 'OPENAI_API_KEY' },
  { name: 'gemini-3-flash-preview',     model: 'gemini-3-flash-preview',  requiredEnv: 'GOOGLE_API_KEY' },
];

// Honor COMPUTER_USE_MODEL if the caller wants to pin one specific model.
const explicitOverride = process.env.COMPUTER_USE_MODEL;
const casesToRun: CuaCase[] = explicitOverride
  ? [{
      name: `override: ${explicitOverride}`,
      model: explicitOverride,
      requiredEnv: explicitOverride.startsWith('gemini-') ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY',
    }]
  : CUA_CASES;

test.describe('WebAgent pure-vision mode', () => {
  for (const cuaCase of casesToRun) {
    test.describe(`CUA: ${cuaCase.name}`, () => {
      let agent: WebAgent;

      test.beforeEach(() => {
        if (process.env.RUN_PURE_VISION_LIVE !== '1') {
          test.skip(
            true,
            'Pure-vision live spec is opt-in. Set RUN_PURE_VISION_LIVE=1 to run it.',
          );
        }
        if (!process.env[cuaCase.requiredEnv]) {
          test.skip(true, `CUA model "${cuaCase.model}" requires ${cuaCase.requiredEnv}`);
        }

        configureSdk({
          env: {
            GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? '',
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
          },
        });

        const model = resolveWebAgentModelFromEnv(process.env);
        if (!model) test.skip(true, 'No main agent model available (set an API key)');

        console.log(`[pure-vision] main model: ${model}`);
        console.log(`[pure-vision] CUA model:  ${cuaCase.model}`);

        const variableStore = new VariableStore();
        const agentContext = createAgentContext({
          model,
          computer_use_model: cuaCase.model,
          variableStore,
          testDataDir: '/tmp',
        });
        agent = new WebAgent(agentContext);
      });

      test('drags elements using screenshot coordinates only', async ({ page, context }) => {
        agent.agentServices.setupPageTracking(context);

        await page.goto(DRAG_DROP_URL, { waitUntil: 'domcontentloaded' });

        // main.0
        page = agent.agentServices.validatePage(page);
        await agent.execute(page, "Select the title 'Drag to Drop Zone'", 'main.0', true);

        // main.1
        page = agent.agentServices.validatePage(page);
        await agent.execute(page, 'Drag the red item to the drop zone.', 'main.1', true);

        // main.2
        page = agent.agentServices.validatePage(page);
        await agent.assert(page, 'Verify the red dot is in the drop zone.');
      });
    });
  }
});
