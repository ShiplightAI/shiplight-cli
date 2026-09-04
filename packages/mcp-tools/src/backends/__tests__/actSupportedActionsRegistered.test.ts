/**
 * Guards the one edge that nothing else checks: every action the `act` tool
 * ADVERTISES must actually be executable.
 *
 * The act tool's description is built directly from ACT_SUPPORTED_ACTIONS
 * (`Supported actions: ${ACT_SUPPORTED_ACTIONS.join(", ")}` in browserTools),
 * but its input schema and the `shiplight://schemas/action-entity` resource are
 * both generated from sdk-core's tool registry, which silently skips names it
 * does not know.
 *
 * That means schema and resource always agree with each other — they share a
 * source — so cross-checking them, as the stdio smoke suite does, cannot catch
 * a name that is advertised but unregistered. It reads as supported and fails
 * at call time with "Tool not found".
 *
 * Found the hard way: `wait_for_page_ready` and `send_keys_on_element` were
 * both listed while unregistered, and only surfaced when an agent driving a
 * real browser called one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureToolsRegistered, getToolRegistry } from 'sdk-core';

import { ACT_SUPPORTED_ACTIONS } from '../sessionTypes.js';

test('every advertised act action resolves to a registered tool', async () => {
  await ensureToolsRegistered();
  const registry = getToolRegistry();

  const unresolved = ACT_SUPPORTED_ACTIONS.filter((name) => !registry.get(name));

  assert.deepEqual(
    unresolved,
    [],
    `these actions are advertised by the act tool but are not registered, so calling one ` +
      `fails with "Tool not found": ${unresolved.join(', ')}. Either register the action in ` +
      `sdk-core's llm_tools registry, or remove it from ACT_SUPPORTED_ACTIONS.`,
  );
});

test('the advertised list matches the schema the act tool actually accepts', async () => {
  // The union schema is what validates a caller's payload. If it and the
  // advertised list ever diverge, one of them is lying to the agent.
  await ensureToolsRegistered();
  const registry = getToolRegistry();

  const schema = registry.buildActionUnionSchemaForTools([...ACT_SUPPORTED_ACTIONS], true) as {
    _def?: { options?: Array<{ shape?: Record<string, unknown> }> };
  };
  const options = schema?._def?.options ?? [];
  // Reading Zod's internals is the only way to enumerate a union's members. If
  // a Zod upgrade changes that shape this would silently read as "no actions
  // accepted" and report a drift that did not happen, so fail on the real cause
  // instead.
  assert.ok(
    options.length > 0,
    'could not enumerate the act union schema — Zod internals (_def.options) may have changed shape; ' +
      'this is a test-harness failure, not a drift between the advertised list and the schema',
  );

  const accepted = options.map((o) => Object.keys(o.shape ?? {})[0]).filter(Boolean).sort();

  assert.deepEqual(
    accepted,
    [...ACT_SUPPORTED_ACTIONS].sort(),
    'the act union schema and ACT_SUPPORTED_ACTIONS have drifted apart',
  );
});
