/**
 * Tests for the registry's `resolveArgs` pre-validation hook.
 *
 * Custom actions resolve variable placeholders through this hook. It has to run before
 * `schema.parse`, otherwise a constrained field such as `z.string().email()` rejects the
 * `{{ placeholder }}` the model was told to emit and the tool never executes.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { ToolRegistry } from '../registry';
import type { ToolExecutionContext } from '../types';

const CONTEXT = { page: {} } as unknown as ToolExecutionContext;

function actionEntity(name: string, kwargs: unknown) {
  return { action_description: name, action_data: { action_name: name, kwargs } };
}

describe('ToolRegistry resolveArgs', () => {
  it('runs before schema validation', async () => {
    const registry = new ToolRegistry();
    let received: unknown;

    registry.register({
      name: 'constrained',
      description: 'field with a refinement',
      schema: z.object({ email: z.string().email() }),
      resolveArgs: (args) => {
        const { email } = args as { email: string };
        return { email: email === '{{ testEmail }}' ? 'user@example.com' : email };
      },
      execute: async (args) => {
        received = args;
        return { success: true, actionEntity: actionEntity('constrained', args) };
      },
    });

    const result = await registry.execute('constrained', { email: '{{ testEmail }}' }, CONTEXT);

    assert.strictEqual(result.success, true, result.error);
    assert.deepStrictEqual(received, { email: 'user@example.com' });
  });

  it('passes the pre-resolution arguments to execute as context.rawArgs', async () => {
    const registry = new ToolRegistry();
    let rawArgs: unknown;

    registry.register({
      name: 'raw_args',
      description: 'reports rawArgs',
      schema: z.object({ value: z.string() }),
      resolveArgs: () => ({ value: 'resolved' }),
      execute: async (args, context) => {
        rawArgs = context.rawArgs;
        return { success: true, actionEntity: actionEntity('raw_args', args) };
      },
    });

    await registry.execute('raw_args', { value: '{{ placeholder }}' }, CONTEXT);

    assert.deepStrictEqual(rawArgs, { value: '{{ placeholder }}' });
  });

  it('excludes the injected description field from the resolved arguments', async () => {
    const registry = new ToolRegistry();
    let seenByResolver: unknown;

    registry.register({
      name: 'with_description',
      description: 'description is stripped before resolution',
      schema: z.object({ value: z.string() }),
      resolveArgs: (args) => {
        seenByResolver = args;
        return args;
      },
      execute: async (args) => ({
        success: true,
        actionEntity: actionEntity('with_description', args),
      }),
    });

    await registry.execute(
      'with_description',
      { value: 'x', description: 'what the model was doing' },
      CONTEXT
    );

    assert.deepStrictEqual(seenByResolver, { value: 'x' });
  });

  it('leaves tools that do not opt in untouched', async () => {
    const registry = new ToolRegistry();
    let received: unknown;
    let rawArgs: unknown = 'unset';

    registry.register({
      name: 'opt_out',
      description: 'no resolveArgs',
      schema: z.object({ code: z.string() }),
      execute: async (args, context) => {
        received = args;
        rawArgs = context.rawArgs;
        return { success: true, actionEntity: actionEntity('opt_out', args) };
      },
    });

    // `${name}` is valid JavaScript, which is why substitution must stay opt-in.
    await registry.execute('opt_out', { code: 'return `${name}`' }, CONTEXT);

    assert.deepStrictEqual(received, { code: 'return `${name}`' });
    assert.strictEqual(rawArgs, undefined, 'rawArgs is only set for opting-in tools');
  });

  it('redacts the rejected value from validation-error text', async () => {
    // Validation now runs on resolved arguments, and Zod embeds the rejected value in
    // z.enum / .refine messages. That text is returned to the model as the failure
    // reason, so a resolving tool must be able to mask it.
    const registry = new ToolRegistry();

    registry.register({
      name: 'pick_role',
      description: 'enum message embeds the received value',
      schema: z.object({ role: z.enum(['admin', 'user']) }),
      resolveArgs: () => ({ role: 'hunter2' }),
      redactErrorText: (text) => text.split('hunter2').join('*****'),
      execute: async (args) => ({ success: true, actionEntity: actionEntity('pick_role', args) }),
    });

    const result = await registry.execute('pick_role', { role: '{{ password }}' }, CONTEXT);

    assert.strictEqual(result.success, false);
    assert.ok(!result.error?.includes('hunter2'), `secret leaked into error: ${result.error}`);
    assert.ok(
      !result.actionEntity.feedback?.includes('hunter2'),
      `secret leaked into feedback: ${result.actionEntity.feedback}`
    );
    assert.match(result.error ?? '', /\*\*\*\*\*/);
  });

  it('leaves validation-error text alone when no redactor is supplied', async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: 'plain_enum',
      description: 'no redactor',
      schema: z.object({ role: z.enum(['admin', 'user']) }),
      execute: async (args) => ({ success: true, actionEntity: actionEntity('plain_enum', args) }),
    });

    const result = await registry.execute('plain_enum', { role: 'nope' }, CONTEXT);

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? '', /role: /);
  });

  it('reports a validation error when the resolved arguments still do not match', async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: 'unresolvable',
      description: 'placeholder has no variable',
      schema: z.object({ email: z.string().email() }),
      resolveArgs: (args) => args,
      execute: async (args) => ({
        success: true,
        actionEntity: actionEntity('unresolvable', args),
      }),
    });

    const result = await registry.execute('unresolvable', { email: '{{ nope }}' }, CONTEXT);

    assert.strictEqual(result.success, false);
    assert.match(result.error ?? '', /Invalid arguments for tool 'unresolvable'/);
    assert.deepStrictEqual(
      result.actionEntity.action_data?.kwargs,
      { email: '{{ nope }}' },
      'the failed entity keeps what the model wrote'
    );
  });
});
