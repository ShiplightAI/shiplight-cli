import type { ExecutionStatus, DebuggerContextType } from '../types/debugger';

/**
 * Determines if a statement should be completely disabled (grayed out) during execution
 */
export const shouldDisableStatement = (
  debugContext: DebuggerContextType | null,
  debugStatus?: ExecutionStatus,
): boolean => {
  // No restrictions if not debugging
  if (!debugContext || !debugContext.isDebugging) {
    return false;
  }

  // Disable the entire statement if it's currently running or streaming
  // This includes condition evaluation for IF_ELSE and WHILE_LOOP
  if (debugStatus === 'running' || debugStatus === 'streaming') {
    return true;
  }

  return false;
};

