import { StatementType } from 'shiplight-types';
import type { Statement, Step, IfElse, WhileLoop } from 'shiplight-types';
import { useCollapseStore } from '../../../../stores/collapseStore';
import { findStatementPathById } from 'shiplight-types';

/**
 * Generate collapse IDs for different statement types and containers
 */
export const generateCollapseId = {
  step: (statementId: string) => `step-${statementId}`,
  ifElseThen: (statementId: string) => `ifelse-then-${statementId}`,
  ifElseElse: (statementId: string) => `ifelse-else-${statementId}`,
  whileLoop: (statementId: string) => `whileloop-${statementId}`,
};

/**
 * Auto-expand containers for newly created or converted statements with nested containers
 */
export const autoExpandStatement = (statementType: StatementType, statementId: string) => {
  const { setCollapsed } = useCollapseStore.getState();

  switch (statementType) {
    case StatementType.STEP:
      const stepCollapseId = generateCollapseId.step(statementId);
      setCollapsed(stepCollapseId, false);
      console.log('🔧 Auto-expanding STEP statement:', stepCollapseId);
      break;

    case StatementType.IF_ELSE:
      const thenCollapseId = generateCollapseId.ifElseThen(statementId);
      setCollapsed(thenCollapseId, false);
      console.log('🔧 Auto-expanding IF_ELSE then branch:', thenCollapseId);
      // Don't auto-expand else branch since it doesn't exist by default
      break;

    case StatementType.WHILE_LOOP:
      const whileCollapseId = generateCollapseId.whileLoop(statementId);
      setCollapsed(whileCollapseId, false);
      console.log('🔧 Auto-expanding WHILE_LOOP statement:', whileCollapseId);
      break;
  }
};

/**
 * Auto-expand else branch when it's created
 */
export const autoExpandElseBranch = (statementId: string) => {
  const { setCollapsed } = useCollapseStore.getState();
  const elseCollapseId = generateCollapseId.ifElseElse(statementId);
  setCollapsed(elseCollapseId, false);
  console.log('🔧 Auto-expanding else branch:', elseCollapseId);
};

/**
 * Auto-expand all parent containers for a statement to make it visible
 * This is used when navigating to a statement that might be inside collapsed containers
 */
export const autoExpandParentContainers = (statementId: string, statements: Statement[]) => {
  const statementPath = findStatementPathById(statements, statementId);
  if (!statementPath) return;

  const { setCollapsed } = useCollapseStore.getState();

  // Start from the statement's path and work backwards to expand all parent containers
  const path = statementPath.path;
  let currentStatement: Statement | undefined;
  let currentStatements = statements;

  // Walk through the path to expand each container that contains this statement
  for (let i = 0; i < path.length; i += 2) { // Skip container keys, only process statement indices
    const statementIndex = path[i] as number;
    currentStatement = currentStatements[statementIndex];

    if (!currentStatement) break;

    // If there's a next element in the path, it's a container key
    if (i + 1 < path.length) {
      const containerKey = path[i + 1] as string;

      // Generate appropriate collapse ID based on statement type and container
      let collapseId: string;
      switch (currentStatement.type) {
        case StatementType.STEP:
          if (containerKey === 'statements') {
            collapseId = generateCollapseId.step(currentStatement.uid);
            setCollapsed(collapseId, false);
            console.log('🔧 Auto-expanding STEP container for navigation:', collapseId);
          }
          break;

        case StatementType.IF_ELSE:
          if (containerKey === 'then') {
            collapseId = generateCollapseId.ifElseThen(currentStatement.uid);
            setCollapsed(collapseId, false);
            console.log('🔧 Auto-expanding IF_ELSE THEN container for navigation:', collapseId);
          } else if (containerKey === 'else') {
            collapseId = generateCollapseId.ifElseElse(currentStatement.uid);
            setCollapsed(collapseId, false);
            console.log('🔧 Auto-expanding IF_ELSE ELSE container for navigation:', collapseId);
          }
          break;

        case StatementType.WHILE_LOOP:
          if (containerKey === 'body') {
            collapseId = generateCollapseId.whileLoop(currentStatement.uid);
            setCollapsed(collapseId, false);
            console.log('🔧 Auto-expanding WHILE_LOOP container for navigation:', collapseId);
          }
          break;
      }

      // Move to the next level
      switch (currentStatement.type) {
        case StatementType.STEP:
          if (containerKey === 'statements' && currentStatement.statements) {
            currentStatements = currentStatement.statements;
          }
          break;
        case StatementType.IF_ELSE:
          if (containerKey === 'then' && currentStatement.then) {
            currentStatements = currentStatement.then;
          } else if (containerKey === 'else' && currentStatement.else) {
            currentStatements = currentStatement.else;
          }
          break;
        case StatementType.WHILE_LOOP:
          if (containerKey === 'body' && currentStatement.body) {
            currentStatements = currentStatement.body;
          }
          break;
      }
    }
  }
};

