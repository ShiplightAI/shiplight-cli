/**
 * Test Flow Transpiler — type and helper re-exports.
 *
 * This deliberately holds no transpile wrapper. It used to export
 * `transpileTestFlow`/`transpileSuiteFile`, which injected
 * `TRANSPILER_CACHE_KEY` around the yaml-transpiler — but every shipping call
 * site (`src/transpile.ts`, `src/commands/transpile.ts`) injects the version
 * itself against a different entry point (`transpileYamlFile`). Only the test
 * suite reached the wrapper, so it was a second implementation of the version
 * stamp that nothing shipped and no test of production behaviour covered.
 *
 * The version itself lives in `./version` and is imported directly by the call
 * sites that need it.
 */

import type { TranspileFileOptions, ParsedSuite } from '../yaml-transpiler';

export type { TranspileFileOptions, ParsedSuite };
export type { ParameterSet, ParsedSuiteTest } from '../yaml-transpiler';


export { escapeString } from '../yaml-transpiler';
export { transpileStatements } from '../yaml-transpiler';
export type { TranspileOptions } from '../yaml-transpiler';
