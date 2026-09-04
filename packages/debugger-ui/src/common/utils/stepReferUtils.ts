/**
 * Step Reference Resolution Utilities
 *
 * This module provides utilities for resolving reference_id in Step statements
 * and expanding them into full statement structures.
 *
 * Read-only tree traversal functions are in statementTreeWalker.ts
 * This file contains mutation and reference resolution logic.
 */

import { Statement, StatementType, Step, TestFlow } from 'shiplight-types';
import { v4 as uuidv4 } from 'uuid';

// Re-export read-only functions from shiplight-types
export { hasReferenceIds, getAllReferenceIds } from 'shiplight-types';

/**
 * Template structure for reusable steps
 */
export interface ReusableStepTemplate {
  id: number | string;
  name?: string;
  description?: string;
  statements: Statement[];
}

/**
 * Options for reference resolution
 */
export interface ReferenceResolutionOptions {
  /**
   * Whether to throw errors on resolution failures
   * Default: false (fallback to local statements)
   */
  throwOnError?: boolean;

  /**
   * Custom template resolver function
   * Required for resolving reference_id to template
   */
  templateResolver?: (referenceId: number) => ReusableStepTemplate | null | Promise<ReusableStepTemplate | null>;
}

/**
 * Result of reference resolution
 */
export interface ResolutionResult {
  success: boolean;
  statements: Statement[];
  description?: string;
  error?: string;
}

/**
 * Generate a new unique ID for cloned statements
 */
function generateUniqueId(): string {
  return uuidv4();
}

/**
 * Deep clone a statement tree and assign new UIDs to all nested statements.
 * This ensures that cloned statements from templates have unique IDs.
 * Always generates completely new UUIDs to avoid prefix accumulation.
 */
function cloneStatementWithNewIds(statement: Statement): Statement {
  const newUid = generateUniqueId();

  switch (statement.type) {
    case StatementType.DRAFT:
    case StatementType.ACTION:
      return {
        ...statement,
        uid: newUid
      };

    case StatementType.STEP:
      return {
        ...statement,
        uid: newUid,
        statements: (statement.statements ?? []).map(s => cloneStatementWithNewIds(s))
      };

    case StatementType.IF_ELSE:
      return {
        ...statement,
        uid: newUid,
        then: (statement.then ?? []).map(s => cloneStatementWithNewIds(s)),
        else: statement.else ? statement.else.map(s => cloneStatementWithNewIds(s)) : undefined
      };

    case StatementType.WHILE_LOOP:
      return {
        ...statement,
        uid: newUid,
        body: (statement.body ?? []).map(s => cloneStatementWithNewIds(s))
      };
  }
}

/**
 * Resolve a single Step's reference_id
 *
 * Note: Reusable steps cannot contain nested reusable steps (enforced during resolution)
 *
 * @param step The Step statement to resolve
 * @param options Resolution options
 * @returns Resolution result with expanded statements
 */
