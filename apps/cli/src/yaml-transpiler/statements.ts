/**
 * Statement Transpiler
 *
 * Converts TestFlow statements into Playwright test code lines.
 */

import type {
  Action,
  ActionEntity,
  ActionEntityStore,
  Draft,
  IfElse,
  Statement,
  Step,
  WhileLoop,
} from 'shiplight-types';
import { DEFAULT_WHILE_LOOP_TIMEOUT_MS, isStoreEntryApplicable } from 'shiplight-types';
import { getActionTranspiler, type ActionTranspileContext } from './actions';
import { canSelfHeal, isAiAction, sanitizeForComment, ACTION_TIMEOUT, getPageLocatorExpression } from './utils';

export interface TranspileOptions {
  /** Action entity store for looking up entities by statement UID */
  actionEntityStore?: ActionEntityStore;
  /** Observer for whether each action resolved from cache or from the YAML. */
  onActionEntitySource?: (info: {
    uid: string;
    description: string;
    source: 'original' | 'cache_hit';
    originalEntity?: ActionEntity;
    cachedEntity?: ActionEntity;
  }) => void;
  /** Collected imports from action transpilers (e.g., function file#export) */
  imports?: Set<string>;
  /** Absolute path to the .test.yaml — see TranspileFileOptions.filePath */
  filePath?: string;
  /** When true, emit raw Playwright calls without agent wrappers (for beforeAll/afterAll hooks) */
  noAgent?: boolean;
  /** Absolute path to the directory containing the .test.yaml (and output .yaml.spec.ts) */
  yamlDir?: string;
  /** Project root — bare paths in function references are resolved relative to this */
  projectRoot?: string;
  /**
   * The file-level baseURL (from `base_url:` or `use.baseURL`), when the file
   * sets one.
   *
   * Worker-scoped beforeAll/afterAll hooks create their own page and cannot see
   * the emitted `test.use({ baseURL })` — Playwright fills `workerInfo.project.use`
   * from playwright.config.ts only. The value has to be baked into the generated
   * hook instead, or relative `URL:` statements in suite hooks fail with
   * `Invalid URL` even though the file declares a base_url. See issue #2209.
   */
  fileBaseURL?: string;
}

/**
 * Transpile an array of statements
 */
export function transpileStatements(
  statements: Statement[],
  indentLevel: number,
  options: TranspileOptions,
  parentStepId: string = 'main',
): string[] {
  const lines: string[] = [];

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const stepId = `${parentStepId}.${i}`;
    const statementLines = transpileStatement(statement, indentLevel, stepId, options);

    if (statementLines.length > 0) {
      lines.push(...statementLines);

      if (i < statements.length - 1) {
        lines.push('');
      }
    }
  }

  return lines;
}

/**
 * Transpile a single statement
 */
function transpileStatement(
  statement: Statement,
  indentLevel: number,
  stepId: string,
  options: TranspileOptions,
): string[] {
  const indent = '  '.repeat(indentLevel);

  switch (statement.type) {
    case 'DRAFT':
      return transpileDraft(statement as Draft, indentLevel, stepId, options);

    case 'ACTION':
      return transpileAction(statement as Action, indentLevel, stepId, options);

    case 'STEP':
      return transpileStep(statement as Step, indentLevel, stepId, options);

    case 'IF_ELSE':
      return transpileIfElse(statement as IfElse, indentLevel, stepId, options);

    case 'WHILE_LOOP':
      return transpileWhileLoop(statement as WhileLoop, indentLevel, stepId, options);

    default:
      return [`${indent}// Unknown statement type: ${(statement as any).type}`];
  }
}

/**
 * Transpile a Draft statement → agent.run()
 */
