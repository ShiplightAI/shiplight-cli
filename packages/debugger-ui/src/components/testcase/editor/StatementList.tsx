import { findStatementPathById } from 'shiplight-types';
import { useTranslations } from 'next-intl';
import type { Action, Draft, IfElse, Statement, Step, WhileLoop } from 'shiplight-types';
import { ConditionType, StatementType } from 'shiplight-types';
import React, { useCallback, useEffect, useRef } from 'react';
// Removed TestFunction import - no longer used in this component
import { TestStepActionType } from '@/common/constants';
import { ActionStatement } from './ActionStatement';
// Removed unused action handler imports - logic moved to individual components
import { AgentAction } from '@/common/interfaces/interactiveRun';
import { generateUid, updateStatementInTree } from '@/common/steps_json/conversionUtils';
import { applyLocatorOverride } from '@/common/steps_json/utils/locatorUtils';
import type { ActionEntity } from 'shiplight-types';
import { notifications } from '@mantine/notifications';
import { useCollapseStore } from '../../../stores/collapseStore';
import type { DebuggerContextType, ExecutionStatus, MultiStreamingActionCallback } from '../types/debugger';
import {
  hasReusableReference,
  REUSABLE_STEP_PENDING_REFERENCE_ID,
} from '../utils/reusableStepUtils';
import { useEditor } from './contexts/EditorContext';
import { useTreeDrag } from './DragContainer';
import { DropIndicator } from './DropIndicator';
import { FloatingAddButton } from './FloatingAddButton';
import { IfElseStatement } from './IfElseStatement';
import { StepStatement } from './StepStatement';
import { cloneStatementWithNewUids } from './utils/cloneUtils';
import { autoExpandStatement } from './utils/collapseUtils';
import { WhileLoopStatement } from './WhileLoopStatement';

interface StatementListProps {
  statements: Statement[];
  onStatementsChange: (statements: Statement[]) => void;
  level?: number;
  parentId?: string | null;
  containerType?: 'root' | 'step' | 'then' | 'else' | 'body';
  onDelete?: (index: number) => void;
  debugContext?: DebuggerContextType | null;
  streamingCallbackId?: string; // ID for registering streaming callback
  isReusableGroup?: boolean; // Whether the parent is a reusable group
  renderBetweenStatements?: (beforeUid: string | undefined, afterUid: string | undefined) => React.ReactNode;
}

