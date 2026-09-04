/**
 * Variable resolution for custom action arguments.
 *
 * The action-generation prompt instructs the model to emit `{{ placeholder }}`
 * rather than the real value of a variable, so credentials never appear in LLM
 * output or stored trajectories. Built-in actions honour the other half of that
 * contract by resolving their own fields at execution time; custom actions get
 * the same treatment through `resolveActionArgs`.
 */

import { replaceVariables } from 'shiplight-types';

/**
 * Resolve every string inside a model-supplied argument object.
 *
 * Recurses through arrays and plain objects so nested schemas
 * (`z.object({ user: z.object({ email: z.string() }) })`, `z.array(z.string())`)
 * are covered. Non-strings pass through untouched, and class instances such as
 * `Date` are returned as-is rather than rebuilt into bare objects.
 *
 * The input is never mutated — callers keep the raw arguments for the trajectory.
 *
 * @param value - Argument value from the model (any depth)
 * @param variables - Variable name/value pairs, e.g. `variableStore.getAll()`
 * @returns A copy with `{{ name }}`, `{{ $name }}`, `${name}` and `$name` resolved
 */
export function resolveActionArgs<T>(value: T, variables: Record<string, unknown>): T {
  return resolveValue(value, variables) as T;
}

function resolveValue(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return replaceVariables(value, variables);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, variables));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, variables)])
    );
  }

  return value;
}

/**
 * True only for object literals (what Zod produces) and null-prototype objects.
 * Keeps `Date`, `Map`, `Buffer` and other class instances out of the recursion,
 * which would otherwise be flattened into plain objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
