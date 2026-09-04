import { Action as ActionModel } from '../models/testStep';
import { Statement, StatementType, TestFlow, Step, IfElse, WhileLoop } from 'shiplight-types';
import { v4 as uuidv4 } from 'uuid';
import { ActionEntity } from 'shiplight-types';

const convertActionEntityToStatement = (actionEntity: ActionEntity): Statement => {
  return {
    uid: generateUid(),
    type: StatementType.ACTION,
    description: actionEntity.action_description,
    action_entity: actionEntity
  };
};

/**
 * Converts an old format ActionModel to a new format Action statement
 */
const convertActionModelToActionStatement = (actionModel: ActionModel): Statement => {
  // Use the existing toEntity() method to convert ActionModel to ActionEntity
  const actionEntity = actionModel.toEntity();
  return convertActionEntityToStatement(actionEntity);
};

/**
 * Converts an array of old format ActionModels to a complete TestFlow object
 */
export const convertActionModelsToTestFlow = (
  actionModels: ActionModel[],
  goal: string = "",
  url: string = ""
): TestFlow => {
  return {
    version: "1.2.0",
    goal,
    url,
    final_feedback: "",
    completed: true,
    success: true,
    statements: actionModels.map(convertActionModelToActionStatement)
  };
};

export const convertActionEntitiesToTestFlow = (
  actionEntities: ActionEntity[],
  goal: string = "",
  url: string = ""
): TestFlow => {
  return {
    version: "1.2.0",
    goal,
    url,
    final_feedback: "",
    completed: true,
    success: true,
    statements: actionEntities.map(convertActionEntityToStatement)
  };
};

/**
 * Checks if a test case uses the old format (has actionSteps but no testFlow)
 */
export const hasOldFormat = (testCase: any): boolean => {
  return Boolean(testCase.actionSteps && testCase.actionSteps.length > 0 && !testCase.testFlow);
};

/**
 * Utility function to update a statement in a statement tree by its UID
 * This function recursively searches through the statement tree and replaces
 * the statement with the matching UID
 *
 * @param statements Array of statements to search through
 * @param targetUid The UID of the statement to update
 * @param updatedStatement The new statement to replace the old one
 * @returns New array with the statement updated
 */
export const updateStatementInTree = (statements: Statement[], targetUid: string, updatedStatement: Statement): Statement[] => {
  return statements.map(stmt => {
    if (stmt.uid === targetUid) {
      return updatedStatement;
    }

    // Recursively search in nested statements
    if (stmt.type === StatementType.STEP) {
      const stepStmt = stmt as Step;
      return {
        ...stepStmt,
        statements: updateStatementInTree(stepStmt.statements, targetUid, updatedStatement)
      };
    } else if (stmt.type === StatementType.IF_ELSE) {
      const ifElseStmt = stmt as IfElse;
      return {
        ...ifElseStmt,
        then: updateStatementInTree(ifElseStmt.then, targetUid, updatedStatement),
        else: ifElseStmt.else ? updateStatementInTree(ifElseStmt.else, targetUid, updatedStatement) : ifElseStmt.else
      };
    } else if (stmt.type === StatementType.WHILE_LOOP) {
      const whileStmt = stmt as WhileLoop;
      return {
        ...whileStmt,
        body: updateStatementInTree(whileStmt.body, targetUid, updatedStatement)
      };
    }

    return stmt;
  });
};

export const generateUid = (): string => {
  return uuidv4();
};

/**
 * Insert a new statement before a target statement in a nested statement tree
 * This function recursively searches through the statement tree and inserts
 * the new statement before the target statement
 *
 * @param statements Array of statements to search through
 * @param targetUid The UID of the statement to insert before
 * @param newStatement The new statement to insert
 * @returns Object with updated statements array and insertion info
 */
export const insertStatementBeforeInTree = (
  statements: Statement[],
  targetUid: string,
  newStatement: Statement
): { statements: Statement[]; inserted: boolean; prevStatement: Statement | null; nextStatement: Statement | null } => {
  let inserted = false;
  let prevStatement: Statement | null = null;
  let nextStatement: Statement | null = null;

  const insertInArray = (stmts: Statement[]): Statement[] => {
    const result: Statement[] = [];
    
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      
      // If this is the target statement, insert before it
      if (stmt.uid === targetUid) {
        result.push(newStatement);
        result.push(stmt);
        inserted = true;
        prevStatement = i > 0 ? stmts[i - 1] : null;
        nextStatement = stmt;
        continue;
      }
      
      // Otherwise, check if we need to recurse into nested statements
      if (stmt.type === StatementType.STEP) {
        const stepStmt = stmt as Step;
        const updatedStatements = insertInArray(stepStmt.statements);
        if (inserted) {
          result.push({
            ...stepStmt,
            statements: updatedStatements
          });
          continue;
        }
        result.push({
          ...stepStmt,
          statements: updatedStatements
        });
      } else if (stmt.type === StatementType.IF_ELSE) {
        const ifElseStmt = stmt as IfElse;
        const updatedThen = insertInArray(ifElseStmt.then);
        if (inserted) {
          result.push({
            ...ifElseStmt,
            then: updatedThen,
            else: ifElseStmt.else
          });
          continue;
        }
        
        const updatedElse = ifElseStmt.else ? insertInArray(ifElseStmt.else) : ifElseStmt.else;
        result.push({
          ...ifElseStmt,
          then: updatedThen,
          else: updatedElse
        });
      } else if (stmt.type === StatementType.WHILE_LOOP) {
        const whileStmt = stmt as WhileLoop;
        const updatedBody = insertInArray(whileStmt.body);
        if (inserted) {
          result.push({
            ...whileStmt,
            body: updatedBody
          });
          continue;
        }
        result.push({
          ...whileStmt,
          body: updatedBody
        });
      } else {
        result.push(stmt);
      }
    }
    
    return result;
  };

  const updatedStatements = insertInArray(statements);
  
  return {
    statements: updatedStatements,
    inserted,
    prevStatement,
    nextStatement
  };
};

/**
 * Add a new statement at the end of a statement tree
 * This is a helper function to add a statement at the end of the root-level statements
 *
 * @param statements Array of statements
 * @param newStatement The new statement to add
 * @returns Object with updated statements array and insertion info
 */
export const addStatementAtEnd = (
  statements: Statement[],
  newStatement: Statement
): { statements: Statement[]; inserted: boolean; prevStatement: Statement | null; nextStatement: Statement | null } => {
  const prevStatement = statements.length > 0 ? statements[statements.length - 1] : null;
  
  return {
    statements: [...statements, newStatement],
    inserted: true,
    prevStatement,
    nextStatement: null
  };
};