/**
 * Variable replacement utility
 *
 * Shared by web-sdk and mobile-sdk for consistent variable substitution.
 */

/**
 * Replace variables in a string with values from a variables object.
 * Supports multiple formats:
 * - ${varName} - template literal style
 * - $varName - simple variable style
 * - {{ varName }} or {{varName}} - Jinja-like template syntax
 * - <secret>varName</secret> - legacy secret format
 * - <secret>$varName</secret> - legacy secret format with $ prefix
 *
 * Variables can be stored with or without $ prefix in the variables object.
 *
 * @param text - Text containing variable placeholders
 * @param variables - Object or Map containing variable name-value pairs
 * @returns Text with variables substituted
 */
export function replaceVariables(
  text: string,
  variables: Record<string, any> | Map<string, any>,
): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Normalize variables to Record format
  const varsRecord: Record<string, any> =
    variables instanceof Map ? Object.fromEntries(variables) : variables;

  // Helper to get value for a variable name (handles with/without $ prefix)
  const getValue = (varName: string): string | undefined => {
    const cleanName = varName.startsWith('$') ? varName.slice(1) : varName;
    const value = varsRecord[cleanName] ?? varsRecord[`$${cleanName}`];
    return value !== null && value !== undefined ? String(value) : undefined;
  };

  // ONE left-to-right pass over all four syntaxes.
  //
  // This used to be four sequential `String.replace` calls, which meant a value
  // written by an earlier pass was still visible to a later one: substituting
  // `{{pw}}` with `P$word` left `$word` in the output, and the `$varName` pass
  // then rewrote it if a variable named `word` existed. Passwords and tokens are
  // the usual carriers of `$`, so the corruption landed on exactly the values
  // that must survive intact.
  //
  // `String.replace` with a global regex resumes scanning after the text it
  // just inserted, never inside it, so substituted values are inert by
  // construction. Alternation order below preserves the original precedence:
  // {{ }} first, then <secret>, then ${ }, then bare $name.
  const PLACEHOLDER =
    /\{\{\s*\$?([^}]+?)\s*\}\}|<secret>\$?([\w-]+)<\/secret>|\$\{([^}]+)\}|\$([a-zA-Z_]\w*)/g;

  return text.replace(
    PLACEHOLDER,
    (
      match: string,
      jinja: string | undefined,
      secret: string | undefined,
      braced: string | undefined,
      simple: string | undefined,
    ) => {
      // Exactly one branch matches, so exactly one group is defined.
      const varName = jinja ?? secret ?? braced ?? simple;
      if (varName === undefined) return match;
      const value = getValue(varName.trim());
      return value !== undefined ? value : match;
    },
  );
}
