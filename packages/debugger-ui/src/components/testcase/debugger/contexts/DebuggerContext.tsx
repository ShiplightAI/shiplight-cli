import { AgentAction } from '@/common/interfaces/interactiveRun';
import {
  findNextAfterContainer,
  findNextSibling,
  findNextStatement,
  findPathBetweenStatements,
  findStatementPathById,
} from 'shiplight-types';
import type { Condition, Statement, TestFlow } from 'shiplight-types';
import { DEFAULT_WHILE_LOOP_TIMEOUT_MS } from 'shiplight-types';
import type { ActionEntity } from 'shiplight-types';
import { IconPlayerPlay, IconPlayerSkipForward } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MenuGroup } from '../../editor/StatementContextMenu';
import {
  CleanupCallback,
  CompletionCallback,
  DebuggerContextType,
  DebugSessionInfo,
  ExecutionResult,
  ExecutionStatus,
  MultiStreamingActionCallback,
  StreamingActionCallback,
} from '../../types/debugger';

// Create the context
const DebuggerContext = createContext<DebuggerContextType | null>(null);

// Utility function to create debugger menu group
export const createDebuggerMenuGroup = (callbacks: {
  onPlay?: () => void;
  onPlayUntil?: () => void;
}, options?: {
  showPlay?: boolean;
  showPlayUntil?: boolean;
}, t?: (key: string) => string): MenuGroup => ({
  id: 'debugger',
  actions: [
    ...(callbacks.onPlay && options?.showPlay ? [{
      id: 'play',
      label: t ? t('executeStatement') : 'Execute This Step',
      icon: <IconPlayerPlay size={14} />,
      onClick: callbacks.onPlay,
      instructionComponent: (
        <div className="space-y-2">
          <div className="text-sm">
            {t ? t('executeThisStepDescription') : 'Executes this step.'}
            <ul className="mt-1 ml-3 list-disc space-y-1">
              <li>{t ? t('executeThisStepItem1') : 'This will execute the step itself.'}</li>
              <li>{t ? t('executeThisStepItem2') : 'Use this to quickly test a specific part of the test flow.'}</li>
            </ul>
          </div>
        </div>
      ),
    }] : []),
    ...(callbacks.onPlayUntil && options?.showPlayUntil ? [{
      id: 'playUntil',
      label: t ? t('runUntilThisStep') : 'Run Until This Step',
      icon: <IconPlayerSkipForward size={14} />,
      onClick: callbacks.onPlayUntil,
      instructionComponent: (
        <div className="space-y-2">
          <div className="text-sm">
            {t ? t('runUntilThisStepDescription') : 'Runs the test flow until this step is executed.'}
            <ul className="mt-1 ml-3 list-disc space-y-1">
              <li>{t ? t('runUntilThisStepItem1') : 'This will not execute the step itself.'}</li>
              <li>{t ? t('runUntilThisStepItem2') : 'Use this to quickly test a specific part of the test flow.'}</li>
            </ul>
          </div>
        </div>
      ),
    }] : []),
  ],
});

interface DebuggerProviderProps {
  testFlow: TestFlow;
  onExecuteStatement: (statement: Statement, session: DebugSessionInfo, streamingCallback?: StreamingActionCallback) => Promise<ExecutionResult>;
  onEvaluateCondition: (condition: Condition, statement: Statement, session: DebugSessionInfo) => Promise<{ result: boolean | 'unknown', message: string }>;
  onStartDebugSession: () => Promise<DebugSessionInfo>;
  onStopDebugSession: (session: DebugSessionInfo) => Promise<void>;
  onExecutionComplete?: (session: DebugSessionInfo) => Promise<void>;
  onPauseExecution?: () => Promise<void>;
  children: React.ReactNode;
}

