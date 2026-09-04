/**
 * Tests for variable resolution of custom action arguments.
 *
 * The action-generation prompt tells the model to emit `{{ placeholder }}` instead of a
 * variable's real value, so the registered action has to resolve before user code runs —
 * and before the Zod schema validates, or a constrained field such as
 * `z.string().email()` rejects the placeholder and the handler never runs.
 *
 * These tests drive the **real** sdk-core tool registry rather than a stub, because the
 * validation ordering is exactly what a stub registry hides.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { toolRegistry } from 'sdk-core';

import { Agent } from '../agent';

// --- Helpers ---

const PAGE_STUB = {} as never;

/** The registry is a module singleton that rejects duplicate names. */
let sequence = 0;

interface SetupOptions {
  variables?: Record<string, unknown>;
  sensitiveKeys?: string[];
  schema: z.ZodObject<z.ZodRawShape>;
  execute?: (
    args: Record<string, unknown>,
    ctx: { variableStore: unknown; page: unknown; replaceVariables: (t: string) => string }
  ) => Promise<{ success: boolean; message?: string }>;
}

/**
 * Register an action on a fresh agent, then return a callable that dispatches through
 * the real registry plus a record of what the handler saw.
 */
function setupAction(options: SetupOptions) {
  const name = `test_action_${(sequence += 1)}`;

  const agent = new Agent({
    model: 'test-model',
    variables: options.variables,
    sensitiveKeys: options.sensitiveKeys,
  });

  const seen: {
    args?: Record<string, unknown>;
    ctx?: { page: unknown; variableStore: { get(key: string): string | undefined }; replaceVariables(text: string): string };
  } = {};

  agent.registerAction({
    name,
    description: 'test action',
    schema: options.schema,
    async execute(args, ctx) {
      seen.args = args;
      seen.ctx = ctx;
      return options.execute
        ? await options.execute(args, ctx)
        : { success: true, message: 'ok' };
    },
  });

  return {
    agent,
    seen,
    invoke: (args: unknown) =>
      toolRegistry.execute(name, args, { page: PAGE_STUB } as never),
  };
}

// --- Tests ---

describe('custom action arguments are variable-resolved', () => {
  it('resolves a {{ placeholder }} argument before calling execute()', async () => {
    const { seen, invoke } = setupAction({
      variables: { testEmail: 'user@example.com' },
      schema: z.object({ email_address: z.string() }),
    });

    await invoke({ email_address: '{{ testEmail }}' });

    assert.strictEqual(seen.args?.email_address, 'user@example.com');
  });

  it('resolves before schema validation, so a constrained field still runs', async () => {
    // Regression: resolution used to happen inside the tool's execute, which the
    // registry calls *after* schema.parse. A z.string().email() field therefore
    // rejected "{{ testEmail }}" and the handler was never reached.
    //
    // Scope: this covers the registry boundary, which is what `run()` reaches. `act()`
    // additionally validates the model's literal output against the same schema while
    // generating the action, so a refinement there still rejects a placeholder — see the
    // note on registerAction().
    const { seen, invoke } = setupAction({
      variables: { testEmail: 'user@example.com' },
      schema: z.object({ email_address: z.string().email() }),
    });

    const result = await invoke({ email_address: '{{ testEmail }}' });

    assert.strictEqual(result.success, true, result.error);
    assert.strictEqual(seen.args?.email_address, 'user@example.com');
  });

  it('resolves before validation for a regex-constrained field', async () => {
    const { seen, invoke } = setupAction({
      variables: { orderId: 'ORD-12345' },
      schema: z.object({ order_id: z.string().regex(/^ORD-\d+$/) }),
    });

    const result = await invoke({ order_id: '{{ orderId }}' });

    assert.strictEqual(result.success, true, result.error);
    assert.strictEqual(seen.args?.order_id, 'ORD-12345');
  });

  it('resolves $name and ${name} syntaxes', async () => {
    const { seen, invoke } = setupAction({
      variables: { testEmail: 'user@example.com' },
      schema: z.object({ a: z.string(), b: z.string() }),
    });

    await invoke({ a: '$testEmail', b: '${testEmail}' });

    assert.strictEqual(seen.args?.a, 'user@example.com');
    assert.strictEqual(seen.args?.b, 'user@example.com');
  });

  it('resolves placeholders in nested objects and arrays', async () => {
    const { seen, invoke } = setupAction({
      variables: { testEmail: 'user@example.com' },
      schema: z.object({
        user: z.object({ email: z.string().email() }),
        recipients: z.array(z.string().email()),
      }),
    });

    const result = await invoke({
      user: { email: '{{ testEmail }}' },
      recipients: ['{{ testEmail }}', 'other@example.com'],
    });

    assert.strictEqual(result.success, true, result.error);
    assert.deepStrictEqual(seen.args?.user, { email: 'user@example.com' });
    assert.deepStrictEqual(seen.args?.recipients, ['user@example.com', 'other@example.com']);
  });

  it('leaves an unknown placeholder verbatim and non-strings untouched', async () => {
    const { seen, invoke } = setupAction({
      variables: { testEmail: 'user@example.com' },
      schema: z.object({ unknown: z.string(), count: z.number(), flag: z.boolean() }),
    });

    await invoke({ unknown: '{{ nope }}', count: 3, flag: false });

    assert.strictEqual(seen.args?.unknown, '{{ nope }}');
    assert.strictEqual(seen.args?.count, 3);
    assert.strictEqual(seen.args?.flag, false);
  });

  it('resolves a sensitive variable for the handler', async () => {
    const { seen, invoke } = setupAction({
      variables: { apiToken: 'secret-token-123' },
      sensitiveKeys: ['apiToken'],
      schema: z.object({ token: z.string() }),
    });

    await invoke({ token: '{{ apiToken }}' });

    assert.strictEqual(seen.args?.token, 'secret-token-123');
  });

  it('resolves variables set after registration', async () => {
    const { agent, seen, invoke } = setupAction({
      schema: z.object({ code: z.string() }),
    });

    agent.setVariable('otp', '123456');
    await invoke({ code: '{{ otp }}' });

    assert.strictEqual(seen.args?.code, '123456');
  });
});