function transpileDraft(draft: Draft, indentLevel: number, stepId: string, options: TranspileOptions): string[] {
  const indent = '  '.repeat(indentLevel);
  const description = draft.description?.trim() || '';

  if (!description) {
    return [`${indent}// ${stepId}: Skipping - no description`];
  }

  if (options.noAgent) {
    // In noAgent mode (beforeAll/afterAll), DRAFT statements can't use the agent
    return [
      `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
      `${indent}// DRAFT: ${sanitizeForComment(description)} (requires agent - skipped in hook)`,
    ];
  }

  const escapedDescription = JSON.stringify(description);
  return [
    `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
    `${indent}// ⚠ DRAFT: AI-resolved at runtime (~5-10s). Add a locator to make this <1s.`,
    `${indent}page = agent.agentServices.validatePage(page);`,
    `${indent}await agent.run(page, ${escapedDescription}, '${stepId}');`,
  ];
}

/**
 * Transpile an Action statement
 *
 * Resolution priority for action entity:
 * 1. User-picked locator (action.locator)
 * 2. Cached/stored entity (actionEntityStore.entries[action.uid])
 * 3. Inline action_entity (action.action_entity)
 */
function transpileAction(
  action: Action,
  indentLevel: number,
  stepId: string,
  options: TranspileOptions,
): string[] {
  const indent = '  '.repeat(indentLevel);
  const description = action.description;
  const stmtUid = action.uid;

  // Resolve action entity: store entry (priority 2) ?? inline entity (priority 3).
  //
  // A store entry only applies while the inline entity it superseded is unchanged. Entries
  // are written by self-healing, so each one means "the inline entity here failed, and this
  // worked instead"; once the YAML is edited that premise is void and the edit must win —
  // otherwise a hand-fixed locator (or an edited `text:`) is silently shadowed by the
  // entity it was meant to replace. Entries predating `source_fingerprint` are
  // grandfathered; see isStoreEntryApplicable.
  const rawStoreEntry = options.actionEntityStore?.entries[action.uid];
  const storeEntry =
    rawStoreEntry && isStoreEntryApplicable(rawStoreEntry.source_fingerprint, action.action_entity)
      ? rawStoreEntry
      : undefined;
  const baseEntity = storeEntry?.action_entity ?? action.action_entity;

  if (!baseEntity) {
    // No action entity found — fall back to agent.execute()
    if (!description) {
      return [`${indent}// ${stepId}: Skipping - no description`];
    }

    if (options.noAgent) {
      return [
        `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
        `${indent}// DRAFT: ${sanitizeForComment(description)} (requires agent - skipped in hook)`,
      ];
    }

    const escapedDescription = JSON.stringify(description);
    const usePureVision = !!action.use_pure_vision;
    return [
      `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
      `${indent}// ⚠ DRAFT: AI-resolved at runtime (~5-10s). Add a locator to make this <1s.`,
      `${indent}page = agent.agentServices.validatePage(page);`,
      `${indent}await agent.execute(page, ${escapedDescription}, '${stepId}', ${usePureVision});`,
    ];
  }

  // Apply user-picked locator override (priority 1)
  let actionEntity: ActionEntity = action.locator
    ? { ...baseEntity, locator: action.locator }
    : baseEntity;
  if (description && description !== actionEntity.action_description) {
    actionEntity = { ...actionEntity, action_description: description };
  }

  const actionName = actionEntity.action_data?.action_name || '';
  const actionDescription = actionEntity.action_description || '';

  // Report which source won, before the two become indistinguishable downstream.
  // Placed here — after entity resolution, before code emission — so it covers
  // exactly the statements that end up as executable code:
  //   - no entity at all (handled above) falls back to agent.execute() and was
  //     never a cache candidate, so counting it would deflate the hit rate with
  //     statements the cache can never serve;
  //   - an AI action inside a beforeAll/afterAll hook is emitted as a comment
  //     and never runs (see the noAgent branch below), so counting it would
  //     inflate the total with code that cannot execute.
  // Both arms of an IF and the body of a WHILE are reported: the transpiler
  // cannot know which will be taken, so this measures cache resolution at
  // transpile time, which is the only point where it is knowable at all.
  if (!(options.noAgent && isAiAction(actionEntity))) {
    options.onActionEntitySource?.({
      uid: action.uid,
      description: description ?? '',
      source: storeEntry?.action_entity ? 'cache_hit' : 'original',
      originalEntity: action.action_entity,
      cachedEntity: storeEntry?.action_entity,
    });
  }

  // Get action-specific transpiler
  const transpiler = getActionTranspiler(actionName);
  if (!transpiler) {
    return [
      `${indent}// ${stepId}: Unknown action: ${actionName}`,
      `${indent}throw new Error(${JSON.stringify(`Unknown action: ${actionName}`)});`,
    ];
  }

  const actionContext: ActionTranspileContext = { imports: options.imports, yamlDir: options.yamlDir, projectRoot: options.projectRoot };
  const executeLines = transpiler(actionEntity, stepId, actionContext);

  if (options.noAgent) {
    // In noAgent mode (beforeAll/afterAll), emit raw Playwright calls without agent wrapper
    if (isAiAction(actionEntity)) {
      return [
        `${indent}// ${stepId}: ${sanitizeForComment(actionDescription)}`,
        `${indent}// AI action: ${sanitizeForComment(actionDescription)} (requires agent - skipped in hook)`,
      ];
    }

    // Handle agent-dependent actions with direct Playwright equivalents
    const noAgentLines = transpileNoAgentAction(actionEntity, actionName, indent, stepId);
    if (noAgentLines) return noAgentLines;

    return [
      `${indent}// ${stepId}: ${sanitizeForComment(actionDescription)}`,
      ...executeLines.map((line) => `${indent}${line}`),
    ];
  }

  if (isAiAction(actionEntity)) {
    // AI actions handle their own logic, no step wrapper needed
    return [
      `${indent}// ${stepId}: ${sanitizeForComment(actionDescription)}`,
      `${indent}page = agent.agentServices.validatePage(page);`,
      ...executeLines.map((line) => `${indent}${line}`),
    ];
  }

  // Non-AI actions: wrap in agent.step()
  const escapedDescription = JSON.stringify(actionDescription);
  const indentedExecuteLines = executeLines.map((line) => `${indent}  ${line}`);
  const selfHealFlag = canSelfHeal(actionEntity);
  const stmtUidArg = stmtUid ? `'${stmtUid}'` : 'undefined';
  return [
    `${indent}// ${stepId}: ${sanitizeForComment(actionDescription)}`,
    `${indent}page = agent.agentServices.validatePage(page);`,
    `${indent}await agent.step(page, async () => {`,
    ...indentedExecuteLines,
    `${indent}}, ${escapedDescription}, '${stepId}', ${stmtUidArg}, ${selfHealFlag});`,
  ];
}