export const DebuggerProvider: React.FC<DebuggerProviderProps> = ({
  testFlow,
  onExecuteStatement,
  onEvaluateCondition,
  onStartDebugSession,
  onStopDebugSession,
  onExecutionComplete,
  onPauseExecution,
  children,
}) => {
  // Core state
  const [currentStatementId, setCurrentStatementId] = useState<string | null>(null);
  const [prevStatementId, setPrevStatementId] = useState<string | null>(null);
  const [isDebugging, setIsDebugging] = useState(false);
  const [isStepping, setIsStepping] = useState(false); // true when executing a single step
  const [isRunning, setIsRunning] = useState(false); // true when in "run" or "run until" mode
  const [sessionInfo, setSessionInfo] = useState<DebugSessionInfo | null>(null);

  // Flag to signal stopping execution
  const shouldStopExecutionRef = useRef(false);

  // Statement status tracking
  const [statementStatus, setStatementStatus] = useState<Map<string, ExecutionStatus>>(new Map());
  const [statementDetails, setStatementDetails] = useState<Map<string, string>>(new Map());
  const [statementAiConverted, setStatementAiConverted] = useState<Map<string, boolean>>(new Map());

  // Streaming state tracking
  const [streamingStatements, setStreamingStatements] = useState<Set<string>>(new Set());
  const streamingActionsRef = useRef<Map<string, ActionEntity[]>>(new Map());

  // Streaming action callback registration (support multiple callbacks)
  const streamingActionCallbacksRef = useRef<Map<string, MultiStreamingActionCallback>>(new Map());

  // Completion callback registration (for single-step ACTION completion notification)
  const completionCallbacksRef = useRef<Map<string, CompletionCallback>>(new Map());

  // Cleanup callback registration (for clearing streaming state before execution)
  const cleanupCallbacksRef = useRef<Map<string, CleanupCallback>>(new Map());

  // While loop timeout tracking - maps loop UID to start time
  const whileLoopStartTimesRef = useRef<Map<string, number>>(new Map());

  // Keep a ref to the latest testFlow to avoid closure issues
  const testFlowRef = useRef<TestFlow>(testFlow);
  testFlowRef.current = testFlow;

  // Helper to get all statements (main flow + teardown)
  const getAllStatements = useCallback((): Statement[] => {
    const allStatements = [...(testFlow.statements ?? [])];
    if (testFlow.teardown && Array.isArray(testFlow.teardown)) {
      allStatements.push(...testFlow.teardown);
    }
    return allStatements;
  }, [testFlow]);

  // Keep a ref to the latest statements to avoid closure issues
  const statementsRef = useRef<Statement[]>(getAllStatements());
  statementsRef.current = getAllStatements();

  // Helper to get statement status
  const getStatementStatus = useCallback((stableId: string): ExecutionStatus => {
    return statementStatus.get(stableId) || 'pending';
  }, [statementStatus]);

  // Get statement details (debug message)
  const getStatementDetails = useCallback((stableId: string): string | undefined => {
    return statementDetails.get(stableId);
  }, [statementDetails]);

  // Get whether statement was AI converted
  const getStatementAiConverted = useCallback((stableId: string): boolean => {
    return statementAiConverted.get(stableId) || false;
  }, [statementAiConverted]);

  // Check if a statement is currently streaming
  const isStatementStreaming = useCallback((stableId: string): boolean => {
    return streamingStatements.has(stableId);
  }, [streamingStatements]);

  // Get the current streaming action count for a statement
  const getStreamingActionCount = useCallback((stableId: string): number => {
    const actions = streamingActionsRef.current.get(stableId);
    return actions ? actions.length : 0;
  }, []);

  // Helper to update statement status
  const updateStatementStatus = useCallback((stableId: string, status: ExecutionStatus, details?: string, isAiConverted?: boolean) => {
    console.log(`🔧 updateStatementStatus: ${stableId} -> ${status}${isAiConverted ? ' (AI converted)' : ''}`);
    setStatementStatus(prev => new Map(prev.set(stableId, status)));
    if (details) {
      setStatementDetails(prev => new Map(prev.set(stableId, details)));
    }
    if (isAiConverted !== undefined) {
      setStatementAiConverted(prev => new Map(prev.set(stableId, isAiConverted)));
    }
  }, []);

  // Helper to handle streaming action updates (pure status tracking)
  const handleStreamingActionUpdate = useCallback((statementId: string, agentAction: AgentAction) => {
    console.log(`🔄 Streaming action update for ${statementId}:`, agentAction);

    // 🔧 Ensure statement is in streaming set when receiving streaming updates
    // This handles the case where ACTION was upgraded to STEP
    setStreamingStatements(prev => {
      if (!prev.has(statementId)) {
        console.log(`🔄 [DebuggerContext] Auto-adding ${statementId} to streaming set (likely upgraded from ACTION)`);
        return new Set(prev.add(statementId));
      }
      return prev;
    });

    const actionEntity = agentAction.action_entity;
    // Store the action in our streaming actions map
    const currentActions = streamingActionsRef.current.get(statementId) || [];
    const updatedActions = [...currentActions, actionEntity];
    streamingActionsRef.current.set(statementId, updatedActions);

    // 🔧 When receiving 2nd action (ACTION→STEP conversion), switch to isRunning mode
    // This enables the Pause button for stop functionality during multi-step streaming
    // Note: This works for both Step Into (isStepping=true) and direct Execute (isStepping=false)
    if (updatedActions.length === 2 && !isRunning) {
      console.log(`🔄 [DebuggerContext] Detected multi-step streaming, enabling Pause button`);
      setIsStepping(false); // Clear isStepping if it was set
      setIsRunning(true);   // Enable Pause button
    }

    // Update status to show streaming progress
    updateStatementStatus(statementId, 'streaming', 'Streaming actions...');

    // Call streaming action callback if registered (for UI updates)
    let handled = false;
    for (const [id, callback] of streamingActionCallbacksRef.current) {
      if (callback(statementId, agentAction)) {
        console.log(`🔧 Streaming update for ${statementId} handled by callback: ${id}`);
        handled = true;
        break; // Stop after first successful handler
      }
    }

    if (!handled && streamingActionCallbacksRef.current.size > 0) {
      console.warn(`🔧 No streaming callback could handle statement ${statementId}`);
    }
  }, [updateStatementStatus, isStepping, isRunning]);

  // Memoized setCurrentStatementId for use as a stable callback
  const setCurrentStatementIdCallback = useCallback((statementId: string | null) => {
    // Track the previous statement before updating to the new one
    setPrevStatementId(currentStatementId);
    setCurrentStatementId(statementId);
          // Note: Auto-expansion is now handled by individual components (StepStatement, IfElseStatement)
    // They watch for changes in currentStatementId and expand themselves when needed
  }, [currentStatementId]);

  // Explicit notification when a statement is added
  const onStatementAdded = useCallback((statementId: string, beforeStatementId: string | null, afterStatementId: string | null) => {
    // Only update currentStatementId if we're debugging and currently at the end (currentStatementId is null)
    if (isDebugging && (!currentStatementId || prevStatementId === beforeStatementId || currentStatementId === afterStatementId)) {
      console.log(`🔧 Statement added ${statementId} while at end of execution, setting as current`);
      setCurrentStatementId(statementId);
    }
  }, [isDebugging, currentStatementId, prevStatementId]);

  // Explicit notification when a statement is deleted
  const onStatementDeleted = useCallback((deletedStatementId: string, updatedStatements: Statement[]) => {
    // Only handle if we're debugging and the deleted statement was the current one
    if (isDebugging && currentStatementId === deletedStatementId) {
      console.log(`🔧 Current statement ${deletedStatementId} was deleted`);

      // Find the next statement in execution order using the statement tree walker
      try {
        // Use statementsRef which is kept up-to-date with all statements (main flow + teardown)
        const nextStatement = findNextStatement(statementsRef.current, deletedStatementId);

        if (nextStatement) {
          console.log(`🔧 Setting current statement to next in execution order: ${nextStatement.uid}`);
          setCurrentStatementId(nextStatement.uid);
        } else {
          console.log(`🔧 No next statement found, clearing current statement (end of execution)`);
          setCurrentStatementId(null);
        }
      } catch (error) {
        console.warn(`🔧 Error finding next statement after deletion:`, error);
        // Fallback: clear current statement
        setCurrentStatementId(null);
      }
    }
  }, [isDebugging, currentStatementId]);

  // Register tree update callback
  const registerStreamingActionCallback = useCallback((
    id: string,
    callback: MultiStreamingActionCallback | null
  ) => {
    if (callback) {
      // console.log(`🔧 Registering streaming callback: ${id}`);
      streamingActionCallbacksRef.current.set(id, callback);
    } else {
      // console.log(`🔧 Unregistering streaming callback: ${id}`);
      streamingActionCallbacksRef.current.delete(id);
    }
  }, []);

  // Register completion callback (for single-step ACTION completion notification)
  const registerCompletionCallback = useCallback((
    id: string,
    callback: CompletionCallback | null
  ) => {
    if (callback) {
      console.log(`🔧 Registering completion callback: ${id}`);
      completionCallbacksRef.current.set(id, callback);
    } else {
      console.log(`🔧 Unregistering completion callback: ${id}`);
      completionCallbacksRef.current.delete(id);
    }
  }, []);

  // Register cleanup callback (for clearing streaming state before execution)
  const registerCleanupCallback = useCallback((
    id: string,
    callback: CleanupCallback | null
  ) => {
    if (callback) {
      console.log(`🔧 Registering cleanup callback: ${id}`);
      cleanupCallbacksRef.current.set(id, callback);
    } else {
      console.log(`🔧 Unregistering cleanup callback: ${id}`);
      cleanupCallbacksRef.current.delete(id);
    }
  }, []);

  // Helper to execute a STEP statement with streaming support
  const executeStepStatement = useCallback(async (statement: Statement, overrideSession?: DebugSessionInfo): Promise<ExecutionResult> => {
    const session = overrideSession || sessionInfo;

    if (!session) {
      throw new Error('No active session');
    }

    const stableId = statement.uid;

    try {
      // 🔧 Trigger cleanup callbacks before execution to clear stale streaming state
      // This ensures StatementList's streamingActionsRef and streamingStatementStateRef are cleared
      console.log(`🧹 [Cleanup] Triggering cleanup callbacks for STEP ${stableId}`);
      for (const [, callback] of cleanupCallbacksRef.current) {
        callback(stableId);
      }

      updateStatementStatus(stableId, 'streaming');
      setStreamingStatements(prev => new Set(prev.add(stableId)));

      // Clear any previous streaming actions for this statement (DebuggerContext's own ref)
      streamingActionsRef.current.delete(stableId);

      // Create streaming callback
      const streamingCallback: StreamingActionCallback = (agentAction: AgentAction) => {
        handleStreamingActionUpdate(stableId, agentAction);
      };

      const result = await onExecuteStatement(statement, session, streamingCallback);

      if (result.isAborted) {
        updateStatementStatus(stableId, 'failed', result.details);
        return { success: true, details: 'STEP execution aborted' };
      }

      // Update final status based on execution result
      if (result.success) {
        // Check if the statement was converted to AI mode
        if (result.wasConvertedToAI) {
          updateStatementStatus(stableId, 'success', result.details, true);
        } else {
          updateStatementStatus(stableId, 'success', result.details, false);
        }
      } else {
        updateStatementStatus(stableId, 'failed', result.details);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      updateStatementStatus(stableId, 'failed', errorMessage);
      return { success: false, details: errorMessage };
    } finally {
      // Clean up abort controller ref
      
      setStreamingStatements(prev => {
        const newSet = new Set(prev);
        newSet.delete(stableId);
        return newSet;
      });
    }
  }, [sessionInfo, onExecuteStatement, updateStatementStatus, handleStreamingActionUpdate]);

  // Helper to execute an ACTION statement
  const executeActionStatement = useCallback(async (statement: Statement, overrideSession?: DebugSessionInfo): Promise<ExecutionResult> => {
    const session = overrideSession || sessionInfo;

    if (!session) {
      throw new Error('No active session');
    }

    const stableId = statement.uid;

    try {
      // 🔧 Trigger cleanup callbacks before execution to clear stale streaming state
      console.log(`🧹 [Cleanup] Triggering cleanup callbacks for ${stableId}`);
      for (const [, callback] of cleanupCallbacksRef.current) {
        callback(stableId);
      }

      updateStatementStatus(stableId, 'running');

      // Create streaming callback for ACTION (needed for multi-step upgrade)
      // This allows ACTION statements to potentially convert to STEP during execution
      const streamingCallback: StreamingActionCallback = (agentAction: AgentAction) => {
        handleStreamingActionUpdate(stableId, agentAction);
      };

      const result = await onExecuteStatement(statement, session, streamingCallback);

      // Update final status
      if (result.success) {
        // Check if the statement was converted to AI mode
        if (result.wasConvertedToAI) {
          updateStatementStatus(stableId, 'success', result.details, true);
        } else {
          updateStatementStatus(stableId, 'success', result.details, false);
        }

        // 🎯 Notify completion callbacks for single-action case
        // This triggers UI update in StatementList for delayed ACTION display
        const actionCount = result.actionEntities?.length || 0;
        if (actionCount === 1) {
          console.log(`✅ [Completion] Single-action completed for ${stableId}, notifying completion callbacks`);
          for (const [id, callback] of completionCallbacksRef.current) {
            callback(stableId, actionCount);
          }
        }
      } else {
        updateStatementStatus(stableId, 'failed', result.details);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      updateStatementStatus(stableId, 'failed', errorMessage);
      return { success: false, details: errorMessage };
    }
  }, [sessionInfo, onExecuteStatement, updateStatementStatus, executeStepStatement, handleStreamingActionUpdate]);

  // Helper to initialize a new debug session
  const initializeDebugSession = useCallback(async (): Promise<DebugSessionInfo> => {
      return await onStartDebugSession();
  }, [onStartDebugSession]);

  // Start debugging - initialize session and enter debug mode
  const startDebugging = useCallback(async () => {
    if (isDebugging || isStepping || isRunning) return;

    try {
      setIsStepping(true);
      const session = await initializeDebugSession();

      setSessionInfo(session);

      // Reset all statement statuses and streaming state
      setStatementStatus(new Map());
      setStatementDetails(new Map());
      setStreamingStatements(new Set());
      streamingActionsRef.current.clear();

      // Set current statement to first statement BEFORE setting isDebugging to true
      // This prevents the useEffect from running with null currentStatementId
      if (statementsRef.current.length > 0) {
        const firstId = statementsRef.current[0].uid;
        setCurrentStatementIdCallback(firstId);
      }

      // Set debugging mode last to avoid timing issues with useEffect
      setIsDebugging(true);
    } catch (error) {
      console.error('Failed to start debugging:', error);
      notifications.show({
        title: 'Failed to start debug session',
        message: error instanceof Error ? error.message : 'Unknown error',
        color: 'red',
      });
    } finally {
      setIsStepping(false);
    }
  }, [isDebugging, isStepping, isRunning, initializeDebugSession, setCurrentStatementIdCallback]);

  // Stop debugging - terminate session and exit debug mode
  const stopDebugging = useCallback(async () => {
    try {
      if (sessionInfo) {
        await onStopDebugSession(sessionInfo);
      }
    } catch (error) {
      console.error('Failed to terminate session:', error);
    } finally {
      setSessionInfo(null);
      setIsDebugging(false);
      setIsStepping(false);
      setIsRunning(false);
      setCurrentStatementId(null);
      setPrevStatementId(null);
      setStatementStatus(new Map());
      setStatementDetails(new Map());
      setStreamingStatements(new Set());
      streamingActionsRef.current.clear();
      whileLoopStartTimesRef.current.clear();
    }
  }, [sessionInfo, onStopDebugSession]);

  // Helper to execute a single statement with proper type handling
  const executeStatementWithTypeHandling = useCallback(async (
    statement: Statement,
    session: DebugSessionInfo
  ): Promise<ExecutionResult> => {
    const stableId = statement.uid;
    let result: ExecutionResult;

    // Handle different statement types
    if (statement.type === 'STEP') {
      // Check if STEP has sublist statements
      if ('statements' in statement && statement.statements && statement.statements.length > 0) {
        // STEP with sublist statements - navigation point only
        updateStatementStatus(stableId, 'success', 'Continue to next statement');
        result = { success: true, details: 'Navigated into STEP container' };
      } else {
        // STEP without sublist statements - execute as streaming statement
        result = await executeStepStatement(statement, session);
      }
    } else if (statement.type === 'IF_ELSE') {
      // IF_ELSE statements need condition evaluation
      updateStatementStatus(stableId, 'running');

      if ('condition' in statement) {
        try {
          const conditionEval = await onEvaluateCondition(statement.condition, statement, session);
          if (conditionEval.result === 'unknown') {
            updateStatementStatus(stableId, 'failed', conditionEval.message);
            result = { success: false, details: conditionEval.message };
          } else {
            updateStatementStatus(stableId, 'success', conditionEval.message);
            result = {
              success: true,
              conditionResult: conditionEval.result,
              details: conditionEval.message
            };
          }
        } catch (error) {
          const errorMsg = `Condition evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          updateStatementStatus(stableId, 'failed', errorMsg);
          result = { success: false, details: errorMsg };
        }
      } else {
        result = { success: false, details: 'IF_ELSE statement missing condition' };
      }
    } else if (statement.type === 'WHILE_LOOP') {
      // WHILE_LOOP statements need condition evaluation
      updateStatementStatus(stableId, 'running');

      if ('condition' in statement) {
        try {
          const whileLoop = statement as any; // Access timeout_ms
          
          // Track loop start time on first evaluation
          if (!whileLoopStartTimesRef.current.has(stableId)) {
            whileLoopStartTimesRef.current.set(stableId, Date.now());
          }
          
          // Check for timeout (use default if not specified)
          const timeoutMs = whileLoop.timeout_ms ?? DEFAULT_WHILE_LOOP_TIMEOUT_MS;
          const startTime = whileLoopStartTimesRef.current.get(stableId);
          if (startTime && (Date.now() - startTime) > timeoutMs) {
            const timeoutSeconds = timeoutMs / 1000;
            const timeoutMsg = whileLoop.timeout_ms 
              ? `While loop exceeded timeout of ${timeoutSeconds}s`
              : `While loop exceeded default timeout of ${timeoutSeconds}s`;
            updateStatementStatus(stableId, 'failed', timeoutMsg);
            // Clear the start time
            whileLoopStartTimesRef.current.delete(stableId);
            result = { success: false, details: timeoutMsg };
            return result;
          }
          
          const conditionEval = await onEvaluateCondition(statement.condition, statement, session);
          if (conditionEval.result === 'unknown') {
            updateStatementStatus(stableId, 'failed', conditionEval.message);
            // Clear the start time on failure
            whileLoopStartTimesRef.current.delete(stableId);
            result = { success: false, details: conditionEval.message };
          } else {
            updateStatementStatus(stableId, 'success', conditionEval.message);
            // If condition is false (loop is exiting), clear the start time
            if (conditionEval.result === false) {
              whileLoopStartTimesRef.current.delete(stableId);
            }
            result = {
              success: true,
              conditionResult: conditionEval.result,
              details: conditionEval.message
            };
          }
        } catch (error) {
          const errorMsg = `Condition evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          updateStatementStatus(stableId, 'failed', errorMsg);
          // Clear the start time on error
          whileLoopStartTimesRef.current.delete(stableId);
          result = { success: false, details: errorMsg };
        }
      } else {
        result = { success: false, details: 'WHILE_LOOP statement missing condition' };
      }
    } else {
      // Execute ACTION statements normally
      result = await executeActionStatement(statement, session);
    }

    return result;
  }, [executeActionStatement, executeStepStatement, onEvaluateCondition, updateStatementStatus]);

  // Helper to execute a single statement and determine the next statement
  // Returns the next statement ID or null if execution should end
  const executeStatementAndGetNext = useCallback(async (
    currentStatementId: string,
    session: DebugSessionInfo
  ): Promise<{ success: boolean; nextStatementId: string | null }> => {
    const currentPath = findStatementPathById(statementsRef.current, currentStatementId);
    if (!currentPath) {
      return { success: false, nextStatementId: null };
    }

    // For STEP statements, determine next statement BEFORE execution
    // (because STEP might add new statements during execution, changing the tree structure)
    let nextStatementId: string | null = null;
    // if (currentPath.statement.type === 'STEP') {
    //   const next = findNextStatement(statementsRef.current, currentStatementId);
    //   nextStatementId = next ? next.uid : null;
    // }

    let isStepWithSublist = false;
    if (currentPath.statement.type === 'STEP' && currentPath.statement.statements && currentPath.statement.statements.length > 0) {
      isStepWithSublist = true;
    }

    const result = await executeStatementWithTypeHandling(currentPath.statement, session);

    if (!result.success) {
      return { success: false, nextStatementId: null };
    }

    if (currentPath.statement.type === 'STEP') {
      if (isStepWithSublist) {
        const next = findNextStatement(statementsRef.current, currentStatementId);
        nextStatementId = next ? next.uid : null;
      } else {
        const next = findNextSibling(statementsRef.current, currentPath) || findNextAfterContainer(statementsRef.current, currentPath);
        nextStatementId = next ? next.uid : null;
      }
    }

    // For ACTION, determine next statement AFTER execution
    // (because ACTION might be upgraded to STEP during execution via multi-step upgrade)
    if (currentPath.statement.type === 'ACTION') {
      // 🔧 Check if ACTION was upgraded to STEP during execution (multi-step upgrade)
      // TestFlowEditorController updates testFlow when upgrade is detected,
      // so we check the current state in testFlow
      const updatedPath = findStatementPathById(statementsRef.current, currentStatementId);
      
      if (updatedPath && updatedPath.statement.type === 'STEP') {
        // ACTION was upgraded to STEP - skip child statements (already executed by backend)
        // This is the same behavior as description-only STEP: skip AI-generated children
        console.log(`🔄 [Multi-step] ACTION ${currentStatementId} was upgraded to STEP, skipping children`);
        const next = findNextSibling(statementsRef.current, updatedPath) || 
                     findNextAfterContainer(statementsRef.current, updatedPath);
        nextStatementId = next ? next.uid : null;
      } else {
        // Still ACTION, find normal next statement
        const next = findNextStatement(statementsRef.current, currentStatementId);
        nextStatementId = next ? next.uid : null;
      }
    }

    // For DRAFT, determine next statement AFTER execution
    // DRAFT may be converted to ACTION (0-1 actions) or STEP (2+ actions) during execution
    if (currentPath.statement.type === 'DRAFT') {
      const updatedPath = findStatementPathById(statementsRef.current, currentStatementId);

      if (updatedPath && updatedPath.statement.type === 'STEP') {
        // DRAFT was upgraded to STEP (2+ actions) - skip child statements (already executed)
        console.log(`🔄 [Draft] DRAFT ${currentStatementId} was upgraded to STEP, skipping children`);
        const next = findNextSibling(statementsRef.current, updatedPath) ||
                     findNextAfterContainer(statementsRef.current, updatedPath);
        nextStatementId = next ? next.uid : null;
      } else {
        // DRAFT converted to ACTION or stayed DRAFT - find normal next
        const next = findNextStatement(statementsRef.current, currentStatementId);
        nextStatementId = next ? next.uid : null;
      }
    }

    // For IF_ELSE and WHILE_LOOP, determine next statement AFTER execution
    // (because next depends on condition result)
    if (currentPath.statement.type === 'IF_ELSE' || currentPath.statement.type === 'WHILE_LOOP') {
      const next = findNextStatement(statementsRef.current, currentStatementId, result.conditionResult);
      nextStatementId = next ? next.uid : null;
    }

    return { success: true, nextStatementId };
  }, [executeStatementWithTypeHandling]);

  // Helper to run until a target statement in a given session
  // If targetStableId is null, run until the end of the test flow
  const runUntilInternal = useCallback(async (
    startingStatementId: string,
    targetStableId: string | null,
    session: DebugSessionInfo
  ): Promise<string | null> => {
    let current = startingStatementId;

    // Clear the stop flag at the start and mark as running continuously
    shouldStopExecutionRef.current = false;
    setIsRunning(true);

    try {
      while (current && current !== targetStableId) {
        // Check if execution should be stopped
        if (shouldStopExecutionRef.current) {
          console.log('🛑 Execution stopped by user request at statement:', current);
          shouldStopExecutionRef.current = false; // Reset the flag
          return current;
        }

        // add 300ms delay for UI to render
        await new Promise(resolve => setTimeout(resolve, 1000));
        const { success, nextStatementId } = await executeStatementAndGetNext(current, session);

        if (!success) {
          // Stop execution on failure
          return current;
        }

        // Move to next statement or end execution
        if (nextStatementId) {
          setCurrentStatementIdCallback(nextStatementId);
          current = nextStatementId;
        } else {
          // End of execution - set currentStatementId to null to indicate we've reached the end
          console.log(`🔧 Reached end of execution, setting currentStatementId to null`);
          setCurrentStatementId(null);

          // Notify that execution completed successfully (all statements executed)
          if (onExecutionComplete) {
            console.log(`🔧 Calling onExecutionComplete callback`);
            await onExecutionComplete(session);
          }

          return null;
        }
      }

      // Return the current position (either target reached or end of execution)
      return current;
    } finally {
      // Always clear the continuous running flag when done
      console.log('🔧 runUntilInternal finally block - clearing isRunning');
      setIsRunning(false);
      shouldStopExecutionRef.current = false;
    }
  }, [executeStatementAndGetNext, setCurrentStatementIdCallback]);

  // Execute the next statement in debugging order
  const step = useCallback(async () => {
    if (!isDebugging || !currentStatementId || !sessionInfo) return;

    try {
      setIsStepping(true);

      let success = false;
      let nextStatementId: string | null = null;
      
      // 🔧 Get the current statement from testFlow
      const currentPath = findStatementPathById(statementsRef.current, currentStatementId);
      if (!currentPath) {
        console.error(`🔧 Statement ${currentStatementId} not found in testFlow`);
        return;
      }

      // Special handling for STEP statements, convert to runUntilNextSibling
      if (currentPath.statement.type === 'STEP') {
        ({ success, nextStatementId } = await runUntilNextSiblingOrAfterContainer(currentStatementId));
      } else {
        // ACTION statements - execute and check for upgrade
        const result = await executeStatementAndGetNext(currentStatementId, sessionInfo);
        success = result.success;
        nextStatementId = result.nextStatementId;
        
        // 🔧 Check if ACTION was upgraded to STEP during execution
        if (success) {
          const updatedPath = findStatementPathById(statementsRef.current, currentStatementId);
          if (updatedPath && updatedPath.statement.type === 'STEP' && currentPath.statement.type === 'ACTION') {
            console.log(`🔄 [step] ACTION ${currentStatementId} was upgraded to STEP during execution, needs proper streaming execution`);
            // Note: The execution already happened in executeStatementAndGetNext
            // The STEP execution flow was already triggered in executeStatementWithTypeHandling
          }
        }
      }

      if (success) {
        // Move to next statement or end execution
        if (nextStatementId) {
          setCurrentStatementIdCallback(nextStatementId);
        } else {
          // End of execution - set currentStatementId to null to indicate we've reached the end
          console.log(`🔧 Step reached end of execution, setting currentStatementId to null`);
          setCurrentStatementId(null);
        }
      }
    } finally {
      // Clean up both states in case ACTION was upgraded to STEP and switched to isRunning
      setIsStepping(false);
      setIsRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDebugging, currentStatementId, sessionInfo, executeStatementAndGetNext, setCurrentStatementIdCallback]);

  // Execute a specific statement by ID
  const stepTo = useCallback(async (stableId: string) => {
    if (!isDebugging) return;

    const targetPath = findStatementPathById(statementsRef.current, stableId);
    if (!targetPath) return;

    try {
      setIsStepping(true);
      await executeActionStatement(targetPath.statement);
      // Don't change current statement - this is just executing a specific statement
    } finally {
      // Clean up both states in case ACTION was upgraded to STEP and switched to isRunning
      setIsStepping(false);
      setIsRunning(false);
    }
  }, [isDebugging, executeActionStatement]);

  // Skip to the next statement, not execute a specific statement
  const skipToNextStatement = useCallback(async () => {
    if (!isDebugging || !currentStatementId || !sessionInfo) return;
    updateStatementStatus(currentStatementId, 'skipped');
    setCurrentStatementIdCallback(findNextStatement(statementsRef.current, currentStatementId)?.uid || null);
  }, [isDebugging, currentStatementId, sessionInfo, updateStatementStatus, setCurrentStatementIdCallback]);

  const skipToStatement = useCallback(async (stableId: string) => {
    if (!isDebugging || !sessionInfo) return;
    if (!currentStatementId) {
      setCurrentStatementIdCallback(stableId);
      return;
    }
    const currentPath = findStatementPathById(statementsRef.current, currentStatementId);
    if (!currentPath) {
      setCurrentStatementIdCallback(stableId);
      return;
    }
    // Use findPathBetweenStatements to get the execution path
    const path = findPathBetweenStatements(statementsRef.current, currentStatementId, stableId);
    
    if (path === null) {
      setCurrentStatementIdCallback(stableId);
      console.warn(`Cannot find path from ${currentStatementId} to ${stableId}`);
      return;
    }
    
    // Mark all statements in the path as skipped
    for (const statementId of path) {
      updateStatementStatus(statementId, 'skipped');
      console.log(`🔧 Skipping statement: ${statementId}`);
    }
    
    // Set the current statement to the target
    setCurrentStatementIdCallback(stableId);
  }, [isDebugging, currentStatementId, sessionInfo, updateStatementStatus, setCurrentStatementIdCallback]);


  const rollBackToStatement = useCallback(async (stableId: string) => {
    if (!isDebugging || !sessionInfo) return;
    
    // findPathBetweenStatements now supports null as the target, so we can pass currentStatementId directly
    const path = findPathBetweenStatements(statementsRef.current, stableId, currentStatementId);
    if (path === null) {
      console.warn(`Cannot find path from ${stableId} to ${currentStatementId || 'end'}`);
      return;
    }
    
    const newStatus = new Map(statementStatus);
    const newDetails = new Map(statementDetails);
    for (const statementId of path) {
      updateStatementStatus(statementId, 'pending');
      newStatus.delete(statementId);
      newDetails.delete(statementId);
      console.log(`🔧 Rolling back statement: ${statementId}`);
    }
    setStatementStatus(newStatus);
    setStatementDetails(newDetails);
    setCurrentStatementIdCallback(stableId);
  }, [isDebugging, currentStatementId, sessionInfo, setCurrentStatementIdCallback, statementStatus, statementDetails, updateStatementStatus]);

  /**
   * Execute from current position until reaching target statement
   * @param targetStableId - The target statement ID
   */
  const runUntil = useCallback(async (targetStableId: string) => {
    if (!isDebugging || !currentStatementId || !sessionInfo) return;

    await runUntilInternal(currentStatementId, targetStableId, sessionInfo);
  }, [isDebugging, currentStatementId, sessionInfo, runUntilInternal]);

  // Pause the current execution
  const pauseExecution = useCallback(async () => {
    console.log('⏸️ Pausing execution...');
    shouldStopExecutionRef.current = true;

    if (sessionInfo?.testSession && onPauseExecution) {
      await onPauseExecution();
    }
    
  }, [sessionInfo]);

  /**
   * Execute from current position until reaching next sibling or after container statement
   * @param currentStableId - The current statement ID
   * @returns { success: boolean; nextStatementId: string | null } - Whether the execution was successful and the next statement ID
   */
  const runUntilNextSiblingOrAfterContainer = useCallback(async (currentStableId: string): Promise<{ success: boolean; nextStatementId: string | null }> => {
    if (!isDebugging || !currentStatementId || !sessionInfo) return { success: false, nextStatementId: null };

    const targetPath = findStatementPathById(statementsRef.current, currentStableId);
    let targetStableId = null;
    if (targetPath) {
      const nextStatement = findNextSibling(statementsRef.current, targetPath) || findNextAfterContainer(statementsRef.current, targetPath);
      targetStableId = nextStatement ? nextStatement.uid : null;
    }
    const nextStatementId = await runUntilInternal(currentStatementId, targetStableId, sessionInfo); // Empty target means run to end
    return { success: nextStatementId === targetStableId, nextStatementId };
  }, [isDebugging, currentStatementId, sessionInfo, runUntilInternal]);

  // Start a new debugging session and run until target statement (avoids React state timing issues)
  // This is used when the user clicks the "Debug" button in the test case view
  // without starting a new session. To work around the react state timing issues,
  // we create a new session and pass it to the runUntilInternal function.
  const startDebuggingAndRunUntil = useCallback(async (targetStableId: string) => {
    if (isDebugging || isStepping || isRunning) return;

    try {
      // Set debugging state but not running yet - we're initializing
      setIsDebugging(true);
      setIsStepping(true); // Show as stepping during initialization

      // Initialize session
      const session = await initializeDebugSession();

      // Now we're done initializing, clear stepping state
      setIsStepping(false);
      // runUntilInternal will set isRunning(true)

      // Set up debugging state
      setSessionInfo(session);
      setStatementStatus(new Map());
      setStatementDetails(new Map());
      setStreamingStatements(new Set());
      streamingActionsRef.current.clear();

      // Wait for React state to settle
      await new Promise(resolve => setTimeout(resolve, 0));

      // Start from first statement if we have statements
      if (statementsRef.current.length > 0) {
        const firstId = statementsRef.current[0].uid;
        setCurrentStatementIdCallback(firstId);

        // Run until target using the session we just created
        await runUntilInternal(firstId, targetStableId, session);
      }
    } catch (error) {
      console.error('Failed to start debugging and run until target:', error);
      notifications.show({
        title: 'Failed to start debug session',
        message: error instanceof Error ? error.message : 'Unknown error',
        color: 'red',
      });
      // Reset states if initialization fails
      setIsDebugging(false);
      setIsStepping(false);
      throw error;
    }
    // runUntilInternal will clear isRunning when done
  }, [isDebugging, isStepping, isRunning, initializeDebugSession, runUntilInternal, setCurrentStatementIdCallback]);

  // Execute all remaining statements from current position
  const run = useCallback(async () => {
    // If not debugging, start a new session
    if (!sessionInfo) {
      await startDebuggingAndRunUntil('');
    } else {
      if (!isDebugging || !currentStatementId) {
        return;
      }
      await runUntilInternal(currentStatementId, null, sessionInfo); // Empty target means run to end
    }
  }, [isDebugging, currentStatementId, sessionInfo, runUntilInternal, startDebuggingAndRunUntil]);

  const contextValue: DebuggerContextType = {
    // State
    currentStatementId,
    prevStatementId,
    isDebugging,
    isExecuting: isStepping || isRunning, // For backward compatibility
    isStepping,
    isRunning,
    sessionInfo,

    // Statement status tracking
    getStatementStatus,
    getStatementDetails,
    getStatementAiConverted,
    updateStatementStatus,

    // Execution controls
    stepTo,
    runUntil,
    runUntilNextSiblingOrAfterContainer,
    step,
    run,
    skipToNextStatement,
    skipToStatement,
    rollBackToStatement,

    // Debugger lifecycle
    startDebugging,
    startDebuggingAndRunUntil,
    stopDebugging,
    pauseExecution,

    // Streaming updates
    onStreamingActionUpdate: handleStreamingActionUpdate,

    // Streaming state methods
    isStatementStreaming,
    getStreamingActionCount,

    // Current statement management
    setCurrentStatementId: setCurrentStatementIdCallback,
    onStatementAdded,
    onStatementDeleted,

    // Streaming action callback registration
    registerStreamingActionCallback,

    // Completion callback registration
    registerCompletionCallback,

    // Cleanup callback registration
    registerCleanupCallback,
  };

  return (
    <DebuggerContext.Provider value={contextValue}>
      {children}
    </DebuggerContext.Provider>
  );
};

// Custom hook to use the debugger context
export const useDebugger = (): DebuggerContextType => {
  const context = useContext(DebuggerContext);
  if (!context) {
    throw new Error('useDebugger must be used within a DebuggerProvider');
  }
  return context;
};

// Hook that returns null when outside a DebuggerProvider (no throw)
export const useOptionalDebugger = (): DebuggerContextType | null => {
  return useContext(DebuggerContext);
};

// Export context for advanced usage
export { DebuggerContext };
