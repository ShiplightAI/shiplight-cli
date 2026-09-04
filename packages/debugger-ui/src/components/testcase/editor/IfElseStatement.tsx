import React, { useEffect } from "react";
import { ActionIcon, Tooltip, Collapse } from "@mantine/core";
import { useTranslations } from "next-intl";
import { IconGitBranch, IconChevronDown, IconChevronUp, IconPlus, IconMinus, IconClearAll } from "@tabler/icons-react";
import { IfElse, Statement, type Condition, StatementType, ConditionType } from "shiplight-types";
import { TestStepActionType } from "@/common/constants";
import { generateUid } from "@/common/steps_json/conversionUtils";
import { StatementList } from "./StatementList";
import { StatementWrapper, type MenuGroup } from "./StatementWrapper";
import { MultilineTextInput } from "../../common/MultilineTextInput";
import { detectAIMode, isValidJavaScript } from "../../../utils/aiDetectionUtils";
import { IconRobot, IconCode } from "@tabler/icons-react";
import { useCollapseStore } from "../../../stores/collapseStore";
import type { ExecutionStatus, DebuggerContextType } from "../types/debugger";
import { shouldDisableStatement } from "../utils/editingUtils";
import { useEditor } from "./contexts/EditorContext";
import { generateCollapseId, autoExpandElseBranch } from "./utils/collapseUtils";
import { AIToggleSwitch } from "./AIToggleSwitch";

