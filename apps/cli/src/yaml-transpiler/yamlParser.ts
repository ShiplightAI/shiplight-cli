/**
 * Extended YAML Parser
 *
 * Wraps the existing yamlToTestFlow() from shiplight-types to extract
 * local extensions (name, tags, use) and expand templates before
 * passing to the core parser.
 */

import { createHash } from 'crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { TestFlow, Statement, Action, Step, IfElse, WhileLoop } from 'shiplight-types';
import { yamlToTestFlow, StatementType } from 'shiplight-types';
import { expandTemplates } from './templates';
import { repoRelativeIdentityPath } from './statementIdentityPath';
import type { ParameterSet, ParsedSuite, ParsedSuiteTest } from './types';

/** Validation error thrown for user-facing YAML issues (not transpiler bugs). */
export class YamlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YamlValidationError';
  }
}

/* ---------- Types ---------- */

export interface ParsedYamlTestFile {
  /** Present for single-test files */
  testFlow?: TestFlow;
  /** Present for suite files */
  suite?: ParsedSuite;
  name?: string;
  tags?: string[];
  use?: Record<string, unknown>;
  /** Top-level hooks for single-test files */
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
  /** Absolute paths of template files referenced during parsing (for cache invalidation) */
  referencedTemplatePaths: string[];
}

/* ---------- Parser ---------- */

/**
 * Parse a YAML test file, extracting local extensions and expanding
 * templates before delegating to the core yamlToTestFlow() parser.
 *
 * @param yamlString - Raw YAML content
 * @param filePath - Absolute path of the YAML file (needed for template resolution).
 *                   If not provided, template expansion is skipped.
 * @param basePath - Project root used as a fallback when a template path cannot be
 *                   resolved relative to the importing file.
 */
export function parseYamlTestFile(yamlString: string, filePath?: string, basePath?: string): ParsedYamlTestFile {
  // First, extract our extensions from the raw YAML
  let rawDoc = parseYaml(yamlString);

  const name = rawDoc?.name as string | undefined;
  const tags = rawDoc?.tags as string[] | undefined;
  const use = rawDoc?.use as Record<string, unknown> | undefined;

  // Strip shared extensions before further processing
  if (rawDoc && (rawDoc.name !== undefined || rawDoc.tags !== undefined || rawDoc.use !== undefined)) {
    delete rawDoc.name;
    delete rawDoc.tags;
    delete rawDoc.use;
  }

  // Detect suite vs single-test
  if (rawDoc?.suite) {
    // Validate: cannot mix suite with top-level goal/statements
    if (rawDoc.goal || rawDoc.statements) {
      throw new YamlValidationError(
        'YAML file cannot have both "suite" and top-level "goal"/"statements". ' +
        'Use either suite format or single-test format.',
      );
    }
    return parseSuiteFile(rawDoc, name, tags, use, filePath, basePath);
  }

  return parseSingleTestFile(rawDoc, name, tags, use, filePath, basePath);
}

/* ---------- Single-test parsing ---------- */

function parseSingleTestFile(
  rawDoc: any,
  name: string | undefined,
  tags: string[] | undefined,
  use: Record<string, unknown> | undefined,
  filePath: string | undefined,
  basePath?: string,
): ParsedYamlTestFile {
  // Extract single-test hooks
  const beforeEach = rawDoc?.beforeEach as any[] | undefined;
  const afterEach = rawDoc?.afterEach as any[] | undefined;
  const parameters = parseParameterSets(rawDoc?.parameters);

  // Extract execution control annotations
  const timeout = rawDoc?.timeout as number | undefined;
  const skip = rawDoc?.skip as boolean | string | undefined;
  const fail = rawDoc?.fail as boolean | string | undefined;
  const only = rawDoc?.only as boolean | undefined;
  const slow = rawDoc?.slow as boolean | undefined;

  // Strip hook/parameter/execution-control fields before passing to core parser
  if (rawDoc) {
    delete rawDoc.beforeEach;
    delete rawDoc.afterEach;
    delete rawDoc.parameters;
    delete rawDoc.timeout;
    delete rawDoc.skip;
    delete rawDoc.fail;
    delete rawDoc.only;
    delete rawDoc.slow;
  }

  // Reject deprecated `url:` field — users should use `base_url:` + `URL: /` instead
  if (rawDoc?.url) {
    throw new YamlValidationError(
      `The "url" field is not supported in local YAML tests. ` +
      `Use "base_url: ${rawDoc.url}" and add "- URL: /" as the first statement instead.`,
    );
  }

  // Auto-set goal from name if missing (core parser requires goal)
  if (rawDoc && !rawDoc.goal && name) {
    rawDoc.goal = name;
  }

  // Expand templates if a file path is provided
  let referencedTemplatePaths: string[] = [];
  if (filePath && rawDoc && typeof rawDoc === 'object') {
    const expandResult = expandTemplates(rawDoc, filePath, basePath);
    rawDoc = expandResult.doc;
    referencedTemplatePaths = expandResult.referencedTemplatePaths;
  }

  // Re-serialize and parse through the core parser
  const cleanYaml = stringifyYaml(rawDoc);
  const testFlow = yamlToTestFlow(cleanYaml);

  // Replace random UIDs with deterministic hash-based UIDs.
  // This makes UIDs stable across parses of the same YAML file,
  // enabling the action entity cache to match entries by UID.
  if (filePath) {
    assignDeterministicUids(testFlow.statements ?? [], filePath, 'main');
    if (testFlow.teardown) {
      assignDeterministicUids(testFlow.teardown, filePath, 'teardown');
    }
  }

  return {
    testFlow,
    name,
    tags,
    use,
    beforeEach,
    afterEach,
    parameters,
    timeout,
    skip,
    fail,
    only,
    slow,
    referencedTemplatePaths,
  };
}