/**
 * Transpile a Step statement (container of statements)
 */
function transpileStep(
  step: Step,
  indentLevel: number,
  stepId: string,
  options: TranspileOptions,
): string[] {
  const indent = '  '.repeat(indentLevel);
  const lines: string[] = [];

  if (step.description && step.description.trim()) {
    lines.push(`${indent}// Step: ${sanitizeForComment(step.description)}`);
  }

  const nestedLines = transpileStatements(step.statements, indentLevel, options, stepId);
  lines.push(...nestedLines);

  return lines;
}

/**
 * Transpile an IfElse statement
 */
function transpileIfElse(
  ifElse: IfElse,
  indentLevel: number,
  stepId: string,
  options: TranspileOptions,
): string[] {
  const indent = '  '.repeat(indentLevel);
  const lines: string[] = [];

  lines.push(`${indent}// ${stepId}: Conditional check`);

  if (ifElse.condition.type === 'JS_CODE') {
    lines.push(`${indent}if (${ifElse.condition.expression}) {`);
  } else {
    lines.push(`${indent}// AI Condition: ${sanitizeForComment(ifElse.condition.expression)}`);
    const escapedCondition = JSON.stringify(ifElse.condition.expression);
    lines.push(
      `${indent}if (await agent.evaluate(page, ${escapedCondition}, "${stepId}", "if")) {`,
    );
  }

  const thenLines = transpileStatements(ifElse.then, indentLevel + 1, options, `${stepId}.then`);
  lines.push(...thenLines);

  if (ifElse.else && ifElse.else.length > 0) {
    lines.push(`${indent}} else {`);
    const elseLines = transpileStatements(
      ifElse.else,
      indentLevel + 1,
      options,
      `${stepId}.else`,
    );
    lines.push(...elseLines);
  }

  lines.push(`${indent}}`);

  return lines;
}

