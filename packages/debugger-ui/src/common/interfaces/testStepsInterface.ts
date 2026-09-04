import { Action } from "../models/testStep";

// Canonical definition lives in shiplight-types; re-exported here for backward compatibility.
export type { OperationStatus } from "shiplight-types";

export enum TestStepExecutionStatus {
  Pending = "pending",
  Success = "success",
  Failed = "failed",
  Running = "running",
  ForceAdvanced = "force-advanced",
}

// Define the possible states a step can be in
export enum TestStepState {
  Pending = "pending", // Not executed yet but ready to be executed
  Executed = "executed", // Step has been run (successfully or with failure)
  Editing = "editing", // Currently being edited
  Display = "display", // View-only mode, not interactive
  Running = "running", // Currently executing
}

export interface TestStep {
  uid: string;
  status: TestStepExecutionStatus;
  action: Action;
  regenerateAction: boolean;
}

// Import and re-export from shiplight-types for backward compatibility
import type {
  ActionGenerationDebugInfo as _ActionGenerationDebugInfo,
  MessageForLogging as _MessageForLogging,
  MessagePartForLogging as _MessagePartForLogging,
} from "shiplight-types";

export type ActionGenerationDebugInfo = _ActionGenerationDebugInfo;
export type MessageForLogging = _MessageForLogging;
export type MessagePartForLogging = _MessagePartForLogging;

// Canonical definition lives in shiplight-types; re-exported here for backward compatibility.
export type { ActionGenerationResponse } from "shiplight-types";

export interface TestStepInstance {
  uid: string;
  status: TestStepExecutionStatus;
  action: Action;
  code?: string;
  regenerateAction: boolean;
  errorDetails?: string;
}
