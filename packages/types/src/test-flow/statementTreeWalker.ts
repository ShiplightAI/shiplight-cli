import type { Statement, Step, TestFlow } from './testFlow';
import { ConditionType, StatementType } from './testFlow';
import type { ActionStepInfo } from './actionEntity';

// Path to a statement in the tree (for internal use)
export interface StatementPath {
  stableId: string;
  path: (string | number)[]; // e.g., [0, 'statements', 1] or [2, 'then', 0]
  statement: Statement;
  parent?: Statement;
  containerKey?: string; // 'statements', 'then', 'else', 'body'
  index: number; // index within the container
}

/**
 * Container holding child statements with its key name
 */
export interface StatementContainer {
  key: string;
  statements: Statement[];
}

/**
 * Get all statements that contain child statements (containers)
 */
export const getStatementContainers = (statement: Statement): StatementContainer[] => {
  const containers: { key: string; statements: Statement[] }[] = [];

  switch (statement.type) {
    case StatementType.STEP:
      if (statement.statements) {
        containers.push({ key: 'statements', statements: statement.statements });
      }
      break;
    case StatementType.IF_ELSE:
      if (statement.then) {
        containers.push({ key: 'then', statements: statement.then });
      }
      if (statement.else) {
        containers.push({ key: 'else', statements: statement.else });
      }
      break;
    case StatementType.WHILE_LOOP:
      if (statement.body) {
        containers.push({ key: 'body', statements: statement.body });
      }
      break;
  }

  return containers;
};

/**
 * Find a statement by its stable ID in the tree
 */
export const findStatementPathById = (
  statements: Statement[],
  targetStableId: string,
  parentStatement: Statement | undefined = undefined,
  containerType: string = 'root'
): StatementPath | null => {

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const stableId = statement.uid;

    // Check if this is the target statement
    if (stableId === targetStableId) {
      return {
        stableId,
        path: [i],
        statement,
        parent: parentStatement,
        containerKey: containerType,
        index: i
      };
    }

    // Search in child statements
    const containers = getStatementContainers(statement);
    for (const container of containers) {
      const found = findStatementPathById(container.statements, targetStableId, statement, container.key);
      if (found) {
        return {
          ...found,
          path: [i, container.key, ...found.path]
        };
      }
    }
  }

  return null;
};

/**
 * Get the next statement in execution order
 */
export const findNextStatement = (
  statements: Statement[],
  currentStableId: string,
  conditionResult?: boolean
): Statement | null => {
  const currentPath = findStatementPathById(statements, currentStableId);
  if (!currentPath) return null;

  const { statement: currentStatement, parent, containerKey, index } = currentPath;

  // Handle different statement types using existing logic
  let nextStatement: Statement | null = null;

  switch (currentStatement.type) {
    case StatementType.DRAFT:
    case StatementType.ACTION:
      // For drafts and actions, go to next sibling or exit container
      nextStatement = findNextSibling(statements, currentPath) || findNextAfterContainer(statements, currentPath);
      break;

    case StatementType.STEP:
      // For steps, go to first child if exists, otherwise next sibling
      if (currentStatement.statements && currentStatement.statements.length > 0) {
        return currentStatement.statements[0];
      }
      nextStatement = findNextSibling(statements, currentPath) || findNextAfterContainer(statements, currentPath);
      break;

    case StatementType.IF_ELSE:
      // For if/else, go to then or else based on condition result
      if (conditionResult === true && currentStatement.then && currentStatement.then.length > 0) {
        return currentStatement.then[0];
      }
      if (conditionResult === false && currentStatement.else && currentStatement.else.length > 0) {
        return currentStatement.else[0];
      }
      // If no condition result or no matching branch, go to next sibling
      nextStatement = findNextSibling(statements, currentPath) || findNextAfterContainer(statements, currentPath);
      break;

    case StatementType.WHILE_LOOP:
      // For while loops, go to body if condition is true, otherwise next sibling
      if (conditionResult === true && currentStatement.body && currentStatement.body.length > 0) {
        return currentStatement.body[0];
      }
      nextStatement = findNextSibling(statements, currentPath) || findNextAfterContainer(statements, currentPath);
      break;

    default:
      nextStatement = findNextSibling(statements, currentPath) || findNextAfterContainer(statements, currentPath);
      break;
  }

  // Generic while loop jump-back logic (user's proposal)
  if (parent && parent.type === StatementType.WHILE_LOOP && containerKey === 'body') {
    // If next statement is null (end) or the parent of next statement is not the same
    if (!nextStatement) {
      return parent; // Jump back to while loop for condition re-evaluation
    }

    const nextStatementPath = findStatementPathById(statements, nextStatement.uid);
    if (!nextStatementPath || nextStatementPath.parent !== parent) {
      return parent; // Jump back to while loop for condition re-evaluation
    }
  }

  return nextStatement;
};