export const StatementList: React.FC<StatementListProps> = ({
  statements,
  onStatementsChange,
  level = 0,
  parentId = null,
  containerType = 'root',
  onDelete,
  debugContext,
  streamingCallbackId,
  isReusableGroup = false,
  renderBetweenStatements,
}) => {
  // Define colors for different nesting levels
  const getVerticalLineColor = (level: number): string => {
    const colors = [
      'border-blue-300',    // Level 1: Light blue
      'border-green-300',   // Level 2: Light green
      'border-purple-300',  // Level 3: Light purple
      'border-orange-300',  // Level 4: Light orange
      'border-pink-300',    // Level 5: Light pink
      'border-indigo-300',  // Level 6: Light indigo
    ];
    return colors[level % colors.length];
  };

  const t = useTranslations('TestCases');
  const showVerticalLine = level > 0;
  const dragContext = useTreeDrag();
  const isDragging = !!dragContext?.activeStatement;

  // Get editor context for enabled state and display-only mode
  const editorContext = useEditor();
  const { markModified, enabled, selectedStatementIds, clearSelection, displayOnly } = editorContext;
  const editable = enabled && !displayOnly;

  // Track streaming actions for each statement
  const streamingActionsRef = useRef<Map<string, ActionEntity[]>>(new Map());

  // Track current statement state during streaming to avoid stale closure issues
  const streamingStatementStateRef = useRef<Map<string, Statement>>(new Map());

  // Refs to avoid stale closures in streaming callback
  const statementsRef = useRef(statements);
  const onStatementsChangeRef = useRef(onStatementsChange);

  // Update refs when values change
  useEffect(() => {
    statementsRef.current = statements;
    onStatementsChangeRef.current = onStatementsChange;
  }, [statements, onStatementsChange]);



  // Simplified streaming action handler
  const handleStreamingAction = useCallback((
    statementId: string,
    agentAction: AgentAction,
    statement: Statement,
    currentStatements: Statement[],
    currentOnStatementsChange: (statements: Statement[]) => void
  ) => {
    const actionEntity = agentAction.action_entity;
    const currentActions = streamingActionsRef.current.get(statementId) || [];
    const updatedActions = [...currentActions, actionEntity];
    streamingActionsRef.current.set(statementId, updatedActions);

    // Handle DRAFT and ACTION the same way for first action - wait for more
    if ((statement.type === 'ACTION' || statement.type === 'DRAFT') && updatedActions.length === 1) {

      // Keep statement in "running" state (not "success" yet)
      // The actual UI update will happen either:
      // 1. When 2nd action arrives → Convert to STEP (below)
      // 2. When Completion arrives → Update to ACTION (in completion callback)

    } else if ((statement.type === 'ACTION' || statement.type === 'DRAFT') && updatedActions.length === 2) {

      const newStepStatement: Statement = {
        uid: statement.uid, // Keep the same UID for replacement
        type: StatementType.STEP,
        description: statement.description,
        statements: updatedActions.map((action, index) => ({
          uid: generateUid(),
          type: StatementType.ACTION,
          description: action.action_description || action.action_data?.action_name || `Action ${index}`,
          action_entity: action,
        }))
      };

      const lastActionUid = newStepStatement.statements?.[newStepStatement.statements.length - 1].uid;
      const updatedStatements = updateStatementInTree(currentStatements, statement.uid, newStepStatement);
      currentOnStatementsChange(updatedStatements);

      streamingStatementStateRef.current.set(statementId, newStepStatement);

      // Mark statement as modified when converted from ACTION/DRAFT to STEP
      markModified(statementId, `Converted from ${statement.type} to STEP due to multiple actions`);

      newStepStatement.statements?.forEach(newActionStatement => {
        debugContext?.updateStatementStatus(newActionStatement.uid, 'success', JSON.stringify(agentAction.agent_state));
      });

      debugContext?.setCurrentStatementId(lastActionUid);

      const collapseId = `step-${statementId}`;
      useCollapseStore.getState().setCollapsed(collapseId, false);
      streamingActionsRef.current.delete(statementId);
      // Note: We keep streamingStatementStateRef for the STEP to track its state during streaming

    } else if (statement.type === 'STEP' && updatedActions.length > 0) {

      const newActionStatement: Statement = {
        uid: generateUid(),
        type: StatementType.ACTION,
        description: actionEntity.action_description || actionEntity.action_data?.action_name || `Action ${updatedActions.length}`,
        action_entity: actionEntity,
      };

      const existingStatements = statement.statements || [];
      const updatedStepStatement: Statement = {
        ...statement,
        statements: [...existingStatements, newActionStatement]
      };

      const updatedStatements = updateStatementInTree(currentStatements, statement.uid, updatedStepStatement);
      currentOnStatementsChange(updatedStatements);

      streamingStatementStateRef.current.set(statementId, updatedStepStatement);

      // Mark statement as modified when new action is added to STEP
      markModified(statementId, "New action added to STEP");

      debugContext?.updateStatementStatus(newActionStatement.uid, 'success', JSON.stringify(agentAction.agent_state));

      debugContext?.setCurrentStatementId(newActionStatement.uid);

      const collapseId = `step-${statementId}`;
      useCollapseStore.getState().setCollapsed(collapseId, false);

    }
  }, [debugContext, markModified]);

  // Register streaming action callback with debugger context (only for root level)
  useEffect(() => {
    if (level === 0 && debugContext && containerType === 'root' && streamingCallbackId) {
      // Use the provided callback ID

      // Create a self-selecting callback that only handles statements it can find
      const streamingCallback: MultiStreamingActionCallback = (statementId: string, agentAction: AgentAction): boolean => {
        // Try to find the statement in our statements (use ref to avoid stale closure)
        const currentStatements = statementsRef.current;
        const statementPath = findStatementPathById(currentStatements, statementId);
        if (!statementPath) {
          return false;
        }

        // 🔧 Always use the current statement from the tree to ensure we have the latest state
        // This is important when user manually clears substeps - we want to use the cleared version, not cached old version
        const statement = statementPath.statement;
        
        // Update cache with latest statement for future reference
        streamingStatementStateRef.current.set(statementId, statement);

        // Handle the streaming update (pass current statements and onChange via refs)
        handleStreamingAction(statementId, agentAction, statement, currentStatements, onStatementsChangeRef.current);
        return true; // We handled it
      };

      // console.log(`🔧 Registering streaming callback: ${streamingCallbackId}`);
      debugContext.registerStreamingActionCallback(streamingCallbackId, streamingCallback);

      // Register cleanup callback for clearing streaming state before execution
      const cleanupCallback = (statementId: string) => {
        streamingActionsRef.current.delete(statementId);
        streamingStatementStateRef.current.delete(statementId);
      };

      debugContext.registerCleanupCallback(streamingCallbackId, cleanupCallback);

      // Register completion callback for single-step ACTION/DRAFT completion
      const completionCallback = (statementId: string, actionCount: number) => {

        const currentStatements = statementsRef.current;
        const statementPath = findStatementPathById(currentStatements, statementId);
        if (!statementPath) {
          return;
        }

        const statement = statementPath.statement;
        if (statement.type !== 'ACTION' && statement.type !== 'DRAFT') {
          return;
        }

        // Get the stored first action from streaming
        const storedActions = streamingActionsRef.current.get(statementId);
        if (!storedActions || storedActions.length === 0) {
          return;
        }

        // Apply locator override to the action entity (same logic as Controller)
        // This ensures single-step actions get the same processing as multi-step
        const actionEntity = applyLocatorOverride(storedActions[0], statement as Action, {
          logging: true,
          logPrefix: 'Completion Callback'
        });

        // Convert DRAFT or update ACTION to have the action_entity
        const updatedStatement: Action = {
          uid: statement.uid,
          type: StatementType.ACTION,
          description: statement.description,
          action_entity: actionEntity,
          use_pure_vision: statement.type === 'ACTION' ? (statement as Action).use_pure_vision : undefined
        };

        // Mark as modified if converting from DRAFT
        if (statement.type === 'DRAFT') {
          markModified(statementId, "Converted from DRAFT to ACTION");
        }

        // Update the statement in the tree
        const updatedStatements = updateStatementInTree(currentStatements, statementId, updatedStatement);
        onStatementsChangeRef.current(updatedStatements);

        // Clean up streaming state
        streamingActionsRef.current.delete(statementId);
        streamingStatementStateRef.current.delete(statementId);
      };

      debugContext.registerCompletionCallback(streamingCallbackId, completionCallback);

      return () => {
        // console.log(`🔧 Unregistering streaming callback: ${streamingCallbackId}`);
        debugContext.registerStreamingActionCallback(streamingCallbackId, null);
        debugContext.registerCleanupCallback(streamingCallbackId, null);
        debugContext.registerCompletionCallback(streamingCallbackId, null);
      };
    }
  }, [level, debugContext, containerType, streamingCallbackId, handleStreamingAction]);

  // Helper to generate drop indicator ID
  // parentId is 'main' or 'teardown' for root-level, or a statement uid for nested
  const getDropIndicatorId = (position: 'before' | 'after' | 'inside', index: number) => {
    return `drop-${parentId}-${containerType}-${position}-${index}`;
  };

  // Check if a drop indicator is active
  const isDropIndicatorActive = (id: string) => {
    return dragContext?.overId === id;
  };

  // Helper to create new statement
  const createNewStatement = useCallback((type: StatementType): Statement => {
    switch (type) {
      case StatementType.DRAFT:
        return {
          uid: generateUid(),
          type: StatementType.DRAFT,
          description: "",
        };
      case StatementType.STEP:
        return {
          uid: generateUid(),
          type: StatementType.STEP,
          description: "",
          statements: []
        };
      case StatementType.ACTION:
        return {
          uid: generateUid(),
          type: StatementType.ACTION,
          description: "",
          action_entity: undefined,
          use_pure_vision: false,
        };
      case StatementType.IF_ELSE:
        return {
          uid: generateUid(),
          type: StatementType.IF_ELSE,
          condition: {
            type: ConditionType.AI_MODE,
            expression: ""
          },
          then: [{
            uid: generateUid(),
            type: StatementType.ACTION,
            description: "",
            action_entity: undefined
          }]
        };
      case StatementType.WHILE_LOOP:
        return {
          uid: generateUid(),
          type: StatementType.WHILE_LOOP,
          condition: {
            type: ConditionType.AI_MODE,
            expression: ""
          },
          body: [{
            uid: generateUid(),
            type: StatementType.ACTION,
            description: "",
            action_entity: undefined
          }]
        };
      default:
        throw new Error(`Unknown statement type: ${type}`);
    }
  }, []);

  // Helper to convert any statement to another statement type, it may mutate the statement object in place
  // but it will preserve the original UID to maintain modification tracking
  const convertStatementToType = useCallback((statement: Statement, newType: StatementType, actionType?: TestStepActionType): Statement => {
    // Get description from any statement type
    const getDescription = (stmt: Statement): string => {
      switch (stmt.type) {
        case StatementType.DRAFT:
          return (stmt as Draft).description;
        case StatementType.ACTION:
          return (stmt as Action).description;
        case StatementType.STEP:
          return (stmt as Step).description;
        default:
          return "";
      }
    };

    const getUsePureVision = (stmt: Statement): boolean | undefined => {
      switch (stmt.type) {
        case StatementType.ACTION:
          return (stmt as Action).use_pure_vision;
        default:
          return undefined;
      }
    };

    const description = getDescription(statement);

    const newStatement = createNewStatement(newType);
    // Preserve the original UID to maintain modification tracking
    newStatement.uid = statement.uid;

    if (newType === StatementType.DRAFT) {
      const draftStatement = newStatement as Draft;
      draftStatement.description = description;
    } else if (newType === StatementType.STEP) {
      const stepStatement = newStatement as Step;
      stepStatement.description = description;

      const originalStep = statement.type === StatementType.STEP ? (statement as Step) : undefined;

      if (originalStep) {
        stepStatement.statements = [...(originalStep.statements ?? [])];
      }

      // Handle reusable step conversion
      if (actionType === TestStepActionType.Reusable) {
        stepStatement.reference_id = REUSABLE_STEP_PENDING_REFERENCE_ID;
      } else {
        // When converting to normal step (not reusable), ensure reference_id is undefined
        delete stepStatement.reference_id;
      }
    } else if (newType === StatementType.ACTION) {
      const actionStatement = newStatement as Action;
      actionStatement.description = description;
      actionStatement.use_pure_vision = getUsePureVision(statement) || false;

      // If actionType is specified, set the appropriate action_entity
      if (actionType) {
        switch (actionType) {
          case TestStepActionType.Assertion:
            actionStatement.action_entity = {
              url: "",
              action_description: description,
              feedback: "",
              action_data: {
                action_name: "ai_assert",
                args: [],
                kwargs: {
                  statement: description
                }
              }
            };
            break;
          case TestStepActionType.AiAction:
            actionStatement.action_entity = {
              url: "",
              action_description: description,
              feedback: "",
              action_data: {
                action_name: "ai_action",
                args: [],
                kwargs: {
                  statement: description,
                  uid: statement.uid,
                  use_pure_vision: getUsePureVision(statement) || false,
                }
              }
            };
            break;
          case TestStepActionType.AiStep:
            actionStatement.action_entity = {
              url: "",
              action_description: description,
              feedback: "",
              action_data: {
                action_name: "ai_step",
                args: [],
                kwargs: { statement: description }
              }
            };
            break;
          case TestStepActionType.Code:
            actionStatement.action_entity = {
              url: "",
              action_description: description,
              feedback: "",
              action_data: {
                action_name: "js_code",
                args: [],
                kwargs: { code: "" }
              }
            };
            break;
          case TestStepActionType.Function:
            actionStatement.action_entity = {
              url: "",
              action_description: description,
              feedback: "",
              action_data: {
                action_name: "function",
                args: [],
                kwargs: {}
              }
            };
            break;
          case TestStepActionType.UploadFile:
            actionStatement.description = "Upload the file";  // Initial description
            // Create minimal action_entity with just action_name so ActionEditor knows the type
            // But no paths/kwargs so the modal will auto-open
            actionStatement.action_entity = {
              url: "",
              action_description: actionStatement.description,
              feedback: "",
              action_data: {
                action_name: "upload_file",
                args: [],
                kwargs: {}  // Empty kwargs will trigger modal to open
              }
            };
            break;
          case TestStepActionType.ExtractContent:
            actionStatement.description = "Extract and save to variable";  // Initial description
            actionStatement.action_entity = {
              url: "",
              action_description: actionStatement.description,
              feedback: "",
              action_data: {
                action_name: "ai_extract",
                args: [],
                kwargs: {}  // Empty kwargs - element_description and variable_name will be added when configured
              }
            };
            break;
          case TestStepActionType.Login:
            actionStatement.action_entity = {
              url: "",
              action_description: actionStatement.description,
              feedback: "",
              action_data: {
                action_name: "login",
                args: [],
                kwargs: {}
              }
            };
            break;
          case TestStepActionType.ExtractEmailContent:
            actionStatement.action_entity = {
              url: "",
              action_description: actionStatement.description,
              feedback: "",
              action_data: {
                action_name: "extract_email_content",
                args: [],
                kwargs: {}
              }
            };
            break;
          case TestStepActionType.WaitUntil:
            actionStatement.description = "Wait until condition is met";  // Initial description
            actionStatement.action_entity = {
              url: "",
              action_description: actionStatement.description,
              feedback: "",
              action_data: {
                action_name: "ai_wait_until",
                args: [],
                kwargs: {}  // Empty kwargs - condition and timeout_seconds will be added when configured
              }
            };
            break;
          case TestStepActionType.Action:
            // Leave action_entity as undefined for dynamic action
            break;
          case TestStepActionType.Reusable:
            // Reusable is only used for STEP type, not ACTION
            // This case should never be reached in practice, but we handle it for type safety
            console.warn("Unexpected: Reusable actionType used with ACTION statement type");
            break;
          default:
            break;
        }
      }
    }
    return newStatement;
  }, [createNewStatement]);

  // Centralized handler for all statement type changes
  const handleStatementTypeChange = useCallback((statementId: string, statementType: StatementType, actionType?: TestStepActionType) => {
    const statementIndex = statements.findIndex(s => s.uid === statementId);
    if (statementIndex < 0) {
      return;
    }

    // Note: We allow creating reusable groups inside another reusable group
    // The template selection handler will automatically convert it to a normal group

    const statement = statements[statementIndex];

    // Check if this is a no-op (same type conversion)
    if (statement.type === statementType) {
      if (statementType === StatementType.STEP) {
        const stepStatement = statement as Step;
        const currentlyReusable = hasReusableReference(stepStatement.reference_id);
        const targetReusable = actionType === TestStepActionType.Reusable;

        if (currentlyReusable === targetReusable) {
          return;
        }
      } else if (statementType === StatementType.ACTION) {
        const actionStatement = statement as Action;
        const currentActionName = actionStatement.action_entity?.action_data?.action_name;

        // Map current action name to TestStepActionType for comparison
        let currentActionType: TestStepActionType;
        switch (currentActionName) {
          case "ai_assert":
          case "verify":
          case "assert":
            currentActionType = TestStepActionType.Assertion;
            break;
          case "ai_action":
            currentActionType = TestStepActionType.AiAction;
            break;
          case "ai_step":
            currentActionType = TestStepActionType.AiStep;
            break;
          case "js_code":
            currentActionType = TestStepActionType.Code;
            break;
          case "function":
            currentActionType = TestStepActionType.Function;
            break;
          case "upload_file":
            currentActionType = TestStepActionType.UploadFile;
            break;
          case "ai_extract":
            currentActionType = TestStepActionType.ExtractContent;
            break;
          case "login":
            currentActionType = TestStepActionType.Login;
            break;
          case "extract_email_content":
            currentActionType = TestStepActionType.ExtractEmailContent;
            break;
          case "ai_wait_until":
            currentActionType = TestStepActionType.WaitUntil;
            break;
          case undefined:
          case "action":
          default:
            currentActionType = TestStepActionType.Action; // Dynamic action
            break;
        }

        // If current action type matches target action type, it's a no-op
        if (currentActionType === actionType) {
          return;
        }
      }
      // For other types, same statement type is a no-op
      if (statementType !== StatementType.STEP && statementType !== StatementType.ACTION) {
        return;
      }
    }

    // Handle all statement type changes uniformly
    markModified(statementId, statement.type === statementType ? "Action type changed" : "Statement type changed");
    const convertedStatement = convertStatementToType(statement, statementType, actionType);
    const updatedStatements = [...statements];
    updatedStatements[statementIndex] = convertedStatement;
    onStatementsChange(updatedStatements);

    // Auto-expand sublists for new statements with nested containers
    if (statement.type !== statementType) { // Only for actual type conversions, not action type changes
      autoExpandStatement(statementType, convertedStatement.uid);
    }

    // Don't notify debugger context about type conversions - this is not a new statement being added
  }, [statements, onStatementsChange, markModified, debugContext, convertStatementToType]);

  // Helper function to calculate debug status for a statement
  const calculateDebugStatus = useCallback((statement: Statement): ExecutionStatus | undefined => {
    if (!debugContext) return undefined;

    const debugStableId = statement.uid;
    const directStatus = debugContext.getStatementStatus(debugStableId);

    return directStatus || 'pending';

  }, [debugContext]);

  // Helper function to recursively remove statements from tree by UIDs
  const removeStatementsFromTree = useCallback((stmts: Statement[], uidsToRemove: Set<string>): Statement[] => {
    const result: Statement[] = [];
    
    for (const stmt of stmts) {
      // Skip statements that should be removed
      if (uidsToRemove.has(stmt.uid)) {
        continue;
      }

      // Recursively process nested statements
      if (stmt.type === StatementType.STEP) {
        const stepStmt = stmt as Step;
        result.push({
          ...stepStmt,
          statements: removeStatementsFromTree(stepStmt.statements || [], uidsToRemove)
        } as Step);
      } else if (stmt.type === StatementType.IF_ELSE) {
        const ifElseStmt = stmt as IfElse;
        result.push({
          ...ifElseStmt,
          then: removeStatementsFromTree(ifElseStmt.then || [], uidsToRemove),
          else: ifElseStmt.else ? removeStatementsFromTree(ifElseStmt.else, uidsToRemove) : undefined
        } as IfElse);
      } else if (stmt.type === StatementType.WHILE_LOOP) {
        const whileStmt = stmt as WhileLoop;
        result.push({
          ...whileStmt,
          body: removeStatementsFromTree(whileStmt.body || [], uidsToRemove)
        } as WhileLoop);
      } else {
        // For ACTION and other types, just add as-is
        result.push(stmt);
      }
    }
    
    return result;
  }, []);

  // Helper function to delete multiple selected statements
  const deleteSelectedStatements = useCallback(() => {
    if (!editable || selectedStatementIds.size === 0) return;

    // Only delete at root level (level === 0) to avoid conflicts
    // This ensures we delete from the entire tree
    if (level === 0) {
      // Remove all selected statements from the entire tree
      const newStatements = removeStatementsFromTree(statements, selectedStatementIds);

      // Notify debugger context about deleted statements
      selectedStatementIds.forEach(uid => {
        debugContext?.onStatementDeleted(uid, newStatements);
      });

      // Clear selection after deletion
      clearSelection();

      onStatementsChange(newStatements);
    } else {
      // For nested levels, only delete from current array
      const selectedInCurrentList = statements.filter(stmt => selectedStatementIds.has(stmt.uid));
      
      if (selectedInCurrentList.length === 0) return;

      // Create new statements array without the selected ones
      const newStatements = statements.filter(stmt => !selectedStatementIds.has(stmt.uid));

      // Notify debugger context about deleted statements
      selectedInCurrentList.forEach(stmt => {
        debugContext?.onStatementDeleted(stmt.uid, newStatements);
      });

      // Clear selection after deletion
      clearSelection();

      onStatementsChange(newStatements);
    }
  }, [editable, selectedStatementIds, level, statements, onStatementsChange, debugContext, clearSelection, editorContext, removeStatementsFromTree]);

  // Handle keyboard shortcuts for deleting selected statements
  useEffect(() => {
    if (!editable || level > 0) return; // Only handle at root level to avoid conflicts

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Delete/Backspace when statements are selected
      if (selectedStatementIds.size === 0) return;

      // Check if the event target is an input/textarea/editable element
      const target = event.target as HTMLElement;
      const isEditable = target.tagName === 'INPUT' || 
                         target.tagName === 'TEXTAREA' || 
                         target.isContentEditable;

      // Don't handle if user is typing in an input field
      if (isEditable) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedStatements();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editable, level, selectedStatementIds.size, deleteSelectedStatements]);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    const newStatements = [...statements];
    [newStatements[index - 1], newStatements[index]] = [newStatements[index], newStatements[index - 1]];
    onStatementsChange(newStatements);
    markModified(statements[index].uid, "Moved up");
  }, [statements, onStatementsChange, markModified]);

  const handleMoveDown = useCallback((index: number) => {
    if (index >= statements.length - 1) return;
    const newStatements = [...statements];
    [newStatements[index], newStatements[index + 1]] = [newStatements[index + 1], newStatements[index]];
    onStatementsChange(newStatements);
    markModified(statements[index].uid, "Moved down");
  }, [statements, onStatementsChange, markModified]);

  // Helper function to create common props for all statement types
  const createCommonProps = useCallback((statement: Statement, index: number, insideReusableGroup: boolean) => {
    // Calculate derived debug status (includes child statement logic for containers)
    const derivedDebugStatus = calculateDebugStatus(statement);

    return {
      index,
      level,
      onEdit: undefined, // No edit functionality for now
      onMoveUp: editable ? () => handleMoveUp(index) : undefined,
      onMoveDown: editable ? () => handleMoveDown(index) : undefined,
      isFirst: index === 0,
      isLast: index === statements.length - 1,
      onDelete: editable && onDelete ? () => onDelete(index) : editable ? () => {
        // Handle deletion internally only if enabled
        const statementToDelete = statements[index];
        const newStatements = [...statements];
        newStatements.splice(index, 1);

        // Handle selection after deletion
        const { selectedStatementIds: selectedIds } = editorContext;
        // Check if the deleted statement was selected
        if (selectedIds.has(statementToDelete.uid)) {
          // Remove from selection if it was selected
          if (selectedIds.size === 1) {
            // It was the only selected statement, clear selection
            clearSelection();
          } else {
            // Multiple statements selected, just remove this one from selection
            const newSelectedIds = new Set(selectedIds);
            newSelectedIds.delete(statementToDelete.uid);
            editorContext.selectStatements(Array.from(newSelectedIds));
          }
        }

        onStatementsChange(newStatements);
        debugContext?.onStatementDeleted(statementToDelete.uid, newStatements);
      } : undefined,
      onDuplicate: editable ? () => {
        // Create a copy of the current statement with new UIDs only if enabled
        const duplicatedStatement = cloneStatementWithNewUids(statement);
        const newStatements = [...statements];
        // Insert the duplicated statement after the current one
        newStatements.splice(index + 1, 0, duplicatedStatement);
        onStatementsChange(newStatements);
        // Notify debugger context that a statement was added
        debugContext?.onStatementAdded(duplicatedStatement.uid, null, null);
      } : undefined,
      // Pass the derived debug status that includes child logic
      derivedDebugStatus,
      debugContext,
      enabled: editable,
      isInsideReusableGroup: insideReusableGroup,
    };
  }, [calculateDebugStatus, debugContext, level, onDelete, statements, onStatementsChange, editable, editorContext, handleMoveUp, handleMoveDown]);

  // Helper function to create ACTION statement element
  const createActionElement = useCallback((statement: Statement, itemId: string, commonProps: any) => {
    return (
      <ActionStatement
        key={itemId}
        statement={statement}
        {...commonProps}
        onStatementChange={(updatedStatement) => {
          // Handle statement update by replacing in the statements array
          const updatedStatements = updateStatementInTree(statements, statement.uid, updatedStatement);
          onStatementsChange(updatedStatements);
        }}
        onStatementTypeChange={editable ? (statementType: StatementType, actionType?: TestStepActionType) => {
          handleStatementTypeChange(itemId, statementType, actionType);
        } : () => { }} // No-op when disabled
      />
    );
  }, [statements, onStatementsChange, handleStatementTypeChange, editable]);

  // Helper function to create STEP statement element
  const createStepElement = useCallback((statement: Statement, itemId: string, commonProps: any, contextFlag: boolean) => {
    return (
      <StepStatement
        key={itemId}
        statement={statement}
        {...commonProps}
        onStatementChange={(updatedStatement) => {
          // Handle statement update by replacing in the statements array
          const updatedStatements = updateStatementInTree(statements, statement.uid, updatedStatement);
          onStatementsChange(updatedStatements);
        }}
        onStatementTypeChange={editable ? (statementType: StatementType, actionType?: TestStepActionType) => {
          handleStatementTypeChange(itemId, statementType, actionType);
        } : () => { }} // No-op when disabled
        debugContext={debugContext}
        enabled={editable}
        isInsideReusableGroup={contextFlag}
      />
    );
  }, [statements, onStatementsChange, debugContext, handleStatementTypeChange, editable]);

  // Helper function to create IF_ELSE statement element
  const createIfElseElement = useCallback((statement: Statement, itemId: string, commonProps: any) => {
    return (
      <IfElseStatement
        key={itemId}
        statement={statement}
        {...commonProps}
        onStatementChange={(updatedStatement) => {
          // Handle statement update by replacing in the statements array
          const updatedStatements = updateStatementInTree(statements, statement.uid, updatedStatement);
          onStatementsChange(updatedStatements);
        }}
        onStatementTypeChange={editable ? (statementType: StatementType, actionType?: TestStepActionType) => {
          handleStatementTypeChange(itemId, statementType, actionType);
        } : () => { }} // No-op when disabled
        debugContext={debugContext}
        enabled={editable}
      />
    );
  }, [statements, onStatementsChange, debugContext, handleStatementTypeChange, editable]);

  // Helper function to create WHILE_LOOP statement element
  const createWhileLoopElement = useCallback((statement: Statement, itemId: string, commonProps: any) => {
    return (
      <WhileLoopStatement
        key={itemId}
        statement={statement}
        {...commonProps}
        onStatementChange={(updatedStatement) => {
          // Handle statement update by replacing in the statements array
          const updatedStatements = updateStatementInTree(statements, statement.uid, updatedStatement);
          onStatementsChange(updatedStatements);
        }}
        onStatementTypeChange={editable ? (statementType: StatementType, actionType?: TestStepActionType) => {
          handleStatementTypeChange(itemId, statementType, actionType);
        } : () => { }} // No-op when disabled
        debugContext={debugContext}
        enabled={editable}
      />
    );
  }, [statements, onStatementsChange, debugContext, handleStatementTypeChange, editable]);

  // Helper function to render a statement element based on its type
  const renderStatementElement = useCallback((statement: Statement, index: number) => {
    const itemId = statement.uid;
    const commonProps = createCommonProps(statement, index, isReusableGroup);

    switch (statement.type) {
      case StatementType.DRAFT:
        // DRAFT uses same renderer as ACTION - it will convert after execution
        return createActionElement(statement, itemId, commonProps);
      case StatementType.ACTION:
        return createActionElement(statement, itemId, commonProps);
      case StatementType.STEP:
        return createStepElement(statement, itemId, commonProps, isReusableGroup);
      case StatementType.IF_ELSE:
        return createIfElseElement(statement, itemId, commonProps);
      case StatementType.WHILE_LOOP:
        return createWhileLoopElement(statement, itemId, commonProps);
      default:
        return null;
    }
  }, [createCommonProps, createActionElement, createStepElement, createIfElseElement, createWhileLoopElement]);

  // Add statement at index
  const handleAddStatement = (index: number, type: StatementType) => {
    if (!editable) return; // Don't add statements when disabled

    const newStatement = createNewStatement(type);
    const newStatements = [...statements];
    newStatements.splice(index, 0, newStatement);
    onStatementsChange(newStatements);

    // Auto-expand sublists for new statements with nested containers
    autoExpandStatement(type, newStatement.uid);

    const prevStatement = index > 0 ? newStatements[index - 1] : null;
    const nextStatement = index < newStatements.length - 1 ? newStatements[index + 1] : null;
    // Notify debugger context that a statement was added
    debugContext?.onStatementAdded(newStatement.uid, prevStatement?.uid ?? null, nextStatement?.uid ?? null);
  };

  if (statements.length === 0) {
    // Empty container - show drop zone when dragging, add button when not
    const emptyDropId = getDropIndicatorId('inside', 0);

    return (
      <div className="flex w-full">
        {showVerticalLine && (
          <div className={`w-4 border-l-2 ${getVerticalLineColor(level - 1)} flex-shrink-0`} />
        )}
        <div className="flex-1 space-y-0.5 ml-2">
          {isDragging ? (
            <DropIndicator
              id={emptyDropId}
              isActive={isDropIndicatorActive(emptyDropId)}
              position="inside"
            />
          ) : (
            <>
              {editable && (
                <FloatingAddButton
                  onAddStatement={(type) => handleAddStatement(0, type)}
                  prominent={level === 0}
                />
              )}
              <div className="text-center py-2 text-xs text-gray-400 italic">
                {editable ? t('statementList.noStatements') : t('statementList.noStatementsReadOnly')}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full">
      {showVerticalLine && (
        <div className={`w-4 border-l-2 ${getVerticalLineColor(level - 1)} flex-shrink-0`} />
      )}
      <div className="flex-1 space-y-0.5 my-1">
        {/* Add button at the beginning */}
        {!isDragging && editable && (
          <FloatingAddButton
            onAddStatement={(type) => handleAddStatement(0, type)}
          />
        )}

        {/* Always show a drop indicator at the very beginning when dragging */}
        {isDragging && (
          <DropIndicator
            id={getDropIndicatorId('before', 0)}
            isActive={isDropIndicatorActive(getDropIndicatorId('before', 0))}
            position="before"
          />
        )}

        {/* Interstitial content before first statement */}
        {level === 0 && renderBetweenStatements && statements.length > 0 && renderBetweenStatements(undefined, statements[0].uid)}

        {statements.map((statement, index) => {
          const itemId = statement.uid;
          const isCurrentlyDragged = dragContext?.activeStatement?.id === itemId;
          const isLastStatement = index === statements.length - 1;
          const afterDropId = getDropIndicatorId('after', index);

          const statementElement = renderStatementElement(statement, index);

          return (
            <React.Fragment key={itemId}>
              {/* The statement element */}
              {statementElement}

              {/* Interstitial content between statements */}
              {level === 0 && renderBetweenStatements && (
                renderBetweenStatements(statement.uid, isLastStatement ? undefined : statements[index + 1]?.uid)
              )}

              {/* Drop indicator after this element (when dragging) OR Add button (when not dragging) */}
              {isDragging ? (
                // Always show drop indicator after the last element to allow dropping at the end
                // For other elements, skip if it's the currently dragged element
                (!isCurrentlyDragged || isLastStatement) && (
                  <DropIndicator
                    id={afterDropId}
                    isActive={isDropIndicatorActive(afterDropId)}
                    position="after"
                  />
                )
              ) : (
                editable ? (
                  <FloatingAddButton
                    onAddStatement={(type) => handleAddStatement(index + 1, type)}
                    prominent={level === 0 && index === statements.length - 1}
                  />
                ) : <div className="h-1" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};