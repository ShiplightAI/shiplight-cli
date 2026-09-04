/**
 * Code validation utilities for JavaScript syntax checking.
 * Used during transpilation to ensure generated code is syntactically valid.
 */

import { parse } from '@babel/parser';

/**
 * Validates if a string is valid JavaScript syntax.
 * Uses @babel/parser for accurate syntax checking, consistent with frontend validation.
 * Suitable for validating expressions like Playwright expect statements.
 *
 * @param code The code string to validate
 * @returns true if the code is valid JavaScript syntax
 */
export function isValidJavaScriptSyntax(code: string): boolean {
  if (!code.trim()) return false;
  try {
    parse(code, {
      sourceType: 'module',
      plugins: ['typescript'],
    });
    return true;
  } catch {
    return false;
  }
}
