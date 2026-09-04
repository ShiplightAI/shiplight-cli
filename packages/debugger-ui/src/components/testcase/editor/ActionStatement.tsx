import { DebuggingOnly } from '@/components/common';
import { useTranslations } from 'next-intl';
import { appEventBus, useAppEvent } from '@/utils/appEventBus';
import { TestStepActionType } from '@/common/constants';
import { TestFunction } from '@/common/models/testFunction';
import type { Action, Statement } from 'shiplight-types';
import { StatementType } from 'shiplight-types';
import { allowPureVisionAction, isDynamicAction } from 'shiplight-types';
import type { ActionEntity } from 'shiplight-types';
import { isLocatorBasedAction } from '@/common/steps_json/utils/locatorUtils';
import { ActionIcon, Collapse, Modal, Tooltip } from '@mantine/core';
import { IconBug, IconChevronDown, IconChevronUp, IconList, IconPointerSearch, IconX } from '@tabler/icons-react';
import React, { useState, useCallback, useMemo } from 'react';
import { MultilineTextInput } from '../../common/MultilineTextInput';
import type { MenuGroup } from './StatementWrapper';
import { createActionsMenuGroup, createControlFlowsMenuGroup } from './StatementWrapper';

import {
  IconBrain,
  IconCode,
  IconEye,
  IconPointerCode,
  IconRobot,
  IconEdit,
} from '@tabler/icons-react';
import { isAIActionType, isValidJavaScript } from '../../../utils/aiDetectionUtils';
import type { DebuggerContextType, ExecutionStatus } from '../types/debugger';
import { getActionIcon, getBadgeColorForActionType, getDisplayActionName, getActionTypeFromActionName } from '../utils/actionIconUtils';
import { updateFunctionActionData } from './actions/functionActionUtils';
import { shouldDisableStatement } from "../utils/editingUtils";
import { AIToggleSwitch } from './AIToggleSwitch';
import { StatementWrapper } from './StatementWrapper';
import { ActionEditor } from './actions/ActionEditor';
import { ActionEntityEditor } from './actions/ActionEntityEditor';
import { updateNonAssertionActionEntityDescription } from './actions/actionDescriptionUtils';
import { V2ActionSettingsPanel } from './actions/V2ActionSettingsPanel';
import { ActionGenerationDebugView } from './actions/ActionGenerationDebugView';
import { useEditor } from './contexts/EditorContext';

interface ActionStatementProps {
  statement: Statement; // Accept full statement instead of individual fields
  index: number;
  level?: number;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onFindElement?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  onStatementChange: (updatedStatement: Statement) => void; // Handle statement updates
  onStatementTypeChange: (statementType: StatementType, actionType?: TestStepActionType) => void;

  // Debug context (passed down from parent)
  debugContext?: DebuggerContextType | null;
  derivedDebugStatus?: ExecutionStatus; // Pre-calculated debug status from StatementList
}