describe('the trajectory keeps the raw placeholder', () => {
  it('records unresolved kwargs on success', async () => {
    const { invoke } = setupAction({
      variables: { testEmail: 'user@example.com' },
      schema: z.object({ email_address: z.string().email() }),
    });

    const result = await invoke({ email_address: '{{ testEmail }}' });

    assert.deepStrictEqual(result.actionEntity.action_data?.kwargs, {
      email_address: '{{ testEmail }}',
    });
  });

  it('records unresolved kwargs for nested arguments', async () => {
    const { invoke } = setupAction({
      variables: { testEmail: 'user@example.com' },
      schema: z.object({ user: z.object({ email: z.string() }) }),
    });

    const result = await invoke({ user: { email: '{{ testEmail }}' } });

    assert.deepStrictEqual(result.actionEntity.action_data?.kwargs, {
      user: { email: '{{ testEmail }}' },
    });
  });

  it('records unresolved kwargs when the action throws', async () => {
    const { invoke } = setupAction({
      variables: { password: 'hunter2' },
      sensitiveKeys: ['password'],
      schema: z.object({ password: z.string() }),
      execute: async () => {
        throw new Error('handler blew up');
      },
    });

    const result = await invoke({ password: '{{ password }}' });

    assert.strictEqual(result.success, false);
    assert.deepStrictEqual(result.actionEntity.action_data?.kwargs, {
      password: '{{ password }}',
    });
    assert.ok(
      !JSON.stringify(result.actionEntity).includes('hunter2'),
      'a resolved secret must not reach the action entity'
    );
  });
});

describe('sensitive values are masked in handler output', () => {
  it('masks a sensitive value echoed in the result message', async () => {
    const { invoke } = setupAction({
      variables: { password: 'hunter2' },
      sensitiveKeys: ['password'],
      schema: z.object({ password: z.string() }),
      execute: async (args) => ({ success: true, message: `used ${args.password}` }),
    });

    const result = await invoke({ password: '{{ password }}' });

    assert.strictEqual(result.message, 'used *****');
    assert.strictEqual(result.actionEntity.action_description, 'used *****');
    assert.ok(!JSON.stringify(result).includes('hunter2'), 'secret must not survive anywhere');
  });

  it('masks a sensitive value echoed in a thrown error', async () => {
    const { invoke } = setupAction({
      variables: { password: 'hunter2' },
      sensitiveKeys: ['password'],
      schema: z.object({ password: z.string() }),
      execute: async (args) => {
        throw new Error(`login failed for ${args.password}`);
      },
    });

    const result = await invoke({ password: '{{ password }}' });

    assert.strictEqual(result.error, 'login failed for *****');
    assert.strictEqual(result.actionEntity.feedback, 'login failed for *****');
  });

  it('masks a sensitive value that a validation error would echo back', async () => {
    // The registry validates the resolved arguments, and Zod puts the rejected value in
    // the z.enum message. That text becomes the step's failure reason for the model.
    const { invoke } = setupAction({
      variables: { password: 'hunter2' },
      sensitiveKeys: ['password'],
      schema: z.object({ role: z.enum(['admin', 'user']) }),
    });

    const result = await invoke({ role: '{{ password }}' });

    assert.strictEqual(result.success, false);
    assert.ok(!result.error?.includes('hunter2'), `secret leaked into error: ${result.error}`);
    assert.ok(
      !JSON.stringify(result).includes('hunter2'),
      'secret must not survive anywhere in the result'
    );
  });

  it('masks a non-string sensitive value echoed in the result message', async () => {
    const { invoke } = setupAction({
      variables: { otp: 123456 },
      sensitiveKeys: ['otp'],
      schema: z.object({ code: z.string() }),
      execute: async (args) => ({ success: true, message: `submitted ${args.code}` }),
    });

    const result = await invoke({ code: '{{ otp }}' });

    assert.strictEqual(result.message, 'submitted *****');
    assert.ok(!JSON.stringify(result).includes('123456'), 'numeric secret must be masked too');
  });

  it('leaves messages untouched when no variable is sensitive', async () => {
    const { invoke } = setupAction({
      variables: { plan: 'pro' },
      schema: z.object({ plan: z.string() }),
      execute: async (args) => ({ success: true, message: `selected ${args.plan}` }),
    });

    const result = await invoke({ plan: '{{ plan }}' });

    assert.strictEqual(result.message, 'selected pro');
  });
});

describe('ActionExecutionContext', () => {
  it('exposes replaceVariables for strings the handler builds itself', async () => {
    const { seen, invoke } = setupAction({
      variables: { host: 'example.com' },
      schema: z.object({}),
    });

    await invoke({});

    assert.strictEqual(typeof seen.ctx?.replaceVariables, 'function');
    assert.strictEqual(
      seen.ctx?.replaceVariables('https://{{ host }}/reset'),
      'https://example.com/reset'
    );
  });

  it('still exposes page and variableStore', async () => {
    const { seen, invoke } = setupAction({
      variables: { host: 'example.com' },
      schema: z.object({}),
    });

    await invoke({});

    assert.strictEqual(seen.ctx?.page, PAGE_STUB);
    assert.strictEqual(seen.ctx?.variableStore.get('host'), 'example.com');
  });
});
