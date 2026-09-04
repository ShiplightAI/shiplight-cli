import React from 'react';
import type { Statement } from 'shiplight-types';
import { StatementList } from './StatementList';
import { DragContainer } from './DragContainer';
import { useEditor } from './contexts/EditorContext';

interface StatementEditorProps {
  statements: Statement[];
  onStatementsChange: (statements: Statement[]) => void;
  dndEnabled?: boolean;
  debugContext?: any; // Pass debug context from parent
  streamingCallbackId?: string; // ID for registering streaming callback
  // Parent ID for root-level statements (used for cross-section drag and drop)
  // Should be 'main' or 'teardown' for root-level editors
  rootParentId?: string;
  // Skip internal DragContainer (when already inside a parent DragContainer)
  skipDragContainer?: boolean;

  // Whether this editor is rendering inside a reusable group (template) context.
  // Used to prevent nested template links.
  isReusableGroup?: boolean;

  // UI customization
  className?: string;

  // Additional content to render above or below the statement list
  headerContent?: React.ReactNode;
  footerContent?: React.ReactNode;

  // Callback to render interstitial content between statements (e.g. removed step dividers)
  renderBetweenStatements?: (beforeUid: string | undefined, afterUid: string | undefined) => React.ReactNode;
}

export const StatementEditor: React.FC<StatementEditorProps> = ({
  statements,
  onStatementsChange,
  dndEnabled = true,
  debugContext = null,
  streamingCallbackId,
  rootParentId = 'main',
  skipDragContainer = false,
  isReusableGroup = false,
  className = "rounded-lg bg-surface",
  headerContent,
  footerContent,
  renderBetweenStatements,
}) => {
  const { enabled, displayOnly } = useEditor();

  const statementList = (
    <StatementList
      statements={statements}
      onStatementsChange={onStatementsChange}
      level={0}
      parentId={rootParentId}
      containerType="root"
      debugContext={debugContext}
      streamingCallbackId={streamingCallbackId}
      isReusableGroup={isReusableGroup}
      renderBetweenStatements={renderBetweenStatements}
    />
  );

  return (
    <div className="w-full">
      {/* Optional header content */}
      {headerContent}

      {/* Statements List */}
      <div className={className}>
        {skipDragContainer ? (
          statementList
        ) : (
          <DragContainer
            statements={statements}
            onStatementsChange={onStatementsChange}
            enabled={dndEnabled && !displayOnly}
          >
            {statementList}
          </DragContainer>
        )}
      </div>

      {/* Optional footer content */}
      {footerContent}
    </div>
  );
};