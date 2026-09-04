import { useIsInternal } from '@/hooks/useIsInternal';
import { useTranslations } from 'next-intl';
import { useExperimentalFeature, EXPERIMENTAL_FEATURES } from '@/hooks/useExperimentalFeature';
import { useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useReusableSteps } from '@/hooks/useReusableSteps';
import { convertMultipleS3PathsToUrls } from '@/hooks/useS3ImageUrl';
import useOrganizationStore from '@/stores/organizationStore';
import { INT_RUN_ARTIFACTS_BUCKET } from '@/common/constants';
import type {
  AgentAction,
  EvaluationResult,
  ExecCodeResponse,
  LoginSessionResponse
} from '@/common/interfaces/interactiveRun';
import { AgentStepEvent, AgentStepEventTypes } from '@/common/interfaces/interactiveRun';
import type { ActionGenerationResponse } from '@/common/interfaces/testStepsInterface';
import { ActionGenerationDebugInfo } from 'shiplight-types';
import type { TestCase } from '@/common/models/testCase';
import type { Action, Condition, Draft, Statement, Step, TestFlow } from 'shiplight-types';
import { ConditionType, StatementType } from 'shiplight-types';
import { updateStatementInTree } from '@/common/steps_json/conversionUtils';
import { NodeJSCodeCommon } from 'shiplight-types';
import type { ActionEntity } from 'shiplight-types';
import { applyStatementOverrides } from '@/common/steps_json/utils/locatorUtils';
import { DEFAULT_MAX_STEPS } from '@/constants/execution';
import { Alert, Text, Button } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExecutionHistoryEntry, ScreenshotResponse, TestSessionInfo } from '../../services/sandboxService';
import { TestFlowEditor } from './TestFlowEditor';
import { TestLiveViewTab } from './TestLiveView';
import { DebugSessionInfo, ExecutionResult, NetworkResponse, StreamingActionCallback } from './types/debugger';
import { runStatementTree, ExecutionCallbacks } from './debugger/utils/StatementTreeExecutor';
import { getDisplayActionName } from './utils/actionIconUtils';
import { appEventBus, useAppEvent } from '@/utils/appEventBus';
import { notifications } from '@mantine/notifications';

interface ActionExecutionStrategy {
  // Determine if action needs regeneration
  shouldRegenerate(actionStatement: Action): boolean;

  // Pre-process before generation
  preGenerate(actionStatement: Action): Action;

  // Post-process after generation
  postGenerate(actionStatement: Action, generatedEntity: ActionEntity): ActionEntity;
}

// Default strategy for standard actions
const defaultActionStrategy: ActionExecutionStrategy = {
  shouldRegenerate: (action) => !action.action_entity,
  preGenerate: (action) => action,  // Default: no preprocessing
  postGenerate: (action, entity) => entity  // Default: no postprocessing
};

// Registry of action-specific execution strategies (only special cases)
const actionStrategies: Map<string, ActionExecutionStrategy> = new Map([
  ['upload_file', {
    shouldRegenerate: (action) => {
      // Only regenerate if missing locator
      return !action.action_entity?.locator;
    },
    preGenerate: (action) => action,  // Keep as is
    postGenerate: (action, generatedEntity) => {
      // Just take the locator from generated and add it to the original
      if (generatedEntity.locator) {
        action.action_entity!.locator = generatedEntity.locator;
        action.action_entity!.action_data!.kwargs['use_file_input'] = generatedEntity.action_data!.kwargs['use_file_input'];
      }
      return action.action_entity || generatedEntity;
    }
  }],
  ['save_variable', {
    ...defaultActionStrategy,  // Inherit default shouldRegenerate and preGenerate
    postGenerate: (action, entity) => {
      // Special handling: mutate save_variable to ai_action
      if (entity.action_data) {
        entity.action_data.action_name = 'ai_action';
        entity.action_data.args = [entity.action_description];
        entity.action_data.kwargs = {};
      }
      return entity;
    }
  }]
]);

/**
 * Calculate the stepId for a statement based on its position in the testFlow
 * Returns format like 'main.0', 'main.0.1', 'teardown.0', etc.
 */
function calculateStepId(testFlow: TestFlow, statementUid: string): string {
  // Helper to recursively search for the statement and build the path
  const findInStatements = (
    statements: Statement[],
    parentPath: string
  ): string | null => {
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const currentPath = `${parentPath}.${i}`;

      if (statement.uid === statementUid) {
        return currentPath;
      }

      // Check nested statements based on statement type
      if (statement.type === StatementType.STEP && 'statements' in statement && statement.statements) {
        const result = findInStatements(statement.statements, currentPath);
        if (result) return result;
      } else if (statement.type === StatementType.IF_ELSE) {
        const ifElse = statement as any;
        if (ifElse.then) {
          const result = findInStatements(ifElse.then, currentPath);
          if (result) return result;
        }
        if (ifElse.else) {
          const result = findInStatements(ifElse.else, currentPath);
          if (result) return result;
        }
      } else if (statement.type === StatementType.WHILE_LOOP) {
        const loop = statement as any;
        if (loop.body) {
          const result = findInStatements(loop.body, currentPath);
          if (result) return result;
        }
      }
    }
    return null;
  };

  // Search in main statements
  const mainResult = findInStatements(testFlow.statements ?? [], 'main');
  if (mainResult) return mainResult;

  // Search in teardown statements
  if (testFlow.teardown) {
    const teardownResult = findInStatements(testFlow.teardown, 'teardown');
    if (teardownResult) return teardownResult;
  }

  // Fallback to using the statement UID if not found
  console.warn(`Could not find statement ${statementUid} in testFlow, using UID as stepId`);
  return statementUid;
}

/**
 * Interface for int-runner API used by TestFlowEditorController.
 * Allows injecting different implementations (e.g. web API vs Electron).
 */
export interface IntRunnerApi {
  createSession: (
    testCase: TestCase,
    options?: { urlOverride?: string }
  ) => Promise<TestSessionInfo>;
  startInteractiveRun: (
    testCase: TestCase,
    options?: { urlOverride?: string }
  ) => Promise<TestSessionInfo>;
  startDebug: (
    session: TestSessionInfo
  ) => Promise<{ liveviewUrl: string; browserWsUrl: string }>;
  getLiveviewUrl: (
    session: TestSessionInfo
  ) => Promise<{ liveviewUrl: string; browserWsUrl: string }>;
  /**
   * Cloud-only: poll backend for idle-timeout state. Omit on runners whose
   * compute is dedicated (local CLI, testbox, electron) — there's no shared
   * resource to reclaim, and the polling effect below skips when this is absent.
   */
  getSessionStatus?: (
    session: TestSessionInfo
  ) => Promise<{ status: "active" | "idle_warning" | "timed_out" | "error"; remainingSeconds?: number }>;
  loginSession: (session: TestSessionInfo) => Promise<LoginSessionResponse>;
  executeCode: (
    session: TestSessionInfo,
    code: string,
    stepId?: string,
    isSync?: boolean
  ) => Promise<ExecCodeResponse>;
  executeAction: (
    session: TestSessionInfo,
    actionEntity: ActionEntity,
    stepId: string,
    withSelfHealing?: boolean,
    stmtUid?: string,
    executionHistoryMap?: Map<string, ExecutionHistoryEntry>
  ) => Promise<ExecCodeResponse>;
  executeDraftStep: (
    session: TestSessionInfo,
    statement: string,
    stepId: string,
    onEvent: (event: AgentStepEvent) => void,
    signal?: AbortSignal,
    timeoutMs?: number,
    executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
    maxSteps?: number,
  ) => Promise<void>;
  evaluateStatement: (
    session: TestSessionInfo,
    statement: string,
    stepId: string,
    executionHistoryMap?: Map<string, ExecutionHistoryEntry>
  ) => Promise<EvaluationResult>;
  takeScreenshot: (
    session: TestSessionInfo,
    s3Path: string,
    saveToHistory?: boolean
  ) => Promise<ScreenshotResponse>;
  generateAction: (
    session: TestSessionInfo,
    statement: string,
    stepId: string,
    executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
    usePureVision?: boolean,
    includeDebugInfo?: boolean
  ) => Promise<ActionGenerationResponse>;
  runStep: (
    session: TestSessionInfo,
    statement: string,
    stepId: string,
    onEvent: (event: AgentStepEvent) => void,
    signal?: AbortSignal,
    timeoutMs?: number,
    executionHistoryMap?: Map<string, ExecutionHistoryEntry>
  ) => Promise<void>;
  stopRunStep: (
    session: TestSessionInfo
  ) => Promise<{ status: string; aborted: boolean; message?: string; details?: string }>;
  terminateSession: (session: TestSessionInfo) => Promise<unknown>;
  keepAlive: (session: TestSessionInfo) => Promise<{ status: string }>;
}

