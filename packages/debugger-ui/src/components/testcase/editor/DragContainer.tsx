import React, { useState, useMemo, createContext, useContext } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable';
import type {
  Statement,
  Step,
  Action,
  IfElse,
  WhileLoop
} from 'shiplight-types';
import { StatementType } from 'shiplight-types';
import { HoverProvider } from './StatementWrapper';
import { StatementBadge } from './StatementBadge';
import { getActionIcon, getBadgeColorForActionType, getDisplayActionName } from '../utils/actionIconUtils';
import { autoCollapseStatementChildren } from './utils/collapseUtils';
import { IconGitBranch, IconRepeat, IconList, IconRotate, IconSquareDot, IconFolders } from '@tabler/icons-react';

// Simple tree structure for cross-container dragging
// For root-level statements, parentId is 'main' or 'teardown' to distinguish sections
interface FlatStatement {
  id: string;
  statement: Statement;
  parentId: string;  // 'main' or 'teardown' for root-level, or statement uid for nested
  containerType: 'root' | 'step' | 'then' | 'else' | 'body';
  sortIndex: number;
}

interface TreeDragContextType {
  flatStatements: FlatStatement[];
  activeStatement: FlatStatement | null;
  isEnabled: boolean;
  overId: string | null;
}

export const TreeDragContext = createContext<TreeDragContextType | null>(null);

// Flatten nested statements into a single sortable array
// For root-level statements, parentId should be 'main' or 'teardown'
const flattenStatementsToTree = (
  statements: Statement[],
  parentId: string = 'main',
  containerType: 'root' | 'step' | 'then' | 'else' | 'body' = 'root'
): FlatStatement[] => {
  const result: FlatStatement[] = [];

  statements.forEach((statement, index) => {
    // Add current statement
    result.push({
      id: statement.uid,
      statement,
      parentId,
      containerType,
      sortIndex: index
    });

    // Add nested statements
    switch (statement.type) {
      case StatementType.STEP:
        result.push(...flattenStatementsToTree(
          (statement as Step).statements,
          statement.uid,
          'step'
        ));
        break;
      case StatementType.IF_ELSE:
        const ifElse = statement as IfElse;
        result.push(...flattenStatementsToTree(ifElse.then, statement.uid, 'then'));
        if (ifElse.else) {
          result.push(...flattenStatementsToTree(ifElse.else, statement.uid, 'else'));
        }
        break;
      case StatementType.WHILE_LOOP:
        result.push(...flattenStatementsToTree(
          (statement as WhileLoop).body,
          statement.uid,
          'body'
        ));
        break;
    }
  });

  return result;
};

// Parse drop indicator ID to get insertion info
// Format: "drop-{parentId}-{containerType}-{position}-{index}"
// parentId is 'main' or 'teardown' for root-level, or a statement uid for nested
const parseDropIndicatorId = (id: string) => {
  const parts = id.split('-');
  if (parts[0] !== 'drop') return null;

  // Extract the last 3 parts: containerType, position, index
  const containerType = parts[parts.length - 3] as 'root' | 'step' | 'then' | 'else' | 'body';
  const position = parts[parts.length - 2] as 'before' | 'after' | 'inside';
  const index = parseInt(parts[parts.length - 1]);

  // Everything between 'drop' and the last 3 parts is the parentId
  const parentId = parts.slice(1, -3).join('-');

  return { parentId, containerType, position, index };
};

// Rebuild nested structure from flat array, returning both main and teardown arrays
// Root-level statements have parentId 'main' or 'teardown'
const rebuildTreeFromFlat = (flatStatements: FlatStatement[]): { main: Statement[], teardown: Statement[] } => {
  const buildSection = (sectionParentId: 'main' | 'teardown'): Statement[] => {
    return flatStatements
      .filter(item => item.parentId === sectionParentId)
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map(item => {
        const statement = { ...item.statement };

        // Rebuild nested content for each statement type
        switch (statement.type) {
          case StatementType.STEP:
            const stepChildren = flatStatements
              .filter(child => child.parentId === item.id && child.containerType === 'step')
              .sort((a, b) => a.sortIndex - b.sortIndex);
            (statement as Step).statements = rebuildNestedStatements(stepChildren, flatStatements);
            break;

          case StatementType.IF_ELSE:
            const thenChildren = flatStatements
              .filter(child => child.parentId === item.id && child.containerType === 'then')
              .sort((a, b) => a.sortIndex - b.sortIndex);
            const elseChildren = flatStatements
              .filter(child => child.parentId === item.id && child.containerType === 'else')
              .sort((a, b) => a.sortIndex - b.sortIndex);

            (statement as IfElse).then = rebuildNestedStatements(thenChildren, flatStatements);
            if (elseChildren.length > 0) {
              (statement as IfElse).else = rebuildNestedStatements(elseChildren, flatStatements);
            }
            break;

          case StatementType.WHILE_LOOP:
            const bodyChildren = flatStatements
              .filter(child => child.parentId === item.id && child.containerType === 'body')
              .sort((a, b) => a.sortIndex - b.sortIndex);
            (statement as WhileLoop).body = rebuildNestedStatements(bodyChildren, flatStatements);
            break;
        }

        return statement;
      });
  };

  return {
    main: buildSection('main'),
    teardown: buildSection('teardown')
  };
};

