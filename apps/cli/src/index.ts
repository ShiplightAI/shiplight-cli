/**
 * shiplightai
 *
 * Shiplight CLI for running and debugging .test.yaml files.
 *
 * Config-time exports only. For test fixtures (test, expect),
 * import from 'shiplightai/fixture'.
 */

export { shiplightConfig, defineConfig, type ShiplightOptions, type ShiplightUseOptions } from './config';

// SDK re-exports needed by standalone transpiler output
export { WebAgent, createAgentContext, configureSdk, VariableStore } from 'sdk-core';
