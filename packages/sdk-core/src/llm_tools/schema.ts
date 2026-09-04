/**
 * LLM Tools - Schema Utilities
 *
 * Utilities for converting Zod schemas to JSON Schema compatible with
 * OpenAI strict mode and MCP format. Based on browser-use's SchemaOptimizer.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert Zod schema to JSON Schema compatible with OpenAI strict mode
 *
 * OpenAI strict mode requirements:
 * - All objects must have `additionalProperties: false`
 * - All properties must be in the `required` array
 * - No $ref or $defs (everything must be inlined)
 * - Parameters must always be an object (even for single parameters)
 *
 * @param schema - Zod schema to convert
 * @returns JSON Schema object ready for OpenAI API
 */
export function zodToOpenAISchema(schema: z.ZodType): Record<string, any> {
  // Convert Zod to JSON Schema with flattened refs
  let jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: 'none', // Flatten all $refs (no definitions)
  });

  // Remove $schema field if present (OpenAI doesn't want it)
  if (jsonSchema.$schema) {
    delete jsonSchema.$schema;
  }

  // Ensure the root is always an object (OpenAI requirement)
  if ((jsonSchema as any).type !== 'object') {
    // If it's not an object, the schema should already be an object type
    // This should not happen with z.object(), but just in case
    throw new Error(`Schema must be a Zod object schema, got type: ${(jsonSchema as any).type}`);
  }

  // Make compatible with OpenAI strict mode
  makeStrictCompatible(jsonSchema);

  return jsonSchema;
}

/**
 * Convert Zod schema to JSON Schema for MCP (Model Context Protocol)
 *
 * MCP is less strict than OpenAI, so we use a more permissive format
 *
 * @param schema - Zod schema to convert
 * @returns JSON Schema object for MCP
 */
export function zodToMCPSchema(schema: z.ZodType): Record<string, any> {
  return zodToJsonSchema(schema, {
    $refStrategy: 'none',
  });
}

/**
 * Make a JSON Schema compatible with OpenAI strict mode
 *
 * Recursively processes the schema to ensure:
 * 1. All objects have `additionalProperties: false`
 * 2. All object properties are required
 * 3. No optional fields remain
 *
 * @param schema - JSON Schema object to modify in-place
 */
function makeStrictCompatible(schema: any): void {
  if (typeof schema !== 'object' || schema === null) {
    return;
  }

  // Handle objects
  if (schema.type === 'object') {
    // Add additionalProperties: false for strict mode
    schema.additionalProperties = false;

    // Make all properties required
    if (schema.properties) {
      const allProps = Object.keys(schema.properties);
      schema.required = allProps;

      // Recursively apply to nested properties
      for (const prop of Object.values(schema.properties)) {
        makeStrictCompatible(prop);
      }
    }
  }

  // Handle arrays
  if (schema.type === 'array' && schema.items) {
    makeStrictCompatible(schema.items);
  }

  // Handle union types (anyOf, oneOf, allOf)
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) {
      schema[key].forEach(makeStrictCompatible);
    }
  }

  // Recursively process other nested objects
  for (const [key, value] of Object.entries(schema)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      !['properties', 'items', 'anyOf', 'oneOf', 'allOf'].includes(key)
    ) {
      makeStrictCompatible(value);
    }
  }
}

/**
 * Optimize a JSON Schema by removing unnecessary metadata
 *
 * Removes fields like:
 * - title (unless inside properties)
 * - examples
 * - default values (if preserveDefaults is false)
 *
 * @param schema - JSON Schema to optimize
 * @param options - Optimization options
 * @returns Optimized schema
 */
export function optimizeSchema(
  schema: Record<string, any>,
  options: {
    preserveDefaults?: boolean;
    preserveDescriptions?: boolean;
  } = {}
): Record<string, any> {
  const {
    preserveDefaults = false,
    preserveDescriptions = true,
  } = options;

  const optimized: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema)) {
    // Skip metadata fields
    if (key === 'title' || key === 'examples') {
      continue;
    }

    // Skip default values if not preserving
    if (key === 'default' && !preserveDefaults) {
      continue;
    }

    // Always preserve descriptions (helpful for LLM)
    if (key === 'description' && preserveDescriptions) {
      optimized[key] = value;
      continue;
    }

    // Recursively optimize nested objects
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      optimized[key] = optimizeSchema(value, options);
    } else if (Array.isArray(value)) {
      optimized[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? optimizeSchema(item, options)
          : item
      );
    } else {
      optimized[key] = value;
    }
  }

  return optimized;
}

/**
 * Validate that a schema is compatible with OpenAI strict mode
 *
 * Checks for:
 * - All objects have additionalProperties: false
 * - All properties are required
 * - No $ref or $defs
 *
 * @param schema - JSON Schema to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateStrictMode(schema: any): string[] {
  const errors: string[] = [];

  function validate(obj: any, path: string = 'root'): void {
    if (typeof obj !== 'object' || obj === null) {
      return;
    }

    // Check for $ref or $defs
    if (obj.$ref) {
      errors.push(`${path}: Contains $ref (not allowed in strict mode)`);
    }
    if (obj.$defs) {
      errors.push(`${path}: Contains $defs (not allowed in strict mode)`);
    }

    // Check objects for strict mode compliance
    if (obj.type === 'object') {
      if (obj.additionalProperties !== false) {
        errors.push(
          `${path}: Object must have additionalProperties: false`
        );
      }

      if (obj.properties) {
        const allProps = Object.keys(obj.properties);
        const required = obj.required || [];

        if (required.length !== allProps.length) {
          errors.push(
            `${path}: Not all properties are required (${required.length}/${allProps.length})`
          );
        }

        // Validate nested properties
        for (const [propName, propSchema] of Object.entries(obj.properties)) {
          validate(propSchema, `${path}.${propName}`);
        }
      }
    }

    // Validate arrays
    if (obj.type === 'array' && obj.items) {
      validate(obj.items, `${path}[]`);
    }

    // Validate union types
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(obj[key])) {
        obj[key].forEach((item: any, i: number) => {
          validate(item, `${path}.${key}[${i}]`);
        });
      }
    }
  }

  validate(schema);
  return errors;
}
