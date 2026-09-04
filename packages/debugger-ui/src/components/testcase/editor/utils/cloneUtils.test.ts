import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { cloneStatementWithNewUids } from './cloneUtils';
import type { Action, Step, IfElse, WhileLoop } from 'shiplight-types';
import { StatementType, ConditionType } from 'shiplight-types';

describe('cloneStatementWithNewUids', () => {
  describe('ACTION statement', () => {
    it('should clone a basic ACTION statement with new UID', () => {
      const original: Action = {
        uid: 'original-uid',
        type: StatementType.ACTION,
        description: 'Click the submit button',
        use_pure_vision: false,
      };

      const cloned = cloneStatementWithNewUids(original) as Action;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.type, StatementType.ACTION);
      assert.strictEqual(cloned.description, original.description);
      assert.strictEqual(cloned.use_pure_vision, original.use_pure_vision);
    });

    it('should clone ACTION statement with action_entity and update kwargs.uid', () => {
      const original: Action = {
        uid: 'original-uid',
        type: StatementType.ACTION,
        description: 'AI action',
        action_entity: {
          url: 'https://example.com',
          action_description: 'Click button',
          feedback: 'Success',
          action_data: {
            action_name: 'ai_action',
            args: [],
            kwargs: {
              uid: 'original-uid',
              statement: 'Click the button',
              use_pure_vision: true,
            },
          },
        },
        use_pure_vision: true,
      };

      const cloned = cloneStatementWithNewUids(original) as Action;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.action_entity?.action_data?.kwargs?.uid, cloned.uid);
      assert.notStrictEqual(cloned.action_entity?.action_data?.kwargs?.uid, original.action_entity?.action_data?.kwargs?.uid);
      assert.strictEqual(cloned.action_entity?.action_description, original.action_entity?.action_description);
      assert.strictEqual(cloned.action_entity?.action_data?.action_name, 'ai_action');
    });

    it('should clone ACTION statement with action_entity but no kwargs.uid', () => {
      const original: Action = {
        uid: 'original-uid',
        type: StatementType.ACTION,
        description: 'Assert something',
        action_entity: {
          url: 'https://example.com',
          action_description: 'Assert',
          feedback: '',
          action_data: {
            action_name: 'ai_assert',
            args: [],
            kwargs: {
              statement: 'Check if element exists',
            },
          },
        },
        use_pure_vision: false,
      };

      const cloned = cloneStatementWithNewUids(original) as Action;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.action_entity?.action_data?.kwargs?.uid, undefined);
      assert.strictEqual(cloned.action_entity?.action_data?.kwargs?.statement, 'Check if element exists');
    });
  });

  describe('STEP statement', () => {
    it('should clone a STEP statement with no nested statements', () => {
      const original: Step = {
        uid: 'step-uid',
        type: StatementType.STEP,
        description: 'Login process',
        statements: [],
      };

      const cloned = cloneStatementWithNewUids(original) as Step;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.type, StatementType.STEP);
      assert.strictEqual(cloned.description, original.description);
      assert.deepStrictEqual(cloned.statements, []);
    });

    it('should clone a STEP statement with nested ACTION statements and update all UIDs', () => {
      const original: Step = {
        uid: 'step-uid',
        type: StatementType.STEP,
        description: 'Login process',
        statements: [
          {
            uid: 'action-1',
            type: StatementType.ACTION,
            description: 'Enter username',
            use_pure_vision: false,
          },
          {
            uid: 'action-2',
            type: StatementType.ACTION,
            description: 'Enter password',
            action_entity: {
              url: 'https://example.com',
              action_description: 'Type password',
              feedback: '',
              action_data: {
                action_name: 'ai_action',
                args: [],
                kwargs: {
                  uid: 'action-2',
                  statement: 'Enter password',
                },
              },
            },
            use_pure_vision: false,
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as Step;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.statements?.length, 2);

      const firstAction = cloned.statements![0] as Action;
      assert.notStrictEqual(firstAction.uid, 'action-1');
      assert.strictEqual(firstAction.description, 'Enter username');

      const secondAction = cloned.statements![1] as Action;
      assert.notStrictEqual(secondAction.uid, 'action-2');
      assert.strictEqual(secondAction.action_entity?.action_data?.kwargs?.uid, secondAction.uid);
      assert.strictEqual(secondAction.description, 'Enter password');
    });

    it('should clone a STEP statement with deeply nested STEP statements', () => {
      const original: Step = {
        uid: 'parent-step',
        type: StatementType.STEP,
        description: 'Parent step',
        statements: [
          {
            uid: 'child-step',
            type: StatementType.STEP,
            description: 'Child step',
            statements: [
              {
                uid: 'grandchild-action',
                type: StatementType.ACTION,
                description: 'Grandchild action',
                use_pure_vision: false,
              },
            ],
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as Step;

      assert.notStrictEqual(cloned.uid, 'parent-step');

      const childStep = cloned.statements![0] as Step;
      assert.notStrictEqual(childStep.uid, 'child-step');

      const grandchildAction = childStep.statements![0] as Action;
      assert.notStrictEqual(grandchildAction.uid, 'grandchild-action');
    });
  });

  describe('IF_ELSE statement', () => {
    it('should clone an IF_ELSE statement with only then branch', () => {
      const original: IfElse = {
        uid: 'if-else-uid',
        type: StatementType.IF_ELSE,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Check if element exists',
        },
        then: [
          {
            uid: 'then-action',
            type: StatementType.ACTION,
            description: 'Click button',
            use_pure_vision: false,
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as IfElse;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.condition.expression, 'Check if element exists');
      assert.strictEqual(cloned.then?.length, 1);

      const thenAction = cloned.then![0] as Action;
      assert.notStrictEqual(thenAction.uid, 'then-action');
      assert.strictEqual(cloned.else, undefined);
    });

    it('should clone an IF_ELSE statement with both then and else branches', () => {
      const original: IfElse = {
        uid: 'if-else-uid',
        type: StatementType.IF_ELSE,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Check if logged in',
        },
        then: [
          {
            uid: 'then-action',
            type: StatementType.ACTION,
            description: 'Go to dashboard',
            use_pure_vision: false,
          },
        ],
        else: [
          {
            uid: 'else-action',
            type: StatementType.ACTION,
            description: 'Go to login',
            use_pure_vision: false,
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as IfElse;

      assert.notStrictEqual(cloned.uid, original.uid);

      const thenAction = cloned.then![0] as Action;
      assert.notStrictEqual(thenAction.uid, 'then-action');
      assert.strictEqual(thenAction.description, 'Go to dashboard');

      const elseAction = cloned.else![0] as Action;
      assert.notStrictEqual(elseAction.uid, 'else-action');
      assert.strictEqual(elseAction.description, 'Go to login');
    });

    it('should clone an IF_ELSE statement with nested IF_ELSE in then branch', () => {
      const original: IfElse = {
        uid: 'outer-if',
        type: StatementType.IF_ELSE,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Outer condition',
        },
        then: [
          {
            uid: 'inner-if',
            type: StatementType.IF_ELSE,
            condition: {
              type: ConditionType.AI_MODE,
              expression: 'Inner condition',
            },
            then: [
              {
                uid: 'inner-action',
                type: StatementType.ACTION,
                description: 'Inner action',
                use_pure_vision: false,
              },
            ],
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as IfElse;

      assert.notStrictEqual(cloned.uid, original.uid);

      const innerIf = cloned.then![0] as IfElse;
      assert.notStrictEqual(innerIf.uid, 'inner-if');

      const innerAction = innerIf.then![0] as Action;
      assert.notStrictEqual(innerAction.uid, 'inner-action');
    });

    it('should clone an IF_ELSE statement with empty branches', () => {
      const original: IfElse = {
        uid: 'if-else-uid',
        type: StatementType.IF_ELSE,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Check condition',
        },
        then: [],
        else: [],
      };

      const cloned = cloneStatementWithNewUids(original) as IfElse;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.deepStrictEqual(cloned.then, []);
      assert.deepStrictEqual(cloned.else, []);
    });
  });

  describe('WHILE_LOOP statement', () => {
    it('should clone a WHILE_LOOP statement with body', () => {
      const original: WhileLoop = {
        uid: 'while-uid',
        type: StatementType.WHILE_LOOP,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Loop condition',
        },
        body: [
          {
            uid: 'loop-action',
            type: StatementType.ACTION,
            description: 'Repeat action',
            use_pure_vision: false,
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as WhileLoop;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.condition.expression, 'Loop condition');
      assert.strictEqual(cloned.body?.length, 1);

      const bodyAction = cloned.body![0] as Action;
      assert.notStrictEqual(bodyAction.uid, 'loop-action');
      assert.strictEqual(bodyAction.description, 'Repeat action');
    });

    it('should clone a WHILE_LOOP statement with nested STEP in body', () => {
      const original: WhileLoop = {
        uid: 'while-uid',
        type: StatementType.WHILE_LOOP,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Keep looping',
        },
        body: [
          {
            uid: 'step-in-loop',
            type: StatementType.STEP,
            description: 'Step in loop',
            statements: [
              {
                uid: 'action-in-step',
                type: StatementType.ACTION,
                description: 'Action inside step',
                use_pure_vision: false,
              },
            ],
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as WhileLoop;

      assert.notStrictEqual(cloned.uid, original.uid);

      const stepInLoop = cloned.body![0] as Step;
      assert.notStrictEqual(stepInLoop.uid, 'step-in-loop');

      const actionInStep = stepInLoop.statements![0] as Action;
      assert.notStrictEqual(actionInStep.uid, 'action-in-step');
    });

    it('should clone a WHILE_LOOP statement with empty body', () => {
      const original: WhileLoop = {
        uid: 'while-uid',
        type: StatementType.WHILE_LOOP,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Loop condition',
        },
        body: [],
      };

      const cloned = cloneStatementWithNewUids(original) as WhileLoop;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.deepStrictEqual(cloned.body, []);
    });

    it('should clone a WHILE_LOOP statement with multiple nested statements', () => {
      const original: WhileLoop = {
        uid: 'while-uid',
        type: StatementType.WHILE_LOOP,
        condition: {
          type: ConditionType.AI_MODE,
          expression: 'Complex loop',
        },
        body: [
          {
            uid: 'action-1',
            type: StatementType.ACTION,
            description: 'First action',
            use_pure_vision: false,
          },
          {
            uid: 'if-in-loop',
            type: StatementType.IF_ELSE,
            condition: {
              type: ConditionType.AI_MODE,
              expression: 'If condition',
            },
            then: [
              {
                uid: 'then-action',
                type: StatementType.ACTION,
                description: 'Then action',
                use_pure_vision: false,
              },
            ],
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as WhileLoop;

      assert.notStrictEqual(cloned.uid, original.uid);
      assert.strictEqual(cloned.body?.length, 2);

      const action1 = cloned.body![0] as Action;
      assert.notStrictEqual(action1.uid, 'action-1');

      const ifInLoop = cloned.body![1] as IfElse;
      assert.notStrictEqual(ifInLoop.uid, 'if-in-loop');

      const thenAction = ifInLoop.then![0] as Action;
      assert.notStrictEqual(thenAction.uid, 'then-action');
    });
  });

  describe('Complex nested structures', () => {
    it('should clone a complex nested structure with all statement types', () => {
      const original: Step = {
        uid: 'root-step',
        type: StatementType.STEP,
        description: 'Root step',
        statements: [
          {
            uid: 'action-1',
            type: StatementType.ACTION,
            description: 'First action',
            use_pure_vision: false,
          },
          {
            uid: 'if-statement',
            type: StatementType.IF_ELSE,
            condition: {
              type: ConditionType.AI_MODE,
              expression: 'If condition',
            },
            then: [
              {
                uid: 'while-in-then',
                type: StatementType.WHILE_LOOP,
                condition: {
                  type: ConditionType.AI_MODE,
                  expression: 'While condition',
                },
                body: [
                  {
                    uid: 'action-in-while',
                    type: StatementType.ACTION,
                    description: 'Action in while',
                    action_entity: {
                      url: 'https://example.com',
                      action_description: 'Complex action',
                      feedback: '',
                      action_data: {
                        action_name: 'ai_action',
                        args: [],
                        kwargs: {
                          uid: 'action-in-while',
                          statement: 'Complex statement',
                        },
                      },
                    },
                    use_pure_vision: false,
                  },
                ],
              },
            ],
            else: [
              {
                uid: 'step-in-else',
                type: StatementType.STEP,
                description: 'Step in else',
                statements: [],
              },
            ],
          },
        ],
      };

      const cloned = cloneStatementWithNewUids(original) as Step;

      // Verify root step
      assert.notStrictEqual(cloned.uid, 'root-step');

      // Verify first action
      const action1 = cloned.statements![0] as Action;
      assert.notStrictEqual(action1.uid, 'action-1');

      // Verify if statement
      const ifStatement = cloned.statements![1] as IfElse;
      assert.notStrictEqual(ifStatement.uid, 'if-statement');

      // Verify while in then branch
      const whileInThen = ifStatement.then![0] as WhileLoop;
      assert.notStrictEqual(whileInThen.uid, 'while-in-then');

      // Verify action in while with action_entity
      const actionInWhile = whileInThen.body![0] as Action;
      assert.notStrictEqual(actionInWhile.uid, 'action-in-while');
      assert.strictEqual(actionInWhile.action_entity?.action_data?.kwargs?.uid, actionInWhile.uid);

      // Verify step in else branch
      const stepInElse = ifStatement.else![0] as Step;
      assert.notStrictEqual(stepInElse.uid, 'step-in-else');
    });
  });

  describe('Deep cloning', () => {
    it('should create independent clones that do not affect the original', () => {
      const original: Action = {
        uid: 'original-uid',
        type: StatementType.ACTION,
        description: 'Original description',
        action_entity: {
          url: 'https://example.com',
          action_description: 'Original action',
          feedback: '',
          action_data: {
            action_name: 'ai_action',
            args: [],
            kwargs: {
              uid: 'original-uid',
              statement: 'Original statement',
            },
          },
        },
        use_pure_vision: false,
      };

      const cloned = cloneStatementWithNewUids(original) as Action;

      // Modify the cloned statement
      cloned.description = 'Modified description';
      cloned.action_entity!.action_description = 'Modified action';

      // Verify original is unchanged
      assert.strictEqual(original.description, 'Original description');
      assert.strictEqual(original.action_entity?.action_description, 'Original action');
    });
  });
});