interface TestFlowEditorControllerProps {
  /** Int-runner API implementation (session start, execute, evaluate, etc.). */
  intRunner: IntRunnerApi;
  debuggerButtonIconOnly?: boolean;
  testCase: TestCase;
  onSave: (newTestFlow: TestFlow) => Promise<void>;
  onReceivedLiveviewUrl: (url: string | undefined, type: string | undefined) => void;
  onNetworkResponse: (responseData: NetworkResponse) => void;
  onReceivePreviewImages: (imageUrls: Array<{ url: string; label: string }>) => void;
  /** Fires when a statement is clicked, with the statement UID. */
  onStatementClick?: (statementUid: string) => void;
  onModeChange?: (mode?: 'debug' | 'generate') => void;
  setActiveTab: (tab: TestLiveViewTab | null) => void;
  onTestFlowChange?: (testFlow: TestFlow) => void; // Callback to pass test flow changes to parent
  onSessionChange?: (session: TestSessionInfo | null) => void; // Callback to pass session changes to parent
  children?: React.ReactNode;
  /** Enable/disable editing and debugging. Defaults to true. */
  editingEnabled?: boolean;
  /** Render custom content between statements (e.g., suite section dividers) */
  renderBetweenStatements?: (beforeUid: string | undefined, afterUid: string | undefined) => React.ReactNode;
  /** V2 mode: floating action bar */
  v2?: boolean;
}

