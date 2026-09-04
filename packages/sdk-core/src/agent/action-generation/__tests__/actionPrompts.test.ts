import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getActionGenerationSystemPrompt } from '../actionPrompts.js';

describe('getActionGenerationSystemPrompt', () => {
  it('does not replace an explicitly requested operation when its result already appears satisfied', () => {
    const prompt = getActionGenerationSystemPrompt('go_to_url, input_text, wait');

    assert.match(
      prompt,
      /If the instruction explicitly asks to perform an operation.*select that operation even when the current page appears to already be in the resulting state/is,
    );
    assert.match(
      prompt,
      /instruction: "Navigate to \/"[\s\S]*?"action": \{"go_to_url": \{"url": "\/"\}\}/,
    );
    assert.doesNotMatch(prompt, /This rule applies even when the instruction directly names an action/i);
  });

  it('uses a one-second wait for a desired end state that is already satisfied', () => {
    const prompt = getActionGenerationSystemPrompt('go_to_url, wait');

    assert.match(
      prompt,
      /If the instruction asks to ensure or establish a desired end state.*select the `wait` action for 1 second/is,
    );
    assert.match(
      prompt,
      /instruction: "Ensure the current path is \/"[\s\S]*?"action": \{"wait": \{"seconds": 1\}\}/,
    );
  });

  it('uses a one-second wait when a conditional operation should not run', () => {
    const prompt = getActionGenerationSystemPrompt('input_text, wait');

    assert.match(
      prompt,
      /For conditional instructions.*condition for performing the action is false.*select the `wait` action for 1 second/is,
    );
    assert.match(
      prompt,
      /instruction: "If the username is empty, enter the username"[\s\S]*?"action": \{"wait": \{"seconds": 1\}\}/,
    );
  });
});