export const ActionStatement: React.FC<ActionStatementProps> = ({
  statement,
  index,
  level = 0,
  onEdit,
  onDelete,
  onDuplicate,
  onFindElement,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  onStatementChange,
  onStatementTypeChange,
  debugContext,
  derivedDebugStatus,
}) => {
  // Check if this is a DRAFT statement
  // DRAFT statements are rendered like ACTION but with a different badge
  // They convert to ACTION or STEP after execution
  const isDraftStatement = statement.type === StatementType.DRAFT;

  // Cast statement to Action type - DRAFT shares the same structure minus action_entity/locator
  // We cast to Action for simplicity since all property accesses use optional chaining
  const action = statement as Action;
  const id = statement.uid;

  // Helper to create an updated statement from the current one
  // Converts DRAFT to ACTION only when setting action_entity or locator
  // Otherwise preserves the original statement type (important for DRAFT)
  const createUpdatedAction = useCallback((updates: Partial<Action>): Statement => {
    // Determine if we should convert DRAFT to ACTION:
    // - When setting action_entity (means we have concrete action data)
    // - When setting locator (means user picked a specific element)
    const shouldConvertToAction = isDraftStatement && (
      updates.action_entity !== undefined ||
      updates.locator !== undefined
    );

    return {
      uid: id,
      type: shouldConvertToAction ? StatementType.ACTION : statement.type,
      description: action.description,
      action_entity: action.action_entity,
      locator: action.locator,
      use_pure_vision: action.use_pure_vision,
      comment: statement.comment,
      ...updates,
    } as Statement;
  }, [id, isDraftStatement, statement.type, action.description, action.action_entity, action.locator, action.use_pure_vision]);

  // Initialize collapsed state based on whether action entity exists
  // DRAFT statements never have action_entity
  const t = useTranslations('TestCases');
  const tWrapper = useTranslations('TestCases.statementWrapper');
  const {
    enabled,
    displayOnly,
    markModified,
    modifiedStatements,
    actionGenerationDebugInfo,
    executionStatusByStatementUid,
    statementDisplayModeByUid,
    v2,
  } = useEditor();
  const runResultStatus = executionStatusByStatementUid?.[id];
  const displayMode = statementDisplayModeByUid[id] ?? (runResultStatus?.autoHealed ? "healed" : "default");
  const healedAction = runResultStatus?.healedAction;
  const effectiveActionEntity = displayOnly && displayMode === "healed" && healedAction
    ? healedAction
    : action.action_entity;
  const effectiveLocator = displayOnly && displayMode === "healed" && healedAction
    ? (healedAction.locator ?? action.locator)
    : action.locator;
  // Check if there's displayable action entity data beyond the description.
  // Pure VERIFY/WAIT without extra fields (js, locator, etc.) has no extra data to show.
  const hasActionEntity = Boolean(effectiveActionEntity?.action_data) && (() => {
    const ae = effectiveActionEntity!;
    const name = ae.action_data?.action_name;
    const kwargs = ae.action_data?.kwargs;
    if (name === 'verify' && !kwargs?.code && !ae.locator && !ae.xpath) return false;
    if (name === 'ai_wait_until' && !kwargs?.timeout_seconds) return false;
    if (name === 'wait' && !kwargs?.seconds) return false;
    return true;
  })();
  const [isDataCollapsed, setIsDataCollapsed] = useState(true);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const editable = enabled && !displayOnly;

  // Get debug info - prefer session debug info (more recent) over persisted debug info
  const debugInfo = actionGenerationDebugInfo?.get(statement.uid);

  // Check if this statement is modified
  const isModified = modifiedStatements.has(id);

  // Calculate debug state internally
  const debugStatus = derivedDebugStatus || debugContext?.getStatementStatus(id);
  const isCurrentStatement = debugContext?.currentStatementId === id;
  const debugDetails = debugContext?.getStatementDetails(id);

  // Local state for selected action type (before creating action_entity)
  const [selectedActionType, setSelectedActionType] = useState<string | null>(null);

  // State for locator picking
  const [isPickingLocator, setIsPickingLocator] = useState(false);

  // Get current action name from action_entity, selected type, or default
  // DRAFT statements use "draft" as their action name
  const currentActionName = isDraftStatement
    ? "draft"
    : (effectiveActionEntity?.action_data?.action_name || selectedActionType || "action");

  // Determine if this is an assertion action (needed early for locator picking)
  const isAssertionAction = getActionTypeFromActionName(currentActionName) === TestStepActionType.Assertion;

  // Track previous action name to detect when changing to upload_file
  const [prevActionName, setPrevActionName] = useState(currentActionName);

  // Detect if this is a newly created upload_file, function, or ai_extract action
  const isNewlyCreatedUploadFile = prevActionName !== 'upload_file' && currentActionName === 'upload_file';
  const isNewlyCreatedFunction = prevActionName !== 'function' && currentActionName === 'function';
  const isNewlyCreatedExtract = prevActionName !== 'ai_extract' && currentActionName === 'ai_extract';

  // Update previous action name when current changes
  React.useEffect(() => {
    if (currentActionName !== prevActionName) {
      setPrevActionName(currentActionName);
    }
  }, [currentActionName, prevActionName]);

  useAppEvent('locator:request-pick', (payload) => {
    if (payload.statementId === id) {
      setIsPickingLocator(true);
    }
  }, [id]);

  // Listen for locator picked events
  useAppEvent('locator:picked', (payload) => {
    if (payload.statementId === id && isPickingLocator) {
      if (isAssertionAction) {
        // For assertions: insert locator into code as await expect(locator).
        const newCode = `await expect(page.${payload.locator}).`;
        const existingStatement = action.description || action.action_entity?.action_data?.kwargs?.statement || '';

        // Update action entity with code, preserving the existing statement
        const updatedActionEntity: ActionEntity = {
          action_description: existingStatement || newCode,
          action_data: {
            action_name: 'verify',
            kwargs: {
              ...(existingStatement ? { statement: existingStatement } : {}),
              code: newCode,
            },
          },
        };

        const updatedStatement = createUpdatedAction({
          description: existingStatement || newCode,
          action_entity: updatedActionEntity,
        });
        onStatementChange(updatedStatement);
        markModified(id, "Assertion locator picked");
      } else {
        // For regular actions: store locator in action.locator
        const updatedStatement = createUpdatedAction({
          locator: payload.locator
        });
        onStatementChange(updatedStatement);
        markModified(id, "Locator picked");
      }
      setIsPickingLocator(false);
    }
  }, [id, isPickingLocator, action, onStatementChange, markModified, createUpdatedAction]);

  // Listen for locator pick cancelled events
  useAppEvent('locator:pick-cancelled', (payload) => {
    console.log('🚫 Locator pick cancelled for statement:', payload.statementId);
    if (payload.statementId === id) {
      setIsPickingLocator(false);
    }
  }, [id]);

  // Get description based on action type and data structure
  const getDescription = () => {
    if (!effectiveActionEntity) {
      // No action_entity, use the basic description
      return action.description || "";
    }

    const actionName = effectiveActionEntity.action_data?.action_name;

    if (actionName === "js_code") {
      // Code and its user-facing description are separate fields. The code is
      // rendered by CodeEditor; keep the statement description available to the
      // description editor and badge.
      return action.description || effectiveActionEntity.action_description || "";
    } else {
      // In healed view, prefer the healed action's own description so the whole step view switches.
      if (displayOnly && displayMode === "healed") {
        return effectiveActionEntity.action_description
          || effectiveActionEntity.action_data?.kwargs?.statement
          || action.description
          || "";
      }
      // For all other action types, prioritize action.description (which gets updated by user edits)
      // Fall back to action_description only if action.description is empty
      return action.description || effectiveActionEntity.action_description || "";
    }
  };

  const description = getDescription();

  // Debug actions from debugContext
  const onPlay = debugContext && isCurrentStatement ? () => debugContext.step().catch(console.error) : undefined;
  const onSkipToNext = debugContext && isCurrentStatement ? () => debugContext.skipToNextStatement().catch(console.error) : undefined;
  const onSkipToStatement = debugContext && debugContext.isDebugging ? () => debugContext.skipToStatement(action.uid).catch(console.error) : undefined;
  const onRollBackToStatement = debugContext && debugContext.isDebugging ? () => debugContext.rollBackToStatement(action.uid).catch(console.error) : undefined;
  const onPlayUntil = debugContext ? () => {
    if (!debugContext.isDebugging) {
      debugContext.startDebuggingAndRunUntil(action.uid).catch(console.error);
    } else {
      debugContext.runUntil(action.uid).catch(console.error);
    }
  } : undefined;

  // Handle function cancellation - reset selected action type
  const handleFunctionCancel = () => {
    console.log("🚫 Function cancelled - resetting action");
    setSelectedActionType(null);
    // No need to remove action_entity since it wasn't created yet
  };

  const handleFileUploadSelect = (files: Array<{ fileName: string; testDataId: number }>, targetDescription?: string) => {
    markModified(id, "File upload selected");

    // Update description with the selected file names
    const fileNames = files.map(f => f.fileName);
    let newDescription: string;

    if (fileNames.length === 1) {
      newDescription = `Upload ${fileNames[0]}`;
    } else if (fileNames.length === 2) {
      newDescription = `Upload ${fileNames[0]} and ${fileNames[1]}`;
    } else {
      // For 3+ files: "Upload file1, file2, and file3"
      const lastFile = fileNames[fileNames.length - 1];
      const otherFiles = fileNames.slice(0, -1).join(', ');
      newDescription = `Upload ${otherFiles}, and ${lastFile}`;
    }

    if (targetDescription) {
      newDescription += ` to ${targetDescription}`;
    }

    // Create or update action_entity with file info in kwargs
    const updatedActionEntity: ActionEntity = {
      action_data: {
        action_name: "upload_file",
        args: action.action_entity?.action_data?.args || [],
        kwargs: {
          paths: files.map(f => f.fileName),  // Use file names as paths
          testDataIds: files.map(f => f.testDataId),  // Store test data IDs for tracking
          uid: action.uid,  // Include statement uid for AI fallback
          ...(targetDescription ? { target_description: targetDescription } : {})
        }
      },
      action_description: newDescription,
      url: action.action_entity?.url || "",
      feedback: action.action_entity?.feedback || ""
    };

    const updatedStatement = createUpdatedAction({
      description: newDescription,
      action_entity: updatedActionEntity
    });

    onStatementChange(updatedStatement);
  };

  const handleFileUploadCancel = () => {
    console.log("🚫 File upload cancelled - resetting action");
    setSelectedActionType(null);
    // No need to remove action_entity since it wasn't created yet
  };

  const handleExtractContentConfirm = (elementDescription: string, variableName: string) => {
    markModified(id, "Extract content configured");

    // Update description with what we're extracting
    const newDescription = `Extract ${elementDescription} and save to ${variableName}`;

    // Create or update action_entity with ai_extract info in kwargs
    const updatedActionEntity: ActionEntity = {
      url: action.action_entity?.url || '',
      action_description: newDescription,  // Always use the new description
      feedback: action.action_entity?.feedback || '',
      action_data: {
        action_name: "ai_extract",
        args: [],
        kwargs: {
          element_description: elementDescription,
          variable_name: variableName
        }
      }
    };

    const updatedStatement = createUpdatedAction({
      description: newDescription,
      action_entity: updatedActionEntity
    });

    onStatementChange(updatedStatement);
  };

  const handleExtractContentCancel = () => {
    console.log("🚫 Extract content cancelled - resetting action");
    setSelectedActionType(null);
    // No need to remove action_entity since it wasn't created yet
  };

  // Check if the entire statement should be disabled (debug) or display-only
  const isStatementDisabled = shouldDisableStatement(debugContext || null, debugStatus);
  const isDisabled = isStatementDisabled || !editable;

  const handleDescriptionChange = async (newDescription: string) => {
    markModified(id, "Action description changed");

    // Update the statement with new description and sync action_entity.action_description if it exists
    let updatedActionEntity: ActionEntity | undefined = action.action_entity;

    // Check if this is an assertion action - auto-detect AI vs JS mode
    const actionType = getActionTypeFromActionName(currentActionName);
    const isAssertion = actionType === TestStepActionType.Assertion;

    if (isAssertion) {
      // Always set kwargs.statement for assertions, preserve existing kwargs.code
      const existingCode = action.action_entity?.action_data?.kwargs?.code;
      updatedActionEntity = {
        action_description: newDescription,
        action_data: {
          action_name: 'verify',
          kwargs: {
            statement: newDescription,
            ...(existingCode ? { code: existingCode } : {}),
          },
        },
      };
    } else if (updatedActionEntity) {
      updatedActionEntity = updateNonAssertionActionEntityDescription(updatedActionEntity, newDescription);
    }

    const updatedStatement = createUpdatedAction({
      description: newDescription,
      action_entity: updatedActionEntity
    });
    onStatementChange(updatedStatement);
  };

  const handleCodeChange = async (code: string) => {
    markModified(id, "Action code changed");

    // Update the action entity with new code
    if (action.action_entity?.action_data?.kwargs) {
      const updatedStatement = createUpdatedAction({
        action_entity: {
          ...action.action_entity,
          action_data: {
            ...action.action_entity.action_data,
            kwargs: {
              ...action.action_entity.action_data.kwargs,
              code: code
            }
          }
        }
      });
      onStatementChange(updatedStatement);
    }
  };

  const handleFunctionSelect = async (func: TestFunction, paramValues?: Record<string, string>) => {
    markModified(id, "Action function selected");

    // Update the action entity with function details
    if (action.action_entity?.action_data?.kwargs) {
      const updatedActionData = updateFunctionActionData(
        action.action_entity.action_data,
        func,
        paramValues,
      );
      const updatedStatement = createUpdatedAction({
        action_entity: {
          ...action.action_entity,
          action_data: updatedActionData,
        }
      });
      onStatementChange(updatedStatement);
    }
  };

  const handleActionEntityChange = async (
    updatedActionEntity: any,
    updates?: { description?: string; locator?: string }
  ) => {
    markModified(id, "Action entity changed");

    const updatedStatement = createUpdatedAction({
      action_entity: updatedActionEntity,
      ...(updates?.description !== undefined ? { description: updates.description } : {}),
      ...(updates?.locator !== undefined ? { locator: updates.locator } : {}),
    });
    onStatementChange(updatedStatement);
  };

  // AI Toggle Logic
  const handleAIToggle = () => {
    markModified(id, "AI mode toggled");

    // Determine target based on current action name, not isAI parameter
    if (currentActionName === 'ai_action') {
      // ai_action → action: Convert to regular action
      onStatementTypeChange(StatementType.ACTION, TestStepActionType.Action);
    } else if (currentActionName === 'ai_step') {
      // ai_step → STEP: Convert back to STEP with empty statements
      onStatementTypeChange(StatementType.STEP);
    } else {
      // All other actions (click, type, action, etc.) → ai_action
      // Clear cached action_entity when switching to AI mode
      const cleared = createUpdatedAction({ action_entity: undefined });
      onStatementChange(cleared);
      onStatementTypeChange(StatementType.ACTION, TestStepActionType.AiAction);
    }
  };

  const handleClearCache = () => {
    markModified(id, "Action entity cache cleared");
    const updatedStatement = createUpdatedAction({ action_entity: undefined });
    onStatementChange(updatedStatement);
  };

  const isAssertionUsingJsCode = isAssertionAction && action.action_entity?.action_data?.kwargs?.code !== undefined;

  const handleJsCodeToggle = (checked: boolean) => {
    markModified(id, "Assertion JS code mode toggled");
    const existingKwargs = action.action_entity?.action_data?.kwargs || {};
    const { code: _removed, ...kwargsWithoutCode } = existingKwargs;
    const updatedEntity: ActionEntity = {
      ...action.action_entity,
      action_description: action.action_entity?.action_description || description,
      action_data: {
        action_name: 'verify',
        kwargs: checked
          ? { ...existingKwargs, code: '' }
          : kwargsWithoutCode,
      },
    };
    const updatedStatement = createUpdatedAction({ action_entity: updatedEntity });
    onStatementChange(updatedStatement);
  };

  const handleJsCodeChange = (code: string) => {
    markModified(id, "Assertion JS code updated");
    const existingKwargs = action.action_entity?.action_data?.kwargs || {};
    const { code: _removed, ...kwargsWithoutCode } = existingKwargs;
    const updatedEntity: ActionEntity = {
      ...action.action_entity,
      action_description: action.action_entity?.action_description || description,
      action_data: {
        action_name: 'verify',
        kwargs: code.trim() ? { ...existingKwargs, code } : kwargsWithoutCode,
      },
    };
    const updatedStatement = createUpdatedAction({ action_entity: updatedEntity });
    onStatementChange(updatedStatement);
  };

  const handleLoginConfirm = async (testAccountId: number, environmentId?: number) => {
    markModified(id, "Login action confirmed");
    if (action.action_entity?.action_data?.kwargs) {
      const updatedStatement = createUpdatedAction({
        action_entity: {
          ...action.action_entity,
          action_data: {
            ...action.action_entity.action_data,
            kwargs: {
              ...action.action_entity.action_data.kwargs,
              test_account_id: testAccountId,
              environment_id: environmentId,
            },
          },
        },
      });
      onStatementChange(updatedStatement);
    }
  };

  const handleLoginCancel = () => {
    markModified(id, "Login action cancelled");
    // onStatementTypeChange(StatementType.ACTION, TestStepActionType.Action);
  };

  const handleExtractEmailContentConfirm = async (config: any) => {
    markModified(id, "Extract email content action confirmed");
    if (action.action_entity?.action_data?.kwargs) {
      const updatedStatement = createUpdatedAction({
        action_entity: {
          ...action.action_entity,
          action_data: {
            ...action.action_entity.action_data,
            kwargs: {
              ...action.action_entity.action_data.kwargs,
              config_id: config.configId,
              forward_email: config.forwardEmail,
              extraction_type: config.extractionType,
              prompt: config.prompt,
              filter_from_email: config.filterFromEmail,
              filter_to_email: config.filterToEmail,
              filter_subject: config.filterSubject,
              filter_body_contains: config.filterBodyContains,
            },
          },
        },
      });
      onStatementChange(updatedStatement);
    }
  };

  const handleExtractEmailContentCancel = () => {
    markModified(id, "Extract email content action cancelled");
    // onStatementTypeChange(StatementType.ACTION, TestStepActionType.Action);
  };

  const handleWaitUntilConfirm = (condition: string, timeoutSeconds: number) => {
    markModified(id, "Wait until configured");

    // Update description with the condition
    const newDescription = `Wait until ${condition}`;

    // Create or update action_entity with ai_wait_until info in kwargs
    const updatedActionEntity: ActionEntity = {
      url: action.action_entity?.url || '',
      action_description: newDescription,
      feedback: action.action_entity?.feedback || '',
      action_data: {
        action_name: "ai_wait_until",
        args: [],
        kwargs: {
          condition: condition,
          timeout_seconds: timeoutSeconds
        }
      }
    };

    const updatedStatement = createUpdatedAction({
      description: newDescription,
      action_entity: updatedActionEntity
    });

    onStatementChange(updatedStatement);
  };

  // Handle Pick Locator action
  const handlePickLocator = () => {
    setIsPickingLocator(true);
    appEventBus.emit('locator:request-pick', {
      statementId: id,
      language: 'JavaScript' // Default to JavaScript, could make this configurable
    });
  };

  // Handle Delete Locator action
  const handleDeleteLocator = () => {
    markModified(id, "Locator removed");
    const updatedStatement = createUpdatedAction({
      locator: undefined
    });
    onStatementChange(updatedStatement);
  };

  // Handle Locator change from inline editor
  const handleLocatorChange = (newValue: string) => {
    // Remove any newlines to keep it single-line
    const singleLineValue = newValue.replace(/\n/g, ' ').trim();
    markModified(id, "Locator edited");
    const updatedStatement = createUpdatedAction({
      locator: singleLineValue || undefined
    });
    onStatementChange(updatedStatement);
  };

  // Calculate syntax warning - returns warning message if there's invalid syntax
  const getSyntaxWarning = (): string | undefined => {
    const kwargs = action.action_entity?.action_data?.kwargs;

    // Check assertion actions in JS mode
    if (isAssertionAction && kwargs?.code !== undefined) {
      if (!isValidJavaScript(kwargs.code)) {
        return "Invalid JavaScript syntax in assertion code";
      }
    }

    return undefined;
  };

  const syntaxWarning = getSyntaxWarning();

  // Determine if we should show AI toggle
  const shouldShowAIToggle = () => {
    // Don't show toggle for DRAFT statements
    if (isDraftStatement) {
      return false;
    }
    // Don't show toggle for assertions — both statement and code coexist
    if (isAssertionAction) {
      return false;
    }
    // Show for ai_action/ai_step
    if (currentActionName === 'ai_action' || currentActionName === 'ai_step') {
      return true;
    }
    // Don't show toggle for other dynamic actions (code, function, etc.)
    if (isDynamicAction(currentActionName)) {
      return false;
    }
    // Show toggle for all other action types (action, click, type, etc.)
    return true;
  };

  // Determine current AI state based on action type
  const isCurrentlyAI = isAIActionType(currentActionName);

  // Get toggle icons based on action type
  const getOffIcon = () => {
    if (isAssertionAction) {
      return <IconCode size={12} stroke={2} color="var(--shiplight-text-secondary)" />;
    }
    if (currentActionName === 'ai_step') {
      return <IconList size={12} stroke={2} color="var(--shiplight-text-secondary)" />;
    }
    return <IconPointerCode size={12} stroke={2} color="var(--shiplight-text-secondary)" />;
  };

  // Get toggle tooltips based on action type
  const getTooltips = () => {
    if (isAssertionAction) {
      return {
        on: t('actionStatement.aiAssertion'),
        off: t('actionStatement.jsAssertion')
      };
    }
    if (currentActionName === 'ai_step') {
      return {
        on: t('actionStatement.aiGroup'),
        off: t('actionStatement.groupContainer')
      };
    }
    return {
      on: t('actionStatement.aiAction'),
      off: t('actionStatement.regularAction')
    };
  };

  const tooltips = getTooltips();

  // Create the AI toggle component
  const aiToggleComponent = shouldShowAIToggle() ? (
    <AIToggleSwitch
      checked={isCurrentlyAI}
      onChange={handleAIToggle}
      onIcon={<IconRobot size={12} stroke={2.5} color="#fff" />}
      offIcon={getOffIcon()}
      onTooltip={tooltips.on}
      offTooltip={tooltips.off}
      disabled={isDisabled}
      warningTooltip={syntaxWarning}
    />
  ) : undefined;

  // Pure Vision Toggle Logic
  const isPureVisionFeatureEnabled = true; // Enabled globally

  const handlePureVisionToggle = (checked: boolean) => {
    markModified(id, "Pure vision mode toggled");

    // Check if we should update the existing action_entity or remove it
    const existingEntity = action.action_entity;
    if (existingEntity?.action_data?.action_name === 'ai_action' && existingEntity.action_data.kwargs) {
      // Update the existing action_entity with new pure vision setting
      const updatedEntity = {
        ...existingEntity,
        action_data: {
          ...existingEntity.action_data,
          kwargs: {
            ...existingEntity.action_data.kwargs,
            use_pure_vision: checked,
          },
        },
      };
      const updatedStatement = createUpdatedAction({
        use_pure_vision: checked,
        action_entity: updatedEntity,
      });
      onStatementChange(updatedStatement);
    } else {
      // Remove action_entity to force regeneration with new pure vision setting
      const updatedStatement = createUpdatedAction({
        use_pure_vision: checked,
        action_entity: undefined,
      });
      onStatementChange(updatedStatement);
    }
  };

  // Determine if we should show pure vision toggle (only for actions, not code/function/assertion/ai_extract/ai_wait_until)
  const shouldShowPureVisionToggle = () => {
    // Don't show toggle for DRAFT statements
    if (isDraftStatement) {
      return false;
    }
    if (!isPureVisionFeatureEnabled) {
      return false;
    }
    // Don't show toggle for code, function, assertion, ai_extract, or ai_wait_until types
    if (!allowPureVisionAction(currentActionName)) {
      return false;
    }

    // Show toggle for all other action types (action, ai_action, ai_step, click, type, etc.)
    return true;
  };

  const pureVisionToggleComponent = shouldShowPureVisionToggle() ? (
    <AIToggleSwitch
      checked={action.use_pure_vision || false}
      onChange={handlePureVisionToggle}
      onIcon={<IconEye size={12} stroke={2.5} color="#fff" />}
      offIcon={<IconBrain size={12} stroke={2} color="var(--shiplight-text-secondary)" />}
      onTooltip={t('actionStatement.pureVision')}
      offTooltip={t('actionStatement.hybridMode')}
      disabled={isDisabled}
      color="cyan"
      size="xs"
      wrapperClassName="switch-pure-vision"
      gradientClassName="animate-gradient-cyan"
    />
  ) : undefined;

  const shouldShowV2Settings = () => isDraftStatement || shouldShowAIToggle() || isAssertionAction;

  // V2: Settings button for floating action bar (replaces inline AI/PureVision toggles)
  const v2SettingsAction = useMemo(() => {
    if (!v2 || !shouldShowV2Settings()) return undefined;
    return (
      <Tooltip label={t('floatingActionBar.edit')} position="top" withArrow>
        <button
          onClick={(e) => { e.stopPropagation(); setIsSettingsExpanded(prev => !prev); }}
          className="p-1 rounded-full hover:bg-white/15 transition-colors"
        >
          <IconEdit size={14} className="text-white" />
        </button>
      </Tooltip>
    );
  }, [v2, shouldShowAIToggle, t]);

  const v2TypeMenuGroups = useMemo(() => {
    if (!v2 || !onStatementTypeChange) return undefined;
    return [
      createActionsMenuGroup(onStatementTypeChange, true, false, tWrapper),
      createControlFlowsMenuGroup(onStatementTypeChange, tWrapper),
    ];
  }, [v2, onStatementTypeChange, t]);

  // Create additional menu groups for Pick Locator action
  const additionalMenuGroups: MenuGroup[] = [];

  // Add Pick Locator menu item for regular actions and assertions
  if ((isLocatorBasedAction(currentActionName) || isAssertionAction) &&
    debugContext?.isDebugging &&
    isCurrentStatement) {
    additionalMenuGroups.push({
      id: "locator-actions",
      label: t('actionStatement.pickLocator'),
      actions: [{
        id: "pick-locator",
        label: isPickingLocator ? t('actionStatement.picking') : t('actionStatement.pickLocator'),
        icon: <IconPointerSearch size={14} />,
        onClick: handlePickLocator,
        tooltip: t('actionStatement.pickLocator')
      }]
    });
  }

  return (
    <div>
      <StatementWrapper
        id={id || `statement-${level}-${index}`}
        index={index}
        statement={statement}
        badgeLabel={getDisplayActionName(currentActionName, description, action.action_entity)}
        badgeIcon={getActionIcon(currentActionName, description)}
        badgeColor={getBadgeColorForActionType(currentActionName)}
        modified={isModified}
        onStatementTypeChange={onStatementTypeChange}
        // AI and Pure Vision Toggle components (suppressed in v2 — moved to settings panel)
        aiToggleComponent={!v2 ? (
          <>
            {aiToggleComponent}
            {pureVisionToggleComponent}
          </>
        ) : undefined}
        extraActions={v2SettingsAction}
        onEdit={onEdit}
        onDelete={onDelete}
        onPlay={onPlay}
        onSkipToNext={onSkipToNext}
        onSkipToStatement={onSkipToStatement}
        onRollBackToStatement={onRollBackToStatement}
        onPlayUntil={onPlayUntil}
        onDuplicate={onDuplicate}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        isFirst={isFirst}
        isLast={isLast}
        additionalMenuGroups={additionalMenuGroups}
        debugStatus={debugStatus}
        isCurrentStatement={isCurrentStatement}
        debugDetails={debugDetails}
        disabled={isStatementDisabled}
      >
        {/* Action Editor with details toggle */}
        <div className="mb-1 flex items-start gap-2">
          <div className="flex-1 flex flex-col">
            <ActionEditor
              actionName={currentActionName}
              description={description}
              selectedActionType={selectedActionType}
              hasActionEntity={hasActionEntity}
              actionEntity={effectiveActionEntity}
              onDescriptionChange={handleDescriptionChange}
              onFindElement={onFindElement}
              onCodeConfirm={handleCodeChange}
              onFunctionSelect={handleFunctionSelect}
              onFunctionCancel={handleFunctionCancel}
              onFileUploadSelect={handleFileUploadSelect}
              onFileUploadCancel={handleFileUploadCancel}
              onExtractContentConfirm={handleExtractContentConfirm}
              onExtractContentCancel={handleExtractContentCancel}
              onLoginConfirm={handleLoginConfirm}
              onLoginCancel={handleLoginCancel}
              onExtractEmailContentConfirm={handleExtractEmailContentConfirm}
              onExtractEmailContentCancel={handleExtractEmailContentCancel}
              onWaitUntilConfirm={handleWaitUntilConfirm}
              enabled={editable}
              isNewlyCreated={isNewlyCreatedUploadFile || isNewlyCreatedFunction || isNewlyCreatedExtract}
            />
            {/* Display locator if present - aligned with action editor */}
            {effectiveLocator && (
              <div className="mt-1 flex items-start text-xs">
                <div className="flex-1 pl-2 pr-1 min-w-0">
                  <MultilineTextInput
                    value={effectiveLocator}
                    onChange={handleLocatorChange}
                    placeholder="Enter locator..."
                    emptyText=""
                    disabled={!editable}
                    displayClassName="text-[12px] cursor-text hover:bg-surface px-2 py-0.5 rounded border-transparent border hover:border-subtle transition-colors font-mono break-all"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1 pt-2">
              {v2 && shouldShowV2Settings() ? (
                <Tooltip label={t('actionStatement.settings')}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
                  >
                    {isSettingsExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </ActionIcon>
                </Tooltip>
              ) : !v2 && hasActionEntity ? (
                <Tooltip label={t('actionStatement.showHideDetails')}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={() => setIsDataCollapsed(!isDataCollapsed)}
                  >
                    {isDataCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
                  </ActionIcon>
                </Tooltip>
              ) : null}
              <DebuggingOnly>
                {debugInfo && (
                  <Tooltip label={t('actionStatement.showDebugInfo')}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={() => setIsDebugModalOpen(true)}
                    >
                      <IconBug size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </DebuggingOnly>
            </div>
            {/* Delete button aligned with locator field */}
            {effectiveLocator && editable && (
              <div className="mt-1">
                <Tooltip label={t('actionStatement.removeLocator')}>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={handleDeleteLocator}
                  >
                    <IconX size={12} />
                  </ActionIcon>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        {/* V2: Expandable AI settings panel */}
        {v2 && shouldShowV2Settings() && (
          <Collapse in={isSettingsExpanded}>
            <V2ActionSettingsPanel
              isAI={isCurrentlyAI}
              onAIToggle={handleAIToggle}
              showAIToggle={shouldShowAIToggle()}
              isUsingJsCode={isAssertionAction ? isAssertionUsingJsCode : undefined}
              onJsCodeToggle={isAssertionAction ? handleJsCodeToggle : undefined}
              jsCode={isAssertionAction ? (action.action_entity?.action_data?.kwargs?.code as string || '') : undefined}
              onJsCodeChange={isAssertionAction ? handleJsCodeChange : undefined}
              isPureVision={action.use_pure_vision || false}
              onPureVisionToggle={handlePureVisionToggle}
              showPureVision={shouldShowPureVisionToggle()}
              showCache={shouldShowAIToggle()}
              hasCache={hasActionEntity}
              onClearCache={handleClearCache}
              cachedActionEntity={effectiveActionEntity}
              description={description}
              locator={effectiveLocator}
              onActionEntityChange={handleActionEntityChange}
              typeMenuGroups={v2TypeMenuGroups}
              currentTypeName={getDisplayActionName(currentActionName, description, action.action_entity)}
              disabled={isDisabled}
              editable={editable}
            />
          </Collapse>
        )}

        {/* V1: Action Details (Expandable) */}
        {!v2 && hasActionEntity && (
          <Collapse in={!isDataCollapsed}>
            <ActionEntityEditor
              initialActionEntity={effectiveActionEntity}
              description={description}
              locator={effectiveLocator}
              onConfirm={editable ? handleActionEntityChange : undefined}
              height="150px"
              emptyText="No action data"
              readOnly={!editable}
            />
          </Collapse>
        )}

        {/* Action Generation Debug Modal */}
        <DebuggingOnly>
          {debugInfo && (
            <Modal
              opened={isDebugModalOpen}
              onClose={() => setIsDebugModalOpen(false)}
              title={t('actionStatement.debugInfoTitle')}
              size="auto"
              styles={{
                content: {
                  maxWidth: '1400px',
                  width: '90vw',
                  height: '90vh',
                  maxHeight: '90vh',
                },
                body: {
                  height: 'calc(90vh - 60px)',
                  display: 'flex',
                  flexDirection: 'column',
                },
              }}
            >
              <ActionGenerationDebugView
                debugInfo={debugInfo}
              />
            </Modal>
          )}
        </DebuggingOnly>

      </StatementWrapper>
    </div>
  );
};
