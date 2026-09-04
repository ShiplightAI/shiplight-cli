import { useTranslations } from 'next-intl';
import { TestSessionInfo } from '@/services/sandboxService';
import { appEventBus, useAppEvent } from '@/utils/appEventBus';
import { Statement, StatementType, TestFlow } from 'shiplight-types';
import { addStatementAtEnd, generateUid, insertStatementBeforeInTree, updateStatementInTree } from '@/common/steps_json/conversionUtils';
import { Button } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { DebuggerButtonBar } from './debugger/components/DebuggerButtonBar';
import { DebuggerProvider, useDebugger } from './debugger/contexts/DebuggerContext';
import { DragContainer } from './editor/DragContainer';
import { EditorProvider, useEditor } from './editor/contexts/EditorContext';
import { StatementEditor } from './editor/StatementEditor';
import type { DebugSessionInfo, StreamingActionCallback, TestFlowEditorProps } from './types/debugger';

/**
 * Wrapper component that provides the intercepted execution handler
 */
const DebuggerWrapper: React.FC<{
  testFlow: TestFlow;
  onExecuteStatement: (statement: Statement, sessionInfo: DebugSessionInfo, streamingCallback?: StreamingActionCallback, modificationCallback?: (statement: Statement) => void) => Promise<any>;
  onEvaluateCondition: any;
  onStartDebugSession: any;
  onStopDebugSession: any;
  onExecutionComplete?: (session: DebugSessionInfo) => Promise<void>;
  onPauseExecution?: () => Promise<void>;
  onStatementModified: () => void; // Callback to mark as having unsaved changes
  children: React.ReactNode;
}> = ({
  testFlow,
  onExecuteStatement,
  onEvaluateCondition,
  onStartDebugSession,
  onStopDebugSession,
  onExecutionComplete,
  onPauseExecution,
  onStatementModified,
  children
}) => {
    const { markModified } = useEditor();

    // Handle statement execution with modification callback
    const handleExecuteStatement = useCallback(async (
      statement: Statement,
      sessionInfo: DebugSessionInfo,
      streamingCallback?: StreamingActionCallback,
    ) => {
      console.log('🔄 Executing statement:', statement);
      const modificationCallback = (statement: Statement) => {
        console.log('🔄 Modifying statement:', statement);
        markModified(statement.uid, "Action entity generated");
        onStatementModified(); // Mark as having unsaved changes
      };

      return await onExecuteStatement(statement, sessionInfo, streamingCallback, modificationCallback);
    }, [onExecuteStatement, markModified, onStatementModified]);

    return (
      <DebuggerProvider
        testFlow={testFlow}
        onExecuteStatement={handleExecuteStatement}
        onEvaluateCondition={onEvaluateCondition}
        onStartDebugSession={onStartDebugSession}
        onStopDebugSession={onStopDebugSession}
        onExecutionComplete={onExecutionComplete}
        onPauseExecution={onPauseExecution}
      >
        {children}
      </DebuggerProvider>
    );
  };

/**
 * Inner component that uses the debugger context
 */
