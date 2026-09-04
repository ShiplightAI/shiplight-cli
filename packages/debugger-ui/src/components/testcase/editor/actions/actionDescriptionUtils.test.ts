import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { updateNonAssertionActionEntityDescription } from './actionDescriptionUtils';

describe('updateNonAssertionActionEntityDescription', () => {
  it('preserves a code action and its JavaScript when its description changes', () => {
    const updated = updateNonAssertionActionEntityDescription(
      {
        action_description: 'Seed the session',
        action_data: {
          action_name: 'js_code',
          kwargs: {
            code: "await page.evaluate(() => localStorage.setItem('token', 'test'))",
          },
        },
      },
      'Seed the authenticated session',
    );

    assert.equal(updated?.action_description, 'Seed the authenticated session');
    assert.equal(updated?.action_data?.kwargs.code, "await page.evaluate(() => localStorage.setItem('token', 'test'))");
  });

  it('clears a generated action when its description changes', () => {
    const updated = updateNonAssertionActionEntityDescription(
      {
        action_description: 'Click submit',
        action_data: {
          action_name: 'click',
          kwargs: {},
        },
      },
      'Click save',
    );

    assert.equal(updated, undefined);
  });

  it('updates the statement kwarg for an AI action', () => {
    const updated = updateNonAssertionActionEntityDescription(
      {
        action_description: 'Click submit',
        action_data: {
          action_name: 'ai_action',
          kwargs: {
            statement: 'Click submit',
            use_pure_vision: true,
          },
        },
      },
      'Click save',
    );

    assert.equal(updated?.action_description, 'Click save');
    assert.equal(updated?.action_data?.kwargs.statement, 'Click save');
    assert.equal(updated?.action_data?.kwargs.use_pure_vision, true);
  });
});