/* ---------- Suite parsing ---------- */

function parseSuiteFile(
  rawDoc: any,
  name: string | undefined,
  tags: string[] | undefined,
  use: Record<string, unknown> | undefined,
  filePath: string | undefined,
  basePath?: string,
): ParsedYamlTestFile {
  const suiteRaw = rawDoc.suite;

  if (!Array.isArray(suiteRaw.tests) || suiteRaw.tests.length === 0) {
    throw new Error('Suite must have a non-empty "tests" array.');
  }

  // Extract suite-level hooks
  const beforeAll = suiteRaw.beforeAll as any[] | undefined;
  const afterAll = suiteRaw.afterAll as any[] | undefined;
  const beforeEach = suiteRaw.beforeEach as any[] | undefined;
  const afterEach = suiteRaw.afterEach as any[] | undefined;

  const allReferencedPaths: string[] = [];

  // Parse each test in the suite
  const tests: ParsedSuiteTest[] = suiteRaw.tests.map((testRaw: any, testIndex: number) => {
    if (!testRaw.name) {
      throw new Error('Each test in a suite must have a "name" field.');
    }
    if (!Array.isArray(testRaw.statements) || testRaw.statements.length === 0) {
      throw new Error(`Suite test "${testRaw.name}" must have a non-empty "statements" array.`);
    }

    // Build a mini YAML doc for the core parser
    const miniDoc: any = {
      goal: testRaw.name,
      statements: testRaw.statements,
    };
    if (testRaw.teardown) {
      miniDoc.teardown = testRaw.teardown;
    }

    // Expand templates in this mini doc
    let referencedPaths: string[] = [];
    let expandedDoc = miniDoc;
    if (filePath && typeof miniDoc === 'object') {
      const expandResult = expandTemplates(miniDoc, filePath, basePath);
      expandedDoc = expandResult.doc;
      referencedPaths = expandResult.referencedTemplatePaths;
      allReferencedPaths.push(...referencedPaths);
    }

    const cleanYaml = stringifyYaml(expandedDoc);
    const testFlow = yamlToTestFlow(cleanYaml);

    // Same deterministic re-keying the single-test path does, for the same
    // reason: `yamlToTestFlow` stamps a fresh uuidv4() per statement, so
    // without this a suite's UIDs differ on every parse. Two consequences,
    // both real — the action-entity cache can never match a suite statement,
    // and the generated spec is not byte-stable, so a re-transpile rewrites it
    // with new UIDs. That second one bites hard because Playwright re-imports
    // playwright.config.ts in EVERY worker process (workerMain._loadIfNeeded →
    // deserializeConfig → requireOrImport), so a worker would execute a spec
    // whose UIDs no longer match the ones the main process recorded, and every
    // heal inside a suite test would be dropped from the run's cache summary
    // and from the cache write-back.
    // The prefix is indexed per test so two tests in one suite cannot collide,
    // and it is disjoint from `main`/`teardown` and the hook-name prefixes.
    if (filePath) {
      const prefix = `tests[${testIndex}]`;
      assignDeterministicUids(testFlow.statements ?? [], filePath, prefix);
      if (testFlow.teardown) {
        assignDeterministicUids(testFlow.teardown, filePath, `${prefix}.teardown`);
      }
    }

    const parameters = parseParameterSets(testRaw.parameters);

    return {
      testFlow,
      name: testRaw.name as string,
      // A bare scalar (`tags: auth`) is accepted as a one-element list, matching
      // how the file-level `tags` above is handled. Requiring an array here made
      // the same spelling emit a tag at file level and nothing per test.
      tags: testRaw.tags === undefined || testRaw.tags === null
        ? undefined
        : (Array.isArray(testRaw.tags) ? testRaw.tags : [testRaw.tags]) as string[],
      parameters,
      timeout: testRaw.timeout as number | undefined,
      skip: testRaw.skip as boolean | string | undefined,
      fail: testRaw.fail as boolean | string | undefined,
      only: testRaw.only as boolean | undefined,
      slow: testRaw.slow as boolean | undefined,
    };
  });

  // Merge base_url into use as baseURL.
  //
  // Two accepted spellings, both mapping to Playwright's `test.use({ baseURL })`:
  //   - top-level `base_url:` — the form documented in the YAML spec §3, which
  //     lists it as a top-level key with no suite exception. This is what users
  //     write by hand.
  //   - nested `suite.base_url:` — what `suiteToYaml` emits on the debugger
  //     round-trip, so it must keep working.
  // Only the nested form used to be read, which silently discarded the
  // documented one and left every relative `URL:` with no base (issue #2209).
  // The nested form wins when both are present: it is the more specific key.
  const suiteBaseUrl = (suiteRaw.base_url ?? rawDoc.base_url) as string | undefined;
  const mergedUse = suiteBaseUrl
    ? { ...use, baseURL: suiteBaseUrl }
    : use;

  return {
    suite: {
      beforeAll,
      afterAll,
      beforeEach,
      afterEach,
      tests,
    },
    name,
    tags,
    use: mergedUse,
    referencedTemplatePaths: allReferencedPaths,
  };
}

