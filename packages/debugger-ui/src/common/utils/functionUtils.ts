export const SYSTEM_PARAMETERS = ["page", "testContext", "request", "agent"];

/**
 * Utility functions for handling function parameters and code generation
 */

/**
 * Parse function parameters from function code
 * @param code Function code as string
 * @returns Array of parameter names
 */
export const parseFunctionParameters = (code: string | undefined): string[] => {
  if (!code || typeof code !== 'string') return [];

  try {
    // Match the function parameters in the function declaration
    // This regex looks for: async(...params...) or function(...params...)
    const match = code.match(/(?:async|function)?\s*\(\s*([^)]*)\s*\)/);

    if (match && match[1]) {
      // Split the parameters string by comma and trim each parameter
      return match[1].split(',')
        .map(param => {
          // Add safeguards against null/undefined values
          if (param === null || param === undefined) return '';
          return param.trim();
        })
        .filter(param => param && param.length > 0); // Only return non-empty params
    }
  } catch (error) {
    console.error("Error parsing function parameters:", error);
  }

  return [];
};

/**
 * Separates system parameters from custom parameters
 * @param parameters List of all parameters
 * @returns Object with systemParams and customParams arrays
 */
export const separateParameters = (parameters: string[]): {
  systemParams: string[];
  customParams: string[]
} => {
  if (!Array.isArray(parameters)) {
    console.warn('Parameters is not an array:', parameters);
    return { systemParams: [], customParams: [] };
  }

  // Filter out any non-string values first
  const validParams = parameters.filter(param => param && typeof param === 'string');

  return {
    systemParams: validParams.filter(param => SYSTEM_PARAMETERS.includes(param)),
    customParams: validParams.filter(param => !SYSTEM_PARAMETERS.includes(param))
  };
};

/**
 * Generate function call code based on parameter values
 * @param functionName Name of the function to call
 * @param paramValues Object with parameter values
 * @returns Generated code string for the function call
 */
export const generateFunctionCallCode = (
  functionName: string,
  paramValues: Record<string, any>
): string => {

  if (!functionName || typeof functionName !== 'string') {
    console.warn('Missing or invalid function name:', functionName);
    return "// Missing function name";
  }

  try {
    // If no parameters, just return a simple function call
    if (!paramValues || Object.keys(paramValues).length === 0) {
      return `await ${functionName}()`;
    }

    // Get all values as strings, handling system parameters and literals properly
    const valueStrings = Object.entries(paramValues).map(([paramName, value]) => {
      // Convert value to string if it's not already
      const strValue = String(value);

      // Handle null/undefined values
      if (value === null || value === undefined) {
        return "undefined";
      }

      // Special handling for system parameters and JavaScript literals
      const systemParams = SYSTEM_PARAMETERS;
      const jsLiterals = ["undefined", "null", "true", "false"];

      // For system parameters, use them directly (without quotes)
      if (systemParams.includes(paramName) && systemParams.includes(strValue)) {
        return strValue;
      }
      // For JavaScript literals or numbers, use them directly
      else if (jsLiterals.includes(strValue) || /^-?\d+(\.\d+)?$/.test(strValue)) {
        return strValue;
      }
      // For values starting with $ (variables), replace with testContext reference
      else if (strValue.startsWith('$')) {
        // Remove the $ prefix and use as a property of testContext
        const contextKey = strValue.substring(1);
        return `testContext.${contextKey}`;
      }
      // For all other values, wrap in quotes
      else {
        return `"${strValue}"`;
      }
    });

    // Join with commas and return the complete function call
    return `await ${functionName}(${valueStrings.join(", ")})`;
  } catch (error) {
    console.error("Error generating function call code:", error);
    return `await ${functionName}()`;
  }
};

/**
 * Initialize parameter values with defaults
 * @param systemParams System parameter names
 * @param customParams Custom parameter names
 * @returns Record with default parameter values
 */
export const initializeParameterValues = (
  systemParams: string[],
  customParams: string[]
): Record<string, string> => {
  const values: Record<string, string> = {};

  // Auto-fill system parameters with their names
  if (Array.isArray(systemParams)) {
    systemParams.forEach(param => {
      if (param && typeof param === 'string') {
        values[param] = param;
      }
    });
  }

  // Initialize custom parameters with undefined
  if (Array.isArray(customParams)) {
    customParams.forEach(param => {
      if (param && typeof param === 'string') {
        values[param] = "undefined";
      }
    });
  }

  return values;
};

/**
 * Check if a parameter is a system parameter
 * @param paramName The parameter name to check
 * @returns True if it's a system parameter, false otherwise
 */
export const isSystemParameter = (paramName: string): boolean => {
  return SYSTEM_PARAMETERS.includes(paramName);
};

/**
 * Extract parameter names and values from a test step's action data
 * @param step The test step instance
 * @returns Array of parameter objects with name and value
 */
export const getFunctionParameters = (step: any): { name: string; value: string }[] => {
  if (!step || step.action?.actionData?.actionName !== "function") {
    return [];
  }

  const parameterNames = step.action.actionData.kwargs?.parameterNames || [];
  const args = step.action.actionData.args || [];

  // Make sure we don't go beyond the shorter array length
  const length = Math.min(parameterNames.length, args.length);

  // Create an array of parameter objects with name and value
  return Array.from({ length }, (_, i) => ({
    name: parameterNames[i] || `param${i + 1}`,
    value: args[i] || ""
  }));
};

/**
 * Filter out system parameters and return only custom parameters
 * @param parameters Array of parameter objects
 * @returns Filtered array with only custom parameters
 */
export const getCustomParameters = (parameters: { name: string; value: string }[]): { name: string; value: string }[] => {
  return parameters.filter(param => !isSystemParameter(param.name));
};