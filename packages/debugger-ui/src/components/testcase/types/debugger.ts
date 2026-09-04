import { ExecutionHistoryEntry, TestSessionInfo } from '@/services/sandboxService';
import type { AgentAction } from '@/common/interfaces/interactiveRun';
import { ActionGenerationDebugInfo } from 'shiplight-types';
import type { Condition, Statement, TestFlow } from 'shiplight-types';
import type { ActionEntity } from 'shiplight-types';

// Execution status for individual statements
export type ExecutionStatus = 'pending' | 'running' | 'streaming' | 'success' | 'failed' | 'skipped';

// DebugSessionInfo is a frontend-only structure that wraps TestSessionInfo with execution tracking
export interface DebugSessionInfo {
  testSession: TestSessionInfo;
  executionHistory: Map<string, ExecutionHistoryEntry>;
}

// Result from executing a statement
export interface ExecutionResult {
  success: boolean;
  details: string;
  isAborted?: boolean; // Indicates if the execution was aborted
  conditionResult?: boolean; // For IF_ELSE and WHILE_LOOP statements
  actionEntities?: ActionEntity[]; // For statements that generate actions
  isPartial?: boolean; // Indicates if this is a partial result due to timeout/error
  warningMessage?: string; // Warning message for partial results
  wasConvertedToAI?: boolean; // Indicates if the statement was converted to AI mode for successful execution
  wasRegenerated?: boolean; // Indicates if the action_entity was regenerated for successful execution
  actionGenerationDebugInfo?: ActionGenerationDebugInfo; // Debug info from action generation (for aiAction calls)
  newActionEntity?: ActionEntity; // Healed action entity from self-healing
}

// Streaming callback for real-time action updates
export interface StreamingActionCallback {
  (agentAction: AgentAction): void;
}

// Completion callback for single-step ACTION execution
export interface CompletionCallback {
  (statementId: string, actionCount: number): void;
}

// Cleanup callback for clearing streaming state before execution
export interface CleanupCallback {
  (statementId: string): void;
}

// Multi-callback streaming function that returns whether it handled the update
export interface MultiStreamingActionCallback {
  (statementId: string, agentAction: AgentAction): boolean;
}

export interface NetworkResponse {
  testContext?: Record<string, any>;
  stdout?: string[];
  details?: string;
}

// Enhanced execution result for streaming updates
export interface StreamingExecutionResult extends ExecutionResult {
  isStreaming?: boolean; // Indicates if this result is from streaming updates
  streamingComplete?: boolean; // Indicates if streaming has completed
}

// Context type for the debugger
export interface DebuggerContextType {
  // State
  currentStatementId: string | null;
  prevStatementId: string | null;
  isDebugging: boolean; // true when in debug mode (shows debug UI)
  isExecuting: boolean; // DEPRECATED - use isStepping || isRunning instead
  isStepping: boolean; // true when executing a single step
  isRunning: boolean; // true when in "run" or "run until" mode

  // Session management
  sessionInfo: DebugSessionInfo | null;

  // Statement status tracking
  getStatementStatus: (stableId: string) => ExecutionStatus;
  getStatementDetails: (stableId: string) => string | undefined;
  getStatementAiConverted: (stableId: string) => boolean;
  updateStatementStatus: (stableId: string, status: ExecutionStatus, details?: string, isAiConverted?: boolean) => void;

  // Current statement management
  setCurrentStatementId: (stableId: string | null) => void;
  onStatementAdded: (statementId: string, beforeStatementId: string | null, afterStatementId: string | null) => void; // Explicit notification when a statement is added
  onStatementDeleted: (statementId: string, updatedStatements: Statement[]) => void; // Explicit notification when a statement is deleted

  // Streaming state tracking
  isStatementStreaming: (stableId: string) => boolean;
  getStreamingActionCount: (stableId: string) => number;