// Helper to rebuild nested statements recursively
const rebuildNestedStatements = (children: FlatStatement[], allFlat: FlatStatement[]): Statement[] => {
  return children.map(child => {
    const statement = { ...child.statement };

    // Recursively rebuild children of this statement
    switch (statement.type) {
      case StatementType.STEP:
        const stepChildren = allFlat
          .filter(item => item.parentId === child.id && item.containerType === 'step')
          .sort((a, b) => a.sortIndex - b.sortIndex);
        (statement as Step).statements = rebuildNestedStatements(stepChildren, allFlat);
        break;

      case StatementType.IF_ELSE:
        const thenChildren = allFlat
          .filter(item => item.parentId === child.id && item.containerType === 'then')
          .sort((a, b) => a.sortIndex - b.sortIndex);
        const elseChildren = allFlat
          .filter(item => item.parentId === child.id && item.containerType === 'else')
          .sort((a, b) => a.sortIndex - b.sortIndex);

        (statement as IfElse).then = rebuildNestedStatements(thenChildren, allFlat);
        if (elseChildren.length > 0) {
          (statement as IfElse).else = rebuildNestedStatements(elseChildren, allFlat);
        }
        break;

      case StatementType.WHILE_LOOP:
        const bodyChildren = allFlat
          .filter(item => item.parentId === child.id && item.containerType === 'body')
          .sort((a, b) => a.sortIndex - b.sortIndex);
        (statement as WhileLoop).body = rebuildNestedStatements(bodyChildren, allFlat);
        break;
    }

    return statement;
  });
};

interface DragContainerProps {
  statements: Statement[];
  onStatementsChange: (statements: Statement[]) => void;
  // Optional teardown support for cross-section dragging
  teardownStatements?: Statement[];
  onTeardownStatementsChange?: (statements: Statement[]) => void;
  // Combined callback for cross-section moves (avoids race conditions)
  onBothSectionsChange?: (main: Statement[], teardown: Statement[]) => void;
  enabled: boolean;
  children: React.ReactNode;
}

