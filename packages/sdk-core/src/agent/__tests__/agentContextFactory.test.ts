/**
 * Unit tests for createAgentContext
 *
 * Tests the current API which requires {model, variableStore} and returns
 * a plain WebAgentContext object with variables accessed via variableStore.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { VariableStore } from 'shiplight-types';
import { createAgentContext } from '../agentContextFactory';

describe('createAgentContext', () => {
  describe('basic functionality', () => {
    it('should create context with required model and variableStore', () => {
      const variableStore = new VariableStore();
      const context = createAgentContext({ model: 'test-model', variableStore });

      assert.strictEqual(context.model, 'test-model');
      assert.strictEqual(context.variableStore, variableStore);
      assert.deepStrictEqual(context.executionHistory, []);
      assert.strictEqual(context.organizationId, undefined);
    });

    it('should initialize currentTime in variableStore by default', () => {
      const variableStore = new VariableStore();
      createAgentContext({ model: 'test-model', variableStore });

      const currentTime = variableStore.get('currentTime');
      assert(currentTime, 'currentTime should be set by default');
      assert(typeof currentTime === 'string', 'currentTime should be a string');
      // Verify format: YYYY-MM-DDTHH:MM:SS.mmm±HH:MM
      assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(currentTime),
        `currentTime should match expected format, got: ${currentTime}`);
    });

    it('should not overwrite currentTime if already set in variableStore', () => {
      const customTime = '2025-01-01T00:00:00.000-08:00';
      const variableStore = new VariableStore();
      variableStore.set('currentTime', customTime);

      createAgentContext({ model: 'test-model', variableStore });

      assert.strictEqual(variableStore.get('currentTime'), customTime);
    });

    it('should create context with initial variables in variableStore', () => {
      const variableStore = new VariableStore();
      variableStore.set('foo', 'bar');
      variableStore.set('num', 42);

      const context = createAgentContext({ model: 'test-model', variableStore });

      assert.strictEqual(context.variableStore.get('foo'), 'bar');
      assert.strictEqual(context.variableStore.get('num'), 42);
    });

    it('should create context with sensitive keys in variableStore', () => {
      const variableStore = new VariableStore();
      variableStore.set('password', 'secret', true);
      variableStore.set('token', 'abc', true);

      const context = createAgentContext({ model: 'test-model', variableStore });

      assert(context.variableStore.isSensitive('password'));
      assert(context.variableStore.isSensitive('token'));
    });
  });

  describe('variableStore get/set', () => {
    it('should get and set variables via variableStore', () => {
      const variableStore = new VariableStore();
      const context = createAgentContext({ model: 'test-model', variableStore });

      context.variableStore.set('myKey', 'myValue');
      assert.strictEqual(context.variableStore.get('myKey'), 'myValue');
    });

    it('should mark variable as sensitive when flag is true', () => {
      const variableStore = new VariableStore();
      const context = createAgentContext({ model: 'test-model', variableStore });

      context.variableStore.set('password', 'secret123', true);

      assert.strictEqual(context.variableStore.get('password'), 'secret123');
      assert(context.variableStore.isSensitive('password'));
    });

    it('should not mark variable as sensitive by default', () => {
      const variableStore = new VariableStore();
      const context = createAgentContext({ model: 'test-model', variableStore });

      context.variableStore.set('username', 'john');

      assert.strictEqual(context.variableStore.get('username'), 'john');
      assert(!context.variableStore.isSensitive('username'));
    });
  });

  describe('optional context properties', () => {
    it('should pass through organizationId', () => {
      const variableStore = new VariableStore();
      const context = createAgentContext({
        model: 'test-model',
        variableStore,
        organizationId: 'org-123',
      });

      assert.strictEqual(context.organizationId, 'org-123');
    });

    it('should pass through executionHistory', () => {
      const variableStore = new VariableStore();
      const history: Array<[string, string]> = [['step1', 'result1']];
      const context = createAgentContext({
        model: 'test-model',
        variableStore,
        executionHistory: history,
      });

      assert.strictEqual(context.executionHistory.length, 1);
      assert.deepStrictEqual(context.executionHistory[0], ['step1', 'result1']);
    });

    it('should initialize tokenUsages and aiActionDetails as empty arrays', () => {
      const variableStore = new VariableStore();
      const context = createAgentContext({ model: 'test-model', variableStore });

      assert.deepStrictEqual(context.tokenUsages, []);
      assert.deepStrictEqual(context.aiActionDetails, []);
    });
  });

  describe('shared variableStore', () => {
    it('should share the same variableStore reference', () => {
      const variableStore = new VariableStore();
      const context = createAgentContext({ model: 'test-model', variableStore });

      // Changes to the original variableStore should be visible through context
      variableStore.set('external', 'value');
      assert.strictEqual(context.variableStore.get('external'), 'value');

      // Changes through context.variableStore should be visible on the original
      context.variableStore.set('internal', 'data');
      assert.strictEqual(variableStore.get('internal'), 'data');
    });

    it('should return a copy of all variables via getAll()', () => {
      const variableStore = new VariableStore();
      variableStore.set('a', 1);
      variableStore.set('b', 2);

      const context = createAgentContext({ model: 'test-model', variableStore });
      const vars = context.variableStore.getAll();

      assert.strictEqual(vars.a, 1);
      assert.strictEqual(vars.b, 2);

      // Modifying the copy should not affect original
      vars.a = 999;
      assert.strictEqual(context.variableStore.get('a'), 1);
    });
  });
});
