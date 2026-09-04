import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { replaceVariables } from 'shiplight-types';

import { resolveExtractEmailContentVariables } from './extractEmailContent';

describe('resolveExtractEmailContentVariables', () => {
  it('resolves filter fields without changing forward_email or prompt', () => {
    const args = {
      forward_email: '{{ inbox }}',
      extraction_type: 'custom',
      prompt: 'Extract the code for {{ user }}',
      filter_from_email: '{{ sender }}',
      filter_to_email: '$recipient',
      filter_subject: 'Welcome <secret>user</secret>',
      filter_body_contains: '${token_hint}',
      timeout: 30,
    };
    const values: Record<string, string> = {
      inbox: 'inbox@example.test',
      user: 'Ada',
      sender: 'sender@example.test',
      recipient: 'recipient@example.test',
      token_hint: 'Your verification code',
    };

    const resolved = resolveExtractEmailContentVariables(args, (input) =>
      replaceVariables(input, values)
    );

    assert.deepStrictEqual(resolved, {
      forward_email: '{{ inbox }}',
      extraction_type: 'custom',
      prompt: 'Extract the code for {{ user }}',
      filter_from_email: 'sender@example.test',
      filter_to_email: 'recipient@example.test',
      filter_subject: 'Welcome Ada',
      filter_body_contains: 'Your verification code',
      timeout: 30,
    });
    assert.deepStrictEqual(args, {
      forward_email: '{{ inbox }}',
      extraction_type: 'custom',
      prompt: 'Extract the code for {{ user }}',
      filter_from_email: '{{ sender }}',
      filter_to_email: '$recipient',
      filter_subject: 'Welcome <secret>user</secret>',
      filter_body_contains: '${token_hint}',
      timeout: 30,
    });
  });
});