/**
 * Find the next sibling statement
 */
export const findNextSibling = (statements: Statement[], currentPath: StatementPath): Statement | null => {
  if (!currentPath.parent) {
    // We're at root level
    return statements[currentPath.index + 1] || null;
  }

  // We're inside a container
  const containers = getStatementContainers(currentPath.parent);
  const container = containers.find(c => c.key === currentPath.containerKey);

  if (container && currentPath.index + 1 < container.statements.length) {
    return container.statements[currentPath.index + 1];
  }

  return null;
};

/**
 * Find the next statement after exiting the current container
 */
export const findNextAfterContainer = (statements: Statement[], currentPath: StatementPath): Statement | null => {
  if (!currentPath.parent) {
    // Already at root level, no more statements
    return null;
  }

  // Find the parent statement's path and get its next sibling
  const parentStableId = currentPath.parent.uid;

  const parentPath = findStatementPathById(statements, parentStableId);
  if (!parentPath) return null;

  return findNextSibling(statements, parentPath) || findNextAfterContainer(statements, parentPath);
};

/**
 * Get all statements in execution order (for debugging/visualization)
 */
export const getAllStatementsInOrder = (statements: Statement[]): Statement[] => {
  const result: Statement[] = [];

  const traverse = (stmts: Statement[]) => {
    for (const stmt of stmts) {
      result.push(stmt);

      // Add child statements
      const containers = getStatementContainers(stmt);
      for (const container of containers) {
        traverse(container.statements);
      }
    }
  };

  traverse(statements);
  return result;
};

/**
 * Check if a statement is executable (not just a container)
 */
export const isExecutableStatement = (statement: Statement): boolean => {
  switch (statement.type) {
    case StatementType.DRAFT:
    case StatementType.ACTION:
      return true;
    case StatementType.STEP:
      // Steps can be executed (they may have setup logic)
      return true;
    case StatementType.IF_ELSE:
    case StatementType.WHILE_LOOP:
      // Conditionals need to be executed to evaluate the condition
      return true;
    default:
      return false;
  }
};

/**
 * Find the execution path between two statements
 * Returns an array of statement IDs representing the intermediate statements from source to target
 * 
 * Note: The returned path does NOT include the source or target statements themselves.
 * - If source and target are the same, returns empty array []
 * - If target is null, returns path from source to end of execution
 * - If no path exists, returns null
 * - Otherwise, returns array of statement IDs that would be executed between source and target
 */
