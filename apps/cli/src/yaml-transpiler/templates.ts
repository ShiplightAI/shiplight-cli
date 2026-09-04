/**
 * Template Expansion
 *
 * When the parser encounters a STEP with `template: ../path/to.yaml`:
 * 1. Resolve the path relative to the importing YAML file
 * 2. Read and parse the template YAML
 * 3. Validate required `params` are provided
 * 4. Substitute `<<paramName>>` with provided param values
 * 5. Inline the template's statements into the parent's statement list
 * 6. Track depth (max 5) and detect circular references
 *
 * Template YAML format:
 * ```yaml
 * params:
 *   - username
 *   - password
 * statements:
 *   - intent: Enter username
 *     action_entity: ...
 * ```
 *
 * Usage in parent YAML:
 * ```yaml
 * statements:
 *   - template: ./login-template.yaml
 *     params:
 *       username: "{{TEST_USER}}"    # runtime vars as param values
 *       password: "{{TEST_PASS}}"
 * ```
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const MAX_TEMPLATE_DEPTH = 5;

interface TemplateContext {
  /** Set of resolved absolute paths currently in the expansion stack (for circular detection) */
  expandingPaths: Set<string>;
  /** Current expansion depth */
  depth: number;
  /** All template file paths referenced during expansion (for cache invalidation) */
  referencedPaths: Set<string>;
  /** Optional project root to use as fallback when a template isn't found relative to the source file */
  basePath?: string;
}

export interface ExpandResult {
  doc: Record<string, any>;
  /** Absolute paths of all template files referenced during expansion */
  referencedTemplatePaths: string[];
}

/**
 * Expand templates in a raw YAML document (pre-parse).
 *
 * Walks the statements array looking for template references,
 * loads and inlines them, then returns the modified document.
 *
 * @param rawDoc - Parsed YAML document (plain object)
 * @param sourceFilePath - Absolute path of the YAML file being processed
 * @returns Modified document with templates expanded
 */
export function expandTemplates(
  rawDoc: Record<string, any>,
  sourceFilePath: string,
  basePath?: string,
): ExpandResult {
  const ctx: TemplateContext = {
    expandingPaths: new Set([resolve(sourceFilePath)]),
    depth: 0,
    referencedPaths: new Set(),
    basePath,
  };

  const result = { ...rawDoc };

  if (Array.isArray(result.statements)) {
    result.statements = expandStatementList(result.statements, sourceFilePath, ctx);
  }

  if (Array.isArray(result.teardown)) {
    result.teardown = expandStatementList(result.teardown, sourceFilePath, ctx);
  }

  // Expand templates in hook arrays (single-test and suite-level)
  for (const hookKey of ['beforeAll', 'afterAll', 'beforeEach', 'afterEach']) {
    if (Array.isArray(result[hookKey])) {
      result[hookKey] = expandStatementList(result[hookKey], sourceFilePath, ctx);
    }
  }

  return {
    doc: result,
    referencedTemplatePaths: Array.from(ctx.referencedPaths),
  };
}

/**
 * Expand templates in an array of statement objects
 */
function expandStatementList(
  statements: any[],
  sourceFilePath: string,
  ctx: TemplateContext,
): any[] {
  const result: any[] = [];

  for (const stmt of statements) {
    if (isTemplateReference(stmt)) {
      const expanded = expandTemplateReference(stmt, sourceFilePath, ctx);
      result.push(expanded);
    } else {
      // Recurse into nested statement containers
      result.push(expandNestedStatements(stmt, sourceFilePath, ctx));
    }
  }

  return result;
}

/**
 * Check if a statement object is a template reference
 */
function isTemplateReference(stmt: any): boolean {
  return typeof stmt === 'object' && stmt !== null && typeof stmt.template === 'string';
}

/**
 * Expand a single template reference into a STEP wrapper with the template's
 * statements as children. Preserves template_path and template_params on the
 * STEP so that testFlowToYaml can reconstruct the `template:` syntax on save.
 */