async function resolveStepReference(
  step: Step,
  options: ReferenceResolutionOptions = {}
): Promise<ResolutionResult> {
  const { throwOnError = false, templateResolver } = options;

  // Check if reference_id exists
  if (!step.reference_id) {
    return {
      success: true,
      statements: step.statements,
      description: step.description
    };
  }

  try {
    // Resolve the template
    if (!templateResolver) {
      const error = 'templateResolver is required for resolving reference_id';
      console.error(error);
      if (throwOnError) {
        throw new Error(error);
      }
      return {
        success: false,
        statements: step.statements,
        error
      };
    }

    const template = await templateResolver(step.reference_id);

    if (!template) {
      const error = `Template not found for reference_id: ${step.reference_id}`;
      console.warn(error);

      if (throwOnError) {
        throw new Error(error);
      }

      return {
        success: false,
        statements: step.statements,
        error
      };
    }

    // Clone template statements with new unique IDs
    const clonedStatements = template.statements.map(s => cloneStatementWithNewIds(s));

    // Validate: Reusable steps should NOT contain nested reusable steps
    const hasNestedReusableSteps = clonedStatements.some(stmt => 
      stmt.type === StatementType.STEP && (stmt as Step).reference_id !== undefined
    );
    
    if (hasNestedReusableSteps) {
      const error = `Invalid template: Reusable steps cannot contain nested reusable steps (reference_id: ${step.reference_id})`;
      console.error(error);
      
      if (throwOnError) {
        throw new Error(error);
      }
      
      return {
        success: false,
        statements: step.statements,
        error
      };
    }

    console.log(`✅ Resolved reference_id: ${step.reference_id} → ${clonedStatements.length} statements`);

    return {
      success: true,
      statements: clonedStatements,
      // Use template description when reference_id is resolved
      description: template.description
    };
  } catch (error) {
    const errorMessage = `Error resolving reference_id ${step.reference_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error(errorMessage);

    if (throwOnError) {
      throw error;
    }

    return {
      success: false,
      statements: step.statements,
      error: errorMessage
    };
  }
}

/**
 * Recursively resolve all reference_id in a statement tree
 *
 * Note: Reusable steps cannot contain nested reusable steps
 *
 * @param statement The statement to process
 * @param options Resolution options
 * @returns The statement with all references resolved
 */
async function resolveStatementReferences(
  statement: Statement,
  options: ReferenceResolutionOptions = {}
): Promise<Statement> {
  switch (statement.type) {
    case StatementType.STEP: {
      if (typeof statement.reference_id === 'number' && statement.reference_id > 0) {
        // Resolve referenced template; after替换无需再递归（模板禁止嵌套引用）
        const result = await resolveStepReference(statement, options);
        if (result.statements === statement.statements) {
          return statement;
        }
        return {
          ...statement,
          statements: result.statements,
          description: result.description || statement.description
        };
      } else {
        // 普通 STEP：递归解析其子语句
        const originalChildren = statement.statements ?? [];
        const resolvedChildren = await Promise.all(originalChildren.map(child => resolveStatementReferences(child, options)));
        // 若无变化则返回原对象，避免不必要的复制
        const unchanged = resolvedChildren.length === originalChildren.length && resolvedChildren.every((s, i) => s === originalChildren[i]);
        if (unchanged) return statement;
        return {
          ...statement,
          statements: resolvedChildren
        };
      }
    }

    case StatementType.IF_ELSE: {
      // Recursively resolve statements in both branches
      const thenArr = statement.then ?? [];
      const resolvedThen = await Promise.all(thenArr.map(s => resolveStatementReferences(s, options)));
      const thenChanged = resolvedThen.some((s, i) => s !== thenArr[i]);

      const elseArr = statement.else ?? undefined;
      const resolvedElse = elseArr ? await Promise.all(elseArr.map(s => resolveStatementReferences(s, options))) : undefined;
      const elseChanged = !!(elseArr && resolvedElse && resolvedElse.some((s, i) => s !== elseArr[i]));

      // Only return a new object if something changed
      if (!thenChanged && !elseChanged) {
        return statement;
      }

      return {
        ...statement,
        then: resolvedThen,
        else: resolvedElse
      };
    }

    case StatementType.WHILE_LOOP: {
      // Recursively resolve statements in loop body
      const bodyArr = statement.body ?? [];
      const resolvedBody = await Promise.all(bodyArr.map(s => resolveStatementReferences(s, options)));
      const bodyChanged = resolvedBody.some((s, i) => s !== bodyArr[i]);

      // Only return a new object if something changed
      if (!bodyChanged) {
        return statement;
      }

      return {
        ...statement,
        body: resolvedBody
      };
    }

    case StatementType.ACTION:
    default:
      // Actions don't have references, return as-is
      return statement;
  }
}

/**
 * Resolve all reference_id in an array of statements
 *
 * This is the main entry point for reference resolution.
 * Call this function when loading a TestFlow to expand all reference_id.
 *
 * @param statements Array of statements to process
 * @param options Resolution options
 * @returns Array of statements with all references resolved
 */
export async function resolveAllReferenceIds(
  statements: Statement[],
  options: ReferenceResolutionOptions = {}
): Promise<Statement[]> {
  console.log(`🔍 Starting reference resolution for ${statements.length} statements`);

  const resolvedStatements = await Promise.all(statements.map(s => resolveStatementReferences(s, options)));

  console.log(`✅ Reference resolution completed: ${statements.length} statements processed`);

  return resolvedStatements;
}

/**
 * Remove expanded data from reusable groups before saving to database.
 * Only keeps uid and reference_id; description and statements will be resolved on load.
 */
export function stripReusableGroups(testFlow: TestFlow): TestFlow {
  const stripStatement = (stmt: Statement): Statement => {
    if (stmt.type === StatementType.STEP) {
      const step = stmt as Step;
      if (step.reference_id && step.reference_id > 0) {
        return {
          uid: step.uid,
          type: step.type,
          reference_id: step.reference_id,
          description: '',
          statements: []
        } as Step;
      }
      if (step.statements && step.statements.length > 0) {
        return {
          ...step,
          statements: step.statements.map(stripStatement)
        };
      }
    } else if (stmt.type === StatementType.IF_ELSE) {
      const ifElse = stmt as any;
      return {
        ...ifElse,
        then: ifElse.then ? ifElse.then.map(stripStatement) : ifElse.then,
        else: ifElse.else ? ifElse.else.map(stripStatement) : ifElse.else
      };
    } else if (stmt.type === StatementType.WHILE_LOOP) {
      const loop = stmt as any;
      return {
        ...loop,
        body: loop.body ? loop.body.map(stripStatement) : loop.body
      };
    }
    return stmt;
  };

  return {
    ...testFlow,
    statements: (testFlow.statements ?? []).map(stripStatement),
    teardown: testFlow.teardown ? testFlow.teardown.map(stripStatement) : testFlow.teardown
  };
}