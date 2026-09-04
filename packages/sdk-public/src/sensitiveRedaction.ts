/**
 * Redaction of sensitive variable values in handler-authored text.
 *
 * `sensitiveKeys` promises that a value is not sent to the LLM. Custom action
 * arguments are variable-resolved, so a handler can see a sensitive value and echo
 * it back in its result message — which is recorded in the trajectory and returned
 * to the model as tool output. Masking on the way out keeps that promise.
 */

const MASK = '*****';

/**
 * Replace every occurrence of a sensitive variable's value with `*****`.
 *
 * Values are masked longest-first, so overlapping secrets (`abc` and `abcdef`) cannot
 * leave the tail of the longer one behind. Non-string values are stringified the same
 * way the resolver stringifies them, so a numeric PIN is masked too.
 *
 * @param text - Text from a custom action handler (result message or error message)
 * @param variables - All variables, e.g. `variableStore.getAll()`
 * @param sensitiveKeys - Keys marked sensitive, e.g. `variableStore.getAllSensitiveKeys()`
 * @returns The text with sensitive values masked, or the input unchanged if there is
 *          nothing to mask
 */
export function redactSensitiveValues(
  text: string | undefined,
  variables: Record<string, unknown>,
  sensitiveKeys: Set<string>
): string | undefined {
  if (!text || sensitiveKeys.size === 0) {
    return text;
  }

  const secrets: string[] = [];
  for (const key of sensitiveKeys) {
    const value = variables[key];
    if (value === null || value === undefined) {
      continue;
    }
    // Matches how replaceVariables substitutes: String(value), so a number reaches the
    // handler as "123456" and has to be masked in that form.
    const secret = String(value);
    if (secret.length > 0) {
      secrets.push(secret);
    }
  }

  // Longest first: masking "abc" before "abcdef" would leave "*****def" behind.
  secrets.sort((a, b) => b.length - a.length);

  let redacted = text;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join(MASK);
  }

  return redacted;
}
