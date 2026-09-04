import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  findStatementPathById,
  findNextStatement,
  findNextSibling,
  findNextAfterContainer,
  getAllStatementsInOrder,
  isExecutableStatement,
  collectActionSteps,
  type StatementPath
} from './statementTreeWalker.js';
import { StatementType, ConditionType, type Statement, type Step, type IfElse, type WhileLoop, type Action } from './testFlow.js';

describe('statementTreeWalker', () => {
  // Helper to create test statements
  const createAction = (uid: string, description = 'Action'): Action => ({
    uid,
    type: StatementType.ACTION,
    description,
    action_entity: {} as any
  });

  const createStep = (uid: string, description: string, statements: Statement[] = []): Step => ({
    uid,
    type: StatementType.STEP,
    description,
    statements
  });

  const createIfElse = (uid: string, conditionExpression: string, then: Statement[] = [], elseStmts: Statement[] | undefined = undefined): IfElse => ({
    uid,
    type: StatementType.IF_ELSE,
    condition: {
      type: ConditionType.JS_CODE,
      expression: conditionExpression
    },
    then,
    else: elseStmts
  });

  const createWhileLoop = (uid: string, conditionExpression: string, body: Statement[] = []): WhileLoop => ({
    uid,
    type: StatementType.WHILE_LOOP,
    condition: {
      type: ConditionType.JS_CODE,
      expression: conditionExpression
    },
    body
  });

  describe('findStatementPathById', () => {
    it('should find statement at root level', () => {
      const statements = [
        createAction('action1'),
        createAction('action2'),
        createAction('action3')
      ];

      const path = findStatementPathById(statements, 'action2');

      assert.ok(path);
      assert.equal(path.stableId, 'action2');
      assert.deepEqual(path.path, [1]);
      assert.equal(path.index, 1);
      assert.equal(path.containerKey, 'root');
      assert.equal(path.parent, undefined);
    });

    it('should find statement nested in Step', () => {
      const statements = [
        createAction('action1'),
        createStep('step1', 'Test Step', [
          createAction('nested1'),
          createAction('nested2')
        ])
      ];

      const path = findStatementPathById(statements, 'nested2');

      assert.ok(path);
      assert.equal(path.stableId, 'nested2');
      assert.deepEqual(path.path, [1, 'statements', 1]);
      assert.equal(path.index, 1);
      assert.equal(path.containerKey, 'statements');
      assert.equal(path.parent?.uid, 'step1');
    });

    it('should find statement in IfElse then branch', () => {
      const statements = [
        createIfElse('if1', 'condition', [
          createAction('then1'),
          createAction('then2')
        ])
      ];

      const path = findStatementPathById(statements, 'then2');

      assert.ok(path);
      assert.equal(path.stableId, 'then2');
      assert.deepEqual(path.path, [0, 'then', 1]);
      assert.equal(path.containerKey, 'then');
      assert.equal(path.parent?.uid, 'if1');
    });

    it('should find statement in IfElse else branch', () => {
      const statements = [
        createIfElse('if1', 'condition', [], [
          createAction('else1'),
          createAction('else2')
        ])
      ];

      const path = findStatementPathById(statements, 'else2');

      assert.ok(path);
      assert.deepEqual(path.path, [0, 'else', 1]);
      assert.equal(path.containerKey, 'else');
    });

    it('should find statement in WhileLoop body', () => {
      const statements = [
        createWhileLoop('while1', 'i < 10', [
          createAction('body1'),
          createAction('body2')
        ])
      ];

      const path = findStatementPathById(statements, 'body2');

      assert.ok(path);
      assert.deepEqual(path.path, [0, 'body', 1]);
      assert.equal(path.containerKey, 'body');
      assert.equal(path.parent?.uid, 'while1');
    });

    it('should find deeply nested statement', () => {
      const statements = [
        createStep('step1', 'Outer', [
          createIfElse('if1', 'cond', [
            createWhileLoop('while1', 'loop', [
              createAction('deep')
            ])
          ])
        ])
      ];

      const path = findStatementPathById(statements, 'deep');

      assert.ok(path);
      assert.deepEqual(path.path, [0, 'statements', 0, 'then', 0, 'body', 0]);
      assert.equal(path.stableId, 'deep');
    });

    it('should return null for non-existent statement', () => {
      const statements = [createAction('action1')];

      const path = findStatementPathById(statements, 'non-existent');

      assert.equal(path, null);
    });

    it('should handle empty statements array', () => {
      const path = findStatementPathById([], 'any');

      assert.equal(path, null);
    });

    it('should find the first occurrence when duplicate UIDs exist', () => {
      // Edge case: duplicate UIDs (shouldn't happen but let's be safe)
      const statements = [
        createAction('duplicate'),
        createStep('step', 'Step', [
          createAction('duplicate')
        ])
      ];

      const path = findStatementPathById(statements, 'duplicate');

      assert.ok(path);
      assert.deepEqual(path.path, [0]); // Should find the first one
    });
  });

  describe('findNextStatement', () => {
    describe('ACTION statements', () => {
      it('should find next sibling action', () => {
        const statements = [
          createAction('action1'),
          createAction('action2'),
          createAction('action3')
        ];

        const next = findNextStatement(statements, 'action1');

        assert.ok(next);
        assert.equal(next.uid, 'action2');
      });

      it('should return null for last action', () => {
        const statements = [
          createAction('action1'),
          createAction('action2')
        ];

        const next = findNextStatement(statements, 'action2');

        assert.equal(next, null);
      });

      it('should exit container and find next statement', () => {
        const statements = [
          createStep('step1', 'Step', [
            createAction('nested1'),
            createAction('nested2')
          ]),
          createAction('after')
        ];

        const next = findNextStatement(statements, 'nested2');

        assert.ok(next);
        assert.equal(next.uid, 'after');
      });
    });

    describe('STEP statements', () => {
      it('should enter step and return first child', () => {
        const statements = [
          createStep('step1', 'Step', [
            createAction('child1'),
            createAction('child2')
          ])
        ];

        const next = findNextStatement(statements, 'step1');

        assert.ok(next);
        assert.equal(next.uid, 'child1');
      });

      it('should go to next sibling if step is empty', () => {
        const statements = [
          createStep('step1', 'Empty Step', []),
          createAction('next')
        ];

        const next = findNextStatement(statements, 'step1');

        assert.ok(next);
        assert.equal(next.uid, 'next');
      });
    });

    describe('IF_ELSE statements', () => {
      it('should enter then branch when condition is true', () => {
        const statements = [
          createIfElse('if1', 'condition', [
            createAction('then1')
          ], [
            createAction('else1')
          ])
        ];

        const next = findNextStatement(statements, 'if1', true);

        assert.ok(next);
        assert.equal(next.uid, 'then1');
      });

      it('should enter else branch when condition is false', () => {
        const statements = [
          createIfElse('if1', 'condition', [
            createAction('then1')
          ], [
            createAction('else1')
          ])
        ];

        const next = findNextStatement(statements, 'if1', false);

        assert.ok(next);
        assert.equal(next.uid, 'else1');
      });

      it('should skip to next when condition is false and no else branch', () => {
        const statements = [
          createIfElse('if1', 'condition', [
            createAction('then1')
          ]),
          createAction('after')
        ];

        const next = findNextStatement(statements, 'if1', false);

        assert.ok(next);
        assert.equal(next.uid, 'after');
      });

      it('should skip to next when no condition result provided', () => {
        const statements = [
          createIfElse('if1', 'condition', [
            createAction('then1')
          ]),
          createAction('after')
        ];

        const next = findNextStatement(statements, 'if1');

        assert.ok(next);
        assert.equal(next.uid, 'after');
      });
    });

    describe('WHILE_LOOP statements', () => {
      it('should enter body when condition is true', () => {
        const statements = [
          createWhileLoop('while1', 'i < 10', [
            createAction('body1'),
            createAction('body2')
          ])
        ];

        const next = findNextStatement(statements, 'while1', true);

        assert.ok(next);
        assert.equal(next.uid, 'body1');
      });

      it('should skip loop when condition is false', () => {
        const statements = [
          createWhileLoop('while1', 'i < 10', [
            createAction('body1')
          ]),
          createAction('after')
        ];

        const next = findNextStatement(statements, 'while1', false);

        assert.ok(next);
        assert.equal(next.uid, 'after');
      });

      it('should jump back to while loop after last body statement', () => {
        const statements = [
          createWhileLoop('while1', 'i < 10', [
            createAction('body1'),
            createAction('body2')
          ])
        ];

        const next = findNextStatement(statements, 'body2');

        assert.ok(next);
        assert.equal(next.uid, 'while1'); // Should jump back to while
      });

      it('should continue to next body statement if not at end', () => {
        const statements = [
          createWhileLoop('while1', 'i < 10', [
            createAction('body1'),
            createAction('body2')
          ])
        ];

        const next = findNextStatement(statements, 'body1');

        assert.ok(next);
        assert.equal(next.uid, 'body2');
      });

      it('should handle nested while loops correctly', () => {
        const statements = [
          createWhileLoop('outer', 'x < 5', [
            createWhileLoop('inner', 'y < 3', [
              createAction('innerBody')
            ]),
            createAction('afterInner')
          ])
        ];

        // From inner body, should jump back to inner while
        let next = findNextStatement(statements, 'innerBody');
        assert.ok(next);
        assert.equal(next.uid, 'inner');

        // From inner while (when false), should go to afterInner
        next = findNextStatement(statements, 'inner', false);
        assert.ok(next);
        assert.equal(next.uid, 'afterInner');

        // From afterInner, should jump back to outer while
        next = findNextStatement(statements, 'afterInner');
        assert.ok(next);
        assert.equal(next.uid, 'outer');
      });
    });

    it('should return null for unknown statement ID', () => {
      const statements = [createAction('action1')];

      const next = findNextStatement(statements, 'unknown');

      assert.equal(next, null);
    });

    it('should handle empty statements array', () => {
      const next = findNextStatement([], 'any');

      assert.equal(next, null);
    });
  });

  describe('findNextSibling', () => {
    it('should find next sibling at root level', () => {
      const statements = [
        createAction('action1'),
        createAction('action2'),
        createAction('action3')
      ];

      const currentPath: StatementPath = {
        stableId: 'action1',
        path: [0],
        statement: statements[0],
        parent: undefined,
        containerKey: 'root',
        index: 0
      };

      const next = findNextSibling(statements, currentPath);

      assert.ok(next);
      assert.equal(next.uid, 'action2');
    });

    it('should return null for last sibling at root', () => {
      const statements = [
        createAction('action1'),
        createAction('action2')
      ];

      const currentPath: StatementPath = {
        stableId: 'action2',
        path: [1],
        statement: statements[1],
        parent: undefined,
        containerKey: 'root',
        index: 1
      };

      const next = findNextSibling(statements, currentPath);

      assert.equal(next, null);
    });

    it('should find next sibling within container', () => {
      const step = createStep('step1', 'Step', [
        createAction('child1'),
        createAction('child2'),
        createAction('child3')
      ]);
      const statements = [step];

      const currentPath: StatementPath = {
        stableId: 'child1',
        path: [0, 'statements', 0],
        statement: step.statements[0],
        parent: step,
        containerKey: 'statements',
        index: 0
      };

      const next = findNextSibling(statements, currentPath);

      assert.ok(next);
      assert.equal(next.uid, 'child2');
    });
  });

  describe('findNextAfterContainer', () => {
    it('should return null when at root level', () => {
      const statements = [createAction('action1')];

      const currentPath: StatementPath = {
        stableId: 'action1',
        path: [0],
        statement: statements[0],
        parent: undefined,
        containerKey: 'root',
        index: 0
      };

      const next = findNextAfterContainer(statements, currentPath);

      assert.equal(next, null);
    });

    it('should find statement after parent container', () => {
      const step = createStep('step1', 'Step', [
        createAction('child1')
      ]);
      const statements = [
        step,
        createAction('after')
      ];

      const currentPath: StatementPath = {
        stableId: 'child1',
        path: [0, 'statements', 0],
        statement: step.statements[0],
        parent: step,
        containerKey: 'statements',
        index: 0
      };

      const next = findNextAfterContainer(statements, currentPath);

      assert.ok(next);
      assert.equal(next.uid, 'after');
    });

    it('should handle nested containers', () => {
      const innerStep = createStep('inner', 'Inner', [
        createAction('deepChild')
      ]);
      const outerStep = createStep('outer', 'Outer', [
        innerStep
      ]);
      const statements = [
        outerStep,
        createAction('afterAll')
      ];

      const currentPath: StatementPath = {
        stableId: 'deepChild',
        path: [0, 'statements', 0, 'statements', 0],
        statement: innerStep.statements[0],
        parent: innerStep,
        containerKey: 'statements',
        index: 0
      };

      const next = findNextAfterContainer(statements, currentPath);

      assert.ok(next);
      assert.equal(next.uid, 'afterAll');
    });
  });

  describe('getAllStatementsInOrder', () => {
    it('should return all statements in tree order', () => {
      const statements = [
        createAction('action1'),
        createStep('step1', 'Step', [
          createAction('nested1'),
          createAction('nested2')
        ]),
        createIfElse('if1', 'cond', [
          createAction('then1')
        ], [
          createAction('else1')
        ]),
        createWhileLoop('while1', 'loop', [
          createAction('body1')
        ])
      ];

      const allStatements = getAllStatementsInOrder(statements);
      const uids = allStatements.map(s => s.uid);

      assert.deepEqual(uids, [
        'action1',
        'step1',
        'nested1',
        'nested2',
        'if1',
        'then1',
        'else1',
        'while1',
        'body1'
      ]);
    });

    it('should handle empty statements', () => {
      const allStatements = getAllStatementsInOrder([]);

      assert.deepEqual(allStatements, []);
    });

    it('should handle deeply nested structures', () => {
      const statements = [
        createStep('s1', 'S1', [
          createIfElse('if1', 'c', [
            createWhileLoop('w1', 'l', [
              createStep('s2', 'S2', [
                createAction('deep')
              ])
            ])
          ])
        ])
      ];

      const allStatements = getAllStatementsInOrder(statements);
      const uids = allStatements.map(s => s.uid);

      assert.deepEqual(uids, ['s1', 'if1', 'w1', 's2', 'deep']);
    });
  });

  describe('isExecutableStatement', () => {
    it('should return true for ACTION', () => {
      const action = createAction('action');
      assert.equal(isExecutableStatement(action), true);
    });

    it('should return true for STEP', () => {
      const step = createStep('step', 'Step');
      assert.equal(isExecutableStatement(step), true);
    });

    it('should return true for IF_ELSE', () => {
      const ifElse = createIfElse('if', 'cond');
      assert.equal(isExecutableStatement(ifElse), true);
    });

    it('should return true for WHILE_LOOP', () => {
      const whileLoop = createWhileLoop('while', 'cond');
      assert.equal(isExecutableStatement(whileLoop), true);
    });

    it('should return false for unknown statement type', () => {
      const unknownStatement = {
        uid: 'unknown',
        type: 'UNKNOWN_TYPE' as any
      } as Statement;

      assert.equal(isExecutableStatement(unknownStatement), false);
    });
  });

  describe('Complex execution flow scenarios', () => {
    it('should correctly traverse a complex nested structure', () => {
      const statements = [
        createAction('start'),
        createWhileLoop('mainLoop', 'running', [
          createIfElse('check', 'condition', [
            createAction('process'),
            createStep('logging', 'Log', [
              createAction('log1'),
              createAction('log2')
            ])
          ], [
            createAction('skip')
          ]),
          createAction('endLoop')
        ]),
        createAction('finish')
      ];

      // Test the full execution flow
      const executionOrder: string[] = [];
      let current: string | null = 'start';

      // Simulate execution with different condition results
      const conditions: { [key: string]: boolean[] } = {
        'mainLoop': [true, true, false], // Loop twice, then exit
        'check': [true, false] // First iteration: true, second: false
      };

      const conditionCounts: { [key: string]: number } = {
        'mainLoop': 0,
        'check': 0
      };

      for (let i = 0; i < 20; i++) { // Safety limit
        if (!current) break;

        const stmt = statements.find(s => s.uid === current) ||
                     getAllStatementsInOrder(statements).find(s => s.uid === current);
        if (!stmt) break;

        executionOrder.push(current);

        let conditionResult: boolean | undefined;
        if (stmt.type === StatementType.WHILE_LOOP || stmt.type === StatementType.IF_ELSE) {
          const condList = conditions[stmt.uid];
          if (condList) {
            conditionResult = condList[conditionCounts[stmt.uid]];
            conditionCounts[stmt.uid]++;
          }
        }

        const next = findNextStatement(statements, current, conditionResult);
        current = next?.uid || null;
      }

      // Verify execution order
      assert.deepEqual(executionOrder, [
        'start',
        'mainLoop',    // First iteration
        'check',       // condition: true
        'process',
        'logging',
        'log1',
        'log2',
        'endLoop',
        'mainLoop',    // Second iteration (jump back)
        'check',       // condition: false
        'skip',
        'endLoop',
        'mainLoop',    // Third check (condition: false)
        'finish'
      ]);
    });
  });

  describe('Edge cases and potential bugs', () => {
    it('should handle statements with undefined containers gracefully', () => {
      const step: Step = {
        uid: 'step',
        type: StatementType.STEP,
        description: 'Step',
        statements: undefined as any // Explicitly undefined
      };

      const statements = [step, createAction('after')];

      const next = findNextStatement(statements, 'step');

      assert.ok(next);
      assert.equal(next.uid, 'after');
    });

    it('should handle empty containers correctly', () => {
      const ifElse: IfElse = {
        uid: 'if',
        type: StatementType.IF_ELSE,
        condition: {
          type: ConditionType.JS_CODE,
          expression: 'test'
        },
        then: [],
        else: []
      };

      const statements = [ifElse, createAction('after')];

      const next = findNextStatement(statements, 'if', true);

      assert.ok(next);
      assert.equal(next.uid, 'after');
    });

    it('POTENTIAL BUG: findStatementPathById returns first match with duplicate UIDs', () => {
      // This shouldn't happen in practice, but the function doesn't handle it well
      const statements = [
        createAction('duplicate'),
        createStep('step', 'Step', [
          createAction('duplicate')
        ])
      ];

      const path1 = findStatementPathById(statements, 'duplicate');
      assert.ok(path1);
      assert.deepEqual(path1.path, [0]);

      // The second duplicate is never reachable
      // This could be a problem if UIDs are not properly unique
    });

    it('should handle circular reference-like structures without infinite loop', () => {
      // While we can't create true circular references, we can test deep nesting
      const deeplyNested = createStep('s1', 'S1', [
        createStep('s2', 'S2', [
          createStep('s3', 'S3', [
            createStep('s4', 'S4', [
              createStep('s5', 'S5', [
                createAction('deep')
              ])
            ])
          ])
        ])
      ]);

      const statements = [deeplyNested];

      const path = findStatementPathById(statements, 'deep');
      assert.ok(path);
      assert.equal(path.path.length, 11); // 5 steps * 2 (index + 'statements') + 1
    });

    it('should handle while loop without body gracefully', () => {
      const whileLoop: WhileLoop = {
        uid: 'while',
        type: StatementType.WHILE_LOOP,
        condition: {
          type: ConditionType.JS_CODE,
          expression: 'test'
        },
        body: undefined as any
      };

      const statements = [whileLoop, createAction('after')];

      const next = findNextStatement(statements, 'while', true);

      assert.ok(next);
      assert.equal(next.uid, 'after');
    });
  });

  describe('collectActionSteps', () => {
    it('should collect simple ACTION statements', () => {
      const statements = [
        createAction('action1', 'Click button'),
        createAction('action2', 'Fill form')
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 2);
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'Click button');
      assert.ok(actionSteps['main.0'].action_entity);
      assert.ok(actionSteps['main.1']);
      assert.equal(actionSteps['main.1'].description, 'Fill form');
      assert.ok(actionSteps['main.1'].action_entity);
    });

    it('should collect ACTION statements nested in STEP', () => {
      const statements = [
        createStep('step1', 'Test Step', [
          createAction('nested1', 'Nested action 1'),
          createAction('nested2', 'Nested action 2')
        ])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 2);
      assert.ok(actionSteps['main.0.0']);
      assert.equal(actionSteps['main.0.0'].description, 'Nested action 1');
      assert.ok(actionSteps['main.0.1']);
      assert.equal(actionSteps['main.0.1'].description, 'Nested action 2');
    });

    it('should collect IF_ELSE condition and both branches', () => {
      const statements = [
        createIfElse('if1', 'x > 0', [
          createAction('then1', 'Then action')
        ], [
          createAction('else1', 'Else action')
        ])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 3);
      // Check IF condition
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'IF x > 0');
      assert.equal(actionSteps['main.0'].action_entity, undefined);
      // Check then branch
      assert.ok(actionSteps['main.0.then.0']);
      assert.equal(actionSteps['main.0.then.0'].description, 'Then action');
      // Check else branch
      assert.ok(actionSteps['main.0.else.0']);
      assert.equal(actionSteps['main.0.else.0'].description, 'Else action');
    });

    it('should handle IF_ELSE with only then branch', () => {
      const statements = [
        createIfElse('if1', 'x > 0', [
          createAction('then1', 'Then action')
        ])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 2);
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'IF x > 0');
      assert.ok(actionSteps['main.0.then.0']);
      assert.equal(actionSteps['main.0.then.0'].description, 'Then action');
    });

    it('should collect WHILE_LOOP condition and body', () => {
      const statements = [
        createWhileLoop('while1', 'i < 10', [
          createAction('body1', 'Body action 1'),
          createAction('body2', 'Body action 2')
        ])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 3);
      // Check WHILE condition
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'WHILE i < 10');
      assert.equal(actionSteps['main.0'].action_entity, undefined);
      // Check body actions
      assert.ok(actionSteps['main.0.body.0']);
      assert.equal(actionSteps['main.0.body.0'].description, 'Body action 1');
      assert.ok(actionSteps['main.0.body.1']);
      assert.equal(actionSteps['main.0.body.1'].description, 'Body action 2');
    });

    it('should handle complex nested structures', () => {
      const statements = [
        createAction('action1', 'Start'),
        createStep('step1', 'Step', [
          createIfElse('if1', 'condition', [
            createAction('then1', 'Then'),
            createWhileLoop('while1', 'loop', [
              createAction('body1', 'Body')
            ])
          ], [
            createAction('else1', 'Else')
          ])
        ]),
        createAction('action2', 'End')
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      // Verify all expected steps are collected
      assert.ok(actionSteps['main.0']); // action1
      assert.ok(actionSteps['main.1.0']); // if1 condition
      assert.ok(actionSteps['main.1.0.then.0']); // then1
      assert.ok(actionSteps['main.1.0.then.1']); // while1 condition
      assert.ok(actionSteps['main.1.0.then.1.body.0']); // body1
      assert.ok(actionSteps['main.1.0.else.0']); // else1
      assert.ok(actionSteps['main.2']); // action2

      assert.equal(actionSteps['main.0'].description, 'Start');
      assert.equal(actionSteps['main.1.0'].description, 'IF condition');
      assert.equal(actionSteps['main.1.0.then.0'].description, 'Then');
      assert.equal(actionSteps['main.1.0.then.1'].description, 'WHILE loop');
      assert.equal(actionSteps['main.1.0.then.1.body.0'].description, 'Body');
      assert.equal(actionSteps['main.1.0.else.0'].description, 'Else');
      assert.equal(actionSteps['main.2'].description, 'End');
    });

    it('should handle empty statements array', () => {
      const actionSteps: Record<string, any> = {};
      collectActionSteps([], 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 0);
    });

    it('should handle STEP with no nested statements', () => {
      const statements = [
        createStep('step1', 'Empty Step', [])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 0);
    });

    it('should handle IF_ELSE with empty branches', () => {
      const statements = [
        createIfElse('if1', 'condition', [], [])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'IF condition');
    });

    it('should handle WHILE_LOOP with empty body', () => {
      const statements = [
        createWhileLoop('while1', 'condition', [])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'WHILE condition');
    });

    it('should handle ACTION with empty description (uses default)', () => {
      const action: Action = {
        uid: 'action1',
        type: StatementType.ACTION,
        description: '', // Empty description should default to "Action"
        action_entity: {} as any
      };

      const statements = [action];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'Action'); // Default description
    });

    it('should handle IF_ELSE without condition expression', () => {
      const ifElse: IfElse = {
        uid: 'if1',
        type: StatementType.IF_ELSE,
        condition: {
          type: ConditionType.JS_CODE,
          expression: undefined as any
        },
        then: [],
        else: []
      };

      const statements = [ifElse];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'IF '); // Empty expression
    });

    it('should handle WHILE_LOOP without condition expression', () => {
      const whileLoop: WhileLoop = {
        uid: 'while1',
        type: StatementType.WHILE_LOOP,
        condition: {
          type: ConditionType.JS_CODE,
          expression: undefined as any
        },
        body: []
      };

      const statements = [whileLoop];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['main.0']);
      assert.equal(actionSteps['main.0'].description, 'WHILE '); // Empty expression
    });

    it('should use correct parentId prefix', () => {
      const statements = [
        createAction('action1', 'Action')
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'teardown', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['teardown.0']);
      assert.equal(actionSteps['teardown.0'].description, 'Action');
    });

    it('should handle deeply nested STEP structures', () => {
      const statements = [
        createStep('s1', 'S1', [
          createStep('s2', 'S2', [
            createStep('s3', 'S3', [
              createAction('deep', 'Deep action')
            ])
          ])
        ])
      ];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      console.log('actionSteps', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['main.0.0.0.0']);
      assert.equal(actionSteps['main.0.0.0.0'].description, 'Deep action');
    });

    it('should preserve action_entity for ACTION statements', () => {
      const actionEntity = {
        action_name: 'click',
        text: 'Button',
        action_description: 'Click button'
      } as any;

      const action: Action = {
        uid: 'action1',
        type: StatementType.ACTION,
        description: 'Click',
        action_entity: actionEntity
      };

      const statements = [action];

      const actionSteps: Record<string, any> = {};
      collectActionSteps(statements, 'main', actionSteps);

      assert.equal(Object.keys(actionSteps).length, 1);
      assert.ok(actionSteps['main.0']);
      assert.deepEqual(actionSteps['main.0'].action_entity, actionEntity);
    });
  });
});
