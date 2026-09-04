import { TestStepActionType } from "@/common/constants";
import { useTranslations } from "next-intl";
import {
  ConditionType,
  DEFAULT_WHILE_LOOP_TIMEOUT_MS,
  Statement,
  StatementType,
  WhileLoop,
  type Condition,
} from "shiplight-types";
import { ActionIcon, Collapse, Tooltip } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconClearAll, IconCode, IconRobot, IconRotate } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useCollapseStore } from "../../../stores/collapseStore";
import { detectAIMode, isValidJavaScript } from "../../../utils/aiDetectionUtils";
import { MultilineTextInput } from "../../common/MultilineTextInput";
import type { DebuggerContextType, ExecutionStatus } from "../types/debugger";
import { detectActionName } from "../utils/actionIconUtils";
import { shouldDisableStatement } from "../utils/editingUtils";
import { AIToggleSwitch } from "./AIToggleSwitch";
import { useEditor } from "./contexts/EditorContext";
import { StatementList } from "./StatementList";
import { StatementWrapper, type MenuGroup } from "./StatementWrapper";
import { generateCollapseId } from "./utils/collapseUtils";

interface WhileLoopStatementProps {
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

export const WhileLoopStatement: React.FC<WhileLoopStatementProps> = ({
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
  // Cast statement to WhileLoop type and extract properties
  const whileLoop = statement as WhileLoop;
  const id = statement.uid;
  const { isCollapsed: isCollapsedStore, toggleCollapsed, setCollapsed } = useCollapseStore();
  const { markModified, modifiedStatements } = useEditor();
  const t = useTranslations('TestCases');

  // Check if this statement is modified
  const isModified = modifiedStatements.has(id);

  // Local state for timeout input (in seconds)
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(
    whileLoop.timeout_ms ? String(whileLoop.timeout_ms / 1000) : ""
  );

  // Sync local timeout state when statement changes
  useEffect(() => {
    setTimeoutSeconds(whileLoop.timeout_ms ? String(whileLoop.timeout_ms / 1000) : "");
  }, [whileLoop.timeout_ms]);

  // Calculate debug state internally
  const debugStatus = derivedDebugStatus || debugContext?.getStatementStatus(id);
  const isCurrentStatement = debugContext?.currentStatementId === id;
  const debugDetails = debugContext?.getStatementDetails(id);

  // Handler functions for statement updates
  const handleConditionChange = (newCondition: Condition) => {
    markModified(id, "Condition changed");
    const updatedStatement: Statement = {
      ...whileLoop,
      condition: newCondition,
    };
    onStatementChange(updatedStatement);
  };

  const handleBodyStatementsChange = (newStatements: Statement[]) => {
    markModified(id, "Body statements changed");
    const updatedStatement: Statement = {
      ...whileLoop,
      body: newStatements,
    };
    onStatementChange(updatedStatement);
  };

  const handleTimeoutInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    // Allow only numbers
    if (/^\d*$/.test(value)) {
      setTimeoutSeconds(value);
    }
  };

  const handleTimeoutBlur = () => {
    const timeout = parseInt(timeoutSeconds);
    if (!isNaN(timeout) && timeout > 0) {
      setTimeoutSeconds(String(timeout)); // Normalize the value
      markModified(id, "Timeout changed");
      const updatedStatement: WhileLoop = {
        ...whileLoop,
        timeout_ms: timeout * 1000, // Convert to milliseconds
      };
      onStatementChange(updatedStatement as Statement);
    } else if (timeoutSeconds === "") {
      // If empty, set to undefined (use default)
      markModified(id, "Timeout cleared");
      const updatedStatement: WhileLoop = {
        ...whileLoop,
        timeout_ms: undefined,
      };
      onStatementChange(updatedStatement as Statement);
    }
  };

  const handleTimeoutKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
  };

  // Use persistent collapse state based on the component's stable ID (not index-based)
  const collapseId = generateCollapseId.whileLoop(id);