function expandTemplateReference(
  stmt: { template: string; params?: Record<string, string> },
  sourceFilePath: string,
  ctx: TemplateContext,
): Record<string, unknown> {
  if (ctx.depth >= MAX_TEMPLATE_DEPTH) {
    throw new Error(
      `Template expansion exceeded maximum depth of ${MAX_TEMPLATE_DEPTH}. ` +
        `Check for deeply nested or circular template references.`,
    );
  }

  // Resolve template path relative to the importing file; fall back to basePath (project root)
  const relativePath = resolve(dirname(sourceFilePath), stmt.template);
  const templatePath =
    !existsSync(relativePath) && ctx.basePath
      ? resolve(ctx.basePath, stmt.template)
      : relativePath;

  // Circular reference detection
  if (ctx.expandingPaths.has(templatePath)) {
    throw new Error(
      `Circular template reference detected: ${templatePath} is already being expanded. ` +
        `Stack: ${Array.from(ctx.expandingPaths).join(' → ')} → ${templatePath}`,
    );
  }

  // Track this template for cache invalidation
  ctx.referencedPaths.add(templatePath);

  // Read and parse the template file
  let templateYaml: string;
  try {
    templateYaml = readFileSync(templatePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read template file: ${templatePath} (referenced from ${sourceFilePath}): ${(err as Error).message}`,
    );
  }

  const templateDoc = parseYaml(templateYaml);
  if (!templateDoc || typeof templateDoc !== 'object') {
    throw new Error(`Invalid template file: ${templatePath} — expected a YAML object`);
  }

  // Validate required params
  const requiredParams: string[] = templateDoc.params || [];
  const providedParams: Record<string, string> = stmt.params || {};

  for (const param of requiredParams) {
    if (!(param in providedParams)) {
      throw new Error(
        `Template ${stmt.template} requires param "${param}" but it was not provided. ` +
          `Required params: [${requiredParams.join(', ')}]`,
      );
    }
  }

  // Get the template's statements
  let templateStatements: any[] = templateDoc.statements;
  if (!Array.isArray(templateStatements)) {
    throw new Error(
      `Template ${stmt.template} must have a "statements" array`,
    );
  }

  // Substitute <<paramName>> in the template statements
  if (Object.keys(providedParams).length > 0) {
    const substituted = stringifyYaml(templateStatements);
    let result = substituted;
    for (const [paramName, paramValue] of Object.entries(providedParams)) {
      // split/join instead of replaceAll — tsconfig targets ES2020
      result = result.split(`<<${paramName}>>`).join(String(paramValue));
    }
    templateStatements = parseYaml(result);
  }

  // Recurse into the template's statements (to expand nested templates)
  const childCtx: TemplateContext = {
    expandingPaths: new Set([...ctx.expandingPaths, templatePath]),
    depth: ctx.depth + 1,
    referencedPaths: ctx.referencedPaths,
  };

  const expandedStatements = expandStatementList(templateStatements, templatePath, childCtx);

  // Derive a description from the template name or file path
  const templateName = templateDoc.name || stmt.template.replace(/\.yaml$/, '').split('/').pop() || stmt.template;

  // Return a STEP wrapper that preserves the template reference
  const stepWrapper: Record<string, unknown> = {
    STEP: templateName,
    template_path: stmt.template,
    statements: expandedStatements,
  };

  // Only include params if there are any
  if (Object.keys(providedParams).length > 0) {
    stepWrapper.template_params = providedParams;
  }

  return stepWrapper;
}

/**
 * Recursively expand templates in nested statement containers
 * (STEP.statements, IF.THEN, IF.ELSE, WHILE.DO)
 */
function expandNestedStatements(
  stmt: any,
  sourceFilePath: string,
  ctx: TemplateContext,
): any {
  if (typeof stmt !== 'object' || stmt === null) {
    return stmt;
  }

  const result = { ...stmt };

  // STEP has statements
  if (Array.isArray(result.statements)) {
    result.statements = expandStatementList(result.statements, sourceFilePath, ctx);
  }

  // IF_ELSE has THEN and ELSE
  if (Array.isArray(result.THEN)) {
    result.THEN = expandStatementList(result.THEN, sourceFilePath, ctx);
  }
  if (Array.isArray(result.ELSE)) {
    result.ELSE = expandStatementList(result.ELSE, sourceFilePath, ctx);
  }

  // WHILE_LOOP has DO
  if (Array.isArray(result.DO)) {
    result.DO = expandStatementList(result.DO, sourceFilePath, ctx);
  }

  return result;
}