  // Execution controls
  stepTo: (stableId: string) => Promise<void>; // Execute a specific statement (for individual "play" buttons)
  runUntil: (targetStableId: string) => Promise<void>; // Execute from current position until reaching target statement
  runUntilNextSiblingOrAfterContainer: (targetStableId: string) => Promise<{ success: boolean; nextStatementId: string | null }>; // Execute from current position until reaching next sibling statement
  step: () => Promise<void>; // Execute the next statement in debugging order (main "Step" button)
  run: () => Promise<void>; // Execute all remaining statements from current position (main "Run" button)
  skipToNextStatement: () => Promise<void>; // Skip to the next statement
  skipToStatement: (stableId: string) => Promise<void>; // Skip to a specific statement
  rollBackToStatement: (stableId: string) => Promise<void>; // Roll back to a specific statement
  
  // Debugger lifecycle
  startDebugging: () => Promise<void>; // Initialize session and start debugging (main "Start" button)
  startDebuggingAndRunUntil: (targetStableId: string) => Promise<void>; // Start debugging and run until target statement
  stopDebugging: () => Promise<void>; // Terminate session and reset to initial state (main "Stop" button)
  pauseExecution: () => Promise<void>; // Signal to stop ongoing execution at the next statement

  // Streaming updates
  onStreamingActionUpdate?: (statementId: string, agentAction: AgentAction) => void; // Callback for real-time action updates

  // Streaming action callback registration
  registerStreamingActionCallback: (id: string, callback: MultiStreamingActionCallback | null) => void;

  // Completion callback registration (for single-step ACTION completion)
  registerCompletionCallback: (id: string, callback: CompletionCallback | null) => void;

  // Cleanup callback registration (for clearing streaming state before execution)
  registerCleanupCallback: (id: string, callback: CleanupCallback | null) => void;
}

// Props for the main TestFlowEditor component
export interface TestFlowEditorProps {
  testFlow: TestFlow;
  onTestFlowChange: (testFlow: TestFlow) => void;
  onSave: () => Promise<void>;
  onRevert: () => Promise<void>;
  onUndo?: () => Promise<void>;
  canUndo?: boolean;
  hasChanges?: boolean;

  // Debugger related props
  onExecuteStatement: (
    statement: Statement,
    sessionInfo: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback,
    modificationCallback?: (statement: Statement) => void,
  ) => Promise<ExecutionResult>;
  onEvaluateCondition: (condition: Condition, statement: Statement, sessionInfo: DebugSessionInfo) => Promise<{ result: boolean | 'unknown', message: string }>;
  onStartDebugSession: () => Promise<DebugSessionInfo>;
  onStopDebugSession: (sessionInfo: DebugSessionInfo) => Promise<void>;
  onExecutionComplete?: (sessionInfo: DebugSessionInfo) => Promise<void>; // Called when test execution completes (all statements executed)
  onPauseExecution?: () => Promise<void>; // Pause execution handler
  onStatementSelected?: (statement: Statement, isDebugging: boolean) => Promise<void>; // Statement click handler for image preview
  onSessionChange?: (session: TestSessionInfo | null) => void; // Callback to pass session changes to parent

  // StatementEditor props (passed through)
  enabled: boolean;
  readonly?: boolean; // If true, the test flow editor will be readonly

  // UI customization
  className?: string;
  headerContent?: React.ReactNode;
  footerContent?: React.ReactNode;
  children?: React.ReactNode;

  debuggerButtonIconOnly?: boolean;

  hiddenDebuggerButtonBar?: boolean; // If true, the debugger button bar will not be shown

  // URL override (memory only, not persisted)
  urlOverride?: string;
  onUrlOverrideChange?: (url: string) => void;

  // Test case environment configuration
  defaultEnvironmentId?: number;

  // Action generation debug info (not persisted to database)
  actionGenerationDebugInfo?: Map<string, ActionGenerationDebugInfo>;

  // Session reset (terminates browser + session)
  hasActiveSession?: boolean;
  onResetSession?: () => Promise<void>;

  // Render custom content between statements (e.g., suite section dividers)
  renderBetweenStatements?: (beforeUid: string | undefined, afterUid: string | undefined) => React.ReactNode;

  // Alerts rendered between the button bar and the scrollable content
  headerAlerts?: React.ReactNode;

  // V2 mode: floating action bar + structured action forms
  v2?: boolean;
}