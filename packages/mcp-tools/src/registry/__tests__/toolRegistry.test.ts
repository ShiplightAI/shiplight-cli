import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../toolRegistry.js';
import type { ToolDefinition } from '../../types/index.js';

function def(name: string): ToolDefinition {
  return { name, description: `desc for ${name}`, inputSchema: { type: 'object' } };
}

describe('ToolRegistry', () => {
  describe('registerTool + build', () => {
    it('exposes the definition and dispatches to its handler', async () => {
      const registry = new ToolRegistry();
      registry.registerTool(def('my_tool'), async () => 'handled');

      const { tools, handleToolCall } = registry.build();
      assert.equal(tools.length, 1);
      assert.equal(tools[0]!.name, 'my_tool');
      assert.equal(await handleToolCall('my_tool', {}), 'handled');
    });

    it('passes args and options (abort signal) through to the handler', async () => {
      const registry = new ToolRegistry();
      const ac = new AbortController();
      let seenArgs: unknown;
      let seenSignal: AbortSignal | undefined;
      registry.registerTool(def('echo'), async (args, options) => {
        seenArgs = args;
        seenSignal = options?.signal;
        return 'ok';
      });

      const { handleToolCall } = registry.build();
      await handleToolCall('echo', { a: 1 }, { signal: ac.signal });
      assert.deepEqual(seenArgs, { a: 1 });
      assert.equal(seenSignal, ac.signal);
    });

    it('register* methods are chainable (return this)', () => {
      const registry = new ToolRegistry();
      const r = registry
        .registerTool(def('a'), async () => 'a')
        .registerTool(def('b'), async () => 'b');
      assert.equal(r, registry);
      assert.deepEqual(registry.getRegisteredToolNames().sort(), ['a', 'b']);
    });
  });

  describe('handleToolCall', () => {
    it('throws "Unknown tool: <name>" for an unregistered tool', async () => {
      const registry = new ToolRegistry();
      const { handleToolCall } = registry.build();
      await assert.rejects(
        () => handleToolCall('nope', {}),
        /Unknown tool: nope/
      );
    });
  });

  describe('introspection', () => {
    it('getRegisteredToolNames + hasToolRegistered reflect state', () => {
      const registry = new ToolRegistry();
      registry.registerTool(def('x'), async () => 'x');
      assert.deepEqual(registry.getRegisteredToolNames(), ['x']);
      assert.equal(registry.hasToolRegistered('x'), true);
      assert.equal(registry.hasToolRegistered('y'), false);
    });
  });

  describe('duplicate registration', () => {
    it('last registration of a name wins', async () => {
      const registry = new ToolRegistry();
      registry.registerTool(def('dup'), async () => 'first');
      registry.registerTool(def('dup'), async () => 'second');

      const { tools, handleToolCall } = registry.build();
      assert.equal(tools.length, 1);
      assert.equal(await handleToolCall('dup', {}), 'second');
    });
  });

  describe('registerAll', () => {
    // registerAll resolves a tool definition's `name` to an instance method via
    // a hardcoded methodMappings table inside ToolRegistry. Use a real mapped
    // pair (new_session -> newSession) so resolution succeeds.
    it('registers a definition whose name maps to an existing instance method', async () => {
      const registry = new ToolRegistry();
      const ToolClass = { toolDefinitions: [def('new_session')] };
      const instance = { async newSession() { return 'session-created'; } };

      registry.registerAll(ToolClass, instance);
      const { handleToolCall } = registry.build();
      assert.equal(registry.hasToolRegistered('new_session'), true);
      assert.equal(await handleToolCall('new_session', {}), 'session-created');
    });

    it('SILENTLY SKIPS a definition whose name is not in methodMappings', () => {
      // Guards the footgun: a new tool added to a tool class but not to the
      // hardcoded methodMappings is dropped with no error.
      const registry = new ToolRegistry();
      const ToolClass = { toolDefinitions: [def('totally_new_tool')] };
      const instance = { async totallyNewTool() { return 'x'; } };

      registry.registerAll(ToolClass, instance);
      assert.equal(registry.hasToolRegistered('totally_new_tool'), false);
      assert.deepEqual(registry.getRegisteredToolNames(), []);
    });

    it('skips a mapped definition when the instance lacks the method', () => {
      const registry = new ToolRegistry();
      const ToolClass = { toolDefinitions: [def('new_session')] };
      const instance = {}; // no newSession method

      registry.registerAll(ToolClass, instance);
      assert.equal(registry.hasToolRegistered('new_session'), false);
    });

    it('binds the handler to the instance (this is preserved)', async () => {
      const registry = new ToolRegistry();
      const ToolClass = { toolDefinitions: [def('new_session')] };
      const instance = {
        secret: 'bound',
        async newSession(this: { secret: string }) { return this.secret; },
      };

      registry.registerAll(ToolClass, instance);
      const { handleToolCall } = registry.build();
      assert.equal(await handleToolCall('new_session', {}), 'bound');
    });
  });

  describe('registerTools (selective)', () => {
    it('registers only the named methods', async () => {
      const registry = new ToolRegistry();
      const ToolClass = { toolDefinitions: [def('new_session'), def('close_session')] };
      const instance = {
        async newSession() { return 'new'; },
        async closeSession() { return 'closed'; },
      };

      registry.registerTools(ToolClass, instance, ['newSession']);
      assert.deepEqual(registry.getRegisteredToolNames(), ['new_session']);
      assert.equal(registry.hasToolRegistered('close_session'), false);
    });
  });
});