export const TestFlowEditorController: React.FC<TestFlowEditorControllerProps> = ({
  intRunner,
  debuggerButtonIconOnly,
  testCase,
  onSave,
  onReceivedLiveviewUrl,
  onNetworkResponse,
  onReceivePreviewImages,
  onStatementClick,
  onModeChange,
  setActiveTab,
  onTestFlowChange,
  onSessionChange,
  children,
  editingEnabled = true,
  renderBetweenStatements,
  v2,
}) => {
  const t = useTranslations("TestCases");
  const [showConversionAlert, setShowConversionAlert] = useState(false);
  const [testFlow, setTestFlow] = useState<TestFlow | null>(null);
  const [previousTestFlow, setPreviousTestFlow] = useState<TestFlow | null>(null);

  // URL override state (memory only, not persisted)
  const [urlOverride, setUrlOverride] = useState<string>("");


  const currentAbortControllerRef = useRef<AbortController | null>(null);
  const pausePendingRef = useRef(false);
  const latestSessionRef = useRef<TestSessionInfo | null>(null);
  const isCleaningUpSessionRef = useRef(false);
  const failedStepErrorsRef = useRef<Map<string, { description: string; error: string }>>(new Map());
  const [hasActiveSession, setHasActiveSession] = useState(false);

  // Track when user has made manual edits (vs receiving external updates)
  // This is used to prevent external updates from overwriting unsaved user edits
  const userHasEditedRef = useRef(false);
  // Track the last testCase.testFlow we received from props to detect prop changes
  const lastTestCaseTestFlowRef = useRef<string>('');

  const checkPausePendingAndStop = async () => {
    if (pausePendingRef.current) {
      pausePendingRef.current = false;
      if (currentAbortControllerRef.current) {
        currentAbortControllerRef.current.abort();
        const session = latestSessionRef.current;
        if (!session) {
          console.warn('Pause execution requested without an active session');
          return;
        }
  
        await intRunner.stopRunStep(session);
        currentAbortControllerRef.current = null;
      }
      return true;
    }
    return false;
  };

  // Track the last loaded testFlow JSON to detect changes
  // const lastLoadedTestFlowRef = useRef<string>('');

  // Session-only debug info map (not persisted to database)
  // Maps statement UID to generation debug info
  const [actionGenerationDebugInfo, setActionGenerationDebugInfo] = useState<Map<string, ActionGenerationDebugInfo>>(new Map());
  const organization = useOrganizationStore(state => state.organization);
  const organizationId = organization?.organization_id;
  const isInternal = useIsInternal();

  // Use reusable steps hook for updating templates and getting templates for hooks
  const { updateReusableStep, getReusableStepById } = useReusableSteps();

  // Extract default environment config from test case (including hooks)
  const defaultEnvironmentConfig = useMemo(() => {
    const environmentConfigs = (testCase as any).environmentConfigs;
    if (environmentConfigs && environmentConfigs.length > 0) {
      const defaultConfig = environmentConfigs.find((env: any) => env.isDefaultDebug);
      if (defaultConfig) {
        return defaultConfig;
      }
      return environmentConfigs[0];
    }
    return undefined;
  }, [testCase]);

  const defaultEnvironmentId = defaultEnvironmentConfig?.environmentId;

  // Sync testFlow with testCase.testFlow when props change
  // This detects when testCase.testFlow changes (from save or refetch)
  // and syncs unless the user has made unsaved manual edits
  useEffect(() => {
    const newTestFlowJson = JSON.stringify(testCase.testFlow || null);
    const lastTestFlowJson = lastTestCaseTestFlowRef.current;

    // Detect if testCase.testFlow has changed from props
    if (newTestFlowJson !== lastTestFlowJson) {
      console.log('📥 [TestFlowEditorController] testCase.testFlow changed from props');

      // If user hasn't made manual edits, sync the testFlow
      if (!userHasEditedRef.current) {
        console.log('🔄 [TestFlowEditorController] Syncing testFlow (no unsaved user edits)');
        setTestFlow(testCase.testFlow || null);
        setHasUnsavedChanges(false);
      } else {
        console.log('⚠️ [TestFlowEditorController] Skipping sync - user has unsaved edits');
      }

      // Update the ref to track what we received
      lastTestCaseTestFlowRef.current = newTestFlowJson;
    }
  }, [testCase.testFlow]);

  // Helper function to update a statement in the testFlow
  const updateStatementInTestFlow = (statementId: string, updatedStatement: Statement) => {
    setTestFlow(prevTestFlow => {
      if (!prevTestFlow) return prevTestFlow;

      // Update the testFlow with the modified statement using the shared utility
      const updatedTestFlow = {
        ...prevTestFlow,
        statements: updateStatementInTree(prevTestFlow.statements ?? [], statementId, updatedStatement),
        teardown: prevTestFlow.teardown ? updateStatementInTree(prevTestFlow.teardown, statementId, updatedStatement) : prevTestFlow.teardown
      };

      console.log('🔄 Updated testFlow:', updatedTestFlow);

      return updatedTestFlow;
    });
  };

  // Process images from a single ACTION statement when clicked
  const handleStatementSelected = async (statement: Statement, isDebugging: boolean) => {
    if (onStatementClick) {
      onStatementClick(statement.uid);
    }

    if (statement.type === StatementType.ACTION) {
      const actionStatement = statement as Action;
      if (actionStatement.action_entity) {
        const imageItems = await processImageUrls([actionStatement.action_entity]);
        if (imageItems.length > 0) {
          onReceivePreviewImages(imageItems);
          if (!isDebugging) {
            setActiveTab('previews');
          }
        }
      } else {
        // Clear images if action has no entity
        onReceivePreviewImages([]);
      }
    } else {
      // Clear images if action has no entity
      onReceivePreviewImages([]);
    }
  };

  const handleTestFlowChange = (newTestFlow: TestFlow) => {
    setTestFlow(newTestFlow);
    setPreviousTestFlow(null);
    // Mark that user has made manual edits
    userHasEditedRef.current = true;
    setHasUnsavedChanges(true);
    // Also notify parent component about test flow changes
    if (onTestFlowChange) {
      onTestFlowChange(newTestFlow);
    }
  };


  // Collect all modified reusable steps from the test flow
  const collectModifiedReusableSteps = (statements: Statement[]): Map<number, { description: string; statements: Statement[] }> => {
    const modifiedSteps = new Map<number, { description: string; statements: Statement[] }>();

    const traverse = (stmts: Statement[]) => {
      for (const stmt of stmts) {
        if (stmt.type === StatementType.STEP) {
          const step = stmt as Step;

          // Check if this is a resolved reusable step (has reference_id > 0)
          if (step.reference_id && step.reference_id > 0) {
            // Store the step data keyed by reference_id
            // If multiple instances of the same template exist, the last one wins
            // (they should all have the same modifications anyway)
            modifiedSteps.set(step.reference_id, {
              description: step.description || '',
              statements: step.statements || []
            });
          }

          // Recursively check nested statements
          if (step.statements && step.statements.length > 0) {
            traverse(step.statements);
          }
        } else if (stmt.type === StatementType.IF_ELSE) {
          // Check both branches
          const ifElse = stmt as any;
          if (ifElse.then) traverse(ifElse.then);
          if (ifElse.else) traverse(ifElse.else);
        } else if (stmt.type === StatementType.WHILE_LOOP) {
          const loop = stmt as any;
          if (loop.body) traverse(loop.body);
        }
      }
    };

    traverse(statements);
    return modifiedSteps;
  };

  const handleSave = async () => {
    if (!testFlow) return;

    try {
      // 1. Collect all modified reusable steps
      const modifiedReusableSteps = collectModifiedReusableSteps(testFlow.statements ?? []);

      // Also check teardown if it exists
      if (testFlow.teardown) {
        const teardownModified = collectModifiedReusableSteps(testFlow.teardown);
        teardownModified.forEach((value, key) => {
          modifiedReusableSteps.set(key, value);
        });
      }

      // 2. Update all modified reusable steps (parallel requests)
      if (modifiedReusableSteps.size > 0) {
        console.log(`📝 Updating ${modifiedReusableSteps.size} reusable step(s)...`);

        const updatePromises = Array.from(modifiedReusableSteps.entries()).map(
          ([referenceId, data]) =>
            updateReusableStep(
              referenceId,
              {
                description: data.description,
                statements: data.statements
              },
              testCase.id  // Pass test case id for audit tracking
            ).catch(error => {
              console.error(`Failed to update reusable step ${referenceId}:`, error);
              throw error;
            })
        );

        await Promise.all(updatePromises);
        console.log(`✅ Successfully updated ${modifiedReusableSteps.size} reusable step(s)`);
      }

      // 3. Save the test flow
      // Note: The stripping of reusable groups is now handled by the parent component (NewStepEditor)
      // This allows the parent to update the cache with the expanded version while saving the stripped version
      console.log(`💾 [TestFlowEditorController] Passing testFlow to onSave (parent will handle stripping)`);
      await onSave(testFlow);
      setShowConversionAlert(false); // Hide alert after successful save

      // Reset the user edit flag after successful save
      userHasEditedRef.current = false;
      setHasUnsavedChanges(false);

    } catch (error) {
      console.error('❌ Save failed:', error);
      throw error;
    }
  };

  const handleRevert = async () => {
    setPreviousTestFlow(testFlow);
    // Reset testFlow to original state from testCase
    // Note: testCase.testFlow is already resolved (expanded) by useTestCaseDetails
    setTestFlow(testCase.testFlow || null);
    // Reset the user edit flag since we're reverting to the original
    userHasEditedRef.current = false;
    setHasUnsavedChanges(false);

    if (onModeChange) {
      onModeChange();
    }
  };

  const handleUndo = async () => {
    if (previousTestFlow) {
      setTestFlow(previousTestFlow);
      setPreviousTestFlow(null);
    }
  };

  // Helper function to extract and convert image URLs from action entities
  const processImageUrls = async (actionEntities: ActionEntity[]): Promise<Array<{ url: string; label: string }>> => {
    // Collect all S3 paths and their metadata
    const pathsToConvert: Array<{ path: string; label: string }> = [];

    for (const actionEntity of actionEntities) {
      if (actionEntity.artifacts) {
        const { screenshot_s3_path_before, screenshot_s3_path_after } = actionEntity.artifacts;

        // Use the same badge labeling logic as the UI
        const actionName = actionEntity.action_data?.action_name || 'action';
        const actionDescription = actionEntity.action_description || '';
        const badgeLabel = getDisplayActionName(actionName, actionDescription, actionEntity);

        if (screenshot_s3_path_before) {
          pathsToConvert.push({
            path: screenshot_s3_path_before,
            label: `${badgeLabel} - Before`
          });
        }

        if (screenshot_s3_path_after) {
          pathsToConvert.push({
            path: screenshot_s3_path_after,
            label: `${badgeLabel} - After`
          });
        }
      }
    }

    if (pathsToConvert.length === 0) return [];

    // Convert all S3 paths to URLs in parallel
    const s3Paths = pathsToConvert.map(item => item.path);
    const urls = await convertMultipleS3PathsToUrls(s3Paths);

    // Build the final image URLs array, filtering out failed conversions
    const imageItems: Array<{ url: string; label: string }> = [];
    urls.forEach((url, index) => {
      if (url) {
        imageItems.push({
          url,
          label: pathsToConvert[index].label
        });
      }
    });

    return imageItems;
  };

  /**
   * Executes an ACTION statement with a defined action_entity
   * @param actionEntity The action entity to execute
   * @param session The debug session for execution
   * @param statementUid Optional statement UID for logging
   * @returns Execution result
   */
  const executeActionEntity = async (
    actionEntity: ActionEntity,
    session: DebugSessionInfo,
    statementUid?: string
  ): Promise<ExecutionResult> => {
    const logPrefix = statementUid ? `statement ${statementUid}` : 'action entity';
    console.log(`🚀 Executing action entity for ${logPrefix}`);

    // Calculate the proper stepId based on statement position in testFlow
    const stepId = statementUid && testFlow ? calculateStepId(testFlow, statementUid) : (statementUid || 'action');

    // Use the new executeAction endpoint which handles code generation and file downloads on the backend
    const result: ExecCodeResponse = await intRunner.executeAction(session.testSession, actionEntity, stepId, true, statementUid, session.executionHistory);

    // Send response to parent component
    if (onNetworkResponse) {
      onNetworkResponse({
        details: result.details,
        testContext: result.testContext,
        stdout: result.stdout
      });
    }

    return {
      success: result.status === 'success',
      details: result.details,
      actionGenerationDebugInfo: result.actionGenerationDebugInfo,
      newActionEntity: result.newActionEntity,
    };
  };

  /**
   * Calculate the timeout for step execution based on organization settings
   * @returns Timeout in milliseconds
   */
  const calculateStepTimeout = (): number => {
    const DEFAULT_STEP_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const MAX_STEP_TIMEOUT = 15 * 60 * 1000; // 10 minutes

    // Get organization timeout if configured
    let orgTimeoutMs = 0;
    if (organization?.settings?.timeouts?.max_step_run_in_minutes) {
      const minutes = organization.settings.timeouts.max_step_run_in_minutes;
      if (typeof minutes === 'number' && minutes > 0) {
        orgTimeoutMs = minutes * 60 * 1000;
      }
    }

    // Take the maximum of default and organization timeout, then cap by max
    const timeoutMs = Math.min(
      Math.max(DEFAULT_STEP_TIMEOUT, orgTimeoutMs),
      MAX_STEP_TIMEOUT
    );

    console.log(`Step timeout: ${timeoutMs / 60000} minutes (default: ${DEFAULT_STEP_TIMEOUT / 60000}m, org: ${orgTimeoutMs / 60000}m, max: ${MAX_STEP_TIMEOUT / 60000}m)`);

    return timeoutMs;
  };

  /**
   * Executes hook template statements (beforeTest or afterTest)
   * Uses the shared templateExecutor with full control flow support (IF_ELSE, WHILE_LOOP)
   * @param templateId The reusable step (template) ID to execute
   * @param session The debug session for execution
   * @param hookName Name of the hook for logging ('beforeTest' or 'afterTest')
   */
  const executeHookTemplate = async (
    templateId: number,
    session: DebugSessionInfo,
    hookName: string
  ): Promise<void> => {
    const template = getReusableStepById(templateId);
    if (!template) {
      console.warn(`⚠️ Hook template ${templateId} not found, skipping ${hookName} hook`);
      return;
    }

    console.log(`🪝 Executing ${hookName} hook: "${template.name}" (${template.statements.length} statements)`);

    // Create execution callbacks for the template executor
    const callbacks: ExecutionCallbacks = {
      executeStep: async (statement, sess) => {
        return await executeStepStatement(statement, sess);
      },
      executeAction: async (statement, sess) => {
        return await executeActionStatementWithFallback(statement as Action, sess);
      },
      evaluateCondition: async (condition, statement, sess) => {
        return await handleEvaluateCondition(condition, statement, sess);
      },
      updateStatus: (statementId, status, details) => {
        console.log(`🪝 ${hookName} [${statementId}] ${status}${details ? `: ${details}` : ''}`);
      },
      delayBetweenStatements: 500,
    };

    const result = await runStatementTree(template.statements, session, callbacks);

    if (!result.success) {
      throw new Error(`${hookName} hook failed: ${result.error}`);
    }

    console.log(`🪝 ${hookName} hook completed successfully (${result.executedCount} statements)`);
  };

  /**
   * Executes a STEP statement using natural language processing
   * @param stepStatement The STEP statement to execute
   * @param session The debug session for execution
   * @param streamingCallback Optional callback for streaming updates
   * @returns Execution result with collected action entities
   */
  const executeStepStatement = async (
    stepStatement: Step,
    session: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback,
    modificationCallback?: (statement: Statement) => void,
  ): Promise<ExecutionResult> => {
    // Check if STEP has reference_id
    if (stepStatement.reference_id) {
      console.log(`🔗 STEP statement ${stepStatement.uid} has reference_id: ${stepStatement.reference_id}`);
      console.log(`⚠️ Note: reference_id should have been resolved during TestFlow loading.`);
      console.log(`📋 This step will be executed based on its description, not the template reference.`);
    }

    // Note: STEP statements can have nested statements from streaming (ACTION upgrade)
    // Empty statements array is OK - it will be filled during streaming execution
    // Non-empty statements array at execution start means it's a pre-filled STEP container
    // which should be executed by stepping through children, not by calling runStep API

    console.log(`🔄 Executing STEP statement: ${stepStatement.description}`);

    if (await checkPausePendingAndStop()) {
      return {
        success: false,
        details: 'Execution is Aborted',
        actionEntities: []
      };
    }

    // Track execution events for STEP
    const actionEntities: ActionEntity[] = [];
    let lastEvent: AgentStepEvent | null = null;

    const abortController = new AbortController();
    currentAbortControllerRef.current = abortController;

    // Calculate the proper stepId based on statement position in testFlow
    const stepId = testFlow ? calculateStepId(testFlow, stepStatement.uid) : stepStatement.uid;

    await intRunner.runStep(
      session.testSession,
      stepStatement.description,
      stepId,
      async (event) => {
        if (await checkPausePendingAndStop()) {
          return;
        }
        lastEvent = event;
        if (event.type != AgentStepEventTypes.Keepalive) {
          console.log('Step event:', event);
        }
        if (event.type === AgentStepEventTypes.Action) {
          const agentAction = event.data as AgentAction;
          if (agentAction.action_entity.action_data?.action_name !== 'done') {
            actionEntities.push(agentAction.action_entity);

            // Call streaming callback for real-time updates - this will trigger
            // the debugger context's handleStreamingActionUpdate which will
            // call the registered streaming callbacks from StatementList
            if (streamingCallback) {
              console.log(`🔄 Calling streaming callback for STEP ${stepStatement.uid} with action:`, agentAction);
              streamingCallback(agentAction);
            }

            // Send network response for test context updates
            if (onNetworkResponse && agentAction.agent_state?.testContext) {
              onNetworkResponse({
                testContext: agentAction.agent_state.testContext,
              });
            }
          }
        }
      },
      abortController.signal, // Pass the abort signal from debugger context
      calculateStepTimeout(), // timeout
      session.executionHistory
    );

    const isAborted = abortController.signal.aborted;
    currentAbortControllerRef.current = null;

    if (isAborted) {
      return {
        success: false,
        isAborted: lastEvent ? true : false,
        details: 'STEP execution aborted'
      }
    }

    if (!lastEvent) {
      return {
        success: false,
        details: "No server response"
      }
    }

    // Determine success based on the last event
    const event = lastEvent as any;

    if (event.type === AgentStepEventTypes.Error) {
      return {
        success: false,
        details: event.data?.explanation || 'STEP execution failed'
      }
    }

    if (event.type === AgentStepEventTypes.Completion) {
      return {
        success: true,
        details: event.data?.explanation || 'Successfully executed STEP',
        actionEntities
      }
    } else {
      return {
        success: false,
        details: event.data?.explanation || 'STEP execution incomplete'
      }
    }
  };

  /**
   * Executes a DRAFT statement using multi-step AI execution
   * DRAFT statements have no cached action, so this always uses AI generation
   * @param draftStatement The DRAFT statement to execute
   * @param session The debug session for execution
   * @param streamingCallback Optional callback for streaming updates
   * @param modificationCallback Optional callback for statement modifications
   * @returns Execution result with collected action entities
   */
  const executeDraftStatement = async (
    draftStatement: Draft,
    session: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback,
    modificationCallback?: (statement: Statement) => void,
  ): Promise<ExecutionResult> => {
    const description = draftStatement.description || '';
    const stepId = testFlow ? calculateStepId(testFlow, draftStatement.uid) : draftStatement.uid;

    console.log(`🚀 [ExecuteDraft] Executing DRAFT statement: ${description}`);

    if (await checkPausePendingAndStop()) {
      return {
        success: false,
        details: 'Execution is Aborted',
        actionEntities: []
      };
    }

    const actionEntities: ActionEntity[] = [];
    let lastEvent: AgentStepEvent | null = null;

    const abortController = new AbortController();
    currentAbortControllerRef.current = abortController;

    await intRunner.executeDraftStep(
      session.testSession,
      description,
      stepId,
      async (event) => {
        if (await checkPausePendingAndStop()) {
          return;
        }
        lastEvent = event;
        if (event.type != AgentStepEventTypes.Keepalive) {
          console.log('[ExecuteDraft] Step event:', event);
        }
        if (event.type === AgentStepEventTypes.Action) {
          const agentAction = event.data as AgentAction;
          if (agentAction.action_entity.action_data?.action_name !== 'done') {
            actionEntities.push(agentAction.action_entity);

            // Call streaming callback for real-time updates
            if (streamingCallback) {
              console.log(`🔄 [ExecuteDraft] Calling streaming callback with action:`, agentAction);
              streamingCallback(agentAction);
            }

            // Store debug info if available
            if (agentAction.debugInfo) {
              console.log(`🐛 [ExecuteDraft] Debug info available`);
              setActionGenerationDebugInfo(prev => {
                const updated = new Map(prev);
                updated.set(draftStatement.uid, agentAction.debugInfo!);
                return updated;
              });
            }

            // Send network response for test context updates
            if (onNetworkResponse && agentAction.agent_state?.testContext) {
              onNetworkResponse({
                testContext: agentAction.agent_state.testContext,
              });
            }
          }
        }
      },
      abortController.signal,
      calculateStepTimeout(),
      session.executionHistory,
      DEFAULT_MAX_STEPS,
    );

    const isAborted = abortController.signal.aborted;
    currentAbortControllerRef.current = null;

    if (isAborted) {
      return {
        success: false,
        isAborted: lastEvent ? true : false,
        details: 'Execution aborted'
      };
    }

    if (!lastEvent) {
      return {
        success: false,
        details: "No server response"
      };
    }

    const completionEvent = lastEvent as any;

    if (completionEvent.type === AgentStepEventTypes.Error) {
      return {
        success: false,
        details: completionEvent.data?.error || 'Execution failed'
      };
    }

    if (completionEvent.type === AgentStepEventTypes.Completion) {
      // Send network response for test context updates from completion event
      if (onNetworkResponse && completionEvent.data?.testContext) {
        onNetworkResponse({
          testContext: completionEvent.data.testContext,
        });
      }

      // Handle DRAFT conversion based on number of actions generated
      // Note: During streaming, StatementList.tsx handles UI updates:
      // - DRAFT with 2+ actions: Already converted to STEP
      // So we only need to update for DRAFT with 0-1 actions
      if (completionEvent.data?.success) {
        if (actionEntities.length === 0) {
          // No actions generated by agent - fallback to ACTION generation
          // This ensures DRAFT always converts to ACTION or STEP
          console.log(`💾 [ExecuteDraft] No actions generated for ${draftStatement.uid}, falling back to ACTION generation`);
          try {
            const actionGenerationResponse = await intRunner.generateAction(
              session.testSession,
              description,
              stepId,
              session.executionHistory,
              false, // use_pure_vision
              isInternal
            );

            if (actionGenerationResponse.status === 'success' && actionGenerationResponse.action) {
              const updatedStatement: Action = {
                uid: draftStatement.uid,
                type: StatementType.ACTION,
                description: draftStatement.description,
                action_entity: actionGenerationResponse.action,
              };

              if (modificationCallback) {
                modificationCallback(updatedStatement);
              }

              updateStatementInTestFlow(draftStatement.uid, updatedStatement);
              console.log(`💾 [ExecuteDraft] Converted DRAFT ${draftStatement.uid} to ACTION via fallback generation`);
            } else {
              console.warn(`⚠️ [ExecuteDraft] Fallback ACTION generation failed for ${draftStatement.uid}, keeping as DRAFT`);
            }
          } catch (error) {
            console.warn(`⚠️ [ExecuteDraft] Fallback ACTION generation error for ${draftStatement.uid}:`, error);
          }
        } else if (actionEntities.length === 1) {
          // Single action: Convert DRAFT to ACTION
          const updatedStatement: Action = {
            uid: draftStatement.uid,
            type: StatementType.ACTION,
            description: draftStatement.description,
            action_entity: actionEntities[0],
          };

          if (modificationCallback) {
            modificationCallback(updatedStatement);
          }

          // Update the statement in the testFlow
          updateStatementInTestFlow(draftStatement.uid, updatedStatement);
          console.log(`💾 [ExecuteDraft] Converted DRAFT ${draftStatement.uid} to ACTION with single generated action`);
        } else {
          // Multiple actions (2+): StatementList.tsx already converted to STEP during streaming
          // Don't overwrite - just log for debugging
          console.log(`💾 [ExecuteDraft] Multiple actions (${actionEntities.length}) generated for ${draftStatement.uid}, streaming already converted to STEP`);
        }
      }

      return {
        success: completionEvent.data?.success ?? true,
        details: completionEvent.data?.details || 'Successfully executed',
        actionEntities,
      };
    }

    return {
      success: false,
      details: completionEvent.data?.explanation || 'Execution incomplete'
    };
  };

  /**
   * Executes an ACTION statement with caching, validation, and fallback logic
   * @param actionStatement The ACTION statement to execute
   * @param session The debug session for execution
   * @param streamingCallback Optional callback for streaming updates (for multi-step upgrade)
   * @param modificationCallback Optional callback for modifications
   * @returns Execution result
   */
  const executeActionStatement = async (
    actionStatement: Action,
    session: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback,
    modificationCallback?: (statement: Statement) => void
  ): Promise<ExecutionResult> => {

    // Get action name to look up strategy
    const actionName = actionStatement.action_entity?.action_data?.action_name;

    // Look up strategy for this action type, fallback to default
    const strategy = actionName && actionStrategies.has(actionName)
      ? actionStrategies.get(actionName)!
      : defaultActionStrategy;

    // Determine if we need to regenerate the action entity
    const shouldRegenerate = strategy.shouldRegenerate(actionStatement);

    if (shouldRegenerate) {
      // Apply pre-generation processing
      console.log(`🔄 preGenerating statement for`, actionStatement);
      const processedStatement = strategy.preGenerate(actionStatement);
      console.log(`🔄 generated new statement`, processedStatement);

      console.log(`🔄 Generating action entity for statement: ${processedStatement.description}`);
      console.log(`📊 Execution history before generateAction:`, session.executionHistory);
      console.log(`📊 Execution history size:`, session.executionHistory?.size || 0);

      // Calculate the proper stepId based on statement position in testFlow
      const stepId = testFlow ? calculateStepId(testFlow, actionStatement.uid) : actionStatement.uid;

      const actionGenerationResponse = await intRunner.generateAction(
        session.testSession,
        processedStatement.description,
        stepId,
        session.executionHistory,
        actionStatement.use_pure_vision || false, // Use pure_vision flag from statement
        isInternal // Include debug info for internal users
      );

      // Log the actionGenerationResponse for debugging
      console.log(`📝 [LegacyAPI] Action generation response:`, actionGenerationResponse);

      // ✅ REMOVED: Legacy multi-step upgrade logic based on completes_instruction flag
      // Now only RunStep API handles multi-step tasks via runStep()
      // Legacy API only generates single actions for backward compatibility

      if (actionGenerationResponse.status !== 'success' || !actionGenerationResponse.action) {
        return {
          success: false,
          details: actionGenerationResponse.explanation || 'Failed to generate action entity'
        };
      }

      // Apply post-generation processing
      console.log(`🔄 postGenerating action entity for`, processedStatement);
      const baseActionEntity = strategy.postGenerate(processedStatement, actionGenerationResponse.action);
      console.log(`🔄 postGenerated action entity`, baseActionEntity);

      // Apply statement overrides (locator and description)
      const actionEntity = applyStatementOverrides(baseActionEntity, actionStatement, {
        logging: true,
        logPrefix: 'Generated Action'
      });

      // Execute the generated action entity
      console.log(`🚀 Executing newly generated action entity for statement`, actionEntity);
      const result = await executeActionEntity(actionEntity, session, actionStatement.uid);
      console.log(`🚀 Executing result`, result);

      // Store debug info if available (regardless of success)
      const generationDebug = actionGenerationResponse.debugInfo;
      if (generationDebug) {
        console.log(`🐛 Action generation debug info available:`, generationDebug);
        setActionGenerationDebugInfo(prev => {
          const updated = new Map(prev);
          updated.set(actionStatement.uid, generationDebug);
          return updated;
        });
      }

      // Only update statement with action_entity if execution was successful
      if (result.success) {
        const updatedStatement: Action = {
          ...actionStatement,
          action_entity: actionEntity,
        };

        if (modificationCallback) {
          modificationCallback(updatedStatement);
        }

        // Update the statement in the testFlow
        updateStatementInTestFlow(actionStatement.uid, updatedStatement);

        console.log(`💾 Updated statement ${actionStatement.uid} with generated action entity`);

        // Send action generation response to parent component
        if (onNetworkResponse) {
          onNetworkResponse({
            details: actionGenerationResponse.explanation
          });
        }
      } else {
        console.log(`❌ Execution failed for ${actionStatement.uid}, not updating action_entity`);
        // Report error to parent component
        if (onNetworkResponse) {
          onNetworkResponse({
            details: result.details || 'Action execution failed'
          });
        }
      }

      return result;
    } else {
      // Validation passed or not needed, proceed with cached execution
      console.log(`✅ Executing cached action for statement ${actionStatement.uid}`);

      // Apply locator override if present
      const actionEntity = applyStatementOverrides(actionStatement.action_entity!, actionStatement, {
        logging: true,
        logPrefix: 'Cached Action'
      });

      // Now execute the cached action entity
      const result = await executeActionEntity(actionEntity, session, actionStatement.uid);

      // If self-healing returned a healed action entity, update the statement and mark dirty
      if (result.newActionEntity) {
        const healedStatement = {
          ...actionStatement,
          action_entity: result.newActionEntity,
        };
        updateStatementInTestFlow(actionStatement.uid, healedStatement);
        userHasEditedRef.current = true;
        setHasUnsavedChanges(true);
        if (modificationCallback) {
          modificationCallback(healedStatement);
        }
      }

      // If we got debug info from aiAction, store it in session-only map (not persisted)
      if (result.actionGenerationDebugInfo) {
        const actionGenerationDebugInfo = result.actionGenerationDebugInfo;
        console.log(`🐛 Cached action had aiAction debug info, storing in session for ${actionStatement.uid}`);
        setActionGenerationDebugInfo(prev => {
          const updated = new Map(prev);
          updated.set(actionStatement.uid, actionGenerationDebugInfo);
          return updated;
        });
      }

      return result;
    }
  };

  /**
  * Execute an ACTION statement without editor-side regeneration fallback.
  * The backend self-healing result from exec_action is treated as authoritative.
  * @param actionStatement The ACTION statement to execute
  * @param session The debug session for execution
  * @param streamingCallback Optional callback for streaming updates (for multi-step upgrade)
  * @param modificationCallback Optional callback for statement modifications
  * @returns Execution result
  */
  const executeActionStatementWithFallback = async (
    actionStatement: Action,
    session: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback,
    modificationCallback?: (statement: Statement) => void
  ): Promise<ExecutionResult> => {
    console.log(`🎯 Executing action statement without regeneration fallback: ${actionStatement.uid}`);
    return executeActionStatement(actionStatement, session, streamingCallback, modificationCallback);
  };

  const constructIntRunnerScreenshotS3Path = (uid: string, postfix: string) => {
    return `s3://${INT_RUN_ARTIFACTS_BUCKET}/${organizationId}/${testCase.id}/${uid}${postfix}.png`;
  }

  // Debugger callback implementations using useIntRunner services
  const handleExecuteStatement = async (
    statement: Statement,
    session: DebugSessionInfo,
    streamingCallback?: StreamingActionCallback,
    modificationCallback?: (statement: Statement) => void,
  ): Promise<ExecutionResult> => {

    pausePendingRef.current = false;
    currentAbortControllerRef.current = null;

    let s3PathBefore = undefined;
    let s3PathAfter = undefined;

    if (statement.type === StatementType.ACTION) {
      const actionStatement = statement as Action;
      if (actionStatement.action_entity?.artifacts) {
        const { screenshot_s3_path_before, screenshot_s3_path_after } = actionStatement.action_entity.artifacts;
        s3PathBefore = screenshot_s3_path_before;
        s3PathAfter = screenshot_s3_path_after;
      }
    }
    if (!s3PathBefore) {
      s3PathBefore = constructIntRunnerScreenshotS3Path(statement.uid, "_before");
    }
    if (!s3PathAfter) {
      s3PathAfter = constructIntRunnerScreenshotS3Path(statement.uid, "_after");
    }

    let executionResult: ExecutionResult | null = null;

    try {
      console.log(`🚀 Executing statement: ${statement.type}`, statement);

      setActiveTab('live');

      const response = await intRunner.takeScreenshot(session.testSession, s3PathBefore, true);
      if (response.status !== 'success') {
        console.error(`Failed to take screenshot for ${s3PathBefore}: ${response.message}`);
        s3PathBefore = undefined;
      }

      // Execute based on statement type
      if (statement.type === StatementType.STEP) {
        const stepStatement = statement as Step;
        executionResult = await executeStepStatement(stepStatement, session, streamingCallback, modificationCallback);
      } else if (statement.type === StatementType.ACTION) {
        const actionStatement = statement as Action;
        executionResult = await executeActionStatementWithFallback(actionStatement, session, streamingCallback, modificationCallback);
      } else if (statement.type === StatementType.DRAFT) {
        // DRAFT uses multi-step AI execution since it has no cached action
        const draftStatement = statement as Draft;
        executionResult = await executeDraftStatement(draftStatement, session, streamingCallback, modificationCallback);
      } else {
        console.error(`Unsupported statement type: ${statement.type}`);
        executionResult = {
          success: false,
          details: `Only DRAFT, ACTION and STEP statements can be executed, got: ${statement.type}`
        };
      }

      // Update execution history after successful execution
      if (executionResult.success && session.executionHistory) {
        const description = (statement as any).description || '';
        const feedback = executionResult.details || 'Executed successfully';

        session.executionHistory.set(statement.uid, {
          description: description,
          feedback: feedback
        });

        console.log(`📝 Updated execution history for ${statement.uid}: "${description}" -> "${feedback}"`);
      }

      // Track failed step errors for agent context
      if (!executionResult.success && !executionResult.isAborted) {
        failedStepErrorsRef.current.set(statement.uid, {
          description: (statement as any).description || statement.uid,
          error: executionResult.details,
        });
      } else {
        failedStepErrorsRef.current.delete(statement.uid);
      }

      return executionResult;

    } catch (error) {
      console.error('Statement execution failed:', error);
      return {
        success: false,
        details: `Execution error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    } finally {
      const response = await intRunner.takeScreenshot(session.testSession, s3PathAfter);
      if (response.status !== 'success') {
        console.error(`Failed to take screenshot for ${s3PathAfter}: ${response.message}`);
        s3PathAfter = undefined;
      }

      if (statement.type === StatementType.ACTION) {
        const artifacts: Record<string, any> = {};
        if (s3PathBefore) {
          artifacts.screenshot_s3_path_before = s3PathBefore;
        }
        if (s3PathAfter) {
          artifacts.screenshot_s3_path_after = s3PathAfter;
        }

        const actionStatement = statement as Action;
        if (actionStatement.action_entity) {
          actionStatement.action_entity.artifacts = artifacts;
        }
      }
    }
  };

  const handleEvaluateCondition = async (
    condition: Condition,
    statement: Statement,
    session: DebugSessionInfo
  ): Promise<{ result: boolean | 'unknown', message: string }> => {
    try {
      console.log(`🔍 Evaluating condition: "${condition.expression}" (${condition.type}) for ${statement.type}`);

      setActiveTab('live');

      if (condition.type === ConditionType.AI_MODE) {
        // Use AI evaluation for natural language conditions
        // Calculate the proper stepId based on statement position in testFlow
        const stepId = testFlow ? calculateStepId(testFlow, statement.uid) : statement.uid;
        const response = await intRunner.evaluateStatement(session.testSession, condition.expression, stepId, session.executionHistory);

        if (response.status !== 'success') {
          return {
            result: "unknown",
            message: response.explanation || 'Unknown error'
          };
        }

        // Send response data to parent component through onNetworkResponse
        if (onNetworkResponse) {
          onNetworkResponse({
            details: response.explanation,
          });
        }

        if (response.conclusion !== "unknown") {
          // Try to parse the result as a boolean
          const conditionResult = response.conclusion === "true";
          return {
            result: conditionResult,
            message: response.explanation || 'No message'
          };
        } else {
          return {
            result: 'unknown',
            message: response.explanation || 'Unknown error'
          };
        }
      } else {
        // Use synchronous JavaScript execution for JS_CODE
        // Calculate the proper stepId based on statement position in testFlow
        const jsStepId = testFlow ? calculateStepId(testFlow, statement.uid) : statement.uid;
        const response: ExecCodeResponse = await intRunner.executeCode(session.testSession, condition.expression, jsStepId, true);

        // Send response data to parent component through onNetworkResponse
        if (onNetworkResponse) {
          onNetworkResponse({
            details: response.details,
            testContext: response.testContext,
            stdout: response.stdout
          });
        }

        if (response.status === 'success') {
          // Parse the result - it should be a boolean value
          const result = response.result;
          if (result === true || result === false) {
            return {
              result: result,
              message: response.details || 'JavaScript condition evaluated'
            };
          } else if (result === 'true' || result === 'false') {
            return {
              result: result === 'true',
              message: response.details || 'JavaScript condition evaluated'
            };
          } else {
            return {
              result: 'unknown',
              message: `JavaScript condition returned: ${result}`
            };
          }
        } else {
          return {
            result: 'unknown',
            message: response.details || 'JavaScript execution failed'
          };
        }
      }
    } catch (error) {
      console.error('Condition evaluation failed:', error);
      return {
        result: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };

  const handleStartDebugSession = async (): Promise<DebugSessionInfo> => {
    try {
      console.log('🔌 Initializing debug session...');
      setShowSessionTimeoutAlert(false);
      if (urlOverride) {
        console.log('🔗 URL Override:', urlOverride);
      }

      setActiveTab('live');

      if (onModeChange) {
        console.log("🔥 mode changed to debug");
        onModeChange('debug');
      }

      setSessionInitProgress('Starting session...');

      let session: TestSessionInfo;

      // Check if a session already exists
      const existingSession = latestSessionRef.current;
      let skipLoginAndPrelude = false;

      if (existingSession && existingSession.liveviewUrl) {
        // Session already has a browser (lazy browser already triggered) — reuse as-is
        // Skip login/prelude since the browser has already been in use
        console.log('Reusing existing session with browser:', existingSession.sessionId);
        session = existingSession;
        skipLoginAndPrelude = true;
      } else if (existingSession && !existingSession.liveviewUrl) {
        // Lightweight session exists (no browser yet) — launch the browser
        console.log('Reusing existing session for debug:', existingSession.sessionId);
        const { liveviewUrl } = await intRunner.startDebug(existingSession);
        session = {
          ...existingSession,
          liveviewUrl,
          liveviewUrlType: 'browser',
        };
        latestSessionRef.current = session;
      } else {
        // No existing session — create new one.
        session = await intRunner.startInteractiveRun(
          testCase,
          urlOverride ? { urlOverride } : undefined
        );
      }

      // Send session data to parent component through onNetworkResponse
      if (onNetworkResponse && session) {
        onNetworkResponse({
          testContext: session.testContext,
          details: session.details
        });
      }

      // Set preview URL if available
      if (session.liveviewUrl && onReceivedLiveviewUrl) {
        onReceivedLiveviewUrl(session.liveviewUrl, session.liveviewUrlType);
      }

      if (!skipLoginAndPrelude) {
        // Login if login is not disabled
        if (!testCase.disableAutoLogin) {
          setSessionInitProgress('Logging in...');
          const loginResponse = await intRunner.loginSession(session);
          if (loginResponse.status !== 'success') {
            console.error('Login failed:', loginResponse.details);
            // Terminate the session and throw error to stop initialization
            await intRunner.terminateSession(session);
            throw new Error(`Login failed: ${loginResponse.details || 'Unknown login error'}`);
          }
        }

        // Generate prelude code and run
        setSessionInitProgress('Navigating to starting URL...');
        const codeGenerator = new NodeJSCodeCommon('1.2.0', { goal: testCase.description || "", url: "" });
        const preludeCode = codeGenerator.generatePrelude();
        const preludeResult = await intRunner.executeCode(session, preludeCode, 'prelude');
        console.log('Prelude result:', preludeResult);
        if (onNetworkResponse && preludeResult?.testContext) {
          onNetworkResponse({
            testContext: preludeResult.testContext,
            stdout: preludeResult.stdout,
            details: preludeResult.details,
          });
        }
      } else {
        console.log('Skipping login and prelude — browser already active');
      }

      // Create DebugSessionInfo with execution history tracking
      const debugSession: DebugSessionInfo = {
        testSession: session,
        executionHistory: new Map()
      };

      // Execute beforeTest hook if configured
      const hooks = defaultEnvironmentConfig?.hooks;
      if (hooks?.beforeTest) {
        setSessionInitProgress('Running beforeTest hook...');
        try {
          await executeHookTemplate(hooks.beforeTest, debugSession, 'beforeTest');
        } catch (error) {
          console.error('beforeTest hook failed:', error);
          // Terminate session and throw to stop initialization
          await intRunner.terminateSession(session);
          throw new Error(`beforeTest hook failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      setSessionInitProgress(null);
      return debugSession;
    } catch (error) {
      setSessionInitProgress(null);
      // Revert state changes made before the failure
      if (onReceivedLiveviewUrl) {
        onReceivedLiveviewUrl(undefined, undefined);
      }
      if (onModeChange) {
        onModeChange();
      }
      console.error('Session initialization failed:', error);
      throw new Error(`Failed to initialize debug session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const cleanupSession = useCallback(async (sessionOverride?: TestSessionInfo | null) => {
    const session = sessionOverride ?? latestSessionRef.current;
    if (!session || isCleaningUpSessionRef.current) {
      return;
    }

    isCleaningUpSessionRef.current = true;
    failedStepErrorsRef.current.clear();

    try {
      if (onReceivedLiveviewUrl) {
        onReceivedLiveviewUrl(undefined, undefined);
      }
      onReceivePreviewImages([]);
      if (onNetworkResponse) {
        onNetworkResponse({ testContext: {}, stdout: [], details: "" });
      }
      if (onModeChange) {
        onModeChange();
      }
      await intRunner.terminateSession(session);
    } catch (error) {
      console.error('Session cleanup failed:', error);
      throw error;
    } finally {
      latestSessionRef.current = null;
      setHasActiveSession(false);
      isCleaningUpSessionRef.current = false;
      if (onSessionChange) {
        onSessionChange(null);
      }
    }
  }, [intRunner, onModeChange, onNetworkResponse, onReceivePreviewImages, onReceivedLiveviewUrl, onSessionChange]);

  const handleStopDebugSession = async (sessionInfo: DebugSessionInfo): Promise<void> => {
    console.log('🔌 Terminating debug session:', sessionInfo.testSession.sessionId);

    setActiveTab('live');
    setShowSessionTimeoutAlert(false);

    try {
      await cleanupSession(sessionInfo.testSession);
    } catch (error) {
      console.error('Session termination failed:', error);
      // Don't throw here as termination failures shouldn't block the UI
    }
  };

  /**
   * Reset the entire session from outside the debugger.
   * Called when Reset is pressed while there's an active session but no debug session.
   */
  const handleResetSession = async () => {
    const session = latestSessionRef.current;
    if (!session) return;
    setShowSessionTimeoutAlert(false);
    // Clear immediately so the Reset button is disabled for the duration of the reset,
    // regardless of whether it was triggered by the user or by a timeout.
    latestSessionRef.current = null;
    setHasActiveSession(false);
    onSessionChange?.(null);
    try {
      await cleanupSession(session);
    } catch (error) {
      console.error('Session reset failed:', error);
    }
  };

  /**
   * Called when test execution completes (all statements executed).
   * Executes afterTest hook if configured.
   */
  const handleExecutionComplete = async (sessionInfo: DebugSessionInfo): Promise<void> => {
    console.log('✅ Test execution completed');

    const hooks = defaultEnvironmentConfig?.hooks;
    if (hooks?.afterTest) {
      try {
        await executeHookTemplate(hooks.afterTest, sessionInfo, 'afterTest');
      } catch (error) {
        // Log but don't throw - afterTest hook failure shouldn't prevent normal flow
        console.error('afterTest hook failed:', error);
      }
    }
  };

  const handleSessionChange = useCallback((session: TestSessionInfo | null) => {
    if (session) {
      latestSessionRef.current = session;
      setHasActiveSession(true);
      setSessionInitProgress(null);
    } else {
      // Don't clear if there's still an active session created outside the
      // debugger; latestSessionRef is the single source of truth.
      if (latestSessionRef.current) {
        return;
      }
      setHasActiveSession(false);
    }
    if (onSessionChange) {
      onSessionChange(session);
    }
  }, [onSessionChange]);

  // Poll session status for idle timeout warning. Cloud-only — runners with
  // dedicated compute (local, electron, testbox) omit getSessionStatus and the
  // effect bails out, so there's no heartbeat and no spurious "Session timed
  // out" banner from transient HTTP blips.
  useEffect(() => {
    if (!hasActiveSession) return;
    const getStatus = intRunner.getSessionStatus;
    if (!getStatus) return;

    const POLL_INTERVAL = 5_000; // 5 second

    const pollStatus = async () => {
      const session = latestSessionRef.current;
      if (!session) return;

      const result = await getStatus(session);
      const currentSession = latestSessionRef.current;
      if (!currentSession) {
        return;
      }

      if (result.status === 'error') {
        // Transient failure — skip this poll, try again next interval
        return;
      }

      if (result.status === 'timed_out') {
        if (idleCountdownRef.current) {
          clearInterval(idleCountdownRef.current);
          idleCountdownRef.current = null;
        }
        setIdleWarningSeconds(null);
        appEventBus.emit('debugger:reset-session-requested', {
          reason: 'timeout',
          showTimeoutBannerAfterReset: true,
        });
        return;
      }

      if (result.status === 'idle_warning') {
        const remaining = result.remainingSeconds ?? 60;
        setIdleWarningSeconds(prev => {
          // Resync countdown when backend extends/refreshes remaining time.
          if (prev === null || remaining > prev + 1) {
            return remaining;
          }
          return prev;
        });
        if (!idleCountdownRef.current) {
          setIdleWarningSeconds(remaining);
          idleCountdownRef.current = setInterval(() => {
            setIdleWarningSeconds(prev => {
              if (prev === null || prev <= 1) {
                clearInterval(idleCountdownRef.current!);
                idleCountdownRef.current = null;
                return null;
              }
              return prev - 1;
            });
          }, 1000);
        }
      } else {
        // Active — dismiss any existing warning
        if (idleCountdownRef.current) {
          clearInterval(idleCountdownRef.current);
          idleCountdownRef.current = null;
        }
        setIdleWarningSeconds(null);
      }
    };

    const intervalId = setInterval(pollStatus, POLL_INTERVAL);

    return () => {
      clearInterval(intervalId);
      if (idleCountdownRef.current) {
        clearInterval(idleCountdownRef.current);
        idleCountdownRef.current = null;
      }
      setIdleWarningSeconds(null);
    };
  }, [hasActiveSession]);

  const handlePauseExecution = async (): Promise<void> => {
    try {
      // setActiveTab('live');
      pausePendingRef.current = true;

      if (currentAbortControllerRef.current) {
        // currentAbortControllerRef.current.abort();
        const session = latestSessionRef.current;
        if (!session) {
          console.warn('Pause execution requested without an active session');
          return;
        }
  
        await intRunner.stopRunStep(session);
        currentAbortControllerRef.current = null;
        pausePendingRef.current = false;
      }
    } catch (error) {
      console.error('Pause execution failed:', error);
    }
  };

  const handleKeepAlive = async () => {
    const session = latestSessionRef.current;
    if (!session) return;
    try {
      const result = await intRunner.keepAlive(session);
      if (result.status !== 'success') {
        console.warn('Keep alive returned non-success status:', result.status);
        return;
      }
      if (idleCountdownRef.current) {
        clearInterval(idleCountdownRef.current);
        idleCountdownRef.current = null;
      }
      setIdleWarningSeconds(null);
    } catch (error) {
      console.error('Keep alive ping failed:', error);
    }
  };

  const [sessionInitProgress, setSessionInitProgress] = useState<string | null>(null);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [idleWarningSeconds, setIdleWarningSeconds] = useState<number | null>(null);
  const [showSessionTimeoutAlert, setShowSessionTimeoutAlert] = useState(false);
  const idleCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useAppEvent('debugger:reset-session-completed', (payload) => {
    if (!payload.showTimeoutBanner) return;
    setShowSessionTimeoutAlert(true);
    notifications.show({
      id: 'session-timeout',
      title: t('sessionTimedOutTitle'),
      message: t('sessionTimedOutMessage'),
      color: 'yellow',
      autoClose: 5000,
    });
  }, []);

  const handleDiscardUnsavedChanges = useCallback(async () => {
    userHasEditedRef.current = false;
    setHasUnsavedChanges(false);
  }, []);

  useLeaveGuard({
    enabled: hasUnsavedChanges,
    title: t('testFlowUnsavedChangesTitle'),
    message: (
      <Text size="sm">
        {t('testFlowUnsavedChangesMessage')}
      </Text>
    ),
    stayLabel: t('continueEditing'),
    leaveLabel: t('discardAndLeave'),
    onDiscard: handleDiscardUnsavedChanges,
    // Tab switches within the same test case keep the component mounted,
    // so unsaved changes are preserved — no need to warn.
    shouldIgnore: (url) => testCase.id != null && url.startsWith(`/test-cases/${testCase.id}/`),
  });

  useEffect(() => {
    return () => {
      if (!latestSessionRef.current) {
        return;
      }

      // Intentionally bypass cleanupSession on unmount:
      // we only want to terminate the remote session here and avoid setState
      // work against an unmounted component (liveview URL, preview images, network response).
      void intRunner.terminateSession(latestSessionRef.current).catch((error) => {
        console.error('Session cleanup on unmount failed:', error);
      });
      latestSessionRef.current = null;
    };
  }, [intRunner]);

  if (!testFlow) {
    // You can render a loading state or nothing while testFlow is being initialized
    return <div>Loading test flow...</div>;
  }

  return (
    <>
      <TestFlowEditor
        debuggerButtonIconOnly={debuggerButtonIconOnly}
        testFlow={testFlow}
        onTestFlowChange={handleTestFlowChange}
        onSave={handleSave}
        onRevert={handleRevert}
        onUndo={handleUndo}
        canUndo={previousTestFlow !== null}
        onExecuteStatement={handleExecuteStatement}
        onEvaluateCondition={handleEvaluateCondition}
        onStartDebugSession={handleStartDebugSession}
        onStopDebugSession={handleStopDebugSession}
        onExecutionComplete={handleExecutionComplete}
        onStatementSelected={handleStatementSelected}
        onSessionChange={handleSessionChange}
        onPauseExecution={handlePauseExecution}
        defaultEnvironmentId={defaultEnvironmentId}
        enabled={editingEnabled}
        actionGenerationDebugInfo={actionGenerationDebugInfo}
        urlOverride={urlOverride}
        onUrlOverrideChange={setUrlOverride}
        hasChanges={hasUnsavedChanges}
        hasActiveSession={hasActiveSession}
        onResetSession={handleResetSession}
        renderBetweenStatements={renderBetweenStatements}
        v2={v2}
        headerAlerts={<>
          {showConversionAlert && (
            <Alert
              icon={<IconInfoCircle size="1rem" />}
              title="Test Converted"
              color="blue"
              withCloseButton
              onClose={() => setShowConversionAlert(false)}
              mb="md"
            >
              This test was converted from an older format. Please review the steps and save to finalize the conversion.
            </Alert>
          )}
      {showSessionTimeoutAlert && (
        <Alert
              icon={<IconInfoCircle size="1rem" />}
              title={t('sessionTimedOutTitle')}
              color="yellow"
          withCloseButton
          onClose={() => setShowSessionTimeoutAlert(false)}
              mb="md"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Your session was reset due to inactivity. Start debug again to continue.</span>
              </div>
            </Alert>
          )}
          {idleWarningSeconds !== null && (
            <Alert
              icon={<IconInfoCircle size="1rem" />}
              title="Session idle"
              color="yellow"
              mb="md"
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Session will terminate in <strong>{idleWarningSeconds}s</strong> due to inactivity.</span>
                <Button size="xs" color="yellow" variant="filled" onClick={handleKeepAlive} ml="md">
                  Keep alive
                </Button>
              </div>
            </Alert>
          )}
        </>}
      >
        {children}
      </TestFlowEditor>
    </>
  );
};

/** Props for the wrapper: same as TestFlowEditorController but without intRunner (injected by the wrapper). */
export type TestFlowEditorControllerWithIntRunnerProps = Omit<
  TestFlowEditorControllerProps,
  'intRunner'
>;
