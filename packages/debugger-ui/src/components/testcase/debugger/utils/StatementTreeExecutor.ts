import { Statement, StatementType, Step, Condition } from "shiplight-types";
import { findStatementPathById, findNextStatement, findNextSibling, findNextAfterContainer } from "shiplight-types";
import { DebugSessionInfo, ExecutionResult, StreamingActionCallback } from "../../types/debugger";

const DEFAULT_WHILE_LOOP_TIMEOUT_MS = 30000;

/**
 * Callbacks for statement execution - these are the "pluggable" parts
 * that differ between hook execution and debugger runUntilInternal
 */
export interface ExecutionCallbacks {
  /** Execute a STEP statement */
  executeStep: (
    statement: Step,
    session: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback
  ) => Promise<ExecutionResult>;

  /** Execute an ACTION statement */
  executeAction: (
    statement: Statement,
    session: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback
  ) => Promise<ExecutionResult>;

  /** Evaluate a condition for IF_ELSE or WHILE_LOOP */
  evaluateCondition: (
    condition: Condition,
    statement: Statement,
    session: DebugSessionInfo
  ) => Promise<{ result: boolean | "unknown"; message: string }>;

  /** Optional: Update statement status (for UI) */
  updateStatus?: (statementId: string, status: "running" | "success" | "failed" | "skipped", details?: string) => void;

  /** Optional: Check if execution should stop */
  shouldStop?: () => boolean;

  /** Optional: Called when moving to next statement (for UI currentStatementId) */
  onStatementChange?: (statementId: string | null) => void;

  /** Optional: Delay between statements in ms */
  delayBetweenStatements?: number;
}

export interface TreeExecutionResult {
  success: boolean;
  /** ID of failed statement (if any) */
  failedStatementId?: string;
  /** Error message if failed */
  error?: string;
  /** Total statements executed */
  executedCount: number;
  /** Last executed statement ID */
  lastStatementId?: string;
}

/**
 * Execute a single statement with proper type handling.
 * This is the core statement executor used by both hook execution and debugger.
 */
export async function executeStatementByType(
  statement: Statement,
  session: DebugSessionInfo,
  callbacks: ExecutionCallbacks,
  whileLoopStartTimes: Map<string, number>
): Promise<ExecutionResult> {
  const stableId = statement.uid;

  callbacks.updateStatus?.(stableId, "running");

  // Handle different statement types
  if (statement.type === StatementType.STEP) {
    const stepStatement = statement as Step;
    // Check if STEP has sublist statements
    if (stepStatement.statements && stepStatement.statements.length > 0) {
      // STEP with sublist statements - navigation point only
      callbacks.updateStatus?.(stableId, "success", "Continue to next statement");
      return { success: true, details: "Navigated into STEP container" };
    } else {
      // STEP without sublist statements - execute
      const result = await callbacks.executeStep(stepStatement, session);
      callbacks.updateStatus?.(stableId, result.success ? "success" : "failed", result.details);
      return result;
    }
  }

  if (statement.type === StatementType.ACTION) {
    const result = await callbacks.executeAction(statement, session);
    callbacks.updateStatus?.(stableId, result.success ? "success" : "failed", result.details);
    return result;
  }

  if (statement.type === StatementType.IF_ELSE) {
    if (!("condition" in statement) || !statement.condition) {
      callbacks.updateStatus?.(stableId, "failed", "IF_ELSE statement missing condition");
      return { success: false, details: "IF_ELSE statement missing condition" };
    }

    try {
      const conditionEval = await callbacks.evaluateCondition(statement.condition, statement, session);
      if (conditionEval.result === "unknown") {
        callbacks.updateStatus?.(stableId, "failed", conditionEval.message);
        return { success: false, details: conditionEval.message };
      }
      callbacks.updateStatus?.(stableId, "success", conditionEval.message);
      return {
        success: true,
        conditionResult: conditionEval.result,
        details: conditionEval.message,
      };
    } catch (error) {
      const errorMsg = `Condition evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      callbacks.updateStatus?.(stableId, "failed", errorMsg);
      return { success: false, details: errorMsg };
    }
  }

  if (statement.type === StatementType.WHILE_LOOP) {
    if (!("condition" in statement) || !statement.condition) {
      callbacks.updateStatus?.(stableId, "failed", "WHILE_LOOP statement missing condition");
      return { success: false, details: "WHILE_LOOP statement missing condition" };
    }

    try {
      const whileLoop = statement as any;

      // Track loop start time on first evaluation
      if (!whileLoopStartTimes.has(stableId)) {
        whileLoopStartTimes.set(stableId, Date.now());
      }

      // Check for timeout
      const timeoutMs = whileLoop.timeout_ms ?? DEFAULT_WHILE_LOOP_TIMEOUT_MS;
      const startTime = whileLoopStartTimes.get(stableId);
      if (startTime && Date.now() - startTime > timeoutMs) {
        const timeoutSeconds = timeoutMs / 1000;
        const timeoutMsg = `While loop exceeded timeout of ${timeoutSeconds}s`;
        callbacks.updateStatus?.(stableId, "failed", timeoutMsg);
        whileLoopStartTimes.delete(stableId);
        return { success: false, details: timeoutMsg };
      }

      const conditionEval = await callbacks.evaluateCondition(statement.condition, statement, session);
      if (conditionEval.result === "unknown") {
        callbacks.updateStatus?.(stableId, "failed", conditionEval.message);
        whileLoopStartTimes.delete(stableId);
        return { success: false, details: conditionEval.message };
      }

      callbacks.updateStatus?.(stableId, "success", conditionEval.message);

      // If condition is false (loop is exiting), clear the start time
      if (conditionEval.result === false) {
        whileLoopStartTimes.delete(stableId);
      }

      return {
        success: true,
        conditionResult: conditionEval.result,
        details: conditionEval.message,
      };
    } catch (error) {
      const errorMsg = `Condition evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      callbacks.updateStatus?.(stableId, "failed", errorMsg);
      whileLoopStartTimes.delete(stableId);
      return { success: false, details: errorMsg };
    }
  }

  // Unsupported statement type
  const unknownType = (statement as any).type || "unknown";
  callbacks.updateStatus?.(stableId, "failed", `Unsupported statement type: ${unknownType}`);
  return { success: false, details: `Unsupported statement type: ${unknownType}` };
}