export const findPathBetweenStatements = (
  statements: Statement[],
  sourceStableId: string,
  targetStableId: string | null
): string[] | null => {
  // First, verify source statement exists
  const sourcePath = findStatementPathById(statements, sourceStableId);
  
  if (!sourcePath) {
    return null;
  }
  
  // If target is null, find path from source to end of execution
  if (targetStableId === null) {
    const path: string[] = [];
    let currentId: string | null = sourceStableId;
    
    // Traverse from source until we reach the end (null)
    while (currentId !== null) {
      const currentPath = findStatementPathById(statements, currentId);
      if (!currentPath) break;
      
      // Add current statement to path
      path.push(currentId);
      
      // Get next statement (without special conditional handling, just traverse everything)
      const nextStatement = findNextStatement(statements, currentId);
      currentId = nextStatement?.uid || null;
      
      // Safety check to prevent infinite loops
      if (path.length > 1000) {
        return null;
      }
    }

    return path;
  }
  
  // Verify target statement exists
  const targetPath = findStatementPathById(statements, targetStableId);
  if (!targetPath) {
    return null;
  }
  
  // If source and target are the same, return empty path
  if (sourceStableId === targetStableId) {
    return [];
  }
  
  const path: string[] = [];
  let currentId: string | null = sourceStableId;
  
  // Traverse from source to target
  while (currentId && currentId !== targetStableId) {
    const currentPath = findStatementPathById(statements, currentId);
    if (!currentPath) break;
    
    // Add current statement to path (all statement types)
    path.push(currentId);
    
    // Special handling for IF_ELSE and WHILE_LOOP statements
    if (currentPath.statement.type === StatementType.IF_ELSE) {
      // Determine which branch contains the target
      const branch = findBranchContainingTarget(currentPath.statement, targetStableId);
      if (branch) {
        // Determine which branch to take based on where the target is
        const conditionResult = branch === 'then';
        const nextStatement = findNextStatement(statements, currentId, conditionResult);
        currentId = nextStatement?.uid || null;
      } else {
        // Target is not in this IF_ELSE, go to next sibling
        const nextStatement = findNextStatement(statements, currentId);
        currentId = nextStatement?.uid || null;
      }
    } else if (currentPath.statement.type === StatementType.WHILE_LOOP) {
      // Check if target is in the while loop body
      const hasTargetInBody = findTargetInWhileLoopBody(currentPath.statement, targetStableId);
      if (hasTargetInBody) {
        // Target is in the body, enter the loop (condition = true)
        const nextStatement = findNextStatement(statements, currentId, true);
        currentId = nextStatement?.uid || null;
      } else {
        // Target is not in this WHILE_LOOP, skip the loop (condition = false)
        const nextStatement = findNextStatement(statements, currentId, false);
        currentId = nextStatement?.uid || null;
      }
    } else {
      // For other statement types, use normal traversal
      const nextStatement = findNextStatement(statements, currentId);
      currentId = nextStatement?.uid || null;
    }
    
    // Safety check to prevent infinite loops
    if (path.length > 1000) {
      return null;
    }
  }

  // If we reached the target, return the path
  if (currentId === targetStableId) {
    return path;
  }
  
  // If we couldn't reach the target, return null
  return null;
};

/**
 * Helper function to determine which branch of an IF_ELSE contains the target statement
 */
const findBranchContainingTarget = (ifElseStatement: Statement, targetStableId: string): 'then' | 'else' | null => {
  // Type guard to ensure this is an IF_ELSE statement
  if (ifElseStatement.type !== StatementType.IF_ELSE) {
    return null;
  }
  
  const ifElse = ifElseStatement as any; // Cast to access then/else properties
  
  // Check if target is in 'then' branch
  if (ifElse.then) {
    const thenPath = findStatementPathById(ifElse.then, targetStableId);
    if (thenPath) return 'then';
  }
  
  // Check if target is in 'else' branch
  if (ifElse.else) {
    const elsePath = findStatementPathById(ifElse.else, targetStableId);
    if (elsePath) return 'else';
  }
  
  return null;
};

/**
 * Helper function to check if target statement is in a WHILE_LOOP body
 */
const findTargetInWhileLoopBody = (whileLoopStatement: Statement, targetStableId: string): boolean => {
  // Type guard to ensure this is a WHILE_LOOP statement
  if (whileLoopStatement.type !== StatementType.WHILE_LOOP) {
    return false;
  }
  
  const whileLoop = whileLoopStatement as any; // Cast to access body property
  
  // Check if target is in the body
  if (whileLoop.body) {
    const bodyPath = findStatementPathById(whileLoop.body, targetStableId);
    if (bodyPath) return true;
  }
  
  return false;
};

/**
 * Check if a statement tree contains any template references (cloud reference_id or local template_path)
 *
 * @param statements Array of statements to check
 * @returns true if any reference_id or template_path is found
 */
