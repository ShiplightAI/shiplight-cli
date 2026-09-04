/**
 * Unit tests for resolveActionArgs — the recursive resolver applied to
 * custom action arguments before they reach user code.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

import { resolveActionArgs } from '../variableResolution';

const variables = {
  testEmail: 'user@example.com',
  userId: 42,
  host: 'example.com',
};

describe('resolveActionArgs — placeholder syntaxes', () => {
  it('resolves {{ name }} with and without spaces', () => {
    assert.deepStrictEqual(
      resolveActionArgs({ a: '{{ testEmail }}', b: '{{testEmail}}' }, variables),
      { a: 'user@example.com', b: 'user@example.com' }
    );
  });

  it('resolves {{ $name }}, ${name} and $name', () => {
    assert.deepStrictEqual(
      resolveActionArgs(
        { a: '{{ $testEmail }}', b: '${testEmail}', c: '$testEmail' },
        variables
      ),
      { a: 'user@example.com', b: 'user@example.com', c: 'user@example.com' }
    );
  });

  it('resolves placeholders embedded in a larger string', () => {
    assert.deepStrictEqual(
      resolveActionArgs({ url: 'https://{{ host }}/users/{{ userId }}/reset' }, variables),
      { url: 'https://example.com/users/42/reset' }
    );
  });

  it('leaves an unknown placeholder verbatim instead of blanking it', () => {
    assert.deepStrictEqual(resolveActionArgs({ a: '{{ nope }}' }, variables), {
      a: '{{ nope }}',
    });
  });

  it('coerces a numeric variable to its string form', () => {
    assert.deepStrictEqual(resolveActionArgs({ id: '{{ userId }}' }, variables), {
      id: '42',
    });
  });
});

describe('resolveActionArgs — value kinds', () => {
  it('passes non-string primitives through untouched', () => {
    const args = { count: 5, enabled: true, missing: null, absent: undefined };
    assert.deepStrictEqual(resolveActionArgs(args, variables), args);
  });

  it('recurses into arrays', () => {
    assert.deepStrictEqual(
      resolveActionArgs({ recipients: ['{{ testEmail }}', 'other@example.com', 3] }, variables),
      { recipients: ['user@example.com', 'other@example.com', 3] }
    );
  });

  it('recurses into nested objects', () => {
    assert.deepStrictEqual(
      resolveActionArgs({ user: { contact: { email: '{{ testEmail }}' } } }, variables),
      { user: { contact: { email: 'user@example.com' } } }
    );
  });

  it('recurses into objects nested inside arrays', () => {
    assert.deepStrictEqual(
      resolveActionArgs({ rows: [{ email: '{{ testEmail }}' }] }, variables),
      { rows: [{ email: 'user@example.com' }] }
    );
  });

  it('returns class instances as-is rather than flattening them', () => {
    const when = new Date(0);
    const resolved = resolveActionArgs({ when }, variables);
    assert.ok(resolved.when instanceof Date, 'Date should survive resolution');
    assert.strictEqual(resolved.when.getTime(), 0);
  });

  it('resolves a bare string argument', () => {
    assert.strictEqual(resolveActionArgs('{{ testEmail }}', variables), 'user@example.com');
  });

  it('is a no-op when no variables are set', () => {
    assert.deepStrictEqual(resolveActionArgs({ a: '{{ testEmail }}' }, {}), {
      a: '{{ testEmail }}',
    });
  });
});

describe('resolveActionArgs — immutability', () => {
  it('does not mutate the input object', () => {
    const args = { email: '{{ testEmail }}', nested: { email: '{{ testEmail }}' } };
    const resolved = resolveActionArgs(args, variables);

    assert.strictEqual(args.email, '{{ testEmail }}', 'top-level input must be unchanged');
    assert.strictEqual(args.nested.email, '{{ testEmail }}', 'nested input must be unchanged');
    assert.notStrictEqual(resolved, args, 'a copy should be returned');
    assert.notStrictEqual(resolved.nested, args.nested, 'nested objects should be copied');
  });

  it('does not mutate the input array', () => {
    const args = { list: ['{{ testEmail }}'] };
    resolveActionArgs(args, variables);
    assert.deepStrictEqual(args.list, ['{{ testEmail }}']);
  });
});
