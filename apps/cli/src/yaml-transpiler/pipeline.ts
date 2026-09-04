/**
 * Shared validate → parse → transpile → write pipeline
 *
 * Consumed by the CLI `transpile` command (its former second consumer, the MCP
 * `validate_yaml_test` tool, moved into the CLI as `transpile --strict`).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { validateTestYaml, type ValidationResult } from 'shiplight-types';
import { parseYamlTestFile, YamlValidationError, type ParsedYamlTestFile } from './yamlParser';
// Import directly from defining file to avoid circular dependency with index.ts
import { transpileYamlTest, transpileYamlSuite } from './transpile';
import type { TranspileFileOptions } from './types';

export interface TranspileResult {
  /** Whether validation and transpilation succeeded */
  valid: boolean;
  /** Hard errors that prevent transpilation */
  errors: string[];
  /** Soft warnings (e.g. low action coverage) */
  warnings: string[];
  /** Locator coverage stats */
  stats?: ValidationResult['stats'];
  /** Path of the written .yaml.spec.ts file (only if successful) */
  specFile?: string;
  /** Absolute paths of template files referenced during parsing (for cache invalidation) */
  referencedTemplatePaths?: string[];
}

/**
 * Full pipeline: read YAML → validate → parse (suites/hooks/params/templates) →
 * transpile → validate JS syntax → write .yaml.spec.ts.
 *
 * @param filePath - Absolute path to the .test.yaml file
 * @param options - Optional transpile options (version string)
 * @returns Result with errors, warnings, stats, and output path
 */
export function transpileYamlFile(
  filePath: string,
  options?: Pick<TranspileFileOptions, 'version' | 'actionEntityStore'> & { basePath?: string },
): TranspileResult {
  // Read file
  let yamlContent: string;
  try {
    yamlContent = readFileSync(filePath, 'utf-8');
  } catch (err: any) {
    return {
      valid: false,
      errors: [`Failed to read file: ${err.message}`],
      warnings: [],
    };
  }

  return transpileYamlContent(yamlContent, filePath, options);
}

/**
 * Pipeline from YAML content string (when content is already in memory).
 */
export function transpileYamlContent(
  yamlContent: string,
  filePath: string,
  options?: Pick<TranspileFileOptions, 'version' | 'actionEntityStore' | 'onActionEntitySource'> & {
    /** Pre-parsed YAML test file. If provided, skips internal re-parse (avoids UID regeneration). */
    parsed?: ParsedYamlTestFile;
    /** Project root used as a fallback when a template path cannot be resolved relative to the test file. */
    basePath?: string;
    /** Project root — bare paths in function references are resolved relative to this */
    projectRoot?: string;
  },
): TranspileResult {
  // 1. Validate YAML structure and JS syntax
  //    Skip validation for files with template references (expanded later in parseYamlTestFile)
  //    Skip validation for suite files (no top-level goal/statements) and template references
  const hasTemplates = /\btemplate:\s/.test(yamlContent);
  const hasSuite = /^suite:/m.test(yamlContent);
  const validation = (hasTemplates || hasSuite) ? null : validateTestYaml(yamlContent);

  if (validation && !validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      warnings: [],
      stats: validation.stats,
    };
  }

  // 2. Parse (suites, hooks, params, templates) → transpile → validate TS → write
  let tsCode: string;
  let outPath: string;
  let referencedTemplatePaths: string[] = [];
  try {
    const parsed = options?.parsed ?? parseYamlTestFile(yamlContent, filePath, options?.basePath);
    referencedTemplatePaths = parsed.referencedTemplatePaths;

    const transpileOpts: TranspileFileOptions = {
      version: options?.version,
      actionEntityStore: options?.actionEntityStore,
      onActionEntitySource: options?.onActionEntitySource,
      filePath,
      yamlDir: dirname(filePath),
      projectRoot: options?.projectRoot ?? options?.basePath,
    };

    // Merge base_url into test.use({ baseURL }); base_url takes precedence over use.baseURL.
    // Suite files have no `parsed.testFlow` — parseSuiteFile has already folded their
    // base_url into `parsed.use`, so mergedUse is the right value for both branches.
    const mergedUse = parsed.testFlow?.baseURL
      ? { ...parsed.use, baseURL: parsed.testFlow.baseURL }
      : parsed.use;

    if (parsed.suite) {
      tsCode = transpileYamlSuite(parsed.suite, {
        ...transpileOpts,
        testName: parsed.name,
        tags: parsed.tags,
        use: mergedUse,
      });
    } else {
      tsCode = transpileYamlTest(parsed.testFlow!, {
        ...transpileOpts,
        testName: parsed.name,
        tags: parsed.tags,
        use: mergedUse,
        beforeEach: parsed.beforeEach,
        afterEach: parsed.afterEach,
        parameters: parsed.parameters,
        timeout: parsed.timeout,
        skip: parsed.skip,
        fail: parsed.fail,
        only: parsed.only,
        slow: parsed.slow,
      });
    }

    // Validate generated JS syntax (strip import lines — invalid inside Function constructor)
    const codeBody = tsCode.split('\n').filter(line => !line.startsWith('import ')).join('\n');
    new Function(codeBody);

    // Write .yaml.spec.ts alongside the .test.yaml file
    outPath = filePath.replace(/\.test\.yaml$/, '.yaml.spec.ts');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, tsCode);
  } catch (err: any) {
    // Distinguish user errors from transpiler bugs
    const hint = err instanceof YamlValidationError
      ? ''
      : err.message.includes('Unexpected token')
        ? ' This usually means a YAML escaping issue — in double-quoted strings, ' +
          'use \\\\/ instead of \\/ for regex patterns, or use single quotes / block scalars.'
        : ' This may indicate a transpiler bug — please report it.';
    return {
      valid: false,
      errors: [`Transpilation failed: ${err.message}.${hint}`],
      warnings: [],
      stats: validation?.stats ?? { total: 0, action: 0, draft: 0, coverage: 0 },
      referencedTemplatePaths,
    };
  }

  return {
    valid: true,
    errors: [],
    warnings: validation?.warnings ?? [],
    stats: validation?.stats ?? { total: 0, action: 0, draft: 0, coverage: 0 },
    specFile: outPath,
    referencedTemplatePaths,
  };
}