/* ---------- Parameter parsing ---------- */

function parseParameterSets(raw: any): ParameterSet[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  return raw.map((entry: any, idx: number) => {
    if (!entry.name) {
      throw new Error(`Parameter set at index ${idx} must have a "name" field.`);
    }
    if (!entry.values || typeof entry.values !== 'object') {
      throw new Error(`Parameter set "${entry.name}" must have a "values" object.`);
    }
    return {
      name: entry.name as string,
      values: entry.values as Record<string, string>,
    };
  });
}

// ============================================================================
// Deterministic UIDs
// ============================================================================

/**
 * Replace random UUIDs with deterministic hash-based UIDs.
 * Uses SHA-256 of (filePath + statementPath + description), formatted as UUID v4.
 * This ensures UIDs are stable across parses of the same YAML file.
 */
export function assignDeterministicUids(
  statements: Statement[],
  filePath: string,
  pathPrefix: string,
): void {
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const stmtPath = `${pathPrefix}.${i}`;
    const desc = (stmt as Action).description || '';

    // Generate deterministic UID formatted as UUID v4
    stmt.uid = computeDeterministicUid(filePath, stmtPath, desc);

    // Recurse into nested statements
    if (stmt.type === StatementType.STEP) {
      assignDeterministicUids((stmt as Step).statements, filePath, stmtPath);
    } else if (stmt.type === StatementType.IF_ELSE) {
      const ifElse = stmt as IfElse;
      assignDeterministicUids(ifElse.then, filePath, `${stmtPath}.then`);
      if (ifElse.else) {
        assignDeterministicUids(ifElse.else, filePath, `${stmtPath}.else`);
      }
    } else if (stmt.type === StatementType.WHILE_LOOP) {
      assignDeterministicUids((stmt as WhileLoop).body, filePath, `${stmtPath}.body`);
    }
  }
}

/**
 * Compute a deterministic UID in UUID v4 format from file path + statement path + description.
 *
 * Deliberately independent of the statement's CONTENT. The UID is an identity, not a
 * validity token: it names the artifact directories a failed statement writes
 * (`.shiplight/artifacts/<yaml>/<uid>_before`, read back by the debugger), it is the
 * `stmtUid` the generated spec passes to `agent.step`, and post-run cache attribution
 * finds a statement's file by testing `specContent.includes(uid)`. Deriving it from the
 * locator or kwargs would detach a statement's screenshots the moment someone edits the
 * locator to debug it, and would break mid-run attribution under watch/UI mode where the
 * spec is rewritten while the run is in flight.
 *
 * Whether a cached entity is still APPLICABLE to the current YAML is a separate question,
 * answered by `source_fingerprint` on the store entry — see
 * `shiplight-types/actionEntityFingerprint`.
 *
 * The path is reduced to its repo-relative, forward-slashed form first, so a UID identifies
 * a statement rather than a checkout — see `repoRelativeIdentityPath`.
 */
function computeDeterministicUid(filePath: string, statementPath: string, description: string): string {
  const identityPath = repoRelativeIdentityPath(filePath);
  const hash = createHash('sha256').update(`${identityPath}:${statementPath}:${description}`).digest('hex');
  // Format as UUID v4: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}
