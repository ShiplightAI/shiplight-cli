import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { ActionEntity, Statement } from 'shiplight-types';
import { getAllStatementsInOrder } from 'shiplight-types';
import { autoExpandParentContainers } from '../utils/collapseUtils';
import { ActionGenerationDebugInfo } from 'shiplight-types';

/** Execution result for a single statement (e.g. from run result overview). */
export interface ExecutionStatusEntry {
  executed?: boolean;
  success?: boolean;
  failed?: boolean;
  autoHealed?: boolean;
  healedDescription?: string;
  healedAction?: ActionEntity;
  duration?: number;
  relativeStartTime?: number;
  /** Note message from step result (e.g. error/output); shown in badge tooltip when present */
  noteMessage?: string;
  /** Diff marker type for AI fix runs: 'added', 'modified', 'moved', or undefined */
  diffType?: 'added' | 'modified' | 'moved';
  /** Original description before AI fix (for 'modified' steps) */
  originalDescription?: string;
}

export interface EditorContextType {
  // Modified state tracking
  modifiedStatements: Set<string>;
  markModified: (uid: string, reason?: string) => void;
  clearModifiedStates: () => void;

  // Selection state (multi-select)
  selectedStatementIds: Set<string>;
  selectStatement: (uid: string, event?: React.MouseEvent | MouseEvent) => void;
  toggleStatementSelection: (uid: string) => void;
  selectStatements: (uids: string[]) => void;
  clearSelection: () => void;

  // Navigation
  navigateToNextStatement: () => Statement | null;
  navigateToPreviousStatement: () => Statement | null;

  // Global editing mode
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;

  // Statement click handling for image preview
  handleStatementSelection?: (statement: Statement, isDebugging: boolean) => Promise<void>;

  // Statements tree for navigation
  statements: Statement[];

  // Test case environment configuration
  defaultEnvironmentId?: number;

  // Session-only debug info (not persisted to database)
  actionGenerationDebugInfo?: Map<string, ActionGenerationDebugInfo>;

  // Run result: execution status per statement uid (for read-only tree with status)
  executionStatusByStatementUid?: Record<string, ExecutionStatusEntry>;
  statementDisplayModeByUid: Record<string, 'default' | 'original' | 'healed'>;
  setStatementDisplayMode: (uid: string, mode: 'default' | 'original' | 'healed') => void;

  // Display only: when true, all editing (drag, add, delete, edit, context menu) is disabled
  displayOnly?: boolean;

  // V2 mode: floating action bar + structured action forms
  v2: boolean;
}

const EditorContext = createContext<EditorContextType | null>(null);

export interface EditorProviderProps {
  children: ReactNode;
  enabled: boolean;
  clearModifiedStates?: boolean; // Trigger to clear modified states
  onStatementSelected?: (statement: Statement, isDebugging: boolean) => Promise<void>; // Statement click handler for image preview
  statements: Statement[]; // Statements tree for navigation
  defaultEnvironmentId?: number; // Test case environment configuration
  actionGenerationDebugInfo?: Map<string, ActionGenerationDebugInfo>; // Session-only debug info (not persisted to database)
  executionStatusByStatementUid?: Record<string, ExecutionStatusEntry>; // Run result: status per statement uid
  displayOnly?: boolean; // When true, disable all editable logic (drag, add, delete, edit)
  v2?: boolean; // V2 mode: floating action bar + structured action forms
}

