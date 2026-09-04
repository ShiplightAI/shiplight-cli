/**
 * Fingerprinting an inline action entity, and the applicability rule built on it.
 *
 * These pin both directions, because either half failing is silent in production: a
 * fingerprint that misses a semantic edit lets a superseded cache entry keep shadowing the
 * fix, and one that moves on noise throws away a validated heal.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { ActionEntity } from './actionEntity';
import { fingerprintActionEntity, isStoreEntryApplicable } from './actionEntityFingerprint';

function click(over: Partial<ActionEntity> = {}): ActionEntity {
  return {
    action_description: 'Click login',
    action_data: { action_name: 'click', kwargs: {} },
    locator: "getByRole('button', { name: 'Login' })",
    ...over,
  };
}

describe('fingerprintActionEntity — moves on semantic edits', () => {
  it('changes when the locator changes', () => {
    assert.notEqual(
      fingerprintActionEntity(click()),
      fingerprintActionEntity(click({ locator: "getByTestId('login')" })),
    );
  });

  it('changes when the xpath changes', () => {
    assert.notEqual(
      fingerprintActionEntity(click({ xpath: '//button[@id="login"]' })),
      fingerprintActionEntity(click({ xpath: '//button[@id="signin"]' })),
    );
  });

  it('changes when the action name changes', () => {
    assert.notEqual(
      fingerprintActionEntity(click()),
      fingerprintActionEntity(click({ action_data: { action_name: 'hover', kwargs: {} } })),
    );
  });

  it('changes when a kwarg value changes', () => {
    // The sharpest form of the shadowing bug: description and locator untouched, so
    // nothing else in the statement's identity moves, yet a store entry serving its
    // heal-time kwargs would keep typing the old value.
    const admin = click({ action_data: { action_name: 'input_text', kwargs: { text: 'admin' } } });
    const bob = click({ action_data: { action_name: 'input_text', kwargs: { text: 'bob' } } });
    assert.notEqual(fingerprintActionEntity(admin), fingerprintActionEntity(bob));
  });

  it('changes when a kwarg is added', () => {
    const bare = click({ action_data: { action_name: 'click', kwargs: {} } });
    const withTimeout = click({ action_data: { action_name: 'click', kwargs: { timeout_seconds: 30 } } });
    assert.notEqual(fingerprintActionEntity(bare), fingerprintActionEntity(withTimeout));
  });

  it('distinguishes no-entity from any entity', () => {
    assert.equal(fingerprintActionEntity(undefined), '');
    assert.notEqual(fingerprintActionEntity(click()), '');
  });
});

describe('fingerprintActionEntity — holds still on noise', () => {
  it('ignores kwarg key order', () => {
    const a = click({ action_data: { action_name: 'input_text', kwargs: { text: 'admin', delay: 10 } } });
    const b = click({ action_data: { action_name: 'input_text', kwargs: { delay: 10, text: 'admin' } } });
    assert.equal(fingerprintActionEntity(a), fingerprintActionEntity(b), 'key order is not semantics');
  });

  it('ignores nested kwarg key order', () => {
    const a = click({ action_data: { action_name: 'x', kwargs: { opts: { a: 1, b: 2 } } } });
    const b = click({ action_data: { action_name: 'x', kwargs: { opts: { b: 2, a: 1 } } } });
    assert.equal(fingerprintActionEntity(a), fingerprintActionEntity(b));
  });

  it('ignores YAML retyping of a scalar', () => {
    // `text: 123` parses to a number, `text: "123"` to a string. A formatter adding
    // quotes must not read as an edit.
    const num = click({ action_data: { action_name: 'input_text', kwargs: { text: 123 } } });
    const str = click({ action_data: { action_name: 'input_text', kwargs: { text: '123' } } });
    assert.equal(fingerprintActionEntity(num), fingerprintActionEntity(str));
  });

  it('respects array order, which IS semantics', () => {
    const a = click({ action_data: { action_name: 'x', kwargs: { items: [1, 2] } } });
    const b = click({ action_data: { action_name: 'x', kwargs: { items: [2, 1] } } });
    assert.notEqual(fingerprintActionEntity(a), fingerprintActionEntity(b));
  });

  it('ignores capture-time debris the YAML never expresses', () => {
    const bare = click();
    const noisy = click({ text: 'Login', tag: 'button', url: 'https://x/y', feedback: 'ok', artifacts: { s: 1 } });
    assert.equal(
      fingerprintActionEntity(bare),
      fingerprintActionEntity(noisy),
      'round-tripping strips these; invalidating on them would drop valid entries',
    );
  });

  it('reads the legacy `action` alias when `action_data` is absent', () => {
    const viaAlias: ActionEntity = {
      action_description: 'Click login',
      action: { action_name: 'click', kwargs: {} },
      locator: "getByRole('button', { name: 'Login' })",
    };
    assert.equal(fingerprintActionEntity(viaAlias), fingerprintActionEntity(click()));
  });

  it('pins the exact serialization', () => {
    // A golden value, so a later change to the field set or the stringifier cannot move
    // every user's cache key silently — the relational assertions above all survive such
    // a change, this one does not.
    assert.equal(
      fingerprintActionEntity(click({ action_data: { action_name: 'input_text', kwargs: { text: 'admin' } } })),
      '{"action_name":"input_text","kwargs":{"text":"admin"},"locator":"getByRole(\'button\', { name: \'Login\' })"}',
    );
  });
});

describe('isStoreEntryApplicable', () => {
  it('serves an entry whose fingerprint still matches the inline entity', () => {
    assert.equal(isStoreEntryApplicable(fingerprintActionEntity(click()), click()), true);
  });

  it('refuses an entry once the inline entity is edited', () => {
    const stamped = fingerprintActionEntity(click());
    assert.equal(isStoreEntryApplicable(stamped, click({ locator: "getByTestId('login')" })), false);
  });

  it('grandfathers entries written before fingerprinting existed', () => {
    // Undefined means "no stamp", not "superseded nothing". Refusing these would strand
    // every existing user's cache in one release.
    assert.equal(isStoreEntryApplicable(undefined, click()), true);
    assert.equal(isStoreEntryApplicable(undefined, undefined), true);
  });

  it('does not grandfather an entry that superseded nothing', () => {
    // '' is a real fingerprint — the statement had no inline entity. It keeps applying
    // while that is still true, and stops as soon as the YAML grows one.
    assert.equal(isStoreEntryApplicable('', undefined), true);
    assert.equal(isStoreEntryApplicable('', click()), false);
  });
});
