/**
 * Shared types for the YAML transpiler
 */

import type { TestFlow } from 'shiplight-types';

export interface ParameterSet {
  name: string;
  values: Record<string, string>;
}

export interface ParsedSuiteTest {
  testFlow: TestFlow;
  name: string;
  tags?: string[];
  parameters?: ParameterSet[];
  timeout?: number;
  skip?: boolean | string;
  fail?: boolean | string;
  only?: boolean;
  slow?: boolean;
}

export interface ParsedSuite {
  beforeAll?: any[];
  afterAll?: any[];
  beforeEach?: any[];
  afterEach?: any[];
  tests: ParsedSuiteTest[];
}

// ── Suite Section Types ──

export type { SectionType } from 'shiplight-types';

// ── Transpiler Options ──

export interface TranspileFileOptions {
  /** Version string for cache invalidation header */
  version?: string;
  testName?: string;
  tags?: string[];
  use?: Record<string, unknown>;
  /** Hooks for single-test files */
  beforeEach?: any[];
  afterEach?: any[];
  /** Parameters for single-test files */
  parameters?: ParameterSet[];
  /** Execution control annotations */
  timeout?: number;
  skip?: boolean | string;
  fail?: boolean | string;
  only?: boolean;
  slow?: boolean;
  /** Cached action entities keyed by statement UID (for cloud cache integration) */
  actionEntityStore?: import('shiplight-types').ActionEntityStore;
  /**
   * Called once per transpiled action with whether its entity came from the
   * cache or from the YAML itself. Purely observational — the transpiler's
   * output does not depend on it — so a caller that does not care omits it.
   * Exists because this is the ONLY point that knows which of the two won:
   * downstream, a cached and an inline entity are indistinguishable.
   */
  onActionEntitySource?: (info: {
    uid: string;
    description: string;
    source: 'original' | 'cache_hit';
    originalEntity?: import('shiplight-types').ActionEntity;
    cachedEntity?: import('shiplight-types').ActionEntity;
  }) => void;
  /**
   * Absolute path to the .test.yaml itself. Used to derive deterministic UIDs
   * for hook statements, which are parsed separately from the main flow and
   * would otherwise get a fresh UUID on every transpile — making them
   * permanently uncacheable. Same path `parseYamlTestFile` keys the main
   * statements by, so hooks key consistently with the rest of the file.
   */
  filePath?: string;
  /** Absolute path to the directory containing the .test.yaml (and output .yaml.spec.ts) */
  yamlDir?: string;
  /** Project root — bare paths in function references are resolved relative to this */
  projectRoot?: string;
}
