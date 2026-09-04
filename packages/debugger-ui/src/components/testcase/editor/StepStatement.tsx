import React, { useEffect, useState, useMemo } from "react";
import { ActionIcon, Tooltip, Collapse, Loader } from "@mantine/core";
import { IconList, IconChevronUp, IconChevronDown, IconClearAll, IconRecycle, IconFolders } from "@tabler/icons-react";
import { Step, Statement, StatementType } from "shiplight-types";
import { TestStepActionType } from "@/common/constants";
import { StatementList } from "./StatementList";
import { StatementWrapper, type MenuGroup } from "./StatementWrapper";
import { MultilineTextInput } from "../../common/MultilineTextInput";
import { useCollapseStore } from "../../../stores/collapseStore";
import type { ExecutionStatus, DebuggerContextType } from "../types/debugger";
import { shouldDisableStatement } from "../utils/editingUtils";
import { detectActionName } from "../utils/actionIconUtils";
import { useEditor } from "./contexts/EditorContext";
import { generateCollapseId } from "./utils/collapseUtils";
import { IconRobot } from "@tabler/icons-react";
import { AIToggleSwitch } from "./AIToggleSwitch";
import { findNextSibling } from "shiplight-types";
import { useReusableSteps } from "@/hooks/useReusableSteps";
import { resolveAllReferenceIds } from "@/common/utils/stepReferUtils";
import { SaveReusableStepModal } from "./SaveReusableStepModal";
import { SelectReusableStepModal } from "./SelectReusableStepModal";
import {
  hasReusableReference,
  isPendingReusableReference,
  isResolvedReusableReference,
  REUSABLE_STEP_PENDING_REFERENCE_ID,
} from "../utils/reusableStepUtils";
import { hasReferenceIds } from "@/common/utils/stepReferUtils";
import { notifications } from "@mantine/notifications";
import { useTranslations } from "next-intl";

interface StepStatementProps {
  statement: Statement; // Accept full statement instead of individual fields
  index: number;
  level?: number;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  onStatementChange: (updatedStatement: Statement) => void; // Handle statement updates
  onStatementTypeChange?: (statementType: StatementType, actionType?: TestStepActionType) => void;

  // Debug context (passed down from parent)
  debugContext?: DebuggerContextType | null; // Will pass this down to nested statements
  derivedDebugStatus?: ExecutionStatus; // Pre-calculated debug status from StatementList
  enabled: boolean;
  isInsideReusableGroup?: boolean;
}