const TestFlowEditorInner: React.FC<Omit<TestFlowEditorProps, 'onExecuteStatement' | 'onEvaluateCondition' | 'onStartDebugSession' | 'onStopDebugSession' | 'onPauseExecution' | 'onTestFlowChange' | 'onSave' | 'onRevert' | 'onActionClick'> & {
  readonly?: boolean;
  testFlow: TestFlow;
  hasUnsavedChanges: boolean;
  onTestFlowChange: (testFlow: TestFlow) => void;
  onSave: () => Promise<void>;
  onRevert: () => Promise<void>;
  onUndo?: () => Promise<void>;
  canUndo?: boolean;
  enabled?: boolean;
  hiddenDebuggerButtonBar?: boolean;
  onSessionChange?: (session: TestSessionInfo | null) => void;
  urlOverride?: string;
  onUrlOverrideChange?: (url: string) => void;
  hasActiveSession?: boolean;
  onResetSession?: () => Promise<void>;
  headerAlerts?: React.ReactNode;
}> = ({
  debuggerButtonIconOnly,
  readonly,
  testFlow,
  onTestFlowChange,
  onSave,
  onRevert,
  onUndo,
  canUndo,
  hasUnsavedChanges,
  enabled,
  onSessionChange,
  hiddenDebuggerButtonBar,
  urlOverride,
  onUrlOverrideChange,
  hasActiveSession,
  onResetSession,
  headerAlerts,
  children,
  ...statementEditorProps
}) => {
  const t = useTranslations('TestCases.flowEditor');
  const flowStatements = testFlow.statements ?? [];
  const debugContext = useDebugger();
  const {
    isDebugging,
    isStepping,
    isRunning,
    sessionInfo,
    startDebugging,
  } = debugContext;

  const currentStatementIdRef = useRef<string | null>(null);
  currentStatementIdRef.current = debugContext?.currentStatementId;

  // Auto-start debug session if autoStartDebug query parameter is present
  const hasAutoStartedRef = useRef(false);
  const shouldAutoStartRef = useRef(false);
  
  // Check for query parameters on mount
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const shouldAutoStart = urlParams.get('autoStartDebug') === 'true';
      
      if (shouldAutoStart) {
        shouldAutoStartRef.current = true;
        console.log('🚀 Auto-start debug flag detected');
        
        // Remove the query parameter without crossing origins in webviews.
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('autoStartDebug');
          const sameOriginUrl = `${url.pathname}${url.search}${url.hash}`;
          window.history.replaceState({}, '', sameOriginUrl);
        } catch (error) {
          console.warn('Failed to update URL after auto-start flag detection:', error);
        }
      }
    }
  }, []);

  // Wait for debugger to be ready, then auto-start
  React.useEffect(() => {
    // Skip if already started or no auto-start requested
    if (hasAutoStartedRef.current || !shouldAutoStartRef.current) return;

    // Wait until debugger is ready (not debugging, stepping, or running)
    if (!isDebugging && !isStepping && !isRunning) {
      hasAutoStartedRef.current = true;
      console.log('🚀 Debugger ready, auto-starting debug session');
      
      // Start debugging after a brief delay to ensure everything is mounted
      setTimeout(() => {
        startDebugging()
          .then(() => {
            console.log('✅ Debug session auto-started successfully');
          })
          .catch((error) => {
            console.error('Failed to auto-start debugging:', error);
          });
      }, 500);
    } else {
      console.log('⏳ Waiting for debugger to be ready...', { isDebugging, isStepping, isRunning });
    }
  }, [isDebugging, isStepping, isRunning, startDebugging, testFlow]);

  // Pass session data up to parent
  React.useEffect(() => {
    if (onSessionChange) {
      onSessionChange(sessionInfo?.testSession || null);
    }
  }, [sessionInfo, onSessionChange]);

  // Listen for toolbar picker requests
  // When toolbar picker button is clicked, use the current statement ID from debugger context
  useAppEvent('toolbar:picker-requested', () => {

    if (!currentStatementIdRef.current) {
      console.warn('⚠️ Toolbar picker requested but no current statement available');
      // TODO: Could show a toast notification to user
      return;
    }

    console.log('🎯 Toolbar picker request received, forwarding for statement:', currentStatementIdRef.current);

    // Forward as a proper locator pick request with the current statement ID
    appEventBus.emit('locator:request-pick', {
      statementId: currentStatementIdRef.current,
      language: 'JavaScript'
    });
  }, []);

  // Listen for recorded actions from the recorder (following picker element pattern)
  useAppEvent('recorder:action-recorded', (payload) => {
    const { actionEntity, statementUid } = payload;
    console.log('🎬 Received recorded action event:', actionEntity.action_description);
    console.log('🆔 Using provided statement UID:', statementUid);

    // Create new statement from action entity, using the provided UID
    const newStatement: Statement = {
      uid: statementUid, // Use the UID generated by MultiPageViewer
      type: StatementType.ACTION,
      description: actionEntity.action_description || actionEntity.action_data?.action_name || 'Recorded Action',
      action_entity: actionEntity,
    };

    // Find insert position
    const currentStatementId = debugContext?.currentStatementId;
    const isDebug = debugContext?.isDebugging;

    let insertResult: { statements: Statement[]; inserted: boolean; prevStatement: Statement | null; nextStatement: Statement | null };
    let insertDescription: string;

    if (isDebug && currentStatementId) {
      // In debugging mode, insert before the current statement (which may be nested)
      insertResult = insertStatementBeforeInTree(flowStatements, currentStatementId, newStatement);

      if (!insertResult.inserted) {
        // If not found in statements, fall back to adding at the end
        console.warn(`⚠️ Could not find statement ${currentStatementId}, inserting at end`);
        insertResult = addStatementAtEnd(flowStatements, newStatement);
        insertDescription = 'at the end (fallback)';
      } else {
        insertDescription = `before current statement (${currentStatementId})`;
      }
      console.log('🔧 Debugging mode: inserting', insertDescription);
    } else {
      // Normal mode, add at the end
      insertResult = addStatementAtEnd(flowStatements, newStatement);
      insertDescription = 'at the end';
      console.log('🔧 Normal mode: inserting at end');
    }

    // Update test flow with new statements
    onTestFlowChange({
      ...testFlow,
      statements: insertResult.statements,
      last_modified_at: new Date().toISOString()
    });

    // Remove notify debugger context that a statement was added
    // since we don't want to update the current statement pointer

    // Mark the recorded action as completed (it's already been executed in the browser)
    if (debugContext && isDebug) {
      // Set the status to success for the newly added statement (it's already been executed)
      debugContext.updateStatementStatus(newStatement.uid, 'success', 'Recorded action (already executed)');

      console.log(`✅ Added recorded action (marked as completed) to test flow ${insertDescription}:`, actionEntity.action_description);
    } else {
      console.log(`✅ Added recorded action to test flow ${insertDescription}:`, actionEntity.action_description);
    }
  }, [testFlow, onTestFlowChange, debugContext]);

  // Listen for action updates from the recorder
  useAppEvent('recorder:action-updated', (payload) => {
    const { actionEntity, statementUid } = payload;
    console.log('🔄 Received action update event:', actionEntity.action_description);
    console.log('🔍 Statement UID to update:', statementUid);

    if (!statementUid) {
      console.warn('⚠️ No statement UID provided, cannot update');
      return;
    }

    // Create the updated statement (assuming it's an ACTION statement)
    const updatedStatement: Statement = {
      uid: statementUid,
      type: StatementType.ACTION,
      description: actionEntity.action_description || actionEntity.action_data?.action_name || 'Recorded Action',
      action_entity: actionEntity,
    };

    // Use updateStatementInTree to handle nested statements
    const newStatements = updateStatementInTree(flowStatements, statementUid, updatedStatement);

    // Check if anything changed (statement was found and updated)
    if (newStatements !== flowStatements) {
      // Update test flow
      onTestFlowChange({
        ...testFlow,
        statements: newStatements,
        last_modified_at: new Date().toISOString()
      });

      console.log(`✅ Updated recorded action (UID: ${statementUid}):`, actionEntity.action_description);
    } else {
      console.warn(`⚠️ Cannot find statement with UID: ${statementUid}`);
    }
  }, [testFlow, onTestFlowChange]);

  // Allow external triggers (e.g. idle timeout) to follow the same reset flow as the Reset button.
  useAppEvent('debugger:reset-session-requested', async (payload) => {
    try {
      if (debugContext.isDebugging) {
        await debugContext.stopDebugging();
      } else if (onResetSession) {
        await onResetSession();
      }
    } catch (error) {
      console.error('Failed to reset session from external request:', error);
    } finally {
      appEventBus.emit('debugger:reset-session-completed', {
        reason: payload.reason,
        showTimeoutBanner: payload.showTimeoutBannerAfterReset,
      });
    }
  }, [debugContext, onResetSession]);

  const handleStatementsChange = (newStatements: Statement[]) => {
    onTestFlowChange({
      ...testFlow,
      statements: newStatements,
    });
  }

    const handleTeardownStatementsChange = (newStatements: Statement[]) => {
      onTestFlowChange({
        ...testFlow,
        teardown: newStatements,
      });
    };

    // Combined callback for cross-section drag moves (avoids race conditions)
    const handleBothSectionsChange = (main: Statement[], teardown: Statement[]) => {
      onTestFlowChange({
        ...testFlow,
        statements: main,
        teardown: teardown,
      });
    };

    const handleAddTeardown = () => {
      onTestFlowChange({
        ...testFlow,
        teardown: [],
      });
    };

    const handleRemoveTeardown = () => {
      const newTestFlow = { ...testFlow };
      delete newTestFlow.teardown;
      onTestFlowChange(newTestFlow);
    };

    return (
      <div className="flex flex-col h-full">
        {/* Fixed Header - Button Bar */}
        {!readonly && <div className="flex-shrink-0 mb-2">
          {/* Debugger Button Bar - add right margin */}
          <div>
            <DebuggerButtonBar
              iconOnly={debuggerButtonIconOnly}
              onSave={onSave}
              onRevert={onRevert}
              onUndo={onUndo}
              canUndo={canUndo}
              hasUnsavedChanges={hasUnsavedChanges}
              enabled={enabled}
              urlOverride={urlOverride}
              onUrlOverrideChange={onUrlOverrideChange}
              hasActiveSession={hasActiveSession}
              onResetSession={onResetSession}
            />
          </div>
        </div>}

        {/* Header alerts (session timeout, idle warning, etc.) */}
        {headerAlerts}

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto px-4">
          {/* Unified DragContainer for cross-section drag and drop */}
          <DragContainer
            statements={flowStatements}
            onStatementsChange={handleStatementsChange}
            teardownStatements={testFlow.teardown}
            onTeardownStatementsChange={handleTeardownStatementsChange}
            onBothSectionsChange={handleBothSectionsChange}
            enabled={!readonly}
          >
            {/* Statement Editor with debugging integration */}
            <div className="relative">
              <StatementEditor
                statements={flowStatements}
                onStatementsChange={handleStatementsChange}
                // Pass the debug context so statements can show current execution status
                debugContext={debugContext}
                // Register streaming callback for main flow
                streamingCallbackId="main-flow"
                // Use 'main' as root parentId for cross-section drag support
                rootParentId="main"
                // Skip internal DragContainer since we have a unified one
                skipDragContainer
                {...statementEditorProps}
              />
            </div>

            {/* Teardown Section */}
            {((testFlow.teardown && testFlow.teardown.length > 0) || enabled) && <div className="">
              <div className="mt-4 pt-4 border-t border-subtle" />
              {testFlow.teardown ? (
                <div>
                  <div className="ml-6 flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold text-secondary">{t('teardownTitle')}</h3>
                    <Button variant="subtle" color="red" size="xs" onClick={handleRemoveTeardown}>
                      {t('removeTeardown')}
                    </Button>
                  </div>
                  <StatementEditor
                    statements={testFlow.teardown}
                    onStatementsChange={handleTeardownStatementsChange}
                    debugContext={debugContext}
                    // Register streaming callback for teardown
                    streamingCallbackId="teardown"
                    // Use 'teardown' as root parentId for cross-section drag support
                    rootParentId="teardown"
                    // Skip internal DragContainer since we have a unified one
                    skipDragContainer
                    {...statementEditorProps}
                  />
                </div>
              ) : (
                <div className="flex justify-center">
                  <Button
                    variant="light"
                    leftSection={<IconPlus size={14} />}
                    onClick={handleAddTeardown}
                  >
                    {t('addTeardown')}
                  </Button>
                </div>
              )}
            </div>}
          </DragContainer>

          {/* Additional children */}
          {children}
        </div>

      </div>
    );
  };