/**
 * Auto-collapse all children of a statement when starting to drag
 * This provides a cleaner dragging experience by collapsing nested content
 */
export const autoCollapseStatementChildren = (statement: Statement) => {
  const { setCollapsed } = useCollapseStore.getState();

  switch (statement.type) {
    case StatementType.STEP:
      const stepStatement = statement as Step;
      const stepCollapseId = generateCollapseId.step(statement.uid);
      setCollapsed(stepCollapseId, true);
      console.log('🔽 Auto-collapsing STEP statement for drag:', stepCollapseId);

      // Recursively collapse all nested statements
      if (stepStatement.statements && stepStatement.statements.length > 0) {
        stepStatement.statements.forEach(nestedStatement => {
          autoCollapseStatementChildren(nestedStatement);
        });
      }
      break;

    case StatementType.IF_ELSE:
      const ifElseStatement = statement as IfElse;
      
      // Collapse then branch
      const thenCollapseId = generateCollapseId.ifElseThen(statement.uid);
      setCollapsed(thenCollapseId, true);
      console.log('🔽 Auto-collapsing IF_ELSE then branch for drag:', thenCollapseId);

      // Collapse else branch if it exists
      if (ifElseStatement.else && ifElseStatement.else.length > 0) {
        const elseCollapseId = generateCollapseId.ifElseElse(statement.uid);
        setCollapsed(elseCollapseId, true);
        console.log('🔽 Auto-collapsing IF_ELSE else branch for drag:', elseCollapseId);
      }

      // Recursively collapse all nested statements in then branch
      if (ifElseStatement.then && ifElseStatement.then.length > 0) {
        ifElseStatement.then.forEach(nestedStatement => {
          autoCollapseStatementChildren(nestedStatement);
        });
      }

      // Recursively collapse all nested statements in else branch
      if (ifElseStatement.else && ifElseStatement.else.length > 0) {
        ifElseStatement.else.forEach(nestedStatement => {
          autoCollapseStatementChildren(nestedStatement);
        });
      }
      break;

    case StatementType.WHILE_LOOP:
      const whileLoopStatement = statement as WhileLoop;
      const whileCollapseId = generateCollapseId.whileLoop(statement.uid);
      setCollapsed(whileCollapseId, true);
      console.log('🔽 Auto-collapsing WHILE_LOOP statement for drag:', whileCollapseId);

      // Recursively collapse all nested statements in body
      if (whileLoopStatement.body && whileLoopStatement.body.length > 0) {
        whileLoopStatement.body.forEach(nestedStatement => {
          autoCollapseStatementChildren(nestedStatement);
        });
      }
      break;

    case StatementType.ACTION:
      // ACTION statements don't have children, so nothing to collapse
      break;

    default:
      console.warn('Unknown statement type for auto-collapse:', (statement as any).type);
      break;
  }
};