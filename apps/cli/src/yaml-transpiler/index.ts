/**
 * YAML Transpiler — barrel exports
 *
 * All implementation lives in dedicated modules; this file only re-exports.
 */

// Types
export type {
  ParameterSet, ParsedSuiteTest, ParsedSuite, TranspileFileOptions,
  SectionType,
} from './types';

// Core transpilers
export { transpileYamlTest, transpileYamlSuite } from './transpile';

// YAML parser
export { parseYamlTestFile } from './yamlParser';
export type { ParsedYamlTestFile } from './yamlParser';

// Shared pipeline (validate → parse → transpile → write)
export { transpileYamlFile, transpileYamlContent } from './pipeline';
export type { TranspileResult } from './pipeline';

// Utilities
export { getActionTranspiler } from './actions';
export { escapeString, sanitizeForComment, getPageLocatorExpression, isAiAction, canSelfHeal } from './utils';
export { transpileStatements } from './statements';
export type { TranspileOptions } from './statements';
export { expandTemplates } from './templates';
export type { ExpandResult } from './templates';
