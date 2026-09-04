/**
 * Mobile Tool Registry
 *
 * Manages tool registration and builds union schemas for generateObject.
 * Similar to web-sdk's ToolRegistry pattern.
 */

import { z } from 'zod';

// Import all tool schemas from actions
import {
  TapToolSchema,
  DoubleTapToolSchema,
  LongPressToolSchema,
  InputTextToolSchema,
  ClearInputToolSchema,
} from './actions/element';

import {
  SwipeToolSchema,
  ScrollToElementToolSchema,
  ScrollToolSchema,
} from './actions/gesture';

import {
  BackToolSchema,
  HomeToolSchema,
  EnterToolSchema,
  PressKeyToolSchema,
} from './actions/system';

import {
  DoneToolSchema,
  WaitToolSchema,
  AiAssertToolSchema,
} from './actions/agent';

/**
 * Tool definition with name, description, and schema
 */
interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  requiresLocator: boolean;
}

/**
 * All available mobile tools
 * Only includes tools useful for LLM action generation
 */
const MOBILE_TOOLS: ToolDefinition[] = [
  // Locator-based actions
  {
    name: 'tap',
    description: 'Tap an element',
    schema: TapToolSchema,
    requiresLocator: true,
  },
  {
    name: 'double_tap',
    description: 'Double-tap an element',
    schema: DoubleTapToolSchema,
    requiresLocator: true,
  },
  {
    name: 'long_press',
    description: 'Long press an element',
    schema: LongPressToolSchema,
    requiresLocator: true,
  },
  {
    name: 'input_text',
    description: 'Type text into an input field',
    schema: InputTextToolSchema,
    requiresLocator: true,
  },
  {
    name: 'clear_input',
    description: 'Clear text from an input field',
    schema: ClearInputToolSchema,
    requiresLocator: true,
  },
  {
    name: 'scroll_to_element',
    description: 'Scroll to find an element',
    schema: ScrollToElementToolSchema,
    requiresLocator: true,
  },

  // Non-locator actions
  {
    name: 'swipe',
    description: 'Swipe gesture for switching tabs, dismissing dialogs, or navigating pages (use scroll for scrolling content)',
    schema: SwipeToolSchema,
    requiresLocator: false,
  },
  {
    name: 'scroll',
    description: 'Scroll content with precise from/to coordinates (preferred for scrolling lists, feeds, etc.)',
    schema: ScrollToolSchema,
    requiresLocator: false,
  },
  {
    name: 'back',
    description: 'Press the back button',
    schema: BackToolSchema,
    requiresLocator: false,
  },
  {
    name: 'home',
    description: 'Press the home button',
    schema: HomeToolSchema,
    requiresLocator: false,
  },
  {
    name: 'enter',
    description: 'Press the enter key',
    schema: EnterToolSchema,
    requiresLocator: false,
  },
  {
    name: 'press_key',
    description: 'Press a system key by key code',
    schema: PressKeyToolSchema,
    requiresLocator: false,
  },
  {
    name: 'wait',
    description: 'Wait for a specified duration',
    schema: WaitToolSchema,
    requiresLocator: false,
  },
  {
    name: 'done',
    description: 'Mark the task as complete',
    schema: DoneToolSchema,
    requiresLocator: false,
  },
  {
    name: 'ai_assert',
    description: 'Assert that a statement is true based on the current screen state',
    schema: AiAssertToolSchema,
    requiresLocator: false,
  },
];

/**
 * Build a union schema for all mobile actions
 *
 * Creates schemas like:
 * { tap: { locator: "text=Login" } }
 * { input_text: { locator: "resource-id=...", text: "hello" } }
 * { swipe: { direction: "up" } }
 * { done: { success: true, message: "Task completed" } }
 */
export function buildMobileActionUnionSchema(): z.ZodType {
  // Wrap each tool's schema as { toolName: schema }
  const wrappedSchemas = MOBILE_TOOLS.map(tool => {
    let schema: z.ZodType = tool.schema;

    // For empty schemas (no properties), add a dummy optional field
    // Gemini rejects objects with empty properties
    if (schema instanceof z.ZodObject) {
      const shape = schema._def.shape();
      if (Object.keys(shape).length === 0) {
        schema = z.object({ _empty: z.boolean().optional() });
      }
    }

    return z.object({ [tool.name]: schema });
  });

  // Create union of all wrapped schemas
  if (wrappedSchemas.length === 1) {
    return wrappedSchemas[0];
  }

  const [first, second, ...rest] = wrappedSchemas;
  return z.union([first, second, ...rest]);
}

/**
 * Get tool descriptions for the system prompt
 */
export function getToolDescriptions(): string {
  const locatorBased = MOBILE_TOOLS.filter(t => t.requiresLocator);
  const nonLocator = MOBILE_TOOLS.filter(t => !t.requiresLocator);

  let desc = '### Locator-based actions (require locator):\n';
  for (const tool of locatorBased) {
    desc += `- ${tool.name}: ${tool.description}\n`;
  }

  desc += '\n### Non-locator actions:\n';
  for (const tool of nonLocator) {
    desc += `- ${tool.name}: ${tool.description}\n`;
  }

  return desc;
}

/**
 * Get all registered tool names
 */
export function getToolNames(): string[] {
  return MOBILE_TOOLS.map(t => t.name);
}
