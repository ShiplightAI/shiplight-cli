import type { Statement, Step, Action, IfElse, WhileLoop } from 'shiplight-types';
import { StatementType } from 'shiplight-types';
import { generateUid } from '@/common/steps_json/conversionUtils';

/**
 * Deep clones a statement with new UIDs for the statement and all nested statements.
 * This ensures that duplicated statements are completely independent from their originals.
 *
 * @param statement - The statement to clone
 * @returns A new statement with fresh UIDs
 */
export const cloneStatementWithNewUids = (statement: Statement): Statement => {
  const cloneStatements = (statements: Statement[]): Statement[] => {
    return statements.map(stmt => cloneStatementWithNewUids(stmt));
  };

  switch (statement.type) {
    case StatementType.STEP:
      const stepStatement = statement as Step;
      return {
        ...stepStatement,
        uid: generateUid(),
        type: StatementType.STEP,
        description: stepStatement.description,
        statements: cloneStatements(stepStatement.statements)
      };
    case StatementType.IF_ELSE:
      const ifElseStatement = statement as IfElse;
      return {
        ...ifElseStatement,
        uid: generateUid(),
        type: StatementType.IF_ELSE,
        condition: ifElseStatement.condition,
        then: cloneStatements(ifElseStatement.then),
        else: ifElseStatement.else ? cloneStatements(ifElseStatement.else) : ifElseStatement.else
      };
    case StatementType.WHILE_LOOP:
      const whileLoopStatement = statement as WhileLoop;
      return {
        ...whileLoopStatement,
        uid: generateUid(),
        type: StatementType.WHILE_LOOP,
        condition: whileLoopStatement.condition,
        body: cloneStatements(whileLoopStatement.body)
      };
    case StatementType.ACTION:
      const actionStatement = statement as Action;
      const newUid = generateUid();
      const newStatement: Action = {
        ...actionStatement,
        uid: newUid,
        type: StatementType.ACTION,
        description: actionStatement.description,
        action_entity: actionStatement.action_entity ? JSON.parse(JSON.stringify(actionStatement.action_entity)) : undefined,
      };
      if (newStatement.action_entity?.action_data?.kwargs?.uid) {
        newStatement.action_entity.action_data.kwargs.uid = newUid;
      }
      return newStatement;

    default:
      // This should never happen, but return a safe fallback
      throw new Error(`Unknown statement type: ${(statement as any).type}`);
  }
};
