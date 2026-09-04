/**
 * Reading the `shiplight-new-action-entities` attachment.
 *
 * The producer (apps/cli/src/fixture.ts) and this consumer are two processes
 * apart with an untyped JSON hop between them, so nothing but a test pins the
 * shape. Getting the nesting wrong does not throw — it silently yields zero
 * heals, which reads as a perfectly healthy cache.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyStore, createRunnerStoreEntry } from 'shiplight-types';
import type { ActionEntity } from 'shiplight-types';
import { parseHealedEntitiesAttachment } from './index.js';

const entity = (locator: string): ActionEntity => ({
  action_description: 'click it',
  action_data: { action_name: 'click', kwargs: {} },
  locator,
});

/** Byte-for-byte what fixture.ts attaches. */
function attachmentFromFixture(entities: Record<string, ActionEntity>): string {
  const store = createEmptyStore();
  for (const [uid, actionEntity] of Object.entries(entities)) {
    store.entries[uid] = createRunnerStoreEntry(actionEntity, 0);
  }
  return JSON.stringify(store, null, 2);
}

describe('parseHealedEntitiesAttachment', () => {
  it('reads UIDs from the store wrapper, not the top level', () => {
    const raw = attachmentFromFixture({
      'uid-a': entity('#healed-a'),
      'uid-b': entity('#healed-b'),
    });

    const healed = parseHealedEntitiesAttachment(raw);

    // Reading the top level would yield the keys "version" and "entries", which
    // match no statement — heals would count as zero and every self-healed
    // statement would stay booked as a successful cache hit.
    assert.deepEqual([...healed.keys()].sort(), ['uid-a', 'uid-b']);
    assert.equal(healed.get('uid-a')?.locator, '#healed-a');
  });

  it('unwraps the store entry to the ActionEntity itself', () => {
    // Each value is an ActionStoreEntry ({action_entity, updated_at, ...}); the
    // collector compares locators to classify the heal, so handing it the
    // wrapper would make every heal_reason undefined.
    const healed = parseHealedEntitiesAttachment(attachmentFromFixture({ 'uid-a': entity('#x') }));
    const value = healed.get('uid-a')!;

    assert.equal(value.locator, '#x');
    assert.equal('action_entity' in value, false);
  });

  it('returns empty for malformed, empty, or absent input', () => {
    assert.equal(parseHealedEntitiesAttachment(null).size, 0);
    assert.equal(parseHealedEntitiesAttachment('').size, 0);
    assert.equal(parseHealedEntitiesAttachment('{ not json').size, 0);
    assert.equal(parseHealedEntitiesAttachment('null').size, 0);
    assert.equal(parseHealedEntitiesAttachment('{"version":"1.0"}').size, 0);
    assert.equal(parseHealedEntitiesAttachment(JSON.stringify(createEmptyStore())).size, 0);
  });

  it('skips entries carrying no action entity', () => {
    const raw = JSON.stringify({ version: '1.0', entries: { 'uid-a': { updated_at: 0 } } });
    assert.equal(parseHealedEntitiesAttachment(raw).size, 0);
  });
});