/**
 * Main TestFlowEditor component that provides debugging capabilities to StatementEditor
 */
export const TestFlowEditor: React.FC<TestFlowEditorProps> = ({
  debuggerButtonIconOnly,
  testFlow,
  onExecuteStatement,
  onEvaluateCondition,
  onStartDebugSession,
  onStopDebugSession,
  onExecutionComplete,
  onPauseExecution,
  onTestFlowChange,
  onSave,
  onRevert,
  onUndo,
  canUndo,
  hasChanges,
  onStatementSelected,
  onSessionChange,
  enabled,
  readonly,
  children,
  defaultEnvironmentId,
  hiddenDebuggerButtonBar,
  urlOverride,
  onUrlOverrideChange,
  hasActiveSession,
  onResetSession,
  headerAlerts,
  v2,
  ...statementEditorProps
}) => {

  // Track statement changes using callback-based approach
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (hasChanges) {
      setHasUnsavedChanges(true);
    }
  }, [hasChanges]);

  // Handle statements change - mark as changed
  const handleTestFlowChange = useCallback((newTestFlow: TestFlow) => {
    onTestFlowChange(newTestFlow);
    setHasUnsavedChanges(true);
  }, [onTestFlowChange]);

  // Handle save - call original save and reset change flag
  const handleSave = useCallback(async () => {
    await onSave();
    setHasUnsavedChanges(false);
  }, [onSave]);

  // Handle reset - call original reset and reset change flag
  const handleRevert = useCallback(async () => {
    await onRevert();
    setHasUnsavedChanges(false);
  }, [onRevert]);

  // Handle statement modification during execution
  const handleStatementModified = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  const handleUndo = useCallback(async () => {
    if (onUndo) {
      await onUndo();
    }
    setHasUnsavedChanges(true);
  }, [onUndo]);

  // Wrapper around onStartDebugSession to ensure there's at least one statement
  const handleStartDebugSession = useCallback(async (): Promise<DebugSessionInfo> => {
    // Check if main test flow is empty and add empty Draft if needed
    if ((testFlow.statements?.length ?? 0) === 0) {
      console.log('🔧 Main test flow is empty, adding empty Draft statement before debugging');

      const emptyDraft: Statement = {
        uid: generateUid(),
        type: StatementType.DRAFT,
        description: "",
      };

      // Update the test flow
      const updatedTestFlow = {
        ...testFlow,
        statements: [emptyDraft]
      };

      // Update the parent state
      onTestFlowChange(updatedTestFlow);
    }

    // Proceed with normal session initialization
    return await onStartDebugSession();
  }, [testFlow, onTestFlowChange, onStartDebugSession]);

  return (
    <EditorProvider
      enabled={enabled}
      clearModifiedStates={!hasUnsavedChanges}
      onStatementSelected={onStatementSelected}
      statements={testFlow.statements ?? []}
      defaultEnvironmentId={defaultEnvironmentId}
      actionGenerationDebugInfo={statementEditorProps.actionGenerationDebugInfo}
      v2={v2}
    >
      <DebuggerWrapper
        testFlow={testFlow}
        onExecuteStatement={onExecuteStatement}
        onEvaluateCondition={onEvaluateCondition}
        onStartDebugSession={handleStartDebugSession}
        onStopDebugSession={onStopDebugSession}
        onExecutionComplete={onExecutionComplete}
        onPauseExecution={onPauseExecution}
        onStatementModified={handleStatementModified}
      >
        <TestFlowEditorInner
          debuggerButtonIconOnly={debuggerButtonIconOnly}
          readonly={readonly}
          hiddenDebuggerButtonBar={hiddenDebuggerButtonBar}
          testFlow={testFlow}
          onTestFlowChange={handleTestFlowChange}
          onSave={handleSave}
          onRevert={handleRevert}
          onUndo={handleUndo}
          canUndo={canUndo}
          hasUnsavedChanges={hasUnsavedChanges || false}
          enabled={enabled}
          onSessionChange={onSessionChange}
          urlOverride={urlOverride}
          onUrlOverrideChange={onUrlOverrideChange}
          hasActiveSession={hasActiveSession}
          onResetSession={onResetSession}
          headerAlerts={headerAlerts}
          {...statementEditorProps}
        >
          {children}
        </TestFlowEditorInner>
      </DebuggerWrapper>
    </EditorProvider>
  );
};
