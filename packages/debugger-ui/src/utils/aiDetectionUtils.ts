import { validateCode } from './codeUtils';
import type { Action } from 'shiplight-types';
import { isDynamicAction } from 'shiplight-types';
import { use } from 'react';

/**
 * Detects if a string contains valid JavaScript code
 * @param code The code string to validate
 * @returns true if the code is valid JavaScript
 */
export const isValidJavaScript = (code: string): boolean => {
  if (!code.trim()) return false;

  try {
    // Use the existing validateCode function from codeUtils (uses @babel/standalone)
    return validateCode(code, 'condition.js');
  } catch (error) {
    // If validateCode fails, try a simpler approach with async wrapper for top-level await
    try {
      new Function('return (async () => { ' + code + ' })()');
      return true;
    } catch {
      return false;
    }
  }
};

/**
 * Auto-detects if content should be in AI mode or manual mode
 * @param content The content string to analyze
 * @returns true if should be AI mode, false if should be manual mode
 */
export const detectAIMode = (content: string): boolean => {
  if (!content.trim()) return true; // Default to AI mode for empty content

  // Check if it's valid JavaScript - if so, it's probably manual mode
  const isJS = isValidJavaScript(content);

  if (isJS) {
    return false; // Manual mode (JS)
  }

  return true; // AI mode (natural language)
};

/**
 * Detects if an action name represents AI mode
 * @param actionName The action name to check
 * @returns true if it's an AI action type
 */
export const isAIActionType = (actionName: string): boolean => {
  return actionName === 'ai_action' || actionName === 'ai_step';
};

/**
 * Gets the AI equivalent of a manual action type
 * @param actionName The manual action name
 * @returns The AI equivalent action name
 */
export const getAIActionType = (actionName: string): string => {
  switch (actionName) {
    case 'action':
      return 'ai_action';
    default:
      return actionName; // Return as-is if no AI equivalent
  }
};

/**
 * Gets the manual equivalent of an AI action type
 * @param actionName The AI action name
 * @returns The manual equivalent action name
 */
export const getManualActionType = (actionName: string): string => {
  switch (actionName) {
    case 'ai_action':
      return 'action';
    default:
      return actionName; // Return as-is if no manual equivalent
  }
};

// Re-export isDynamicAction from common package for backward compatibility
export { isDynamicAction };

/**
 * Determines if an action can be converted to AI mode
 * @param actionName The action name to check
 * @returns true if the action can be converted to AI mode
 */
export const canConvertActionToAIMode = (actionName?: string): boolean => {
  if (!actionName) {
    return true; // Actions without action names (dynamic actions) can be converted
  }

  // Don't convert if it's a dynamic action (already special/AI/code actions)
  return !isDynamicAction(actionName);
};

/**
 * Determines if an ACTION statement can be converted to AI mode
 * @param actionStatement The ACTION statement to check
 * @returns true if the action can be converted to AI mode
 */
export const canConvertActionStatementToAIMode = (actionStatement: Action): boolean => {
  const actionName = actionStatement.action_entity?.action_data?.action_name;
  return canConvertActionToAIMode(actionName);
};

/**
 * Converts an ACTION statement to AI mode
 * @param actionStatement The ACTION statement to convert
 * @returns The converted ACTION statement with AI action entity
 */
export const convertActionToAIMode = (actionStatement: Action): Action => {
  const description = actionStatement.description || '';

  return {
    ...actionStatement,
    action_entity: {
      url: "",
      action_description: description,
      feedback: "",
      action_data: {
        action_name: "ai_action",
        args: [],
        kwargs: {
          statement: description,
          uid: actionStatement.uid,
          use_pure_vision: actionStatement.use_pure_vision || false,
        }
      }
    }
  };
};