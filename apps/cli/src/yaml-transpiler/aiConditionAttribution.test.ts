/**
 * Proof for 002 `exp-usage-summary`.
 *
 * The 4th argument to `agent.evaluate` is what lets the runner attribute an AI
 * poll to IF vs WHILE (vs WAIT_UNTIL) in the run usage summary. Without it,
 * WAIT_UNTIL and IF collapse together (spec 047).
 *
 * This assertion previously lived on `testFlowTranspiler.test.ts`, which
 * asserted the emit in `testFlowTranspiler.ts` — a transpiler no shipped
 * command reached. That file was deleted in August 2026 with the rest of the
 * unreachable export surface. The live emit is `statements.ts`
 * (`transpileIfElse` / `transpileWhileLoop`), which run-usage-summary's
 * test-report flagged as "not separately asserted", so the proof moves here
 * rather than disappearing with the dead code.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { transpileStatements } from './statements';
import type { Statement } from 'shiplight-types';

describe('AI condition usage attribution', () => {
  it('tags AI-mode IF and WHILE conditions with their construct so usage attribution can split them', () => {
    const statements = [
      {
        uid: 'if-ai',
        type: 'IF_ELSE',
        condition: { type: 'AI_MODE', expression: 'the banner is visible' },
        then: [],
      },
      {
        uid: 'while-ai',
        type: 'WHILE_LOOP',
        condition: { type: 'AI_MODE', expression: 'more items remain' },
        body: [],
      },
    ] as unknown as Statement[];

    const result = transpileStatements(statements, 0, {}).join('\n');

    assert.match(
      result,
      /if \(await agent\.evaluate\(page, "the banner is visible", "[^"]+", "if"\)\)/,
    );
    assert.match(
      result,
      /await agent\.evaluate\(page, "more items remain", "[^"]+", "while"\)/,
    );
  });

  it('does not tag JS_CODE conditions, which never reach the agent', () => {
    const statements = [
      {
        uid: 'if-js',
        type: 'IF_ELSE',
        condition: { type: 'JS_CODE', expression: 'true' },
        then: [],
      },
    ] as unknown as Statement[];

    const result = transpileStatements(statements, 0, {}).join('\n');

    assert.doesNotMatch(result, /agent\.evaluate/);
    assert.match(result, /if \(true\) \{/);
  });
});
