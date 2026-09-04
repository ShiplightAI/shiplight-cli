/**
 * Tests for ToolRegistry buildActionUnionSchema
 *
 * Verifies that the union schema generated for LLM action parsing works correctly
 * with Zod validation, especially for tools with empty schemas.
 *
 * Background: When tools have empty schemas (like go_back, done, etc.), we originally
 * used z.any() as a replacement. This caused issues with Vercel AI SDK's generateObject
 * because z.any() generates JSON Schema without a "required" field, which breaks
 * union validation. The fix is to use z.object({ _empty: z.boolean().optional() })
 * instead, which generates proper JSON Schema structure.
 */

import { test, expect } from '@playwright/test';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import { ToolRegistry } from '../../src/llm_tools/registry';

test.describe('ToolRegistry buildActionUnionSchema', () => {
  test('should generate union schema with proper required fields for empty schemas', () => {
    const registry = new ToolRegistry();

    // Register tools with regular schemas
    registry.register({
      name: 'click',
      description: 'Click an element',
      schema: z.object({ element_index: z.number().int().nonnegative() }),
      execute: async () => ({ success: true, actionEntity: { action_description: 'click', action_data: { action_name: 'click', kwargs: {} } } }),
    });

    registry.register({
      name: 'switch_tab',
      description: 'Switch tab',
      schema: z.object({ tab_index: z.number().int().nonnegative() }),
      execute: async () => ({ success: true, actionEntity: { action_description: 'switch_tab', action_data: { action_name: 'switch_tab', kwargs: {} } } }),
    });

    // Register tools with empty schemas (like go_back, done, etc.)
    registry.register({
      name: 'go_back',
      description: 'Go back',
      schema: z.object({}),
      execute: async () => ({ success: true, actionEntity: { action_description: 'go_back', action_data: { action_name: 'go_back', kwargs: {} } } }),
    });

    registry.register({
      name: 'done',
      description: 'Done',
      schema: z.object({}),
      execute: async () => ({ success: true, actionEntity: { action_description: 'done', action_data: { action_name: 'done', kwargs: {} } } }),
    });

    // Build the union schema
    const unionSchema = registry.buildActionUnionSchema();

    // Convert to JSON Schema to inspect structure
    const jsonSchema = zodToJsonSchema(unionSchema, { $refStrategy: 'none' });

    // Verify it's an anyOf structure
    expect(jsonSchema).toHaveProperty('anyOf');
    expect(Array.isArray((jsonSchema as any).anyOf)).toBe(true);

    const anyOfItems = (jsonSchema as any).anyOf;
    expect(anyOfItems.length).toBe(4);

    // Check each schema in the anyOf has proper structure
    anyOfItems.forEach((item: any) => {
      expect(item).toHaveProperty('type', 'object');
      expect(item).toHaveProperty('properties');
      expect(item).toHaveProperty('additionalProperties', false);

      // Get the tool name (the single property key)
      const toolName = Object.keys(item.properties)[0];

      // Critical: Empty schemas should have a proper schema (not just {})
      // This ensures Zod validation works correctly in union matching
      const innerSchema = item.properties[toolName];
      if (toolName === 'go_back' || toolName === 'done') {
        // Empty schemas should have been replaced with { _empty: boolean optional }
        // to ensure proper required field generation
        expect(innerSchema).toHaveProperty('type', 'object');
        expect(innerSchema).toHaveProperty('properties');
      }
    });
  });

  test('should correctly validate switch_tab action with union schema containing empty schemas', () => {
    const registry = new ToolRegistry();

    // Register multiple tools including empty schemas
    registry.register({
      name: 'switch_tab',
      description: 'Switch tab',
      schema: z.object({ tab_index: z.number().int().nonnegative() }),
      execute: async () => ({ success: true, actionEntity: { action_description: 'switch_tab', action_data: { action_name: 'switch_tab', kwargs: {} } } }),
    });

    registry.register({
      name: 'click',
      description: 'Click',
      schema: z.object({ element_index: z.number() }),
      execute: async () => ({ success: true, actionEntity: { action_description: 'click', action_data: { action_name: 'click', kwargs: {} } } }),
    });

    registry.register({
      name: 'go_back',
      description: 'Go back',
      schema: z.object({}),
      execute: async () => ({ success: true, actionEntity: { action_description: 'go_back', action_data: { action_name: 'go_back', kwargs: {} } } }),
    });

    registry.register({
      name: 'done',
      description: 'Done',
      schema: z.object({}),
      execute: async () => ({ success: true, actionEntity: { action_description: 'done', action_data: { action_name: 'done', kwargs: {} } } }),
    });

    const unionSchema = registry.buildActionUnionSchema();

    // Test that switch_tab action parses correctly
    const switchTabAction = { switch_tab: { tab_index: 0 } };
    const result = unionSchema.safeParse(switchTabAction);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(switchTabAction);
      expect(Object.keys(result.data)).toContain('switch_tab');
      expect((result.data as any).switch_tab.tab_index).toBe(0);
    }
  });

  test('should correctly validate click action with union schema', () => {
    const registry = new ToolRegistry();

    registry.register({
      name: 'click',
      description: 'Click',
      schema: z.object({ element_index: z.number().int().nonnegative() }),
      execute: async () => ({ success: true, actionEntity: { action_description: 'click', action_data: { action_name: 'click', kwargs: {} } } }),
    });

    registry.register({
      name: 'go_back',
      description: 'Go back',
      schema: z.object({}),
      execute: async () => ({ success: true, actionEntity: { action_description: 'go_back', action_data: { action_name: 'go_back', kwargs: {} } } }),
    });

    const unionSchema = registry.buildActionUnionSchema();

    const clickAction = { click: { element_index: 5 } };
    const result = unionSchema.safeParse(clickAction);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(clickAction);
    }
  });

  test('should correctly validate empty schema action (go_back)', () => {
    const registry = new ToolRegistry();

    registry.register({
      name: 'click',
      description: 'Click',
      schema: z.object({ element_index: z.number() }),
      execute: async () => ({ success: true, actionEntity: { action_description: 'click', action_data: { action_name: 'click', kwargs: {} } } }),
    });

    registry.register({
      name: 'go_back',
      description: 'Go back',
      schema: z.object({}),
      execute: async () => ({ success: true, actionEntity: { action_description: 'go_back', action_data: { action_name: 'go_back', kwargs: {} } } }),
    });

    const unionSchema = registry.buildActionUnionSchema();

    // go_back with empty object (or the dummy _empty field)
    const goBackAction = { go_back: {} };
    const result = unionSchema.safeParse(goBackAction);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toContain('go_back');
    }
  });

  test('should reject invalid action that matches no schema', () => {
    const registry = new ToolRegistry();

    registry.register({
      name: 'click',
      description: 'Click',
      schema: z.object({ element_index: z.number() }),
      execute: async () => ({ success: true, actionEntity: { action_description: 'click', action_data: { action_name: 'click', kwargs: {} } } }),
    });

    registry.register({
      name: 'go_back',
      description: 'Go back',
      schema: z.object({}),
      execute: async () => ({ success: true, actionEntity: { action_description: 'go_back', action_data: { action_name: 'go_back', kwargs: {} } } }),
    });

    const unionSchema = registry.buildActionUnionSchema();

    // Invalid action - nonexistent tool
    const invalidAction = { nonexistent_tool: { foo: 'bar' } };
    const result = unionSchema.safeParse(invalidAction);

    expect(result.success).toBe(false);
  });

  test('should handle large union with many tools including empty schemas', () => {
    const registry = new ToolRegistry();

    // Register 20+ tools like the real registry
    const toolsWithSchemas = [
      { name: 'click', schema: z.object({ element_index: z.number().int().nonnegative() }) },
      { name: 'hover', schema: z.object({ element_index: z.number().int().nonnegative() }) },
      { name: 'double_click', schema: z.object({ element_index: z.number().int().nonnegative() }) },
      { name: 'right_click', schema: z.object({ element_index: z.number().int().nonnegative() }) },
      { name: 'go_to_url', schema: z.object({ url: z.string(), new_tab: z.boolean().optional() }) },
      { name: 'go_back', schema: z.object({}) }, // Empty
      { name: 'reload_page', schema: z.object({}) }, // Empty
      { name: 'input_text', schema: z.object({ element_index: z.number(), text: z.string() }) },
      { name: 'clear_input', schema: z.object({ element_index: z.number() }) },
      { name: 'press', schema: z.object({ keys: z.string() }) },
      { name: 'scroll', schema: z.object({ direction: z.string().optional() }) },
      { name: 'close_tab', schema: z.object({ tab_index: z.number().optional() }) },
      { name: 'switch_tab', schema: z.object({ tab_index: z.number().int().nonnegative() }) },
      { name: 'wait', schema: z.object({ duration: z.number() }) },
      { name: 'wait_for_page_ready', schema: z.object({}) }, // Empty
      { name: 'done', schema: z.object({}) }, // Empty
    ];

    toolsWithSchemas.forEach(tool => {
      registry.register({
        name: tool.name,
        description: tool.name,
        schema: tool.schema,
        execute: async () => ({ success: true, actionEntity: { action_description: tool.name, action_data: { action_name: tool.name, kwargs: {} } } }),
      });
    });

    const unionSchema = registry.buildActionUnionSchema();

    // Test switch_tab action specifically - this was the failing case
    const switchTabAction = { switch_tab: { tab_index: 0 } };
    const result = unionSchema.safeParse(switchTabAction);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(switchTabAction);
      expect((result.data as any).switch_tab.tab_index).toBe(0);
    }

    // Also test a few other actions to ensure they work
    const clickResult = unionSchema.safeParse({ click: { element_index: 5 } });
    expect(clickResult.success).toBe(true);

    const goBackResult = unionSchema.safeParse({ go_back: {} });
    expect(goBackResult.success).toBe(true);

    const doneResult = unionSchema.safeParse({ done: {} });
    expect(doneResult.success).toBe(true);
  });
});