/**
 * Transpile a WhileLoop statement
 */
function transpileWhileLoop(
  whileLoop: WhileLoop,
  indentLevel: number,
  stepId: string,
  options: TranspileOptions,
): string[] {
  const indent = '  '.repeat(indentLevel);
  const lines: string[] = [];

  lines.push(`${indent}// ${stepId}: Loop`);

  const timeoutMs = whileLoop.timeout_ms ?? DEFAULT_WHILE_LOOP_TIMEOUT_MS;
  const timeoutSeconds = timeoutMs / 1000;

  const timeoutMsg = whileLoop.timeout_ms
    ? `While loop exceeded timeout of ${timeoutSeconds}s`
    : `While loop exceeded default timeout of ${timeoutSeconds}s`;
  const loopVarPrefix = `loop_${stepId.replace(/\./g, '_')}`;

  lines.push(`${indent}const ${loopVarPrefix}_start = Date.now();`);
  lines.push(`${indent}const ${loopVarPrefix}_timeout = ${timeoutMs};`);
  lines.push(`${indent}const ${loopVarPrefix}_check = () => {`);
  lines.push(`${indent}  if (Date.now() - ${loopVarPrefix}_start > ${loopVarPrefix}_timeout) {`);
  lines.push(`${indent}    throw new Error('${timeoutMsg}');`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  return true;`);
  lines.push(`${indent}};`);

  if (whileLoop.condition.type === 'JS_CODE') {
    lines.push(
      `${indent}while (${loopVarPrefix}_check() && (${whileLoop.condition.expression})) {`,
    );
  } else {
    lines.push(
      `${indent}// AI Loop Condition: ${sanitizeForComment(whileLoop.condition.expression)}`,
    );
    const escapedCondition = JSON.stringify(whileLoop.condition.expression);
    lines.push(
      `${indent}while (${loopVarPrefix}_check() && await agent.evaluate(page, ${escapedCondition}, "${stepId}", "while")) {`,
    );
  }

  const bodyLines = transpileStatements(
    whileLoop.body,
    indentLevel + 1,
    options,
    `${stepId}.body`,
  );
  lines.push(...bodyLines);

  lines.push(`${indent}}`);

  return lines;
}

/**
 * Transpile agent-dependent actions into direct Playwright calls for noAgent mode.
 * Returns null if the action doesn't need special handling (i.e., its transpiled code
 * doesn't reference `agent`).
 */
function transpileNoAgentAction(
  actionEntity: ActionEntity,
  actionName: string,
  indent: string,
  stepId: string,
): string[] | null {
  const description = actionEntity.action_description || '';
  const kwargs = actionEntity.action_data?.kwargs || {};
  const timeout = kwargs.timeout_ms ?? ACTION_TIMEOUT;

  switch (actionName) {
    case 'go_to_url':
    case 'open_tab': {
      const url = kwargs.url || '';
      return [
        `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
        `${indent}await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded' });`,
      ];
    }
    case 'go_back':
      return [
        `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
        `${indent}await page.goBack();`,
      ];
    case 'go_forward':
      return [
        `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
        `${indent}await page.goForward();`,
      ];
    case 'input_text': {
      const text = kwargs.text || '';
      const locExpr = getPageLocatorExpression(actionEntity);
      if (locExpr) {
        return [
          `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
          `${indent}await ${locExpr}.fill(${JSON.stringify(text)}, { timeout: ${timeout} });`,
        ];
      }
      return null;
    }
    case 'select_dropdown_option': {
      const text = kwargs.text || kwargs.label || '';
      const locExpr = getPageLocatorExpression(actionEntity);
      if (locExpr) {
        return [
          `${indent}// ${stepId}: ${sanitizeForComment(description)}`,
          `${indent}await ${locExpr}.selectOption({ label: ${JSON.stringify(text)} }, { timeout: ${timeout} });`,
        ];
      }
      return null;
    }
    default:
      return null; // Use default transpiled output
  }
}