export const StepStatement: React.FC<StepStatementProps> = ({
  statement,
  index,
  level = 0,
  onEdit,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  onStatementChange,
  onStatementTypeChange,
  debugContext,
  derivedDebugStatus,
  enabled,
  isInsideReusableGroup = false,
}) => {
  // Cast statement to Step type and extract step properties
  const step = statement as Step;
  const id = statement.uid;
  const { isCollapsed: isCollapsedStore, toggleCollapsed, setCollapsed } = useCollapseStore();
  const t = useTranslations("TestCases");
  const { markModified, modifiedStatements } = useEditor();

  // Check if this statement is modified
  const isModified = modifiedStatements.has(id);

  // Calculate debug state internally
  const debugStatus = derivedDebugStatus || debugContext?.getStatementStatus(id);
  const isCurrentStatement = debugContext?.currentStatementId === id;
  const debugDetails = debugContext?.getStatementDetails(id);

  // Check if this is a reusable step (cloud reference_id or local template_path)
  const referenceId = step.reference_id;
  const hasReference = hasReusableReference(referenceId);
  const isPendingReusableStep = isPendingReusableReference(referenceId);
  const isResolvedReusableStep = isResolvedReusableReference(referenceId);
  const isReusableStep = hasReference || !!step.template_path;
  const isReusableContext = isInsideReusableGroup || isReusableStep;

  // Handler functions for statement updates
  const handleDescriptionChange = (newDescription: string) => {
    markModified(id, "Group description changed");
    const updatedStatement: Statement = {
      ...step,
      description: newDescription,
    };
    onStatementChange(updatedStatement);
    // Mark reusable step as modified if applicable
    if (isResolvedReusableStep && step.reference_id) {
      markModified(id, "Reusable step modified");
    }
  };

  const handleStatementsChange = (newStatements: Statement[]) => {
    markModified(id, "Group statements changed");
    const updatedStatement: Statement = {
      ...step,
      statements: newStatements,
    };
    onStatementChange(updatedStatement);
    // Mark reusable step as modified if applicable
    if (isResolvedReusableStep && step.reference_id) {
      markModified(id, "Reusable step modified");
    }
  };

  // State for modals
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);
  const [hasSelectedTemplate, setHasSelectedTemplate] = useState(false);

  // Use reusable steps hook
  const { createReusableStep, getReusableStepById } = useReusableSteps();


  // Auto-open template selection modal for newly created reusable steps
  useEffect(() => {
    if (isPendingReusableStep) {
      setIsSelectModalOpen(true);
    }
  }, [isPendingReusableStep]);

  // Handle saving current step as a template
  const handleSaveAsTemplate = async (templateName: string) => {
    try {
      const originalStatements = step.statements || [];
      const description = step.description || '';

      if (hasReferenceIds(originalStatements)) {
        notifications.show({
          color: 'yellow',
          title: t('saveBLockedTitle'),
          message: t('saveBlockedNestedTemplates'),
        });
        return;
      }

      const createdTemplate = await createReusableStep(
        templateName,
        description,
        originalStatements
      );

      const tempStep: Step = {
        ...step,
        reference_id: createdTemplate.id,
        description: description,
        statements: originalStatements,
      };

      const templateResolver = (id: number) => {
        if (id === createdTemplate.id) {
          return createdTemplate;
        }
        return getReusableStepById(id);
      };

      const resolvedStatements = await resolveAllReferenceIds([tempStep], {
        templateResolver,
      });
      const expandedStep = resolvedStatements[0] as Step;

      markModified(id, "Saved as reusable group");
      onStatementChange(expandedStep);
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  };

  // Handle template selection from SelectReusableStepModal
  const handleTemplateSelect = async (templateId: number, copy: boolean = false) => {
    setHasSelectedTemplate(true);
    setIsSelectModalOpen(false);

    try {
      // Get template from API
      const template = getReusableStepById(templateId);
      if (!template) {
        console.error(`Template not found: ${templateId}`);
        setHasSelectedTemplate(false);
        return;
      }

      // Convert to normal group if:
      // 1. User selected "Copy" (copy = true), or
      // 2. We're inside a reusable group (nested reusable groups not allowed)
      const shouldConvertToNormalGroup = copy || isInsideReusableGroup;

      if (shouldConvertToNormalGroup) {
        // Resolve template first so nested statements get fresh UIDs
        const tempStep: Step = {
          ...step,
          reference_id: templateId,
          description: template.description || '',
          statements: [],
        };

        const resolvedStatements = await resolveAllReferenceIds([tempStep], {
          templateResolver: (id: number) => getReusableStepById(id),
        });
        const expandedStep = resolvedStatements[0] as Step;

        const normalGroup: Step = {
          ...expandedStep,
          reference_id: undefined,
        };
        delete normalGroup.reference_id;

        markModified(id, "Template content inserted as normal group");
        onStatementChange(normalGroup);

        // Show notification only when it's a forced conversion due to nesting (not when user chose "Copy")
        if (!copy && isInsideReusableGroup) {
          notifications.show({
            color: 'blue',
            title: t('templateInsertedTitle'),
            message: t('templateInsertedMessage'),
            autoClose: 5000,
          });
        }
        setHasSelectedTemplate(false);
      } else {
        // Normal flow: Create reusable group with reference_id
        const tempStep: Step = {
          ...step,
          reference_id: templateId,
          description: template.description || '',
          statements: [],
        };

        // Resolve the reference to get expanded statements
        const resolvedStatements = await resolveAllReferenceIds([tempStep], {
          templateResolver: (id: number) => getReusableStepById(id)
        });
        const expandedStep = resolvedStatements[0] as Step;

        markModified(id, "Template selected");
        onStatementChange(expandedStep);
      }
      setHasSelectedTemplate(false);
    } catch (error) {
      setHasSelectedTemplate(false);
      console.error('Failed to select template:', error);
    }
  };

  // Handle template selection modal close/cancel
  const handleSelectModalClose = () => {
    setIsSelectModalOpen(false);

    if (hasSelectedTemplate) {
      setHasSelectedTemplate(false);
      return;
    }

    // If no template was selected (reference_id is still 0), convert back to normal step
    if (isPendingReusableStep) {
      markModified(id, "Reusable step selection cancelled");

      const updatedStep: Step = {
        ...step,
      };
      delete updatedStep.reference_id;

      onStatementChange(updatedStep);
      onStatementTypeChange?.(StatementType.STEP);
    }
  };

  // Use persistent collapse state based on the component's stable ID (not index-based)
  // The 'id' prop should be stable across reorders, unlike index
  const collapseId = generateCollapseId.step(id);

  // Get current store state
  const currentStoreState = isCollapsedStore(collapseId);

  // On first mount, if we don't have a state yet, set it.
  // In read-only mode (e.g. run result overview) default to expanded so child statements are visible.
  useEffect(() => {
    const storeState = useCollapseStore.getState();
    if (!(collapseId in storeState.collapsedStates)) {
      setCollapsed(collapseId, enabled); // Default collapsed when editing, expanded when read-only
    }
  }, [collapseId, setCollapsed, enabled]);

  const isCollapsed = currentStoreState;

  // Get debug state and actions from debugContext
  const stableId = step.uid;
  // Streaming is now handled as debugStatus === 'streaming'

  // Debug actions from debugContext
  const onPlay =
    debugContext && isCurrentStatement
      ? () => {
          if (step.statements && step.statements.length > 0) {
            debugContext.runUntilNextSiblingOrAfterContainer(stableId).catch(console.error);
          } else {
            debugContext.step().catch(console.error);
          }
        }
      : undefined;
  const onSkipToNext = debugContext && isCurrentStatement ? () => debugContext.skipToNextStatement().catch(console.error) : undefined;
  const onSkipToStatement = debugContext && debugContext.isDebugging ? () => debugContext.skipToStatement(stableId).catch(console.error) : undefined;
  const onRollBackToStatement = debugContext && debugContext.isDebugging ? () => debugContext.rollBackToStatement(stableId).catch(console.error) : undefined;
  const onPlayUntil = debugContext
    ? () => {
        if (!debugContext.isDebugging) {
          debugContext.startDebuggingAndRunUntil(stableId).catch(console.error);
        } else {
          debugContext.runUntil(stableId).catch(console.error);
        }
      }
    : undefined;

  // Local state for selected action type (before creating action_entity)
  const [selectedActionType, setSelectedActionType] = useState<string | null>(null);
  // Handle action type change
  const handleActionTypeChange = (newType: string) => {
    console.log("🔄 ActionStatement handleActionTypeChange:", newType);

    // Handle action type changes (existing logic)
    let newActionName: string;

    // Determine the new action name based on the selected type
    if (newType === TestStepActionType.Assertion) {
      newActionName = "ai_assert";
    } else if (newType === TestStepActionType.Action) {
      newActionName = detectActionName(step.description || "", newType);
    } else if (newType === TestStepActionType.Code) {
      newActionName = "js_code";
    } else if (newType === TestStepActionType.Function) {
      newActionName = "function";
    } else {
      newActionName = "action"; // Default fallback
    }

    // If clicking the same type that's already selected, deselect it
    if (selectedActionType === newActionName) {
      setSelectedActionType(null);
      return;
    }

    // Special handling for function type - don't create action_entity immediately
    // Wait for user to select a function, similar to code actions
    if (newType === TestStepActionType.Function) {
      setSelectedActionType(newActionName);
      // Don't create action_entity yet - wait for function selection
      return;
    }

    // For other types, set the selected type locally (don't create action_entity yet)
    setSelectedActionType(newActionName);
  };

  // Auto-expand when debugging and a child statement is current
  useEffect(() => {
    if (debugContext && debugContext.isDebugging && debugContext.currentStatementId) {
      // Check if any child statement is current
      const checkChildIsCurrent = (statements: Statement[], parentId: string): boolean => {
        for (const stmt of statements) {
          const stableId = stmt.uid;
          if (stableId === debugContext.currentStatementId) {
            return true;
          }
          // Check nested children
          if (stmt.type === "STEP" && stmt.statements) {
            if (checkChildIsCurrent(stmt.statements, stableId)) return true;
          }
          if (stmt.type === "IF_ELSE") {
            if (stmt.then && checkChildIsCurrent(stmt.then, stableId)) return true;
            if (stmt.else && checkChildIsCurrent(stmt.else, stableId)) return true;
          }
          if (stmt.type === "WHILE_LOOP" && stmt.body) {
            if (checkChildIsCurrent(stmt.body, stableId)) return true;
          }
        }
        return false;
      };

      const myStableId = id || `statement-${level}-${index}`;
      if (step.statements && checkChildIsCurrent(step.statements, myStableId)) {
        console.log("🔧 StepStatement auto-expanding for current child:", debugContext.currentStatementId);
        setCollapsed(collapseId, false);
      }
    }
  }, [
    debugContext,
    debugContext?.currentStatementId,
    debugContext?.isDebugging,
    step.statements,
    id,
    level,
    index,
    collapseId,
    setCollapsed,
  ]);

  // Check if the entire statement should be disabled (debug) or display-only
  const isStatementDisabled = shouldDisableStatement(debugContext || null, debugStatus);
  const isDisabled = isStatementDisabled || !enabled;

  // AI Toggle Logic for GROUP ↔ ai_group conversion
  const handleAIToggle = () => {
    markModified(id, "AI mode toggled");

    // Convert GROUP to ACTION with ai_step type
    // Keep description, discard nested statements
    if (onStatementTypeChange) {
      onStatementTypeChange(StatementType.ACTION, TestStepActionType.AiStep);
    }
  };

  // GROUP is always "non-AI" (container), ai_group would be an ACTION
  const isCurrentlyAI = false;
  const shouldShowAIToggle = !step.statements || step.statements.length === 0; // Always show toggle for GROUP statements

  // Create the AI toggle component
  const aiToggleComponent = shouldShowAIToggle ? (
    <AIToggleSwitch
      checked={isCurrentlyAI}
      onChange={handleAIToggle}
      onIcon={<IconRobot size={12} stroke={2.5} color="#fff" />}
      offIcon={<IconList size={12} stroke={2} color="var(--mantine-color-gray-6)" />}
      onTooltip="AI Group: Natural language description"
      offTooltip="Group Container: Contains nested statements"
      disabled={isDisabled}
    />
  ) : undefined;

  // Handle clearing all statements in the step
  const handleClearStatements = () => {
    markModified(id, "Step statements cleared");
    const updatedStatement: Statement = {
      ...step,
      statements: [],
    };
    onStatementChange(updatedStatement);
  };

  // Create additional menu groups for Step-specific actions
  const additionalMenuGroups: MenuGroup[] = [];

  const stepClearAction = {
    id: "clear",
    label: t("stepStatement.clearAll"),
    icon: <IconClearAll size={14} />,
    tooltip: t("stepStatement.clearAllTooltip"),
    onClick: handleClearStatements,
    instructionComponent: (
      <div className="space-y-2">
        <div className="text-sm">
          <ul className="mt-1 ml-3 list-disc space-y-1">
            <li>{t("stepStatement.clearAllItem1")}</li>
            <li>{t("stepStatement.clearAllItem2")}</li>
          </ul>
        </div>
      </div>
    ),
  };

  const saveAsTemplateAction = {
    id: "save-as-template",
    label: t("saveTemplate.title"),
    icon: <IconRecycle size={14} />,
    tooltip: t("stepStatement.saveAsTemplateTooltip"),
    onClick: () => setIsSaveModalOpen(true),
    instructionComponent: (
      <div className="space-y-2">
        <div className="text-sm">
          <ul className="mt-1 ml-3 list-disc space-y-1">
            <li>{t("stepStatement.saveAsTemplateItem1")}</li>
            <li>{t("stepStatement.saveAsTemplateItem2")}</li>
            <li>{t("stepStatement.saveAsTemplateItem3")}</li>
          </ul>
        </div>
      </div>
    ),
  };

  // Build actions array for Step Actions menu
  const stepActions = [];
  if (!isReusableStep && step.statements && step.statements.length > 0 && !isCurrentlyAI) {
    stepActions.push(stepClearAction);
  }
  // Add "Save as Template" for all normal groups (even empty ones)
  if (!isReusableStep && !isCurrentlyAI && !isInsideReusableGroup) {
    stepActions.push(saveAsTemplateAction);
  }

  // Add Step Actions menu if there are any actions (and editable)
  if (enabled && stepActions.length > 0) {
    additionalMenuGroups.push({
      id: "step-actions",
      label: t("stepStatement.groupActions"),
      actions: stepActions,
    });
  }

  const renderExtraActions = () => {
    if (!enabled) return undefined;
    if (!isReusableStep && step.statements && step.statements.length > 0) {
      return (
        <Tooltip multiline maw={300} label={stepClearAction.tooltip}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClearStatements();
            }}
            className="p-1 rounded hover:bg-surface-active transition-colors"
          >
            {stepClearAction.icon}
          </button>
        </Tooltip>
      );
    }

    return undefined;
  };

  // Get reusable step name for display
  const reusableStepName = useMemo(() => {
    if (step.template_path) {
      return step.template_path;
    }
    if (isResolvedReusableStep && step.reference_id) {
      const template = getReusableStepById(step.reference_id);
      return template?.name || null;
    }
    return null;
  }, [step.template_path, isResolvedReusableStep, step.reference_id, getReusableStepById]);

  return (
    <div>
      {/* Group Description - Outside the bordered container */}
      <StatementWrapper
        id={id || `statement-${level}-${index}`}
        index={index}
        statement={statement}
        badgeLabel={
          isReusableStep
            ? reusableStepName ? `Template: ${reusableStepName}` : "TEMPLATE"
            : "GROUP"
        }
        badgeIcon={<IconFolders size={14} />}
        badgeColor={isReusableStep ? "bg-sky-600" : "bg-blue-600"}
        modified={isModified}
        onStatementTypeChange={onStatementTypeChange}
        onSkipToNext={onSkipToNext}
        onSkipToStatement={onSkipToStatement}
        onRollBackToStatement={onRollBackToStatement}
        // AI Toggle component
        aiToggleComponent={aiToggleComponent}
        extraActions={renderExtraActions()}
        onEdit={onEdit}
        onDelete={onDelete}
        onPlay={onPlay}
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
        {/* Description Field with collapse button */}
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <MultilineTextInput
              value={step.description || ""}
              onChange={handleDescriptionChange}
              placeholder={isReusableStep ? "Template description" : "Enter group description..."}
              emptyText={isReusableStep ? "Click to add description" : "Click to add description"}
              disabled={isDisabled}
            />
          </div>
          <div className="flex items-center gap-1 pt-2">
            <Tooltip label={`${isCollapsed ? "Expand" : "Collapse"} nested statements`}>
              <ActionIcon size="sm" variant="subtle" onClick={() => toggleCollapsed(collapseId)}>
                {isCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
              </ActionIcon>
            </Tooltip>
            {/* <div className="text-xs text-gray-400">
              {step.statements.length}
            </div> */}
          </div>
        </div>
      </StatementWrapper>

      {/* Nested Statements - Inside their own container with vertical line */}
      <Collapse in={!isCollapsed}>
        <StatementList
          statements={step.statements}
          onStatementsChange={handleStatementsChange}
          level={level + 1}
          parentId={id || `statement-${level}-${index}`}
          containerType="step"
          debugContext={debugContext}
          isReusableGroup={isReusableContext}
        />
      </Collapse>

      {/* Modals */}
      <SaveReusableStepModal
        open={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={handleSaveAsTemplate}
      />

      <SelectReusableStepModal
        open={isSelectModalOpen}
        onClose={handleSelectModalClose}
        onSelect={handleTemplateSelect}
        disableLink={isInsideReusableGroup}
      />
    </div>
  );
};
