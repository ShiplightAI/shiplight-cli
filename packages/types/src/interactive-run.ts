/**
 * Interactive run / sandbox execution response types.
 *
 * Canonical home for response shapes shared between the debugger sandbox
 * (cli, mcp) and the test execution surfaces. the internal shared package re-exported
 * these for backward compatibility with v1 consumers.
 */
import type { ActionEntity } from "./test-flow/actionEntity";
import type { ActionGenerationDebugInfo } from "./debugInfo";

export type OperationStatus = "success" | "error" | "unknown";

export interface ExecCodeResponse {
  status: "success" | "error";
  details?: any;
  stdout?: string[];
  stderr?: string[];
  testContext?: Record<string, any>;
  result?: any;
  /** Debug info from aiAction calls during self-healing */
  actionGenerationDebugInfo?: ActionGenerationDebugInfo;
  /** Healed action entity returned when self-healing corrects a stale locator.
   *  The frontend should use this to update the statement and mark the flow as dirty. */
  newActionEntity?: ActionEntity;
}

export interface ActionGenerationResponse {
  status: OperationStatus;
  explanation?: string;
  action?: ActionEntity;
  debugInfo?: ActionGenerationDebugInfo;

  /**
   * Indicates whether a single action can complete the instruction.
   * - true: Single action is sufficient
   * - false: Task requires multi-step decomposition (upgrade to runStep)
   * - undefined: Not determined (backward compatibility, treated as true)
   */
  completes_instruction?: boolean;
}