interface IfElseStatementProps {
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

export const IfElseStatement: React.FC<IfElseStatementProps> = ({
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
  // Cast statement to IfElse type and extract properties
  const ifElse = statement as IfElse;
  const id = statement.uid;
  const { isCollapsed: isCollapsedStore, toggleCollapsed, setCollapsed } = useCollapseStore();
  const { markModified, modifiedStatements } = useEditor();
  const t = useTranslations('TestCases');

  // Check if this statement is modified
  const isModified = modifiedStatements.has(id);

  // Calculate debug state internally
  const debugStatus = derivedDebugStatus || debugContext?.getStatementStatus(id);
  const isCurrentStatement = debugContext?.currentStatementId === id;
  const debugDetails = debugContext?.getStatementDetails(id);

  // Handler functions for statement updates
  const handleConditionChange = (newCondition: Condition) => {
    markModified(id, "Condition changed");
    const updatedStatement: Statement = {
      ...ifElse,
      condition: newCondition,
    };
    onStatementChange(updatedStatement);
  };

  const handleThenStatementsChange = (newStatements: Statement[]) => {
    markModified(id, "Then statements changed");
    const updatedStatement: Statement = {
      ...ifElse,
      then: newStatements,
    };
    onStatementChange(updatedStatement);
  };

  const handleElseStatementsChange = (newStatements: Statement[]) => {
    markModified(id, "Else statements changed");
    const updatedStatement: Statement = {
      ...ifElse,
      else: newStatements,
    };
    onStatementChange(updatedStatement);
  };

  const handleAddElseBranch = () => {
    markModified(id, "Else branch added");
    const updatedStatement: Statement = {
      ...ifElse,
      else: [
        {
          uid: generateUid(),
          type: StatementType.ACTION,
          description: "",
          action_entity: undefined,
        },
      ],
    };
    onStatementChange(updatedStatement);

    // Auto-expand the newly created else branch
    autoExpandElseBranch(id);
  };

  const handleRemoveElseBranch = () => {
    markModified(id, "Else branch removed");
    const updatedStatement: Statement = {
      ...ifElse,
      else: undefined,
    };
    onStatementChange(updatedStatement);
  };

  // Use persistent collapse state based on the component's stable ID (not index-based)
  const thenCollapseId = generateCollapseId.ifElseThen(id);
  const elseCollapseId = generateCollapseId.ifElseElse(id);

  // Initialize states in store if they don't exist.
  // In read-only mode default to expanded so child statements are visible.
  useEffect(() => {
    const storeState = useCollapseStore.getState();
    if (!(thenCollapseId in storeState.collapsedStates)) {
      setCollapsed(thenCollapseId, enabled);
    }
    if (!(elseCollapseId in storeState.collapsedStates)) {
      setCollapsed(elseCollapseId, enabled);
    }
  }, [thenCollapseId, elseCollapseId, setCollapsed, enabled]);

  // Use store states directly
  const isThenCollapsed = isCollapsedStore(thenCollapseId);
  const isElseCollapsed = isCollapsedStore(elseCollapseId);

  const hasElseBranch = ifElse.else !== undefined;

  // Get debug state and actions from debugContext
  const stableId = ifElse.uid;
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

  // Auto-expand when debugging and a child statement is current
  useEffect(() => {
    if (debugContext && debugContext.isDebugging && debugContext.currentStatementId) {
      const checkChildIsCurrent = (statements: Statement[], parentId: string, containerType: string): boolean => {
        for (const stmt of statements) {
          const stableId = stmt.uid;
          if (stableId === debugContext.currentStatementId) {
            return true;
          }
          // Check nested children
          if (stmt.type === "STEP" && stmt.statements) {
            if (checkChildIsCurrent(stmt.statements, stableId, "step")) return true;
          }
          if (stmt.type === "IF_ELSE") {
            if (stmt.then && checkChildIsCurrent(stmt.then, stableId, "then")) return true;
            if (stmt.else && checkChildIsCurrent(stmt.else, stableId, "else")) return true;
          }
          if (stmt.type === "WHILE_LOOP" && stmt.body) {
            if (checkChildIsCurrent(stmt.body, stableId, "body")) return true;
          }
        }
        return false;
      };

      const myStableId = id || `statement-${level}-${index}`;

      // Check then branch
      if (ifElse.then && checkChildIsCurrent(ifElse.then, myStableId, "then")) {
        console.log(
          "🔧 IfElseStatement auto-expanding THEN branch for current child:",
          debugContext.currentStatementId,
        );
        setCollapsed(thenCollapseId, false);
      }

      // Check else branch
      if (ifElse.else && checkChildIsCurrent(ifElse.else, myStableId, "else")) {
        console.log(
          "🔧 IfElseStatement auto-expanding ELSE branch for current child:",
          debugContext.currentStatementId,
        );
        setCollapsed(elseCollapseId, false);
      }
    }
  }, [
    debugContext,
    debugContext?.currentStatementId,
    debugContext?.isDebugging,
    ifElse.then,
    ifElse.else,
    id,
    level,
    index,
    thenCollapseId,
    elseCollapseId,
    setCollapsed,
  ]);

  // Check if the entire statement should be disabled (debug) or display-only
  const isStatementDisabled = shouldDisableStatement(debugContext || null, debugStatus);
  const isDisabled = isStatementDisabled || !enabled;

  // AI Toggle Logic for condition
  const handleAIToggle = () => {
    markModified(id, "AI mode toggled for condition");

    const newCondition: Condition = {
      type: ifElse.condition.type === ConditionType.AI_MODE ? ConditionType.JS_CODE : ConditionType.AI_MODE,
      expression: ifElse.condition.expression,
    };

    handleConditionChange(newCondition);
  };

  const isCurrentlyAI = ifElse.condition.type === ConditionType.AI_MODE;
  const shouldShowAIToggle = true; // Always show toggle for IF/ELSE conditions

  // Calculate syntax warning for invalid JS mode conditions
  const syntaxWarning = ifElse.condition.type === ConditionType.JS_CODE &&
    ifElse.condition.expression &&
    !isValidJavaScript(ifElse.condition.expression)
    ? "Invalid JavaScript syntax in condition"
    : undefined;

  // Create the AI toggle component
  const aiToggleComponent = shouldShowAIToggle ? (
    <AIToggleSwitch
      checked={isCurrentlyAI}
      onChange={handleAIToggle}
      onIcon={<IconRobot size={12} stroke={2.5} color="#fff" />}
      offIcon={<IconCode size={12} stroke={2} color="var(--mantine-color-gray-6)" />}
      onTooltip={t('ifElseStatement.aiCondition')}
      offTooltip={t('ifElseStatement.jsCondition')}
      disabled={isDisabled}
      warningTooltip={syntaxWarning}
    />
  ) : undefined;

  // Handle clearing all statements in the then branch
  const handleClearThenStatements = () => {
    markModified(id, "Then statements cleared");
    const updatedStatement: Statement = {
      ...ifElse,
      then: [],
    };
    onStatementChange(updatedStatement);
  };

  // Create additional menu groups for IfElse-specific actions
  const additionalMenuGroups: MenuGroup[] = [];

  const ifElseClearAction = {
    id: "clear-then",
    label: t('ifElseStatement.clearThenBranch'),
    icon: <IconClearAll size={14} />,
    tooltip: t('ifElseStatement.clearThenTooltip'),
    onClick: handleClearThenStatements,
    instructionComponent: (
      <div className="space-y-2">
        <div className="text-sm">
          <ul className="mt-1 ml-3 list-disc space-y-1">
            <li>{t('ifElseStatement.clearThenItem1')}</li>
            <li>{t('ifElseStatement.clearThenItem2')}</li>
            <li>{t('ifElseStatement.clearThenItem3')}</li>
          </ul>
        </div>
      </div>
    ),
  };

  // Add Clear menu item if the then branch has statements (and editable)
  if (enabled && ifElse.then && ifElse.then.length > 0) {
    additionalMenuGroups.push({
      id: "ifelse-actions",
      label: t('ifElseStatement.ifElseActions'),
      actions: [ifElseClearAction],
    });
  }

  return (
    <div>
      {/* IF Condition - Outside the bordered container */}
      <StatementWrapper
        id={id || `statement-${level}-${index}`}
        index={index}
        statement={statement}
        badgeLabel="IF"
        badgeIcon={<IconGitBranch size={14} />}
        badgeColor="bg-emerald-600"
        modified={isModified}
        onStatementTypeChange={onStatementTypeChange}
        onSkipToNext={onSkipToNext}
        onSkipToStatement={onSkipToStatement}
        onRollBackToStatement={onRollBackToStatement}
        // AI Toggle component
        aiToggleComponent={aiToggleComponent}
        extraActions={
          enabled && ifElse.then && ifElse.then.length > 0 ? (
            <Tooltip multiline maw={300} label={ifElseClearAction.tooltip}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearThenStatements();
                }}
                className="p-1 rounded hover:bg-surface-active transition-colors"
              >
                {ifElseClearAction.icon}
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
        <div>
          <MultilineTextInput
            value={ifElse.condition.expression}
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
            placeholder={t('ifElseStatement.conditionPlaceholder')}
            emptyText={isDisabled ? "Disabled" : t('ifElseStatement.clickToAddCondition')}
            disabled={isDisabled}
          />
        </div>
      </StatementWrapper>

      {/* Then Branch - Inside its own container with vertical line */}
      <div className="mb-1">
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-xs text-gray-500">{t('ifElseStatement.then')}</div>
          <div className="flex items-center gap-1">
            <Tooltip label={isThenCollapsed ? t('ifElseStatement.expandThen') : t('ifElseStatement.collapseThen')}>
              <ActionIcon size="sm" variant="subtle" onClick={() => toggleCollapsed(thenCollapseId)}>
                {isThenCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
              </ActionIcon>
            </Tooltip>
            {/* <div className="text-xs text-gray-400">
              {ifElse.then.length}
            </div> */}
          </div>
        </div>

        <Collapse in={!isThenCollapsed}>
          <StatementList
            statements={ifElse.then}
            onStatementsChange={handleThenStatementsChange}
            level={level + 1}
            parentId={id || `statement-${level}-${index}`}
            containerType="then"
            debugContext={debugContext}
            isReusableGroup={isInsideReusableGroup}
          />
        </Collapse>
      </div>

      {/* Else Branch - Inside its own container with vertical line */}
      <div className="mb-1">
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-xs text-gray-500">{t('ifElseStatement.else')}</div>
          <div className="flex items-center gap-1">
            {hasElseBranch ? (
              <>
                <Tooltip label={isElseCollapsed ? t('ifElseStatement.expandElse') : t('ifElseStatement.collapseElse')}>
                  <ActionIcon size="sm" variant="subtle" onClick={() => toggleCollapsed(elseCollapseId)}>
                    {isElseCollapsed ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
                  </ActionIcon>
                </Tooltip>
                {/* <div className="text-xs text-gray-400">
                  {ifElse.else?.length || 0}
                </div> */}
                {enabled && (
                  <Tooltip label={t('ifElseStatement.removeElseBranch')}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={handleRemoveElseBranch}
                      className="ml-1"
                      style={{ color: "#f87171" }}
                      styles={{
                        root: {
                          "&:hover": {
                            color: "#dc2626",
                          },
                        },
                      }}
                    >
                      <IconMinus size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </>
            ) : (
              enabled && (
                <Tooltip label={t('ifElseStatement.addElseBranch')}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={handleAddElseBranch}
                    style={{ color: "#4ade80" }}
                    styles={{
                      root: {
                        "&:hover": {
                          color: "#16a34a",
                        },
                      },
                    }}
                  >
                    <IconPlus size={16} />
                  </ActionIcon>
                </Tooltip>
              )
            )}
          </div>
        </div>

        {hasElseBranch && (
          <Collapse in={!isElseCollapsed}>
            <StatementList
              statements={ifElse.else || []}
              onStatementsChange={handleElseStatementsChange}
              level={level + 1}
              parentId={id || `statement-${level}-${index}`}
              containerType="else"
              debugContext={debugContext}
              isReusableGroup={isInsideReusableGroup}
            />
          </Collapse>
        )}
      </div>
    </div>
  );
};