/**
 * Determine the next statement ID after executing a statement.
 * Handles navigation for all statement types including control flow.
 */
export function getNextStatementId(
  statements: Statement[],
  currentStatementId: string,
  executionResult: ExecutionResult
): string | null {
  const currentPath = findStatementPathById(statements, currentStatementId);
  if (!currentPath) {
    return null;
  }

  const statement = currentPath.statement;

  // For STEP statements
  if (statement.type === StatementType.STEP) {
    const stepStatement = statement as Step;
    const hasSublist = stepStatement.statements && stepStatement.statements.length > 0;

    if (hasSublist) {
      // STEP with sublist - go to first child
      const next = findNextStatement(statements, currentStatementId);
      return next ? next.uid : null;
    } else {
      // STEP without sublist - skip to next sibling or after container
      const next = findNextSibling(statements, currentPath) || findNextAfterContainer(statements, currentPath);
      return next ? next.uid : null;
    }
  }

  // For ACTION statements
  if (statement.type === StatementType.ACTION) {
    const next = findNextStatement(statements, currentStatementId);
    return next ? next.uid : null;
  }

  // For IF_ELSE and WHILE_LOOP - use condition result for branching
  if (statement.type === StatementType.IF_ELSE || statement.type === StatementType.WHILE_LOOP) {
    const next = findNextStatement(statements, currentStatementId, executionResult.conditionResult);
    return next ? next.uid : null;
  }

  return null;
}

/**
 * Core execution loop that runs through a statement tree.
 * This is the shared logic between hook execution and debugger runUntilInternal.
 *
 * @param statements - The statement tree to execute
 * @param session - Debug session
 * @param callbacks - Execution callbacks
 * @param startStatementId - Starting statement ID (defaults to first statement)
 * @param targetStatementId - Target statement ID to stop at (null = run to end)
 */
export async function runStatementTree(
  statements: Statement[],
  session: DebugSessionInfo,
  callbacks: ExecutionCallbacks,
  startStatementId?: string,
  targetStatementId?: string | null
): Promise<TreeExecutionResult> {
  if (!statements || statements.length === 0) {
    return { success: true, executedCount: 0 };
  }

  const whileLoopStartTimes = new Map<string, number>();
  let currentId: string | null = startStatementId || statements[0].uid;
  let executedCount = 0;
  const delayMs = callbacks.delayBetweenStatements ?? 500;

  while (currentId && currentId !== targetStatementId) {
    // Check if execution should stop
    if (callbacks.shouldStop?.()) {
      console.log("🛑 Execution stopped by user request at statement:", currentId);
      return {
        success: true, // Not a failure, just stopped
        executedCount,
        lastStatementId: currentId,
      };
    }

    // Find current statement
    const currentPath = findStatementPathById(statements, currentId);
    if (!currentPath) {
      return {
        success: false,
        failedStatementId: currentId,
        error: `Statement ${currentId} not found`,
        executedCount,
      };
    }

    // Add delay between statements (except for first)
    if (executedCount > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Execute statement
    const result = await executeStatementByType(
      currentPath.statement,
      session,
      callbacks,
      whileLoopStartTimes
    );

    executedCount++;

    if (!result.success) {
      return {
        success: false,
        failedStatementId: currentId,
        error: result.details,
        executedCount,
        lastStatementId: currentId,
      };
    }

    // Determine next statement
    const nextId = getNextStatementId(statements, currentId, result);
    callbacks.onStatementChange?.(nextId);
    currentId = nextId;
  }

  return {
    success: true,
    executedCount,
    lastStatementId: currentId || undefined,
  };
}