  // Initialize state in store if it doesn't exist.
  // In read-only mode default to expanded so child statements are visible.
  useEffect(() => {
    const storeState = useCollapseStore.getState();
    if (!(collapseId in storeState.collapsedStates)) {
      setCollapsed(collapseId, enabled);
    }
  }, [collapseId, setCollapsed, enabled]);

  // Use store state directly
  const isCollapsed = isCollapsedStore(collapseId);

  // Get debug state and actions from debugContext
  const stableId = whileLoop.uid;
  // Streaming is now handled as debugStatus === 'streaming'

  // Debug actions from debugContext
  const onPlay = debugContext && isCurrentStatement ? () => debugContext.step().catch(console.error) : undefined;
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
      newActionName = detectActionName((whileLoop as any).description || "", newType);
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
      if (whileLoop.body && checkChildIsCurrent(whileLoop.body, myStableId)) {
        console.log("🔧 WhileLoopStatement auto-expanding for current child:", debugContext.currentStatementId);
        setCollapsed(collapseId, false);
      }
    }
  }, [
    debugContext,
    debugContext?.currentStatementId,
    debugContext?.isDebugging,
    whileLoop.body,
    id,
    level,
    index,
    collapseId,
    setCollapsed,
  ]);

  // Check if the entire statement should be disabled (debug) or display-only
  const isStatementDisabled = shouldDisableStatement(debugContext || null, debugStatus);
  const isDisabled = isStatementDisabled || !enabled;

  // AI Toggle Logic for condition
  const handleAIToggle = () => {
    markModified(id, "AI mode toggled for condition");

    const newCondition: Condition = {
      type: whileLoop.condition.type === ConditionType.AI_MODE ? ConditionType.JS_CODE : ConditionType.AI_MODE,
      expression: whileLoop.condition.expression,
    };

    handleConditionChange(newCondition);
  };

  const isCurrentlyAI = whileLoop.condition.type === ConditionType.AI_MODE;
  const shouldShowAIToggle = true; // Always show toggle for WHILE conditions

  // Calculate syntax warning for invalid JS mode conditions
  const syntaxWarning = whileLoop.condition.type === ConditionType.JS_CODE &&
    whileLoop.condition.expression &&
    !isValidJavaScript(whileLoop.condition.expression)
    ? "Invalid JavaScript syntax in condition"
    : undefined;

  // Create the AI toggle component
  const aiToggleComponent = shouldShowAIToggle ? (
    <AIToggleSwitch
      checked={isCurrentlyAI}
      onChange={handleAIToggle}
      onIcon={<IconRobot size={12} stroke={2.5} color="#fff" />}
      offIcon={<IconCode size={12} stroke={2} color="var(--mantine-color-gray-6)" />}
      onTooltip={t('whileLoopStatement.aiCondition')}
      offTooltip={t('whileLoopStatement.jsCondition')}
      disabled={isDisabled}
      warningTooltip={syntaxWarning}
    />
  ) : undefined;

  // Handle clearing all statements in the loop body
  const handleClearBodyStatements = () => {
    markModified(id, "Loop body cleared");
    const updatedStatement: Statement = {
      ...whileLoop,
      body: [],
    };
    onStatementChange(updatedStatement);
  };

  // Create additional menu groups for WhileLoop-specific actions
  const additionalMenuGroups: MenuGroup[] = [];

  const whileLoopClearAction = {
    id: "clear-body",
    label: t('whileLoopStatement.clearLoopBody'),
    icon: <IconClearAll size={14} />,
    tooltip: t('whileLoopStatement.clearLoopTooltip'),
    onClick: handleClearBodyStatements,
    instructionComponent: (
      <div className="space-y-2">
        <div className="text-sm">
          <ul className="mt-1 ml-3 list-disc space-y-1">
            <li>{t('whileLoopStatement.clearBodyItem1')}</li>
            <li>{t('whileLoopStatement.clearBodyItem2')}</li>
            <li>{t('whileLoopStatement.clearBodyItem3')}</li>
          </ul>
        </div>
      </div>
    ),
  };

  // Add Clear menu item if the loop body has statements (and editable)
  if (enabled && whileLoop.body && whileLoop.body.length > 0) {
    additionalMenuGroups.push({
      id: "while-actions",
      label: t('whileLoopStatement.loopActions'),
      actions: [whileLoopClearAction],
    });
  }

  return (
    <div>
      {/* WHILE Condition - Outside the bordered container */}
      <StatementWrapper
        id={id || `statement-${level}-${index}`}
        index={index}
        statement={statement}
        badgeLabel="WHILE"
        badgeIcon={<IconRotate size={14} />}
        badgeColor="bg-orange-600"
        modified={isModified}
        onStatementTypeChange={onStatementTypeChange}
        onSkipToNext={onSkipToNext}
        onSkipToStatement={onSkipToStatement}
        onRollBackToStatement={onRollBackToStatement}
        // AI Toggle component
        aiToggleComponent={aiToggleComponent}
        extraActions={
          enabled && whileLoop.body && whileLoop.body.length > 0 ? (
            <Tooltip multiline maw={300} label={whileLoopClearAction.tooltip}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearBodyStatements();
                }}
                className="p-1 rounded hover:bg-surface-active transition-colors"
              >
                {whileLoopClearAction.icon}
              </button>
            </Tooltip>
          ) : undefined
        }
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
        {/* Condition Field */}
        <div className="space-y-2">
          <MultilineTextInput
            value={whileLoop.condition.expression}
            onChange={(newExpression: string) => {
              // Auto-detect condition type based on content, but preserve manual toggle setting
              const detectedIsAI = detectAIMode(newExpression);
              const newType = detectedIsAI ? ConditionType.AI_MODE : ConditionType.JS_CODE;

              const newCondition: Condition = {
                type: newType,
                expression: newExpression,
              };

              handleConditionChange(newCondition);
            }}
            placeholder={t('whileLoopStatement.conditionPlaceholder')}
            emptyText={isDisabled ? "Disabled" : t('whileLoopStatement.clickToAddCondition')}
            disabled={isDisabled}
          />
          
          {/* Timeout Field */}
          <div className="flex items-center gap-2 px-2">
            <input
              type="text"
              value={timeoutSeconds}
              onChange={handleTimeoutInputChange}
              onBlur={handleTimeoutBlur}
              onKeyDown={handleTimeoutKeyDown}
              placeholder={String(DEFAULT_WHILE_LOOP_TIMEOUT_MS / 1000)}
              disabled={isDisabled}
              className="w-16 px-2 py-0.5 text-[13px] text-secondary bg-transparent border border-transparent hover:border-subtle focus:border-primary focus:outline-none rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: "24px" }}
            />
            <span className="text-[13px] text-gray-500">{t('whileLoopStatement.secondsMax')}</span>
          </div>
        </div>
      </StatementWrapper>

      {/* Body - Inside its own container with vertical line */}
      <div className="mb-1">
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-xs text-gray-500">{t('whileLoopStatement.loopBody')}</div>
          <div className="flex items-center gap-1">
            <Tooltip label={isCollapsed ? t('whileLoopStatement.expandLoop') : t('whileLoopStatement.collapseLoop')}>
              <ActionIcon size="sm" variant="subtle" onClick={() => toggleCollapsed(collapseId)}>
                {isCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
              </ActionIcon>
            </Tooltip>
            {/* <div className="text-xs text-gray-400">
              {whileLoop.body.length}
            </div> */}
          </div>
        </div>

        <Collapse in={!isCollapsed}>
          <StatementList
            statements={whileLoop.body}
            onStatementsChange={handleBodyStatementsChange}
            level={level + 1}
            parentId={id || `statement-${level}-${index}`}
            containerType="body"
            debugContext={debugContext}
          isReusableGroup={isInsideReusableGroup}
          />
        </Collapse>
      </div>
    </div>
  );
};