export const DragContainer: React.FC<DragContainerProps> = ({
  statements,
  onStatementsChange,
  teardownStatements,
  onTeardownStatementsChange,
  onBothSectionsChange,
  enabled,
  children
}) => {
  const [activeStatement, setActiveStatement] = useState<FlatStatement | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10, // Slightly higher to prevent accidental drags
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    })
  );

  // Generate flat structure for tree-wide dragging (includes both main and teardown)
  const { flatStatements, statementIds } = useMemo(() => {
    if (enabled) {
      const mainFlat = flattenStatementsToTree(statements, 'main', 'root');
      const teardownFlat = teardownStatements
        ? flattenStatementsToTree(teardownStatements, 'teardown', 'root')
        : [];
      const flat = [...mainFlat, ...teardownFlat];
      return {
        flatStatements: flat,
        statementIds: flat.map(item => item.id)
      };
    } else {
      return {
        flatStatements: [],
        statementIds: []
      };
    }
  }, [statements, teardownStatements, enabled]);

  const handleDropIndicatorMove = (activeId: string, dropIndicatorId: string) => {
    const dropInfo = parseDropIndicatorId(dropIndicatorId);
    if (!dropInfo) return;

    const activeIndex = flatStatements.findIndex(item => item.id === activeId);
    if (activeIndex === -1) return;

    const activeItem = flatStatements[activeIndex];
    const { parentId, containerType, position, index } = dropInfo;

    // Create updated flat statements
    const updatedFlat = [...flatStatements];
    const movedItem = { ...activeItem };

    // Remove from original position
    updatedFlat.splice(activeIndex, 1);

    // Update item's container info
    movedItem.parentId = parentId;
    movedItem.containerType = containerType;

    // Calculate insertion index
    let insertIndex = index;
    if (position === 'after') {
      insertIndex = index + 1;
    }

    // Adjust insertion index if we're moving within the same container
    // and the original position was before the target position
    if (activeItem.parentId === parentId &&
        activeItem.containerType === containerType &&
        activeItem.sortIndex < insertIndex) {
      // Since we removed the item, indices shifted down by 1
      insertIndex -= 1;
    }

    // Find the actual insertion position in the flat array
    const containerItems = updatedFlat.filter(item =>
      item.parentId === parentId && item.containerType === containerType
    );

    if (insertIndex >= containerItems.length) {
      // Insert at end of container
      const lastContainerItemIndex = containerItems.length > 0
        ? updatedFlat.findIndex(item => item.id === containerItems[containerItems.length - 1].id)
        : -1;

      if (lastContainerItemIndex >= 0) {
        updatedFlat.splice(lastContainerItemIndex + 1, 0, movedItem);
      } else {
        // Empty container, just add it
        updatedFlat.push(movedItem);
      }
    } else {
      // Insert before specific item
      const targetItem = containerItems[insertIndex];
      const targetIndex = updatedFlat.findIndex(item => item.id === targetItem.id);
      updatedFlat.splice(targetIndex, 0, movedItem);
    }

    // Recalculate sort indices for affected containers
    const affectedContainers = new Set([
      `${activeItem.parentId}-${activeItem.containerType}`,
      `${parentId}-${containerType}`
    ]);

    affectedContainers.forEach(containerKey => {
      const parts = containerKey.split('-');
      const cContainerType = parts[parts.length - 1];
      const cParentId = parts.slice(0, -1).join('-');
      const items = updatedFlat.filter(item =>
        item.parentId === cParentId && item.containerType === cContainerType
      );

      items.forEach((item, idx) => {
        item.sortIndex = idx;
      });
    });

    // Rebuild tree and update both sections
    const { main, teardown } = rebuildTreeFromFlat(updatedFlat);

    // Use combined callback if available (avoids race conditions for cross-section moves)
    if (onBothSectionsChange) {
      onBothSectionsChange(main, teardown);
    } else {
      onStatementsChange(main);
      if (onTeardownStatementsChange) {
        onTeardownStatementsChange(teardown);
      }
    }
  };

  const handleTreeMove = (activeId: string, overId: string) => {
    // Check if dropping on a drop indicator
    if (overId.startsWith('drop-')) {
      handleDropIndicatorMove(activeId, overId);
      return;
    }

    const activeIndex = flatStatements.findIndex(item => item.id === activeId);
    const overIndex = flatStatements.findIndex(item => item.id === overId);

    if (activeIndex === -1 || overIndex === -1) return;

    // Simple reorder in flat array
    const reorderedFlat = arrayMove(flatStatements, activeIndex, overIndex);

    // Update sort indices
    const activeItem = reorderedFlat[overIndex];
    const overItem = flatStatements[overIndex];
    const originalParentId = activeItem.parentId;

    // If moving to different container, update parentId and containerType
    if (activeItem.parentId !== overItem.parentId ||
        activeItem.containerType !== overItem.containerType) {
      activeItem.parentId = overItem.parentId;
      activeItem.containerType = overItem.containerType;
    }

    // Recalculate sort indices for affected containers
    const affectedContainers = new Set([
      `${originalParentId}-${activeItem.containerType}`,
      `${overItem.parentId}-${overItem.containerType}`
    ]);

    affectedContainers.forEach(containerKey => {
      const containerItems = reorderedFlat
        .filter(item =>
          `${item.parentId}-${item.containerType}` === containerKey
        )
        .sort((a, b) => reorderedFlat.indexOf(a) - reorderedFlat.indexOf(b));

      containerItems.forEach((item, index) => {
        item.sortIndex = index;
      });
    });

    // Rebuild tree and update both sections
    const { main, teardown } = rebuildTreeFromFlat(reorderedFlat);

    // Use combined callback if available (avoids race conditions for cross-section moves)
    if (onBothSectionsChange) {
      onBothSectionsChange(main, teardown);
    } else {
      onStatementsChange(main);
      if (onTeardownStatementsChange) {
        onTeardownStatementsChange(teardown);
      }
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (enabled) {
      try {
        const activeItem = flatStatements.find(item => item.id === event.active.id);
        setActiveStatement(activeItem || null);
        
        // Auto-collapse children when starting to drag a node with sub-nodes
        if (activeItem?.statement) {
          const statement = activeItem.statement;
          const hasChildren = (
            (statement.type === StatementType.STEP && (statement as Step).statements.length > 0) ||
            (statement.type === StatementType.IF_ELSE && ((statement as IfElse).then.length > 0 || ((statement as IfElse).else && (statement as IfElse).else!.length > 0))) ||
            (statement.type === StatementType.WHILE_LOOP && (statement as WhileLoop).body.length > 0)
          );
          
          if (hasChildren) {
            console.log('🔽 Auto-collapsing children of dragged statement:', statement.uid);
            autoCollapseStatementChildren(statement);
          }
        }
      } catch (error) {
        console.error('Error in handleDragStart:', error);
        setActiveStatement(null);
      }
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    try {
    // Only update if overId actually changed to reduce re-renders
    const newOverId = event.over?.id as string || null;
    if (newOverId !== overId) {
      setOverId(newOverId);
      }
    } catch (error) {
      console.error('Error in handleDragOver:', error);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    try {
    setActiveStatement(null);
    setOverId(null);

    if (enabled) {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      handleTreeMove(active.id as string, over.id as string);
      }
    } catch (error) {
      console.error('Error in handleDragEnd:', error);
      setActiveStatement(null);
      setOverId(null);
    }
  };

  const contextValue: TreeDragContextType = {
    flatStatements,
    activeStatement,
    isEnabled: enabled,
    overId
  };

  if (!enabled) {
    return (
      <HoverProvider>
        <TreeDragContext.Provider value={contextValue}>
          {children}
        </TreeDragContext.Provider>
      </HoverProvider>
    );
  }

  return (
    <HoverProvider>
      <TreeDragContext.Provider value={contextValue}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          autoScroll={{ threshold: { x: 0.2, y: 0.2 } }}
        >
          {children}
          {/* Drag overlay for better visual feedback */}
          <DragOverlay
            dropAnimation={null}
            zIndex={1000}
          >
            {activeStatement && activeStatement.statement ? (
              <div
                className="shadow-2xl border-2 border-blue-300 rounded-md p-3 opacity-95 min-w-64 max-w-96"
                style={{
                  cursor: 'grabbing',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  {(() => {
                    const statement = activeStatement.statement;
                    if (statement.type === StatementType.ACTION) {
                      const action = statement as Action;
                      const actionName = action.action_entity?.action_data?.action_name || 'action';
                      return (
                        <StatementBadge
                          label={getDisplayActionName(actionName, action.description, action.action_entity)}
                          icon={getActionIcon(actionName, action.description)}
                          color={getBadgeColorForActionType(actionName)}
                        />
                      );
                    } else if (statement.type === StatementType.STEP) {
                      return (
                        <StatementBadge
                          label="GROUP"
                          icon={<IconFolders size={14} />}
                          color="bg-blue-600"
                        />
                      );
                    } else if (statement.type === StatementType.IF_ELSE) {
                      return (
                        <StatementBadge
                          label="IF"
                          icon={<IconGitBranch size={12} />}
                          color="bg-emerald-600"
                        />
                      );
                    } else if (statement.type === StatementType.WHILE_LOOP) {
                      return (
                        <StatementBadge
                          label="WHILE"
                          icon={<IconRotate size={12} />}
                          color="bg-orange-600"
                        />
                      );
                    }
                    return (
                      <StatementBadge
                        label="STATEMENT"
                        icon={<IconSquareDot size={14} />}
                        color="bg-gray-500"
                      />
                    );
                  })()}
                </div>
                <div className="text-sm text-gray-700 font-medium line-clamp-2">
                  {(() => {
                    try {
                      if (activeStatement.statement.type === StatementType.ACTION) {
                        return (activeStatement.statement as Action).description || 'Untitled action';
                      } else if (activeStatement.statement.type === StatementType.IF_ELSE) {
                        const ifElse = activeStatement.statement as IfElse;
                        return ifElse.condition?.expression || 'Untitled IF/ELSE';
                      } else if (activeStatement.statement.type === StatementType.WHILE_LOOP) {
                        const whileLoop = activeStatement.statement as WhileLoop;
                        return whileLoop.condition?.expression || 'Untitled WHILE';
                      } else {
                        return (activeStatement.statement as any).description || 'Untitled statement';
                      }
                    } catch (error) {
                      console.warn('Error rendering drag overlay content:', error);
                      return 'Statement';
                    }
                  })()}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </TreeDragContext.Provider>
    </HoverProvider>
  );
};

// Hook for components to check if they're in a drag context
export const useTreeDrag = () => {
  return useContext(TreeDragContext);
};