export const EditorProvider: React.FC<EditorProviderProps> = ({
  children,
  enabled,
  clearModifiedStates = false,
  onStatementSelected,
  statements,
  defaultEnvironmentId,
  actionGenerationDebugInfo,
  executionStatusByStatementUid,
  displayOnly = false,
  v2 = false,
}) => {
  // Modified state tracking
  const [modifiedStatements, setModifiedStatements] = useState<Set<string>>(new Set());

  // Selection state (multi-select)
  const [selectedStatementIds, setSelectedStatementIds] = useState<Set<string>>(new Set());
  const [statementDisplayModeByUid, setStatementDisplayModeByUid] = useState<Record<string, 'default' | 'original' | 'healed'>>({});

  // Editing mode
  const [isEnabled, setIsEnabled] = useState(enabled);

  // Update enabled state when prop changes
  useEffect(() => {
    setIsEnabled(enabled);
  }, [enabled]);

  // Clear modified states when clearModifiedStates prop changes to true
  useEffect(() => {
    if (clearModifiedStates) {
      setModifiedStatements(new Set());
    }
  }, [clearModifiedStates]);

  // Mark a statement as modified
  const markModified = useCallback((uid: string, reason?: string) => {
    setModifiedStatements(prev => {
      if (prev.has(uid)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(uid);
      return next;
    });
  }, []);

  // Clear all modified states
  const clearModifiedStatesCallback = useCallback(() => {
    setModifiedStatements(new Set());
  }, []);

  // Select a statement (with multi-select support)
  const selectStatement = useCallback((uid: string, event?: React.MouseEvent | MouseEvent) => {
    // First expand any collapsed parent containers
    autoExpandParentContainers(uid, statements);
    
    const isMultiSelect = event && (event.ctrlKey || event.metaKey);
    const isRangeSelect = event && event.shiftKey;
    
    if (isRangeSelect && selectedStatementIds.size > 0) {
      // Range selection: select all statements between the last selected and the clicked one
      const allStatements = getAllStatementsInOrder(statements);
      // Find the last selected statement (highest index)
      let lastSelectedIndex = -1;
      for (let i = allStatements.length - 1; i >= 0; i--) {
        if (selectedStatementIds.has(allStatements[i].uid)) {
          lastSelectedIndex = i;
          break;
        }
      }
      const clickedIndex = allStatements.findIndex(stmt => stmt.uid === uid);
      
      if (lastSelectedIndex >= 0 && clickedIndex >= 0) {
        const startIndex = Math.min(lastSelectedIndex, clickedIndex);
        const endIndex = Math.max(lastSelectedIndex, clickedIndex);
        const rangeUids = allStatements.slice(startIndex, endIndex + 1).map(stmt => stmt.uid);
        
        setSelectedStatementIds(prev => {
          const next = new Set(prev);
          rangeUids.forEach(uid => next.add(uid));
          return next;
        });
        return;
      }
    }
    
    if (isMultiSelect) {
      // Toggle selection
      setSelectedStatementIds(prev => {
        const next = new Set(prev);
        if (next.has(uid)) {
          next.delete(uid);
        } else {
          next.add(uid);
        }
        return next;
      });
    } else {
      // Single selection: replace current selection
      setSelectedStatementIds(new Set([uid]));
    }
  }, [statements, selectedStatementIds]);
  
  // Toggle statement selection (for programmatic use)
  const toggleStatementSelection = useCallback((uid: string) => {
    setSelectedStatementIds(prev => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  }, []);
  
  // Select multiple statements programmatically
  const selectStatements = useCallback((uids: string[]) => {
    setSelectedStatementIds(new Set(uids));
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedStatementIds(new Set());
  }, []);

  const setStatementDisplayMode = useCallback((uid: string, mode: 'default' | 'original' | 'healed') => {
    setStatementDisplayModeByUid(prev => {
      if (mode === 'default') {
        if (!(uid in prev)) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      }
      return { ...prev, [uid]: mode };
    });
  }, []);

  // Set enabled state
  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
  }, []);

  // Handle action click for image preview
  const handleStatementSelection = useCallback(async (statement: Statement, isDebugging: boolean) => {
    if (onStatementSelected) {
      try {
        await onStatementSelected(statement, isDebugging);
      } catch (error) {
        console.error('Failed to handle action click:', error);
      }
    }
  }, [onStatementSelected]);

  // Navigation functions (use first selected statement for navigation)
  const navigateToNextStatement = useCallback(() => {
    if (selectedStatementIds.size === 0) return null;

    const allStatements = getAllStatementsInOrder(statements);
    const firstSelectedId = Array.from(selectedStatementIds)[0];
    const currentIndex = allStatements.findIndex(stmt => stmt.uid === firstSelectedId);

    if (currentIndex >= 0 && currentIndex < allStatements.length - 1) {
      const nextStatement = allStatements[currentIndex + 1];
      selectStatement(nextStatement.uid);
      return nextStatement;
    }
    return null;
  }, [selectedStatementIds, statements, selectStatement]);

  const navigateToPreviousStatement = useCallback(() => {
    if (selectedStatementIds.size === 0) return null;

    const allStatements = getAllStatementsInOrder(statements);
    const firstSelectedId = Array.from(selectedStatementIds)[0];
    const currentIndex = allStatements.findIndex(stmt => stmt.uid === firstSelectedId);

    if (currentIndex > 0) {
      const prevStatement = allStatements[currentIndex - 1];
      selectStatement(prevStatement.uid);
      return prevStatement;
    }
    return null;
  }, [selectedStatementIds, statements, selectStatement]);

  const contextValue: EditorContextType = {
    // Modified state
    modifiedStatements,
    markModified,
    clearModifiedStates: clearModifiedStatesCallback,

    // Selection state (multi-select)
    selectedStatementIds,
    selectStatement,
    toggleStatementSelection,
    selectStatements,
    clearSelection,

    // Navigation
    navigateToNextStatement,
    navigateToPreviousStatement,

    // Editing mode
    enabled,
    setEnabled,

    // Action click handling
    handleStatementSelection: onStatementSelected ? handleStatementSelection : undefined,

    // Statements tree
    statements,

    // Environment configuration
    defaultEnvironmentId,

    // Session-only debug info
    actionGenerationDebugInfo,

    // Run result execution status
    executionStatusByStatementUid,
    statementDisplayModeByUid,
    setStatementDisplayMode,

    // Display only
    displayOnly,

    // V2 mode
    v2,
  };

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
};

export const useEditor = (): EditorContextType => {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
};