export function hasReferenceIds(statements: Statement[]): boolean {
  for (const statement of statements) {
    if (statement.type === StatementType.STEP) {
      const step = statement as Step;
      if (step.reference_id || step.template_path) return true;
    }

    // Check nested statements
    const containers = getStatementContainers(statement);
    for (const container of containers) {
      if (hasReferenceIds(container.statements)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get all reference_id used in a statement tree
 *
 * @param statements Array of statements to analyze
 * @returns Array of unique reference_id values
 */
export function getAllReferenceIds(statements: Statement[]): number[] {
  const referenceIds = new Set<number>();

  function collectReferenceIds(stmts: Statement[]) {
    for (const statement of stmts) {
      if (statement.type === StatementType.STEP) {
        const step = statement as Step;
        if (step.reference_id) referenceIds.add(step.reference_id);
      }

      // Check nested statements
      const containers = getStatementContainers(statement);
      for (const container of containers) {
        collectReferenceIds(container.statements);
      }
    }
  }

  collectReferenceIds(statements);

  return Array.from(referenceIds);
}

/**
 * Determines if an action is a dynamic action (special actions like AI, code, functions, assertions)
 * Dynamic actions are actions that have special handling and cannot be directly mapped to Playwright commands
 * Dynamic actions also cannot use self-healing
 * @param actionName The action name to check
 * @returns true if it's a dynamic action
 */
export const isDynamicAction = (actionName: string): boolean => {
  if (actionName.startsWith("ai_")) {
    return true;
  }

  return [
    "js_code",
    "function",
    "assert",
    "verify",
    "wait_for_download_complete",
    "extract_email_content",
  ].includes(actionName);
};

/**
 * Determines if an action is allowed to use pure vision
 * @param actionName The action name to check
 * @returns true if the action is allowed to use pure vision
 */
export const allowPureVisionAction = (actionName: string): boolean => {
  const blockList = ['js_code', 'function', 'assert', 'ai_assert', 'verify', 'ai_extract', 'ai_wait_until', 'upload_file', 'login', 'extract_email_content', 'ai_step'];

  return !blockList.includes(actionName);
};

// Recursive function to traverse statements and collect ACTION statements with their IDs
export const collectActionSteps = (statements: Statement[], parentId: string, actionSteps: Record<string, ActionStepInfo>) => {
  statements.forEach((statement, index) => {
    const currentId = `${parentId}.${index}`;

    if (statement.type === StatementType.DRAFT) {
      // DRAFT statements have no action_entity yet (they'll convert after execution)
      actionSteps[currentId] = {
        description: statement.description || "Draft",
        action_entity: undefined
      };
    } else if (statement.type === StatementType.ACTION) {
      actionSteps[currentId] = {
        description: statement.description || "Action",
        action_entity: statement.action_entity,
        locator: statement.locator
      };
    } else if (statement.type === StatementType.STEP && statement.statements) {
      // For STEP statements, traverse their nested statements
      collectActionSteps(statement.statements, currentId, actionSteps);
    } else if (statement.type === StatementType.IF_ELSE) {
      // First collect condition evaluation
      actionSteps[currentId] = {
        description: "IF " + (statement.condition?.expression || ""),
        action_entity: undefined
      };
      // For IF_ELSE statements, traverse both then and else branches
      if (statement.then) {
        collectActionSteps(statement.then, `${currentId}.then`, actionSteps);
      }
      if (statement.else) {
        collectActionSteps(statement.else, `${currentId}.else`, actionSteps);
      }
    } else if (statement.type === StatementType.WHILE_LOOP) {
      actionSteps[currentId] = {
        description: "WHILE " + (statement.condition?.expression || ""),
        action_entity: undefined
      };
      // For WHILE_LOOP statements, traverse their body
      if (statement.body) {
        collectActionSteps(statement.body, `${currentId}.body`, actionSteps);
      }
    }
  });
};

/**
 * Extracts action steps from a test flow structure, creating a mapping of step IDs to action info.
 * The step IDs use path-based format (e.g., "main.0", "main.0.then.1") that matches resultJson keys.
 *
 * @param testFlow The test flow object containing statements and optional teardown
 * @returns A record mapping step IDs to their descriptions and action entities
 */
export function extractActionStepsFromTestFlow(testFlow: TestFlow | null | undefined): Record<string, ActionStepInfo> {
  if (!testFlow?.statements || !Array.isArray(testFlow.statements)) {
    return {};
  }

  const actionSteps: Record<string, ActionStepInfo> = {};

  // Recursive function to traverse statements and collect ACTION statements with their IDs
  // const traverseStatements = (statements: Statement[], parentId: string) => {
  //   statements.forEach((statement, index) => {
  //     const currentId = `${parentId}.${index}`;

  //     if (statement.type === StatementType.ACTION) {
  //       actionSteps[currentId] = {
  //         description: statement.description || "Action",
  //         action_entity: statement.action_entity
  //       };
  //     } else if (statement.type === StatementType.STEP && statement.statements) {
  //       // For STEP statements, traverse their nested statements
  //       traverseStatements(statement.statements, currentId);
  //     } else if (statement.type === StatementType.IF_ELSE) {
  //       // First collect condition evaluation
  //       actionSteps[currentId] = {
  //         description: "IF " + (statement.condition?.expression || ""),
  //         action_entity: undefined
  //       };
  //       // For IF_ELSE statements, traverse both then and else branches
  //       if (statement.then) {
  //         traverseStatements(statement.then, `${currentId}.then`);
  //       }
  //       if (statement.else) {
  //         traverseStatements(statement.else, `${currentId}.else`);
  //       }
  //     } else if (statement.type === StatementType.WHILE_LOOP) {
  //       actionSteps[currentId] = {
  //         description: "WHILE " + (statement.condition?.expression || ""),
  //         action_entity: undefined
  //       };
  //       // For WHILE_LOOP statements, traverse their body
  //       if (statement.body) {
  //         traverseStatements(statement.body, `${currentId}.body`);
  //       }
  //     }
  //   });
  // };

  // Traverse main statements with "main" as the parent ID
  collectActionSteps(testFlow.statements, "main", actionSteps);

  // Traverse teardown statements with "teardown" as the parent ID
  if (testFlow.teardown && Array.isArray(testFlow.teardown)) {
    collectActionSteps(testFlow.teardown, "teardown", actionSteps);
  }

  return actionSteps;
}

/** Sections of a test flow: before, main, teardown, after (matches step phase order). */
export interface TestFlowSections {
  before: Statement[];
  main: Statement[];
  teardown: Statement[];
  after: Statement[];
}

/**
 * Build Statement[] for a path prefix from actionStepsMap (e.g. "main" or "main.1.then").
 * StepIds follow the same format as produced by collectActionSteps.
 */
function buildStatementsFromActionSteps(
  prefix: string,
  entries: [string, ActionStepInfo][],
  map: Record<string, ActionStepInfo>
): Statement[] {
  const prefixDot = prefix + '.';
  const childEntries = entries.filter(([id]) => id === prefix || id.startsWith(prefixDot));
  if (childEntries.length === 0) return [];

  const result: Statement[] = [];
  const seenIndices = new Set<string>();

  for (const [stepId] of childEntries) {
    const suffix = stepId === prefix ? '' : stepId.slice(prefixDot.length);
    if (!suffix) continue;
    const firstSegment = suffix.split('.')[0];
    if (seenIndices.has(firstSegment)) continue;
    seenIndices.add(firstSegment);
  }

  const indices = Array.from(seenIndices);
  indices.sort((a, b) => {
    const numA = /^\d+$/.test(a) ? parseInt(a, 10) : -1;
    const numB = /^\d+$/.test(b) ? parseInt(b, 10) : -1;
    if (numA >= 0 && numB >= 0) return numA - numB;
    if (a === 'then' && b === 'else') return -1;
    if (a === 'else' && b === 'then') return 1;
    if (a === 'body') return 1;
    if (b === 'body') return -1;
    return a.localeCompare(b);
  });

  function getStepInfo(stepId: string): ActionStepInfo | undefined {
    return map[stepId];
  }

  function parseCondition(desc: string): { type: ConditionType; expression: string } {
    const match = desc.match(/^(IF|WHILE)\s+([\s\S]+)$/);
    const expression = match ? match[2].trim() : desc;
    return { type: ConditionType.AI_MODE, expression: expression || 'true' };
  }

  for (const firstSegment of indices) {
    const nodeStepId = prefix ? `${prefix}.${firstSegment}` : firstSegment;
    const info = getStepInfo(nodeStepId);
    const description = info?.description ?? '';
    const uid = nodeStepId;

    if (firstSegment === 'then') {
      const thenPrefix = `${prefix}.then`;
      const elsePrefix = `${prefix}.else`;
      const thenStatements = buildStatementsFromActionSteps(thenPrefix, entries, map);
      const elseStatements = buildStatementsFromActionSteps(elsePrefix, entries, map);
      const parentInfo = getStepInfo(prefix);
      const condition = parentInfo ? parseCondition(parentInfo.description) : { type: ConditionType.JS_CODE, expression: 'true' };
      result.push({
        uid: prefix,
        type: StatementType.IF_ELSE,
        condition,
        then: thenStatements,
        ...(elseStatements.length > 0 ? { else: elseStatements } : {}),
      });
      continue;
    }
    if (firstSegment === 'else') continue;
    if (firstSegment === 'body') {
      const bodyPrefix = `${prefix}.body`;
      const bodyStatements = buildStatementsFromActionSteps(bodyPrefix, entries, map);
      const parentInfo = getStepInfo(prefix);
      const condition = parentInfo ? parseCondition(parentInfo.description) : { type: ConditionType.JS_CODE, expression: 'true' };
      result.push({
        uid: prefix,
        type: StatementType.WHILE_LOOP,
        condition,
        body: bodyStatements,
      });
      continue;
    }

    const childPrefix = `${prefix}.${firstSegment}`;
    const hasThen = entries.some(([id]) => id.startsWith(childPrefix + '.then.') || id === childPrefix + '.then');
    const hasElse = entries.some(([id]) => id.startsWith(childPrefix + '.else.') || id === childPrefix + '.else');
    const hasBody = entries.some(([id]) => id.startsWith(childPrefix + '.body.') || id === childPrefix + '.body');
    const numericChildren = entries.filter(([id]) => {
      if (!id.startsWith(childPrefix + '.')) return false;
      const rest = id.slice(childPrefix.length + 1);
      const next = rest.split('.')[0];
      return /^\d+$/.test(next) && next !== 'then' && next !== 'else' && next !== 'body';
    });

    if (hasThen || hasElse) {
      const thenPrefix = childPrefix + '.then';
      const elsePrefix = childPrefix + '.else';
      const thenStatements = buildStatementsFromActionSteps(thenPrefix, entries, map);
      const elseStatements = buildStatementsFromActionSteps(elsePrefix, entries, map);
      const condition = info ? parseCondition(description) : { type: ConditionType.JS_CODE, expression: 'true' };
      result.push({
        uid: nodeStepId,
        type: StatementType.IF_ELSE,
        condition,
        then: thenStatements,
        ...(elseStatements.length > 0 ? { else: elseStatements } : {}),
      });
    } else if (hasBody) {
      const bodyPrefix = childPrefix + '.body';
      const bodyStatements = buildStatementsFromActionSteps(bodyPrefix, entries, map);
      const condition = info ? parseCondition(description) : { type: ConditionType.JS_CODE, expression: 'true' };
      result.push({
        uid: nodeStepId,
        type: StatementType.WHILE_LOOP,
        condition,
        body: bodyStatements,
      });
    } else if (numericChildren.length > 0) {
      const nested = buildStatementsFromActionSteps(childPrefix, entries, map);
      result.push({
        uid: nodeStepId,
        type: StatementType.STEP,
        description: description || 'Group',
        statements: nested,
      });
    } else {
      result.push({
        uid: nodeStepId,
        type: StatementType.ACTION,
        description: description || 'Action',
        action_entity: info?.action_entity,
      });
    }
  }

  return result;
}

/**
 * Converts an actionStepsMap (stepId -> ActionStepInfo) back into a test flow with four sections.
 * StepIds must follow the same format as produced by collectActionSteps (e.g. "main.0", "main.1.then.0").
 *
 * @param actionStepsMap Record of step IDs to action step info (e.g. from a run result)
 * @returns Object with before, main, teardown, and after arrays of Statement[]
 */
export function actionStepsMapToTestFlowSections(
  actionStepsMap: Record<string, ActionStepInfo>
): TestFlowSections {
  const entries = Object.entries(actionStepsMap);

  const buildSection = (phase: string): Statement[] => {
    const phasePrefix = phase + '.';
    const hasPhase = entries.some(([id]) => id === phase || id.startsWith(phasePrefix));
    if (!hasPhase) return [];
    return buildStatementsFromActionSteps(phase, entries, actionStepsMap);
  };

  return {
    before: buildSection('before'),
    main: buildSection('main'),
    teardown: buildSection('teardown'),
    after: buildSection('after'),
  };
}