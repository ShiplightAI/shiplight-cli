import type { ActionDataEntity } from "shiplight-types";

function parseParameterNames(functionCode: string | undefined): string[] {
  if (!functionCode) return [];
  const match = functionCode.match(/(?:async\s+)?function\s+\w+\s*\(([^)]*)\)/)
    ?? functionCode.match(/(?:async\s*)?\(([^)]*)\)\s*=>/);
  if (!match?.[1].trim()) return [];

  return match[1]
    .split(",")
    .map((parameter) => parameter.split(":")[0].trim().replace(/\?$/, ""))
    .filter(Boolean);
}

interface FunctionReference {
  id: string | number;
  name: string;
}

function preserveArgumentType(value: string, originalValue: unknown): unknown {
  if (typeof originalValue === "number" && value.trim() !== "") {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }
  if (typeof originalValue === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}

export function findFunctionDefinition<T extends FunctionReference>(
  functions: readonly T[] | undefined,
  functionName: string | undefined,
  functionId: string | number | undefined,
): T | undefined {
  return functions?.find((func) =>
    func.name === functionName
    || (functionId !== undefined && String(func.id) === String(functionId))
  );
}

/**
 * Build the name/value map consumed by FunctionEditor.
 *
 * Current `call:` YAML supplies positional args, so parameter names come from
 * the locally-discovered exported function. Legacy actions already carry
 * parameterNames and continue to use those names.
 */
export function mapFunctionArgumentsForDisplay(
  argumentValues: readonly unknown[],
  functionCode?: string,
  legacyParameterNames: readonly string[] = [],
): Record<string, string> {
  const parameterNames = legacyParameterNames.length > 0
    ? [...legacyParameterNames]
    : parseParameterNames(functionCode);

  return Object.fromEntries(argumentValues.map((value, index) => [
    parameterNames[index] || `arg${index + 1}`,
    value === null || value === undefined ? "" : String(value),
  ]));
}

/**
 * Write edited function parameters back in the same data shape that was
 * loaded. Current `call:` actions update kwargs.args positionally; legacy
 * actions keep parameterNames/parameterValues.
 */
export function updateFunctionActionData(
  actionData: ActionDataEntity,
  func: FunctionReference,
  paramValues: Record<string, string> = {},
): ActionDataEntity {
  const values = Object.values(paramValues);
  const currentKwargs = actionData.kwargs ?? {};

  if (Array.isArray(currentKwargs.args)) {
    const positionalValues = values.map((value, index) =>
      preserveArgumentType(value, currentKwargs.args[index])
    );
    const nextKwargs: Record<string, unknown> = {
      ...currentKwargs,
      functionName: func.name,
      functionId: func.id,
      args: positionalValues,
    };
    delete nextKwargs.parameterNames;
    delete nextKwargs.parameterValues;
    return { ...actionData, kwargs: nextKwargs };
  }

  return {
    ...actionData,
    ...(Array.isArray(actionData.args) ? { args: values } : {}),
    kwargs: {
      ...currentKwargs,
      functionName: func.name,
      functionId: func.id,
      parameterNames: Object.keys(paramValues),
      parameterValues: values,
    },
  };
}
