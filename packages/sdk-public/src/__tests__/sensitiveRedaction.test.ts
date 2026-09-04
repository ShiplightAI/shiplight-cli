/**
 * Unit tests for redactSensitiveValues — masking of sensitive variable values in
 * text a custom action handler returns.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

import { redactSensitiveValues } from '../sensitiveRedaction';

const variables = { password: 'hunter2', token: 'abc123', plan: 'pro' };

describe('redactSensitiveValues', () => {
  it('masks a sensitive value', () => {
    assert.strictEqual(
      redactSensitiveValues('logged in with hunter2', variables, new Set(['password'])),
      'logged in with *****'
    );
  });

  it('masks every occurrence', () => {
    assert.strictEqual(
      redactSensitiveValues('hunter2 then hunter2', variables, new Set(['password'])),
      '***** then *****'
    );
  });

  it('masks several sensitive variables in one string', () => {
    assert.strictEqual(
      redactSensitiveValues('hunter2 / abc123', variables, new Set(['password', 'token'])),
      '***** / *****'
    );
  });

  it('leaves non-sensitive values alone', () => {
    assert.strictEqual(
      redactSensitiveValues('selected pro', variables, new Set(['password'])),
      'selected pro'
    );
  });

  it('returns the text unchanged when nothing is sensitive', () => {
    assert.strictEqual(
      redactSensitiveValues('hunter2', variables, new Set()),
      'hunter2'
    );
  });

  it('masks a non-string sensitive value, which the resolver stringifies', () => {
    // variables is Record<string, any>, so a numeric PIN from a config file is legal and
    // reaches the handler as "123456" — it has to be masked in that form.
    assert.strictEqual(
      redactSensitiveValues('submitted code 123456', { otp: 123456 }, new Set(['otp'])),
      'submitted code *****'
    );
  });

  it('masks overlapping secrets longest-first so no tail survives', () => {
    const overlapping = { short: 'abc', long: 'abcdef' };
    assert.strictEqual(
      redactSensitiveValues('token=abcdef', overlapping, new Set(['short', 'long'])),
      'token=*****'
    );
    assert.strictEqual(
      redactSensitiveValues('token=abcdef', overlapping, new Set(['long', 'short'])),
      'token=*****',
      'result must not depend on sensitive-key iteration order'
    );
  });

  it('ignores sensitive keys with no value', () => {
    const withOddValues = { missing: undefined, empty: '' };
    assert.strictEqual(
      redactSensitiveValues('nothing to mask', withOddValues, new Set(['missing', 'empty'])),
      'nothing to mask'
    );
  });

  it('passes undefined and empty text through', () => {
    assert.strictEqual(redactSensitiveValues(undefined, variables, new Set(['password'])), undefined);
    assert.strictEqual(redactSensitiveValues('', variables, new Set(['password'])), '');
  });
});
