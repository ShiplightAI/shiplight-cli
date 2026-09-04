import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testFlowToYaml, yamlToTestFlow, extractYamlMetadata, suiteToYaml, actionEntityToYaml, yamlToActionEntity } from './yamlFlowParser.js';
import { StatementType, ConditionType } from './testFlow.js';
import type { TestFlow, Statement, Action, Draft, Step, IfElse, WhileLoop, TestGroup, TestGroupEntry } from './testFlow.js';
import { TestFlowSchema, TestGroupSchema, TestGroupEntrySchema } from './testFlowSchema.js';

describe('yamlFlowParser', () => {
  // ============================================================================
  // testFlowToYaml
  // ============================================================================

  describe('testFlowToYaml', () => {
    it('should convert a simple DRAFT-only flow', () => {
      const flow: TestFlow = {
        version: '1.3.0',
        goal: 'Login and verify dashboard',
        baseURL: 'https://app.example.com',
        statements: [
          { uid: 'a1', type: StatementType.DRAFT, description: 'Enter username admin@test.com' },
          { uid: 'a2', type: StatementType.DRAFT, description: 'Enter password' },
          { uid: 'a3', type: StatementType.DRAFT, description: 'Click login button' },
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('goal: Login and verify dashboard'));
      assert.ok(yaml.includes('base_url: https://app.example.com'));
      // DRAFTs should use intent: format
      assert.ok(yaml.includes('intent: Enter username admin@test.com'));
      assert.ok(yaml.includes('intent: Enter password'));
      assert.ok(yaml.includes('intent: Click login button'));
      // Should not contain uid or version
      assert.ok(!yaml.includes('uid:'));
      assert.ok(!yaml.includes('version:'));
    });

    it('should preserve settings metadata', () => {
      const flow: TestFlow = {
        version: '1.3.0',
        goal: 'Login and verify dashboard',
        statements: [
          { uid: 'a1', type: StatementType.DRAFT, description: 'Click login button' },
        ],
      };

      const yaml = testFlowToYaml(flow, {
        settings: {
          auto_dismiss_modal: true,
          browser_timezone: 'America/Los_Angeles',
          extra_http_headers: {
            'x-test': 'enabled',
          },
        },
      });

      assert.ok(yaml.includes('settings:'));
      assert.ok(yaml.includes('auto_dismiss_modal: true'));
      assert.ok(yaml.includes('browser_timezone: America/Los_Angeles'));
      assert.ok(yaml.includes('x-test: enabled'));
      assert.deepEqual(extractYamlMetadata(yaml).settings, {
        auto_dismiss_modal: true,
        browser_timezone: 'America/Los_Angeles',
        extra_http_headers: {
          'x-test': 'enabled',
        },
      });
    });

    it('should convert VERIFY action to shorthand', () => {
      const flow: TestFlow = {
        goal: 'Verify test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'v1',
            type: StatementType.ACTION,
            description: 'Verify dashboard is visible',
            action_entity: {
              action_description: 'Verify dashboard is visible',
              action_data: {
                action_name: 'verify',
                kwargs: { statement: 'dashboard heading is visible' },
              },
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('VERIFY: dashboard heading is visible'));
    });

    it('should convert ai_wait_until action to WAIT_UNTIL shorthand', () => {
      const flow: TestFlow = {
        goal: 'Wait test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'w1',
            type: StatementType.ACTION,
            description: 'Wait until: Spinner gone',
            action_entity: {
              action_description: 'Wait until: Spinner gone',
              action_data: {
                action_name: 'ai_wait_until',
                kwargs: { condition: 'Spinner gone', timeout_seconds: 20 },
              },
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('WAIT_UNTIL: Spinner gone'));
      assert.ok(yaml.includes('timeout_seconds: 20'));
    });

    it('should re-add the js: prefix when serializing a JS_CODE WAIT_UNTIL', () => {
      const flow: TestFlow = {
        goal: 'Wait test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'w1',
            type: StatementType.ACTION,
            description: "Wait until: !document.querySelector('.spinner')",
            action_entity: {
              action_description: "Wait until: !document.querySelector('.spinner')",
              action_data: {
                action_name: 'ai_wait_until',
                kwargs: {
                  condition: "!document.querySelector('.spinner')",
                  condition_type: ConditionType.JS_CODE,
                  timeout_seconds: 20,
                },
              },
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes("js:!document.querySelector('.spinner')"));
      assert.ok(yaml.includes('timeout_seconds: 20'));
    });

    it('should serialize a WAIT_UNTIL with a js kwarg to the sibling js: form', () => {
      const flow: TestFlow = {
        goal: 'Wait test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'w1',
            type: StatementType.ACTION,
            description: 'Wait until: The dashboard has finished loading',
            action_entity: {
              action_description: 'Wait until: The dashboard has finished loading',
              action_data: {
                action_name: 'ai_wait_until',
                kwargs: {
                  condition: 'The dashboard has finished loading',
                  condition_type: ConditionType.JS_CODE,
                  js: "(await page.locator('.spinner').count()) === 0",
                  timeout_seconds: 20,
                },
              },
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('WAIT_UNTIL: The dashboard has finished loading'), yaml);
      assert.ok(yaml.includes("js: (await page.locator('.spinner').count()) === 0"), yaml);
      assert.ok(!yaml.includes('WAIT_UNTIL: js'), yaml);
      assert.ok(yaml.includes('timeout_seconds: 20'), yaml);
    });

    it('should omit default timeout_seconds (60) in WAIT_UNTIL shorthand', () => {
      const flow: TestFlow = {
        goal: 'Wait test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'w1',
            type: StatementType.ACTION,
            description: 'Wait until: Page ready',
            action_entity: {
              action_description: 'Wait until: Page ready',
              action_data: {
                action_name: 'ai_wait_until',
                kwargs: { condition: 'Page ready', timeout_seconds: 60 },
              },
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('WAIT_UNTIL: Page ready'));
      assert.ok(!yaml.includes('timeout_seconds'));
    });

    it('should convert wait action to WAIT shorthand', () => {
      const flow: TestFlow = {
        goal: 'Wait test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'w1',
            type: StatementType.ACTION,
            description: 'Wait for animation',
            action_entity: {
              action_description: 'Wait for animation',
              action_data: {
                action_name: 'wait',
                kwargs: { seconds: 3 },
              },
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('WAIT: Wait for animation'));
      assert.ok(yaml.includes('seconds: 3'));
    });

    it('should convert ACTION with action_entity to flat syntax with intent first', () => {
      const flow: TestFlow = {
        goal: 'Click test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'c1',
            type: StatementType.ACTION,
            description: 'Click login button',
            action_entity: {
              action_description: 'Click login button',
              action_data: { action_name: 'click', kwargs: {} },
              locator: "getByRole('button', { name: 'Login' })",
              url: 'https://example.com/login',
              feedback: 'Clicked successfully',
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('intent: Click login button'));
      assert.ok(yaml.includes('action: click'));
      assert.ok(yaml.includes("locator: \"getByRole('button', { name: 'Login' })\""));
      // Should not contain nested action_entity structure
      assert.ok(!yaml.includes('action_entity:'));
      assert.ok(!yaml.includes('action_data:'));
      assert.ok(!yaml.includes('feedback:'));
    });

    it('should convert STEP to YAML', () => {
      const flow: TestFlow = {
        goal: 'Step test',
        url: 'https://example.com',
        statements: [
          {
            uid: 's1',
            type: StatementType.STEP,
            description: 'Complete login',
            statements: [
              { uid: 'd1', type: StatementType.DRAFT, description: 'Enter username' },
              { uid: 'd2', type: StatementType.DRAFT, description: 'Enter password' },
            ],
          } as Step,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('STEP: Complete login'));
      assert.ok(yaml.includes('intent: Enter username'));
      assert.ok(yaml.includes('intent: Enter password'));
    });

    it('should convert IF_ELSE to YAML', () => {
      const flow: TestFlow = {
        goal: 'Conditional test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'if1',
            type: StatementType.IF_ELSE,
            condition: { type: ConditionType.AI_MODE, expression: 'cookie consent is visible' },
            then: [
              { uid: 'd1', type: StatementType.DRAFT, description: 'Accept all cookies' },
            ],
            else: [
              { uid: 'd2', type: StatementType.DRAFT, description: 'Continue browsing' },
            ],
          } as IfElse,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('IF: cookie consent is visible'));
      assert.ok(yaml.includes('THEN:'));
      assert.ok(yaml.includes('intent: Accept all cookies'));
      assert.ok(yaml.includes('ELSE:'));
      assert.ok(yaml.includes('intent: Continue browsing'));
    });

    it('should convert WHILE_LOOP to YAML', () => {
      const flow: TestFlow = {
        goal: 'Loop test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'w1',
            type: StatementType.WHILE_LOOP,
            condition: { type: ConditionType.AI_MODE, expression: 'more items to load' },
            body: [
              { uid: 'd1', type: StatementType.DRAFT, description: 'Scroll down' },
            ],
            timeout_ms: 30000,
          } as WhileLoop,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('WHILE: more items to load'));
      assert.ok(yaml.includes('DO:'));
      assert.ok(yaml.includes('intent: Scroll down'));
      assert.ok(yaml.includes('timeout_ms: 30000'));
    });

    it('should convert JS_CODE condition with js: prefix', () => {
      const flow: TestFlow = {
        goal: 'JS condition test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'if1',
            type: StatementType.IF_ELSE,
            condition: {
              type: ConditionType.JS_CODE,
              expression: "document.querySelector('.modal') !== null",
            },
            then: [
              { uid: 'd1', type: StatementType.DRAFT, description: 'Close modal' },
            ],
          } as IfElse,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes("IF: js:document.querySelector('.modal') !== null"));
    });

    it('should include teardown', () => {
      const flow: TestFlow = {
        goal: 'Teardown test',
        url: 'https://example.com',
        statements: [
          { uid: 'd1', type: StatementType.DRAFT, description: 'Do something' },
        ],
        teardown: [
          { uid: 't1', type: StatementType.DRAFT, description: 'Click logout' },
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('teardown:'));
      assert.ok(yaml.includes('intent: Click logout'));
    });

    it('should include final_feedback', () => {
      const flow: TestFlow = {
        goal: 'Feedback test',
        url: 'https://example.com',
        final_feedback: 'Test completed successfully',
        statements: [
          { uid: 'd1', type: StatementType.DRAFT, description: 'Do something' },
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('final_feedback: Test completed successfully'));
    });

    it('should strip uid from ai_action kwargs when serializing', () => {
      const flow: TestFlow = {
        goal: 'AI action test',
        statements: [
          {
            uid: 'a1',
            type: StatementType.ACTION,
            description: 'Click the submit button',
            action_entity: {
              action_description: 'Click the submit button',
              action_data: {
                action_name: 'ai_action',
                args: [],
                kwargs: {
                  statement: 'Click the submit button',
                  uid: 'a1',
                  use_pure_vision: false,
                },
              },
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(!yaml.includes('uid:'), 'uid should not appear in YAML output');
      assert.ok(!yaml.includes('statement:'), 'statement is redundant with intent and should not appear in YAML output');
      assert.ok(yaml.includes('action: ai_action'));
      assert.ok(yaml.includes('intent: Click the submit button'));
    });

    it('should convert ACTION without action_entity to intent-only object', () => {
      const flow: TestFlow = {
        goal: 'Simple action test',
        url: 'https://example.com',
        statements: [
          {
            uid: 'a1',
            type: StatementType.ACTION,
            description: 'Click the button',
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(flow);
      // Should be an intent-only object
      assert.ok(yaml.includes('intent: Click the button'));
    });
  });

  // ============================================================================
  // yamlToTestFlow
  // ============================================================================

  describe('yamlToTestFlow', () => {
    it('should preserve call shorthand and typed positional args through a round-trip', () => {
      const yaml = `
goal: Function call test
statements:
  - intent: Go directly to the target page
    call: "helpers/navigation.func.ts#navigate"
    args: [page, "/target-path", 45000]
`;

      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'function');
      assert.equal(
        stmt.action_entity?.action_data?.kwargs?.functionName,
        'helpers/navigation.func.ts#navigate',
      );
      assert.deepEqual(
        stmt.action_entity?.action_data?.kwargs?.args,
        ['page', '/target-path', 45000],
      );

      const output = testFlowToYaml(flow);
      assert.match(output, /call: helpers\/navigation\.func\.ts#navigate/);
      assert.doesNotMatch(output, /action: function/);
      assert.doesNotMatch(output, /functionName:/);

      const reparsed = yamlToTestFlow(output);
      const reparsedStmt = reparsed.statements![0] as Action;
      assert.deepEqual(
        reparsedStmt.action_entity?.action_data?.kwargs?.args,
        ['page', '/target-path', 45000],
      );
    });

    it('should continue to parse legacy action: function syntax', () => {
      const flow = yamlToTestFlow(`
goal: Legacy function call test
statements:
  - intent: Go directly to the target page
    action: function
    functionName: "helpers/navigation.func.ts#navigate"
    parameterNames: [page, path, timeout]
    parameterValues: [page, "/target-path", 45000]
`);

      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'function');
      assert.deepEqual(
        stmt.action_entity?.action_data?.kwargs?.parameterValues,
        ['page', '/target-path', 45000],
      );
    });

    it('should preserve call shorthand when args are omitted', () => {
      const flow = yamlToTestFlow(`
goal: No-argument function call
statements:
  - intent: Clear state
    call: "helpers/state.func.ts#clear_state"
`);

      const output = testFlowToYaml(flow);
      assert.match(output, /call: helpers\/state\.func\.ts#clear_state/);
      assert.doesNotMatch(output, /action: function/);
      assert.doesNotMatch(output, /args:/);
    });

    it('should parse simple DRAFT-only YAML with intent:', () => {
      const yaml = `
goal: Login and verify dashboard
base_url: https://app.example.com
statements:
  - intent: Enter username admin@test.com
  - intent: Enter password
  - intent: Click login button
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.goal, 'Login and verify dashboard');
      assert.equal(flow.baseURL, 'https://app.example.com');
      assert.equal(flow.version, '1.3.0');
      assert.equal(flow.statements!.length, 3);

      for (const stmt of flow.statements!) {
        assert.equal(stmt.type, 'DRAFT');
        assert.ok((stmt as Draft).uid);
      }

      assert.equal((flow.statements![0] as Draft).description, 'Enter username admin@test.com');
      assert.equal((flow.statements![1] as Draft).description, 'Enter password');
      assert.equal((flow.statements![2] as Draft).description, 'Click login button');
    });

    it('should reject plain string statements', () => {
      const yaml = `
goal: Test
base_url: https://example.com
statements:
  - Click the button
`;
      assert.throws(() => yamlToTestFlow(yaml), /Plain string statements are not supported/);
    });

    it('should parse VERIFY shorthand', () => {
      const yaml = `
goal: Verify test
base_url: https://example.com
statements:
  - VERIFY: dashboard heading is visible
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.action_entity?.action_data?.action_name, 'verify');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.statement, 'dashboard heading is visible');
    });

    it('should parse VERIFY with js sibling', () => {
      const yaml = `
goal: Verify with js cache
base_url: https://example.com
statements:
  - VERIFY: button ABC is visible
    js: "await expect(page.getByRole('button', { name: 'ABC' })).toBeVisible()"
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.action_entity?.action_data?.action_name, 'verify');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.statement, 'button ABC is visible');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.code, "await expect(page.getByRole('button', { name: 'ABC' })).toBeVisible()");
    });

    it('should hoist a list-valued kwarg into kwargs as an array (block and flow syntax)', () => {
      // Structured ACTIONs hoist every non-structural field into kwargs verbatim
      // (parseFlatAction). A YAML sequence — block or flow — must survive as an array,
      // not be coerced to a string. upload_file's `paths` is the motivating case.
      const block = yamlToTestFlow(`
goal: Upload test
base_url: https://example.com
statements:
  - intent: Upload receipts
    action: upload_file
    locator: "getByLabel('Upload')"
    paths:
      - a.pdf
      - b.pdf
`);
      const flow = yamlToTestFlow(`
goal: Upload test
base_url: https://example.com
statements:
  - intent: Upload receipts
    action: upload_file
    locator: "getByLabel('Upload')"
    paths: ["a.pdf", "b.pdf"]
`);

      const blockKwargs = (block.statements![0] as Action).action_entity?.action_data?.kwargs;
      const flowKwargs = (flow.statements![0] as Action).action_entity?.action_data?.kwargs;
      // Assert each form against the literal directly (not just against each other) so a
      // both-undefined regression can't pass.
      assert.deepStrictEqual(blockKwargs?.paths, ['a.pdf', 'b.pdf']);
      assert.deepStrictEqual(flowKwargs?.paths, ['a.pdf', 'b.pdf']);
    });

    it('should keep a single-string list-capable kwarg as a scalar (backward compatible)', () => {
      const flow = yamlToTestFlow(`
goal: Upload test
base_url: https://example.com
statements:
  - intent: Upload receipt
    action: upload_file
    locator: "getByLabel('Upload')"
    paths: a.pdf
`);
      const kwargs = (flow.statements![0] as Action).action_entity?.action_data?.kwargs;
      assert.strictEqual(kwargs?.paths, 'a.pdf');
    });

    it('should parse WAIT_UNTIL shorthand', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: Dashboard data has finished loading
    timeout_seconds: 15
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.action_entity?.action_data?.action_name, 'ai_wait_until');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.condition, 'Dashboard data has finished loading');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.timeout_seconds, 15);
    });

    it('should parse WAIT_UNTIL with default timeout', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: Spinner has disappeared
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'ai_wait_until');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.condition, 'Spinner has disappeared');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.timeout_seconds, 60);
    });

    it('should mark a natural-language WAIT_UNTIL as AI_MODE', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: Spinner has disappeared
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.kwargs?.condition_type, ConditionType.AI_MODE);
    });

    it('should parse WAIT_UNTIL with js: prefix as a JS_CODE condition', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: "js:!document.querySelector('.spinner')"
    timeout_seconds: 10
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'ai_wait_until');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.condition_type, ConditionType.JS_CODE);
      assert.equal(
        stmt.action_entity?.action_data?.kwargs?.condition,
        "!document.querySelector('.spinner')",
      );
      assert.equal(stmt.action_entity?.action_data?.kwargs?.timeout_seconds, 10);
    });

    it('should parse WAIT_UNTIL with a sibling js: key (intent + expression)', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: The dashboard has finished loading
    js: "(await page.locator('.spinner').count()) === 0"
    timeout_seconds: 10
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'ai_wait_until');
      const kwargs = stmt.action_entity?.action_data?.kwargs;
      assert.equal(kwargs?.condition_type, ConditionType.JS_CODE);
      assert.equal(kwargs?.condition, 'The dashboard has finished loading');
      assert.equal(kwargs?.js, "(await page.locator('.spinner').count()) === 0");
      assert.equal(kwargs?.timeout_seconds, 10);
      assert.equal(stmt.description, 'Wait until: The dashboard has finished loading');
    });

    it('should reject a WAIT_UNTIL that combines the js: prefix with a sibling js: key', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: "js: (await page.locator('.a').count()) > 0"
    js: "(await page.locator('.b').count()) > 0"
`;
      assert.throws(() => yamlToTestFlow(yaml), /cannot combine/);
    });

    it('should round-trip a JS_CODE WAIT_UNTIL losslessly through YAML', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: "js:(await page.locator('.item').count()) >= 10"
    timeout_seconds: 20
`;
      const flow = yamlToTestFlow(yaml);
      const out = testFlowToYaml(flow);
      const reparsed = yamlToTestFlow(out);
      const stmt = reparsed.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.kwargs?.condition_type, ConditionType.JS_CODE);
      assert.equal(
        stmt.action_entity?.action_data?.kwargs?.condition,
        "(await page.locator('.item').count()) >= 10",
      );
      assert.equal(stmt.action_entity?.action_data?.kwargs?.timeout_seconds, 20);
    });

    it('should parse WAIT shorthand with intent', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT: Wait for animation to complete
    seconds: 3
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.action_entity?.action_data?.action_name, 'wait');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.seconds, 3);
      assert.equal(stmt.description, 'Wait for animation to complete');
    });

    it('should parse WAIT shorthand without intent', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT:
    seconds: 5
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'wait');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.seconds, 5);
      assert.equal(stmt.description, 'Wait 5s');
    });

    it('should parse WAIT shorthand with default seconds', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT: Brief pause
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'wait');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.seconds, 3);
      assert.equal(stmt.description, 'Brief pause');
    });

    it('should parse ai_action with use_pure_vision: true into kwargs', () => {
      const yaml = `
goal: Vision test
base_url: https://example.com
statements:
  - intent: Click the submit button
    action: ai_action
    use_pure_vision: true
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.action_entity?.action_data?.action_name, 'ai_action');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.use_pure_vision, true);
      assert.equal(stmt.use_pure_vision, true);
    });

    it('should not forward use_pure_vision into kwargs when false', () => {
      const yaml = `
goal: Vision test
base_url: https://example.com
statements:
  - intent: Click the submit button
    action: ai_action
    use_pure_vision: false
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.action_name, 'ai_action');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.use_pure_vision, undefined);
      assert.equal(stmt.use_pure_vision, undefined);
    });

    it('should roundtrip ai_action with use_pure_vision: true (parse → serialize → parse)', () => {
      const yaml = `
goal: Vision roundtrip test
base_url: https://example.com
statements:
  - intent: Click the submit button
    action: ai_action
    use_pure_vision: true
`;
      const flow1 = yamlToTestFlow(yaml);
      const reserialized = testFlowToYaml(flow1);
      const flow2 = yamlToTestFlow(reserialized);
      const stmt1 = flow1.statements![0] as Action;
      const stmt2 = flow2.statements![0] as Action;
      assert.equal(stmt2.action_entity?.action_data?.kwargs?.use_pure_vision, true);
      assert.equal(stmt2.use_pure_vision, stmt1.use_pure_vision);
      assert.equal(stmt2.action_entity?.action_data?.kwargs?.statement, 'Click the submit button');
    });

    it('should parse VERIFY without js — no code key in kwargs', () => {
      const yaml = `
goal: Verify without code
base_url: https://example.com
statements:
  - VERIFY: the page loaded
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity?.action_data?.kwargs?.statement, 'the page loaded');
      assert.equal(stmt.action_entity?.action_data?.kwargs?.code, undefined);
    });

    it('should parse IF_ELSE structure', () => {
      const yaml = `
goal: Conditional test
base_url: https://example.com
statements:
  - IF: cookie consent is visible
    THEN:
      - intent: Accept all cookies
    ELSE:
      - intent: Continue browsing
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as IfElse;
      assert.equal(stmt.type, 'IF_ELSE');
      assert.equal(stmt.condition.type, 'AI_MODE');
      assert.equal(stmt.condition.expression, 'cookie consent is visible');
      assert.equal(stmt.then.length, 1);
      assert.equal((stmt.then[0] as Draft).description, 'Accept all cookies');
      assert.equal(stmt.else!.length, 1);
      assert.equal((stmt.else![0] as Draft).description, 'Continue browsing');
    });

    it('should parse WHILE_LOOP structure', () => {
      const yaml = `
goal: Loop test
base_url: https://example.com
statements:
  - WHILE: more items to load
    DO:
      - intent: Scroll down
    timeout_ms: 30000
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as WhileLoop;
      assert.equal(stmt.type, 'WHILE_LOOP');
      assert.equal(stmt.condition.type, 'AI_MODE');
      assert.equal(stmt.condition.expression, 'more items to load');
      assert.equal(stmt.body.length, 1);
      assert.equal((stmt.body[0] as Draft).description, 'Scroll down');
      assert.equal(stmt.timeout_ms, 30000);
    });

    it('should parse STEP structure', () => {
      const yaml = `
goal: Step test
base_url: https://example.com
statements:
  - STEP: Complete login
    statements:
      - intent: Enter username
      - intent: Enter password
      - intent: Click login button
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Step;
      assert.equal(stmt.type, 'STEP');
      assert.equal(stmt.description, 'Complete login');
      assert.equal(stmt.statements.length, 3);
    });

    it('should parse ACTION with flat syntax using intent', () => {
      const yaml = `
goal: Action test
base_url: https://example.com
statements:
  - intent: Click login button
    action: click
    locator: "getByRole('button', { name: 'Login' })"
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.description, 'Click login button');
      assert.equal(stmt.action_entity?.action_data?.action_name, 'click');
      assert.equal(stmt.action_entity?.locator, "getByRole('button', { name: 'Login' })");
    });

    it('should parse intent-only object as DRAFT', () => {
      const yaml = `
goal: Draft object test
base_url: https://example.com
statements:
  - intent: Fill out the form
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Draft;
      assert.equal(stmt.type, 'DRAFT');
      assert.equal(stmt.description, 'Fill out the form');
    });

    it('should parse JS_CODE condition with js: prefix', () => {
      const yaml = `
goal: JS condition test
base_url: https://example.com
statements:
  - IF: "js:document.querySelector('.modal') !== null"
    THEN:
      - intent: Close modal
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as IfElse;
      assert.equal(stmt.condition.type, 'JS_CODE');
      assert.equal(stmt.condition.expression, "document.querySelector('.modal') !== null");
    });

    it('should parse teardown', () => {
      const yaml = `
goal: Teardown test
base_url: https://example.com
statements:
  - intent: Do something
teardown:
  - intent: Click logout
`;
      const flow = yamlToTestFlow(yaml);
      assert.ok(flow.teardown);
      assert.equal(flow.teardown!.length, 1);
      assert.equal((flow.teardown![0] as Draft).description, 'Click logout');
    });

    it('should parse final_feedback', () => {
      const yaml = `
goal: Feedback test
base_url: https://example.com
final_feedback: Test completed successfully
statements:
  - intent: Do something
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.final_feedback, 'Test completed successfully');
    });

    it('should generate unique UIDs', () => {
      const yaml = `
goal: UID test
base_url: https://example.com
statements:
  - intent: Step one
  - intent: Step two
`;
      const flow = yamlToTestFlow(yaml);
      const uid1 = flow.statements![0].uid;
      const uid2 = flow.statements![1].uid;
      assert.ok(uid1);
      assert.ok(uid2);
      assert.notEqual(uid1, uid2);
    });

    it('should throw on invalid YAML structure', () => {
      assert.throws(() => yamlToTestFlow('not a yaml object'), /Invalid YAML/);
    });

    it('should throw on missing required fields', () => {
      const yaml = `
statements:
  - intent: Do something
`;
      assert.throws(() => yamlToTestFlow(yaml), /Invalid TestFlow/);
    });
  });

  // ============================================================================
  // Roundtrip tests
  // ============================================================================

  describe('roundtrip', () => {
    it('should round-trip a WAIT_UNTIL with sibling js: losslessly', () => {
      const yaml = `
goal: Wait test
base_url: https://example.com
statements:
  - WAIT_UNTIL: The dashboard has finished loading
    js: "(await page.locator('.spinner').count()) === 0"
    timeout_seconds: 10
`;
      const flow = yamlToTestFlow(yaml);
      const flow2 = yamlToTestFlow(testFlowToYaml(flow));
      const kwargs = (flow2.statements![0] as Action).action_entity?.action_data?.kwargs;
      assert.equal(kwargs?.condition, 'The dashboard has finished loading');
      assert.equal(kwargs?.js, "(await page.locator('.spinner').count()) === 0");
      assert.equal(kwargs?.condition_type, ConditionType.JS_CODE);
      assert.equal(kwargs?.timeout_seconds, 10);
    });

    it('should preserve essential data through JSON → YAML → JSON', () => {
      const original: TestFlow = {
        version: '1.3.0',
        goal: 'Login and verify dashboard',
        baseURL: 'https://app.example.com',
        final_feedback: 'Login succeeded',
        completed: true,
        success: true,
        statements: [
          { uid: 'a1', type: StatementType.DRAFT, description: 'Enter username admin@test.com' },
          { uid: 'a2', type: StatementType.DRAFT, description: 'Enter password' },
          {
            uid: 'a3',
            type: StatementType.ACTION,
            description: 'Click login button',
            action_entity: {
              action_description: 'Click login button',
              action_data: { action_name: 'click', kwargs: {} },
              locator: "getByRole('button', { name: 'Login' })",
              url: 'https://example.com',
              feedback: 'Clicked',
            },
          } as Action,
          {
            uid: 'v1',
            type: StatementType.ACTION,
            description: 'Verify dashboard',
            action_entity: {
              action_description: 'Verify dashboard',
              action_data: { action_name: 'verify', kwargs: { statement: 'dashboard is visible' } },
            },
          } as Action,
          {
            uid: 'v2',
            type: StatementType.ACTION,
            description: 'Verify button with code cache',
            action_entity: {
              action_description: 'Verify button with code cache',
              action_data: { action_name: 'verify', kwargs: { statement: 'button is visible', code: "await expect(page.getByRole('button')).toBeVisible()" } },
            },
          } as Action,
        ],
        teardown: [
          { uid: 't1', type: StatementType.DRAFT, description: 'Click logout' },
        ],
      };

      const yaml = testFlowToYaml(original);
      const roundtripped = yamlToTestFlow(yaml);

      // Goal, baseURL, and final_feedback should be preserved
      assert.equal(roundtripped.goal, original.goal);
      assert.equal(roundtripped.baseURL, original.baseURL);
      assert.equal(roundtripped.final_feedback, original.final_feedback);

      // Statement count should be preserved
      assert.equal(roundtripped.statements!.length, original.statements!.length);

      // DRAFT descriptions
      assert.equal((roundtripped.statements![0] as Draft).description, 'Enter username admin@test.com');
      assert.equal((roundtripped.statements![1] as Draft).description, 'Enter password');

      // ACTION preserves action_data and locator through flat syntax roundtrip
      const clickAction = roundtripped.statements![2] as Action;
      assert.equal(clickAction.type, 'ACTION');
      assert.equal(clickAction.description, 'Click login button');
      assert.equal(clickAction.action_entity?.action_data?.action_name, 'click');
      assert.equal(clickAction.action_entity?.locator, "getByRole('button', { name: 'Login' })");

      // VERIFY roundtrips through shorthand
      const verifyAction = roundtripped.statements![3] as Action;
      assert.equal(verifyAction.type, 'ACTION');
      assert.equal(verifyAction.action_entity?.action_data?.action_name, 'verify');
      assert.equal(verifyAction.action_entity?.action_data?.kwargs?.statement, 'dashboard is visible');

      // VERIFY with js roundtrips through shorthand (js: in YAML → kwargs.code internally)
      const verifyWithCode = roundtripped.statements![4] as Action;
      assert.equal(verifyWithCode.type, 'ACTION');
      assert.equal(verifyWithCode.action_entity?.action_data?.action_name, 'verify');
      assert.equal(verifyWithCode.action_entity?.action_data?.kwargs?.statement, 'button is visible');
      assert.equal(verifyWithCode.action_entity?.action_data?.kwargs?.code, "await expect(page.getByRole('button')).toBeVisible()");

      // Teardown preserved
      assert.ok(roundtripped.teardown);
      assert.equal(roundtripped.teardown!.length, 1);
      assert.equal((roundtripped.teardown![0] as Draft).description, 'Click logout');
    });

    it('should preserve complex structure through roundtrip', () => {
      const original: TestFlow = {
        version: '1.3.0',
        goal: 'Complex flow',
        url: 'https://example.com',
        statements: [
          {
            uid: 'if1',
            type: StatementType.IF_ELSE,
            condition: { type: ConditionType.AI_MODE, expression: 'cookie dialog visible' },
            then: [
              { uid: 'd1', type: StatementType.DRAFT, description: 'Accept cookies' },
            ],
            else: [
              { uid: 'd2', type: StatementType.DRAFT, description: 'Skip' },
            ],
          } as IfElse,
          {
            uid: 's1',
            type: StatementType.STEP,
            description: 'Login',
            statements: [
              { uid: 'd3', type: StatementType.DRAFT, description: 'Enter username' },
              { uid: 'd4', type: StatementType.DRAFT, description: 'Enter password' },
            ],
          } as Step,
          {
            uid: 'w1',
            type: StatementType.WHILE_LOOP,
            condition: { type: ConditionType.AI_MODE, expression: 'loading spinner visible' },
            body: [
              { uid: 'd5', type: StatementType.DRAFT, description: 'Wait' },
            ],
            timeout_ms: 15000,
          } as WhileLoop,
        ],
      };

      const yaml = testFlowToYaml(original);
      const roundtripped = yamlToTestFlow(yaml);

      assert.equal(roundtripped.statements!.length, 3);

      // IF_ELSE
      const ifElse = roundtripped.statements![0] as IfElse;
      assert.equal(ifElse.type, 'IF_ELSE');
      assert.equal(ifElse.condition.expression, 'cookie dialog visible');
      assert.equal(ifElse.then.length, 1);
      assert.equal(ifElse.else!.length, 1);

      // STEP
      const step = roundtripped.statements![1] as Step;
      assert.equal(step.type, 'STEP');
      assert.equal(step.description, 'Login');
      assert.equal(step.statements.length, 2);

      // WHILE_LOOP
      const whileLoop = roundtripped.statements![2] as WhileLoop;
      assert.equal(whileLoop.type, 'WHILE_LOOP');
      assert.equal(whileLoop.condition.expression, 'loading spinner visible');
      assert.equal(whileLoop.body.length, 1);
      assert.equal(whileLoop.timeout_ms, 15000);
    });
  });

  // ============================================================================
  // YAML metadata
  // ============================================================================

  describe('YAML metadata', () => {
    it('extractYamlMetadata returns test_case_id when present', () => {
      const yaml = `
test_case_id: 42
goal: Test
base_url: https://example.com
statements:
  - intent: Do something
`;
      const meta = extractYamlMetadata(yaml);
      assert.deepEqual(meta, { test_case_id: 42 });
    });

    it('extractYamlMetadata returns {} when test_case_id is missing', () => {
      const yaml = `
goal: Test
base_url: https://example.com
statements:
  - intent: Do something
`;
      const meta = extractYamlMetadata(yaml);
      assert.deepEqual(meta, {});
    });

    it('extractYamlMetadata returns {} for non-numeric values', () => {
      const yaml = `
test_case_id: abc
goal: Test
base_url: https://example.com
statements:
  - intent: Do something
`;
      const meta = extractYamlMetadata(yaml);
      assert.deepEqual(meta, {});
    });

    it('testFlowToYaml with metadata includes test_case_id', () => {
      const flow: TestFlow = {
        goal: 'Meta test',
        url: 'https://example.com',
        statements: [
          { uid: 'd1', type: StatementType.DRAFT, description: 'Do something' },
        ],
      };

      const yaml = testFlowToYaml(flow, { test_case_id: 42 });
      assert.ok(yaml.includes('test_case_id: 42'));
    });

    it('testFlowToYaml without metadata omits test_case_id', () => {
      const flow: TestFlow = {
        goal: 'No meta test',
        url: 'https://example.com',
        statements: [
          { uid: 'd1', type: StatementType.DRAFT, description: 'Do something' },
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(!yaml.includes('test_case_id'));
    });

    it('yamlToTestFlow ignores test_case_id (not on TestFlow)', () => {
      const yaml = `
test_case_id: 42
goal: Ignore meta test
base_url: https://example.com
statements:
  - intent: Do something
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.goal, 'Ignore meta test');
      assert.ok(!('test_case_id' in flow));
    });

    it('roundtrip: testFlowToYaml with metadata → extractYamlMetadata → gets ID; yamlToTestFlow → no test_case_id', () => {
      const flow: TestFlow = {
        goal: 'Roundtrip meta test',
        url: 'https://example.com',
        statements: [
          { uid: 'd1', type: StatementType.DRAFT, description: 'Do something' },
        ],
      };

      const yaml = testFlowToYaml(flow, { test_case_id: 99 });

      // extractYamlMetadata should recover the ID
      const meta = extractYamlMetadata(yaml);
      assert.equal(meta.test_case_id, 99);

      // yamlToTestFlow should not have test_case_id
      const parsed = yamlToTestFlow(yaml);
      assert.ok(!('test_case_id' in parsed));
      assert.equal(parsed.goal, 'Roundtrip meta test');
    });
  });

  // ============================================================================
  // TestFlow Zod Schema validation
  // ============================================================================

  describe('TestFlowSchema validation', () => {
    it('should accept single-test TestFlow with goal and statements', () => {
      const flow = {
        version: '1.3.0',
        goal: 'Test login',
        statements: [{ uid: '1', type: 'DRAFT', description: 'Click login' }],
      };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(result.success, `Expected valid: ${JSON.stringify(result.error?.errors)}`);
    });

    it('should accept single-test TestFlow with goal and empty statements', () => {
      const flow = { goal: 'Test login', statements: [] };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(result.success);
    });

    it('should accept single-test TestFlow with goal only (no statements)', () => {
      const flow = { goal: 'Test login' };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(result.success);
    });

    it('should reject TestFlow with statements but no goal (and no testGroup)', () => {
      const flow = {
        statements: [{ uid: '1', type: 'DRAFT', description: 'Click login' }],
      };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(!result.success);
    });

    it('should accept TestFlow with testGroup', () => {
      const flow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Login test',
            statements: [{ uid: '1', type: 'DRAFT', description: 'Click login' }],
          }],
        },
      };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(result.success, `Expected valid: ${JSON.stringify(result.error?.errors)}`);
    });

    it('should reject TestFlow with both goal and testGroup', () => {
      const flow = {
        goal: 'Test login',
        testGroup: {
          tests: [{
            name: 'Login test',
            statements: [{ uid: '1', type: 'DRAFT', description: 'Click login' }],
          }],
        },
      };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(!result.success);
    });

    it('should reject TestFlow with neither goal nor testGroup', () => {
      const flow = { version: '1.3.0' };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(!result.success);
    });

    it('should accept testGroup with hooks', () => {
      const flow = {
        testGroup: {
          tests: [{
            name: 'Test A',
            statements: [{ uid: '1', type: 'DRAFT', description: 'Do A' }],
          }],
          beforeAll: [{ uid: 'ba1', type: 'DRAFT', description: 'Setup' }],
          afterAll: [{ uid: 'aa1', type: 'DRAFT', description: 'Teardown' }],
          beforeEach: [{ uid: 'be1', type: 'DRAFT', description: 'Before each' }],
          afterEach: [{ uid: 'ae1', type: 'DRAFT', description: 'After each' }],
        },
      };
      const result = TestFlowSchema.safeParse(flow);
      assert.ok(result.success, `Expected valid: ${JSON.stringify(result.error?.errors)}`);
    });
  });

  // ============================================================================
  // TestGroupEntry and TestGroup Zod schemas
  // ============================================================================

  describe('TestGroupEntrySchema', () => {
    it('should accept minimal entry', () => {
      const entry = {
        name: 'Test A',
        statements: [{ uid: '1', type: 'DRAFT', description: 'Do something' }],
      };
      const result = TestGroupEntrySchema.safeParse(entry);
      assert.ok(result.success);
    });

    it('should keep tags on the parsed entry', () => {
      // Zod strips unknown keys, so without `tags` in the schema every
      // `.parse()` would silently drop a suite test's tags.
      const result = TestGroupEntrySchema.safeParse({
        name: 'Test A',
        statements: [{ uid: '1', type: 'DRAFT', description: 'Do something' }],
        tags: ['auth', 'slow-path'],
      });
      assert.ok(result.success);
      assert.deepEqual(result.data.tags, ['auth', 'slow-path']);
    });

    it('should accept entry with all optional fields', () => {
      const entry = {
        name: 'Test A',
        statements: [{ uid: '1', type: 'DRAFT', description: 'Do A' }],
        teardown: [{ uid: 't1', type: 'DRAFT', description: 'Cleanup' }],
        skip: 'flaky',
        timeout: 30000,
        fail: true,
        only: true,
        slow: true,
      };
      const result = TestGroupEntrySchema.safeParse(entry);
      assert.ok(result.success);
    });

    it('should reject entry without name', () => {
      const entry = {
        statements: [{ uid: '1', type: 'DRAFT', description: 'Do something' }],
      };
      const result = TestGroupEntrySchema.safeParse(entry);
      assert.ok(!result.success);
    });
  });

  describe('TestGroupSchema', () => {
    it('should accept group with only tests', () => {
      const group = {
        tests: [{
          name: 'Test A',
          statements: [{ uid: '1', type: 'DRAFT', description: 'Do A' }],
        }],
      };
      const result = TestGroupSchema.safeParse(group);
      assert.ok(result.success);
    });

    it('should reject group with empty tests', () => {
      const group = { tests: [] };
      const result = TestGroupSchema.safeParse(group);
      assert.ok(!result.success);
    });

    it('should accept group with all hooks', () => {
      const group = {
        tests: [{
          name: 'Test A',
          statements: [{ uid: '1', type: 'DRAFT', description: 'Do A' }],
        }],
        beforeAll: [{ uid: 'ba', type: 'DRAFT', description: 'Before all' }],
        afterAll: [{ uid: 'aa', type: 'DRAFT', description: 'After all' }],
        beforeEach: [{ uid: 'be', type: 'DRAFT', description: 'Before each' }],
        afterEach: [{ uid: 'ae', type: 'DRAFT', description: 'After each' }],
      };
      const result = TestGroupSchema.safeParse(group);
      assert.ok(result.success);
    });
  });

  // ============================================================================
  // yamlToTestFlow — suite YAML → TestFlow with testGroup
  // ============================================================================

  describe('yamlToTestFlow suite parsing', () => {
    it('should parse minimal suite YAML into TestFlow with testGroup', () => {
      const yaml = `
suite:
  tests:
    - name: Login test
      statements:
        - intent: Click login
    - name: Signup test
      statements:
        - intent: Click signup
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.version, '1.3.0');
      assert.equal(flow.goal, undefined);
      assert.equal(flow.statements, undefined);
      assert.ok(flow.testGroup);
      assert.equal(flow.testGroup!.tests.length, 2);
      assert.equal(flow.testGroup!.tests[0].name, 'Login test');
      assert.equal(flow.testGroup!.tests[0].statements.length, 1);
      assert.equal((flow.testGroup!.tests[0].statements[0] as Draft).description, 'Click login');
      assert.equal(flow.testGroup!.tests[1].name, 'Signup test');
    });

    // Regression for issue #2209 — the documented top-level `base_url` (YAML
    // spec §3) was dropped for suite files because only the nested
    // `suite.base_url` written by suiteToYaml was ever read.
    it('should read a top-level base_url on a suite file', () => {
      const yaml = `
name: Repro
base_url: https://example.com

suite:
  tests:
    - name: anything
      statements:
        - intent: Do something
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.baseURL, 'https://example.com');
    });

    it('should let the nested suite.base_url win over a top-level base_url', () => {
      const yaml = `
base_url: https://outer.example.com

suite:
  base_url: https://inner.example.com
  tests:
    - name: anything
      statements:
        - intent: Do something
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.baseURL, 'https://inner.example.com');
    });

    it('should parse suite YAML with hooks', () => {
      const yaml = `
suite:
  beforeAll:
    - intent: Open browser
  afterAll:
    - intent: Close browser
  beforeEach:
    - intent: Navigate to home
  afterEach:
    - intent: Clear cookies
  tests:
    - name: Test A
      statements:
        - intent: Do A
`;
      const flow = yamlToTestFlow(yaml);
      assert.ok(flow.testGroup);
      const group = flow.testGroup!;
      assert.equal(group.beforeAll!.length, 1);
      assert.equal((group.beforeAll![0] as Draft).description, 'Open browser');
      assert.equal(group.afterAll!.length, 1);
      assert.equal((group.afterAll![0] as Draft).description, 'Close browser');
      assert.equal(group.beforeEach!.length, 1);
      assert.equal((group.beforeEach![0] as Draft).description, 'Navigate to home');
      assert.equal(group.afterEach!.length, 1);
      assert.equal((group.afterEach![0] as Draft).description, 'Clear cookies');
    });

    it('should parse suite test with execution control annotations', () => {
      const yaml = `
suite:
  tests:
    - name: Skipped test
      skip: flaky on CI
      statements:
        - intent: Never runs
    - name: Slow test
      slow: true
      timeout: 60000
      statements:
        - intent: Takes a while
    - name: Expected failure
      fail: known bug
      statements:
        - intent: Fails gracefully
    - name: Focus test
      only: true
      statements:
        - intent: Only this runs
`;
      const flow = yamlToTestFlow(yaml);
      const tests = flow.testGroup!.tests;
      assert.equal(tests.length, 4);

      assert.equal(tests[0].skip, 'flaky on CI');
      assert.equal(tests[1].slow, true);
      assert.equal(tests[1].timeout, 60000);
      assert.equal(tests[2].fail, 'known bug');
      assert.equal(tests[3].only, true);
    });

    it('should parse suite test with teardown', () => {
      const yaml = `
suite:
  tests:
    - name: Test with cleanup
      statements:
        - intent: Do something
      teardown:
        - intent: Clean up
`;
      const flow = yamlToTestFlow(yaml);
      const test = flow.testGroup!.tests[0];
      assert.ok(test.teardown);
      assert.equal(test.teardown!.length, 1);
      assert.equal((test.teardown![0] as Draft).description, 'Clean up');
    });

    it('should parse suite with base_url into TestFlow.baseURL', () => {
      const yaml = `
suite:
  base_url: https://example.com
  tests:
    - name: Test A
      statements:
        - intent: Do A
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.baseURL, 'https://example.com');
    });

    it('should generate UIDs for suite statements', () => {
      const yaml = `
suite:
  beforeEach:
    - intent: Setup
  tests:
    - name: Test
      statements:
        - intent: Action
`;
      const flow = yamlToTestFlow(yaml);
      const hookUid = flow.testGroup!.beforeEach![0].uid;
      const testUid = flow.testGroup!.tests[0].statements[0].uid;
      assert.ok(hookUid, 'Hook statement should have UID');
      assert.ok(testUid, 'Test statement should have UID');
      assert.notEqual(hookUid, testUid, 'UIDs should be unique');
    });

    it('should parse ACTION statements in suite tests', () => {
      const yaml = `
suite:
  tests:
    - name: Action test
      statements:
        - intent: Click button
          action: click
          locator: "getByRole('button', { name: 'Submit' })"
        - VERIFY: form submitted
`;
      const flow = yamlToTestFlow(yaml);
      const stmts = flow.testGroup!.tests[0].statements;
      assert.equal(stmts.length, 2);

      const clickAction = stmts[0] as Action;
      assert.equal(clickAction.type, 'ACTION');
      assert.equal(clickAction.action_entity?.action_data?.action_name, 'click');
      assert.equal(clickAction.action_entity?.locator, "getByRole('button', { name: 'Submit' })");

      const verifyAction = stmts[1] as Action;
      assert.equal(verifyAction.type, 'ACTION');
      assert.equal(verifyAction.action_entity?.action_data?.action_name, 'verify');
    });

    it('should throw on suite with no tests', () => {
      const yaml = `
suite:
  tests: []
`;
      assert.throws(() => yamlToTestFlow(yaml), /non-empty "tests"/);
    });

    it('should throw on suite test without name', () => {
      const yaml = `
suite:
  tests:
    - statements:
        - intent: No name
`;
      assert.throws(() => yamlToTestFlow(yaml), /must have a "name"/);
    });

    it('should throw on suite test without statements', () => {
      const yaml = `
suite:
  tests:
    - name: Empty test
      statements: []
`;
      assert.throws(() => yamlToTestFlow(yaml), /non-empty "statements"/);
    });
  });

  // ============================================================================
  // suiteToYaml — TestFlow with testGroup → YAML
  // ============================================================================

  describe('suiteToYaml', () => {
    /**
     * Regression for the follow-up to issue #2209 — suiteToYaml wrote baseURL
     * only as the nested `suite.base_url`, so a debugger save silently moved a
     * hand-written top-level `base_url` into the undocumented spelling. Write
     * the documented top-level key, matching testFlowToYamlObject.
     */
    it('should write base_url at the top level, not nested under suite', () => {
      const yaml = suiteToYaml({
        version: '1.3.0',
        baseURL: 'https://example.com',
        testGroup: {
          tests: [{ name: 'anything', statements: [{ type: StatementType.DRAFT, description: 'Do something' } as Draft] }],
        },
      });

      const suiteIndex = yaml.indexOf('suite:');
      const baseUrlIndex = yaml.indexOf('base_url: https://example.com');
      assert.ok(baseUrlIndex !== -1, 'base_url must be emitted');
      assert.ok(baseUrlIndex < suiteIndex, 'base_url must sit above the suite: key, at the top level');
    });

    it('should round-trip per-test tags through suiteToYaml and back', () => {
      // Regression: TestGroupEntry had no `tags` field, so a debugger save
      // silently deleted a suite test's `tags:`. Those tags select tests via
      // `--grep`, so losing one changes which tests a CI job runs, with no error.
      const yaml = suiteToYaml({
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Checkout',
            tags: ['pro', 'billing'],
            statements: [{ type: StatementType.DRAFT, description: 'Do something' } as Draft],
          }],
        },
      });

      assert.ok(yaml.includes('tags:'), 'per-test tags must be written back to YAML');

      const reparsed = yamlToTestFlow(yaml);
      assert.deepEqual(reparsed.testGroup?.tests[0].tags, ['pro', 'billing']);
    });

    it('should accept a bare scalar tags value as a one-element list', () => {
      // Regression: `tags: smoke` (no list) transpiles to a real Playwright tag,
      // but this parser required an array and returned undefined — so opening
      // the file in the debugger and saving deleted the tag, and the next
      // `--grep '@smoke'` CI job selected nothing, with no error.
      const metadata = extractYamlMetadata('tags: smoke\ngoal: X\nstatements: []\n');

      assert.deepEqual(metadata.tags, ['smoke']);
    });

    it('should drop blank tag entries rather than round-tripping them', () => {
      const metadata = extractYamlMetadata('tags:\n  - ""\n  - smoke\ngoal: X\nstatements: []\n');

      assert.deepEqual(metadata.tags, ['smoke']);
    });

    it('should keep a non-string file-level tag instead of dropping the block', () => {
      // Regression: the file-level guard required EVERY entry to be a string,
      // so an unquoted `tags: [2026]` (a year, a version, a ticket number) made
      // a debugger save delete the whole tags block with no error — while
      // per-test tags coerced it. Same file, two behaviors.
      const metadata = extractYamlMetadata('tags:\n  - 2026\n  - smoke\ngoal: X\nstatements: []\n');

      assert.deepEqual(metadata.tags, ['2026', 'smoke']);
    });

    it('should omit tags entirely for a suite test that has none', () => {
      const yaml = suiteToYaml({
        version: '1.3.0',
        testGroup: {
          tests: [{ name: 'Plain', statements: [{ type: StatementType.DRAFT, description: 'Do something' } as Draft] }],
        },
      });

      assert.ok(!yaml.includes('tags:'));
      assert.equal(yamlToTestFlow(yaml).testGroup?.tests[0].tags, undefined);
    });

    it('should round-trip base_url through suiteToYaml and back', () => {
      const yaml = suiteToYaml({
        version: '1.3.0',
        baseURL: 'https://example.com',
        testGroup: {
          tests: [{ name: 'anything', statements: [{ type: StatementType.DRAFT, description: 'Do something' } as Draft] }],
        },
      });

      assert.equal(yamlToTestFlow(yaml).baseURL, 'https://example.com');
    });

    it('should convert minimal TestFlow with testGroup to YAML', () => {
      const testFlow: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Login test',
            statements: [
              { uid: '1', type: StatementType.DRAFT, description: 'Click login' },
            ],
          }],
        },
      };

      const yaml = suiteToYaml(testFlow);
      assert.ok(yaml.includes('suite:'));
      assert.ok(yaml.includes('name: Login test'));
      assert.ok(yaml.includes('intent: Click login'));
      assert.ok(!yaml.includes('uid:'));
    });

    it('should convert TestFlow with testGroup hooks to YAML', () => {
      const testFlow: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Test A',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do A' }],
          }],
          beforeAll: [{ uid: 'ba', type: StatementType.DRAFT, description: 'Setup all' }],
          afterAll: [{ uid: 'aa', type: StatementType.DRAFT, description: 'Teardown all' }],
          beforeEach: [{ uid: 'be', type: StatementType.DRAFT, description: 'Setup each' }],
          afterEach: [{ uid: 'ae', type: StatementType.DRAFT, description: 'Cleanup each' }],
        },
      };

      const yaml = suiteToYaml(testFlow);
      assert.ok(yaml.includes('beforeAll:'));
      assert.ok(yaml.includes('intent: Setup all'));
      assert.ok(yaml.includes('afterAll:'));
      assert.ok(yaml.includes('intent: Teardown all'));
      assert.ok(yaml.includes('beforeEach:'));
      assert.ok(yaml.includes('intent: Setup each'));
      assert.ok(yaml.includes('afterEach:'));
      assert.ok(yaml.includes('intent: Cleanup each'));
    });

    it('should include execution control annotations in YAML', () => {
      const testFlow: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Skipped test',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Skip me' }],
            skip: 'flaky',
            timeout: 30000,
          }],
        },
      };

      const yaml = suiteToYaml(testFlow);
      assert.ok(yaml.includes('skip: flaky'));
      assert.ok(yaml.includes('timeout: 30000'));
    });

    it('should include per-test teardown in YAML', () => {
      const testFlow: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Test with cleanup',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do work' }],
            teardown: [{ uid: 't1', type: StatementType.DRAFT, description: 'Clean up' }],
          }],
        },
      };

      const yaml = suiteToYaml(testFlow);
      assert.ok(yaml.includes('teardown:'));
      assert.ok(yaml.includes('intent: Clean up'));
    });

    it('should include base_url from TestFlow.baseURL', () => {
      const testFlow: TestFlow = {
        version: '1.3.0',
        baseURL: 'https://example.com',
        testGroup: {
          tests: [{
            name: 'Test A',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do A' }],
          }],
        },
      };

      const yaml = suiteToYaml(testFlow);
      assert.ok(yaml.includes('base_url: https://example.com'));
    });

    it('should include metadata in YAML output', () => {
      const testFlow: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Test A',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do A' }],
          }],
        },
      };

      const yaml = suiteToYaml(testFlow, {
        test_case_id: 42,
        name: 'My Suite',
        tags: ['e2e', 'login'],
        use: { locale: 'en-US' },
      });
      assert.ok(yaml.includes('test_case_id: 42'));
      assert.ok(yaml.includes('name: My Suite'));
      assert.ok(yaml.includes('tags: [ e2e, login ]') || yaml.includes("tags: [e2e, login]"));
      assert.ok(yaml.includes('use:'));
      assert.ok(yaml.includes('locale: en-US'));
    });

    it('should throw if TestFlow has no testGroup', () => {
      const testFlow: TestFlow = {
        goal: 'Single test',
        statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do something' }],
      };

      assert.throws(() => suiteToYaml(testFlow), /testGroup/);
    });
  });

  // ============================================================================
  // testFlowToYaml — delegates to suiteToYaml for testGroup
  // ============================================================================

  describe('testFlowToYaml with testGroup', () => {
    it('should delegate to suiteToYaml when testGroup is present', () => {
      const testFlow: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Test A',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do A' }],
          }],
        },
      };

      const yaml = testFlowToYaml(testFlow);
      assert.ok(yaml.includes('suite:'));
      assert.ok(yaml.includes('name: Test A'));
    });

    it('should still produce single-test YAML when no testGroup', () => {
      const testFlow: TestFlow = {
        goal: 'Simple test',
        statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do something' }],
      };

      const yaml = testFlowToYaml(testFlow);
      assert.ok(yaml.includes('goal: Simple test'));
      assert.ok(!yaml.includes('suite:'));
    });
  });

  // ============================================================================
  // Suite roundtrip: TestFlow → YAML → TestFlow
  // ============================================================================

  describe('suite roundtrip', () => {
    it('should roundtrip a simple suite through YAML', () => {
      const original: TestFlow = {
        version: '1.3.0',
        baseURL: 'https://example.com',
        testGroup: {
          tests: [
            {
              name: 'Login test',
              statements: [
                { uid: 'a1', type: StatementType.DRAFT, description: 'Enter username' },
                { uid: 'a2', type: StatementType.DRAFT, description: 'Click login' },
              ],
            },
            {
              name: 'Signup test',
              statements: [
                { uid: 'b1', type: StatementType.DRAFT, description: 'Enter email' },
              ],
              skip: true,
            },
          ],
          beforeEach: [
            { uid: 'be1', type: StatementType.DRAFT, description: 'Navigate to home' },
          ],
        },
      };

      const yaml = testFlowToYaml(original);
      const roundtripped = yamlToTestFlow(yaml);

      assert.equal(roundtripped.version, '1.3.0');
      assert.equal(roundtripped.baseURL, 'https://example.com');
      assert.equal(roundtripped.goal, undefined);
      assert.equal(roundtripped.statements, undefined);

      const group = roundtripped.testGroup!;
      assert.equal(group.tests.length, 2);
      assert.equal(group.tests[0].name, 'Login test');
      assert.equal(group.tests[0].statements.length, 2);
      assert.equal((group.tests[0].statements[0] as Draft).description, 'Enter username');
      assert.equal((group.tests[0].statements[1] as Draft).description, 'Click login');

      assert.equal(group.tests[1].name, 'Signup test');
      assert.equal(group.tests[1].skip, true);

      assert.equal(group.beforeEach!.length, 1);
      assert.equal((group.beforeEach![0] as Draft).description, 'Navigate to home');
    });

    it('should roundtrip suite with hooks and teardown', () => {
      const original: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Test A',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do A' }],
            teardown: [{ uid: 't1', type: StatementType.DRAFT, description: 'Clean A' }],
          }],
          beforeAll: [{ uid: 'ba', type: StatementType.DRAFT, description: 'Global setup' }],
          afterAll: [{ uid: 'aa', type: StatementType.DRAFT, description: 'Global teardown' }],
          beforeEach: [{ uid: 'be', type: StatementType.DRAFT, description: 'Per-test setup' }],
          afterEach: [{ uid: 'ae', type: StatementType.DRAFT, description: 'Per-test cleanup' }],
        },
      };

      const yaml = testFlowToYaml(original);
      const roundtripped = yamlToTestFlow(yaml);
      const group = roundtripped.testGroup!;

      assert.equal((group.beforeAll![0] as Draft).description, 'Global setup');
      assert.equal((group.afterAll![0] as Draft).description, 'Global teardown');
      assert.equal((group.beforeEach![0] as Draft).description, 'Per-test setup');
      assert.equal((group.afterEach![0] as Draft).description, 'Per-test cleanup');
      assert.equal((group.tests[0].teardown![0] as Draft).description, 'Clean A');
    });

    it('should roundtrip suite with ACTION statements', () => {
      const original: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Action test',
            statements: [
              {
                uid: 'v1',
                type: StatementType.ACTION,
                description: 'Verify page loaded',
                action_entity: {
                  action_description: 'Verify page loaded',
                  action_data: { action_name: 'verify', kwargs: { statement: 'page is loaded' } },
                },
              } as Action,
              {
                uid: 'c1',
                type: StatementType.ACTION,
                description: 'Click submit',
                action_entity: {
                  action_description: 'Click submit',
                  action_data: { action_name: 'click', kwargs: {} },
                  locator: "getByRole('button', { name: 'Submit' })",
                },
              } as Action,
            ],
          }],
        },
      };

      const yaml = testFlowToYaml(original);
      const roundtripped = yamlToTestFlow(yaml);
      const stmts = roundtripped.testGroup!.tests[0].statements;

      const verify = stmts[0] as Action;
      assert.equal(verify.action_entity?.action_data?.action_name, 'verify');
      assert.equal(verify.action_entity?.action_data?.kwargs?.statement, 'page is loaded');

      const click = stmts[1] as Action;
      assert.equal(click.action_entity?.action_data?.action_name, 'click');
      assert.equal(click.action_entity?.locator, "getByRole('button', { name: 'Submit' })");
    });

    it('should roundtrip suite with metadata', () => {
      const original: TestFlow = {
        version: '1.3.0',
        testGroup: {
          tests: [{
            name: 'Test A',
            statements: [{ uid: '1', type: StatementType.DRAFT, description: 'Do A' }],
          }],
        },
      };

      const yaml = testFlowToYaml(original, { test_case_id: 99, name: 'My Suite' });

      // extractYamlMetadata should recover the metadata
      const meta = extractYamlMetadata(yaml);
      assert.equal(meta.test_case_id, 99);
      assert.equal(meta.name, 'My Suite');

      // Roundtrip should preserve suite structure
      const roundtripped = yamlToTestFlow(yaml);
      assert.ok(roundtripped.testGroup);
      assert.equal(roundtripped.testGroup!.tests[0].name, 'Test A');
    });
  });

  // ============================================================================
  // Backward compatibility — v1.2.0 single-test flows still work
  // ============================================================================

  describe('backward compatibility', () => {
    it('should still parse single-test YAML without testGroup', () => {
      const yaml = `
goal: Login test
url: https://example.com
statements:
  - intent: Click login
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.goal, 'Login test');
      assert.ok(flow.statements);
      assert.equal(flow.statements!.length, 1);
      assert.equal(flow.testGroup, undefined);
    });

    it('should still produce single-test YAML for flows without testGroup', () => {
      const flow: TestFlow = {
        goal: 'Test login',
        url: 'https://example.com',
        statements: [
          { uid: '1', type: StatementType.DRAFT, description: 'Click login' },
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('goal: Test login'));
      assert.ok(!yaml.includes('suite:'));
      assert.ok(!yaml.includes('testGroup'));
    });

    it('should parse legacy desc: field as intent (backward compat)', () => {
      const yaml = `
goal: Legacy desc test
base_url: https://example.com
statements:
  - desc: Click the legacy button
  - desc: Enter username
    action: input_text
    locator: "getByPlaceholder('Email')"
    text: "user@test.com"
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 2);
      // desc: parsed as DRAFT
      assert.equal((flow.statements![0] as Draft).type, 'DRAFT');
      assert.equal((flow.statements![0] as Draft).description, 'Click the legacy button');
      // desc: + action parsed as ACTION
      assert.equal((flow.statements![1] as Action).type, 'ACTION');
      assert.equal((flow.statements![1] as Action).description, 'Enter username');
    });

    it('should parse description: + js: as a non-healing js_code action', () => {
      const yaml = `
goal: Code escape hatch test
statements:
  - description: Mock the users API to return empty
    js: "await page.route('**/api/users', r => r.fulfill({ status: 200, body: '[]' }))"
`;
      const flow = yamlToTestFlow(yaml);
      assert.equal(flow.statements!.length, 1);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.description, 'Mock the users API to return empty');
      assert.equal(stmt.action_entity!.action_data!.action_name, 'js_code');
      assert.match(stmt.action_entity!.action_data!.kwargs.code as string, /page\.route/);
    });

    it('should reject intent: + js: (raw js no longer self-heals)', () => {
      const yaml = `
goal: bad
statements:
  - intent: Submit the form
    js: "await page.getByRole('button', { name: 'Submit' }).click()"
`;
      assert.throws(() => yamlToTestFlow(yaml), /description:.*not.*intent:|does not self-heal/i);
    });

    it('should parse a bare js: statement (description optional, defaults to a label)', () => {
      const yaml = `
goal: bare js
statements:
  - js: "await page.waitForLoadState('networkidle')"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.action_entity!.action_data!.action_name, 'js_code');
      assert.equal(stmt.description, 'Code block');
    });

    it('should still parse CODE: as a back-compat alias for js_code', () => {
      const yaml = `
goal: legacy code block
statements:
  - CODE: "await page.evaluate(() => localStorage.clear())"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.type, 'ACTION');
      assert.equal(stmt.action_entity!.action_data!.action_name, 'js_code');
    });

    it('should prefer a description: sibling over the "Code block" default when CODE: is used', () => {
      const yaml = `
goal: named legacy code
statements:
  - description: Clear local storage
    CODE: "await page.evaluate(() => localStorage.clear())"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity!.action_data!.action_name, 'js_code');
      assert.equal(stmt.description, 'Clear local storage');
      // the description sibling must not clobber the js payload
      assert.equal(stmt.action_entity!.action_data!.kwargs.code, "await page.evaluate(() => localStorage.clear())");
    });

    it('should round-trip a description: + js: action through testFlowToYaml', () => {
      const yaml = `
goal: roundtrip
statements:
  - description: Seed auth token
    js: "await page.evaluate(() => localStorage.setItem('t', 'x'))"
`;
      const flow = yamlToTestFlow(yaml);
      const out = testFlowToYaml(flow);
      assert.ok(out.includes('description: Seed auth token'));
      assert.ok(out.includes('js:'));
      assert.ok(!out.includes('intent: Seed auth token'));
      // and it parses back to the same js_code action
      const reparsed = yamlToTestFlow(out);
      assert.equal((reparsed.statements![0] as Action).action_entity!.action_data!.action_name, 'js_code');
    });

    it('should serialize a legacy js_action Action to description: + js: via testFlowToYaml', () => {
      const flow: TestFlow = {
        goal: 'legacy js_action roundtrip',
        statements: [
          {
            uid: 'x1',
            type: StatementType.ACTION,
            description: 'Drag the slider',
            action_entity: {
              action_description: 'Drag the slider',
              action_data: {
                action_name: 'js_action',
                kwargs: { code: "await page.getByRole('slider').first().fill('50')" },
              },
            },
          } as Action,
        ],
      };
      const out = testFlowToYaml(flow);
      assert.ok(out.includes('description: Drag the slider'));
      assert.ok(out.includes('js:'));
      assert.ok(!out.includes('intent: Drag the slider'));
      assert.ok(!out.includes('CODE:'));
      // legacy js_action collapses to the non-healing js_code form on re-parse
      const reparsed = yamlToTestFlow(out);
      assert.equal((reparsed.statements![0] as Action).action_entity!.action_data!.action_name, 'js_code');
    });

    it('should reject mixing suite: and top-level goal in same YAML', () => {
      // yamlToTestFlow parses suite: key, which means goal is not at top level
      // If the YAML has suite: key, goal inside suite is NOT the same as top-level goal
      const yaml = `
suite:
  tests:
    - name: Test A
      statements:
        - intent: Do A
`;
      const flow = yamlToTestFlow(yaml);
      // Suite YAML → testGroup, no goal
      assert.ok(flow.testGroup);
      assert.equal(flow.goal, undefined);
    });
  });

  // ============================================================================
  // {{VAR}} variable syntax — regression tests
  //
  // YAML interprets unquoted {{ as a flow mapping. These tests verify that
  // {{VAR}} survives round-trip through yamlToTestFlow regardless of quoting.
  // ============================================================================

  describe('{{VAR}} variable syntax', () => {
    it('should parse quoted {{VAR}} in flat action kwargs (input_text)', () => {
      const yaml = `
goal: test variables
statements:
  - action: input_text
    intent: Enter username
    text: "{{TEST_USER}}"
    locator: "getByRole('textbox', { name: 'Email' })"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity!.action_data!.kwargs.text, '{{TEST_USER}}');
    });

    it('should parse single-quoted {{VAR}} in flat action kwargs', () => {
      const yaml = `
goal: test variables
statements:
  - action: input_text
    intent: Enter password
    text: '{{TEST_PASS}}'
    locator: "getByRole('textbox', { name: 'Password' })"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity!.action_data!.kwargs.text, '{{TEST_PASS}}');
    });

    it('should parse unquoted {{VAR}} in flat action kwargs as a string', () => {
      // This is the reported bug: unquoted {{VAR}} gets parsed as a YAML
      // flow mapping { "{ VAR }": null } instead of the string "{{VAR}}"
      const yaml = `
goal: test variables
statements:
  - action: input_text
    intent: Enter username
    text: {{TEST_USER}}
    locator: "getByRole('textbox', { name: 'Email' })"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(typeof stmt.action_entity!.action_data!.kwargs.text, 'string',
        'text kwarg should be a string, not an object (flow mapping)');
      assert.equal(stmt.action_entity!.action_data!.kwargs.text, '{{TEST_USER}}');
    });

    it('should parse unquoted {{VAR}} in VERIFY shorthand as a string', () => {
      const yaml = `
goal: test variables
statements:
  - VERIFY: "{{EXPECTED_TEXT}} is visible"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity!.action_data!.kwargs.statement, '{{EXPECTED_TEXT}} is visible');
    });

    it('should parse unquoted standalone {{VAR}} in VERIFY shorthand', () => {
      // Standalone unquoted {{VAR}} as VERIFY value
      const yaml = `
goal: test variables
statements:
  - VERIFY: {{EXPECTED}}
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(typeof stmt.description, 'string');
      assert.match(stmt.description!, /EXPECTED/);
    });

    it('should round-trip {{VAR}} through testFlowToYaml → yamlToTestFlow', () => {
      const original: TestFlow = {
        version: '1.3.0',
        goal: 'test round-trip',
        statements: [
          {
            uid: 'a1',
            type: StatementType.ACTION,
            description: 'Enter username',
            action_entity: {
              action_description: 'Enter username',
              action_data: {
                action_name: 'input_text',
                kwargs: { text: '{{TEST_USER}}' },
              },
              locator: "getByRole('textbox', { name: 'Email' })",
            },
          } as Action,
        ],
      };

      const yaml = testFlowToYaml(original);
      const parsed = yamlToTestFlow(yaml);
      const stmt = parsed.statements![0] as Action;
      assert.equal(stmt.action_entity!.action_data!.kwargs.text, '{{TEST_USER}}',
        '{{VAR}} should survive round-trip without corruption');
    });

    it('should handle multiple {{VAR}} references in kwargs', () => {
      const yaml = `
goal: test multiple vars
statements:
  - action: input_text
    intent: Enter credentials
    text: "{{USERNAME}}:{{PASSWORD}}"
    locator: "getByRole('textbox')"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity!.action_data!.kwargs.text, '{{USERNAME}}:{{PASSWORD}}');
    });

    it('should handle {{ VAR }} with spaces in kwargs', () => {
      const yaml = `
goal: test spaced vars
statements:
  - action: input_text
    intent: Enter username
    text: "{{ TEST_USER }}"
    locator: "getByRole('textbox')"
`;
      const flow = yamlToTestFlow(yaml);
      const stmt = flow.statements![0] as Action;
      assert.equal(stmt.action_entity!.action_data!.kwargs.text, '{{ TEST_USER }}');
    });
  });

  // ============================================================================
  // actionEntityToYaml / yamlToActionEntity
  // ============================================================================

  describe('actionEntityToYaml', () => {
    it('should convert a click action to flat YAML', () => {
      const yaml = actionEntityToYaml(
        {
          action_description: 'Click login button',
          action_data: { action_name: 'click', kwargs: { text: 'Login' } },
          locator: "getByRole('button')",
        },
        'Click login button',
      );
      assert.ok(yaml.includes('action: click'));
      assert.ok(yaml.includes('text: Login'));
      assert.ok(yaml.includes("locator: getByRole('button')"));
    });

    it('should return empty for VERIFY without js (fully redundant with description)', () => {
      const yaml = actionEntityToYaml(
        {
          action_description: 'Dashboard is visible',
          action_data: { action_name: 'verify', kwargs: { statement: 'Dashboard is visible' } },
        },
        'Dashboard is visible',
      );
      assert.equal(yaml, '');
    });

    it('should produce URL shorthand for go_to_url', () => {
      const yaml = actionEntityToYaml(
        {
          action_description: 'Navigate to https://example.com',
          action_data: { action_name: 'go_to_url', kwargs: { url: 'https://example.com' } },
        },
      );
      assert.ok(yaml.includes('URL: https://example.com'));
    });

    it('should emit js: (not CODE:) for a js_code action and strip the description', () => {
      const yaml = actionEntityToYaml(
        {
          action_description: 'Abort all API requests',
          action_data: { action_name: 'js_code', kwargs: { code: "await page.route('**/api', r => r.abort())" } },
        },
        'Abort all API requests',
      );
      assert.ok(yaml.includes('js:'), 'should emit js: key');
      assert.ok(!yaml.includes('description:'), 'description is shown separately in the editor, not in the flat box');
      assert.ok(!yaml.includes('CODE:'), 'should not emit the deprecated CODE: alias');
    });
  });

  describe('yamlToActionEntity', () => {
    it('should parse a flat YAML action back to ActionEntity', () => {
      const result = yamlToActionEntity(`
intent: Click login button
action: click
locator: getByRole('button')
text: Login
      `);
      assert.equal(result.actionEntity.action_data!.action_name, 'click');
      assert.equal(result.actionEntity.action_data!.kwargs.text, 'Login');
      assert.equal(result.locator, "getByRole('button')");
      assert.equal(result.description, 'Click login button');
    });

    it('should parse VERIFY shorthand', () => {
      const result = yamlToActionEntity('VERIFY: Dashboard is visible');
      assert.equal(result.actionEntity.action_data!.action_name, 'verify');
      assert.equal(result.actionEntity.action_data!.kwargs.statement, 'Dashboard is visible');
    });

    it('should parse URL shorthand', () => {
      const result = yamlToActionEntity('URL: https://example.com');
      assert.equal(result.actionEntity.action_data!.action_name, 'go_to_url');
      assert.equal(result.actionEntity.action_data!.kwargs.url, 'https://example.com');
    });

    it('should parse CODE shorthand', () => {
      const result = yamlToActionEntity('CODE: console.log("hello")');
      assert.equal(result.actionEntity.action_data!.action_name, 'js_code');
      assert.equal(result.actionEntity.action_data!.kwargs.code, 'console.log("hello")');
    });

    it('should parse WAIT_UNTIL with a sibling js: key (intent + expression)', () => {
      const result = yamlToActionEntity(`
WAIT_UNTIL: The dashboard has finished loading
js: "(await page.locator('.spinner').count()) === 0"
timeout_seconds: 10
      `);
      assert.equal(result.actionEntity.action_data!.action_name, 'ai_wait_until');
      const kwargs = result.actionEntity.action_data!.kwargs;
      assert.equal(kwargs.condition, 'The dashboard has finished loading');
      assert.equal(kwargs.condition_type, ConditionType.JS_CODE);
      assert.equal(kwargs.js, "(await page.locator('.spinner').count()) === 0");
      assert.equal(kwargs.timeout_seconds, 10);
      // Label matches parseStatement's for the same statement.
      assert.equal(result.description, 'Wait until: The dashboard has finished loading');
    });

    it('should reject WAIT_UNTIL combining the js: prefix with a sibling js: key', () => {
      assert.throws(
        () => yamlToActionEntity(`
WAIT_UNTIL: "js: (await page.locator('.a').count()) > 0"
js: "(await page.locator('.b').count()) > 0"
        `),
        /cannot combine/,
      );
    });

    it('should round-trip a click action', () => {
      const original = {
        action_description: 'Click submit',
        action_data: { action_name: 'click', kwargs: { text: 'Submit' } },
        locator: "getByRole('button')",
      };
      const yaml = actionEntityToYaml(original, 'Click submit', "getByRole('button')");
      const result = yamlToActionEntity(yaml);
      assert.equal(result.actionEntity.action_data!.action_name, 'click');
      assert.equal(result.actionEntity.action_data!.kwargs.text, 'Submit');
      assert.equal(result.locator, "getByRole('button')");
    });

    it('should parse a bare js: statement to js_code (description optional)', () => {
      const result = yamlToActionEntity("js: \"await page.waitForLoadState('networkidle')\"");
      assert.equal(result.actionEntity.action_data!.action_name, 'js_code');
      assert.equal(result.actionEntity.action_data!.kwargs.code, "await page.waitForLoadState('networkidle')");
    });

    it('should parse description: + js: to js_code', () => {
      const result = yamlToActionEntity("description: Mock the API\njs: \"await page.route('**/api', r => r.abort())\"");
      assert.equal(result.actionEntity.action_data!.action_name, 'js_code');
      assert.equal(result.description, 'Mock the API');
      assert.equal(result.actionEntity.action_data!.kwargs.code, "await page.route('**/api', r => r.abort())");
    });

    it('should round-trip a js_code action through actionEntityToYaml → yamlToActionEntity (editor parity with CODE:)', () => {
      const original = {
        action_description: 'Seed auth token',
        action_data: { action_name: 'js_code', kwargs: { code: "await page.evaluate(() => localStorage.setItem('t', 'x'))" } },
      };
      const yaml = actionEntityToYaml(original, 'Seed auth token');
      const result = yamlToActionEntity(yaml);
      assert.equal(result.actionEntity.action_data!.action_name, 'js_code');
      assert.equal(result.actionEntity.action_data!.kwargs.code, "await page.evaluate(() => localStorage.setItem('t', 'x'))");
    });

    it('should accept intent: as a description fallback in the UI editor (legacy display strings)', () => {
      // Deliberate divergence from the file parser (parseStatement throws on intent+js);
      // the UI editor stays lenient for legacy display strings. Lock in that contract.
      const result = yamlToActionEntity("intent: Drag the slider\njs: \"await page.getByRole('slider').first().fill('50')\"");
      assert.equal(result.actionEntity.action_data!.action_name, 'js_code');
      assert.equal(result.description, 'Drag the slider');
    });

    it('should hoist a block-sequence kwarg into kwargs as an array (not coerce to string)', () => {
      const result = yamlToActionEntity(`
intent: Upload receipts
action: upload_file
locator: getByLabel('Upload')
paths:
  - a.pdf
  - b.pdf
      `);
      assert.equal(result.actionEntity.action_data!.action_name, 'upload_file');
      assert.deepStrictEqual(result.actionEntity.action_data!.kwargs.paths, ['a.pdf', 'b.pdf']);
    });

    it('should parse a flow-sequence kwarg identically to the block form', () => {
      const block = yamlToActionEntity(`
intent: Upload receipts
action: upload_file
locator: getByLabel('Upload')
paths:
  - a.pdf
  - b.pdf
      `);
      const flow = yamlToActionEntity(`
intent: Upload receipts
action: upload_file
locator: getByLabel('Upload')
paths: ["a.pdf", "b.pdf"]
      `);
      // Block vs flow YAML are two spellings of the same value — both must hoist to the same array.
      assert.deepStrictEqual(
        flow.actionEntity.action_data!.kwargs.paths,
        block.actionEntity.action_data!.kwargs.paths,
      );
      assert.deepStrictEqual(flow.actionEntity.action_data!.kwargs.paths, ['a.pdf', 'b.pdf']);
    });

    it('should keep a single-string kwarg as a scalar (backward compatible)', () => {
      const result = yamlToActionEntity(`
intent: Upload receipt
action: upload_file
locator: getByLabel('Upload')
paths: a.pdf
      `);
      assert.strictEqual(result.actionEntity.action_data!.kwargs.paths, 'a.pdf');
    });
  });

  // ============================================================================
  // Comment round-trip (yamlToTestFlow → testFlowToYaml)
  // ============================================================================

  describe('comment round-trip', () => {
    it('should preserve top-of-file comment through round-trip', () => {
      const yaml = `# This is a test file
# with multiple comment lines
goal: Test something

statements:
  - URL: /page
`;
      const testFlow = yamlToTestFlow(yaml);
      assert.ok(testFlow.comment, 'should extract top-of-file comment');
      assert.ok(testFlow.comment!.includes('This is a test file'));

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# This is a test file'), 'should preserve top comment in output');
      assert.ok(output.includes('# with multiple comment lines'), 'should preserve multi-line comment');
    });

    it('should preserve statement comments through round-trip', () => {
      const yaml = `goal: Test

statements:
  # Navigate first
  - URL: /page

  # Then verify
  - VERIFY: Page is loaded
`;
      const testFlow = yamlToTestFlow(yaml);
      assert.equal(testFlow.statements![0].comment, ' Navigate first');
      assert.equal(testFlow.statements![1].comment, ' Then verify');

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# Navigate first'), 'should preserve first comment');
      assert.ok(output.includes('# Then verify'), 'should preserve second comment');
    });

    it('should preserve comments even after modifying a statement', () => {
      const yaml = `goal: Test

statements:
  # Navigate first
  - URL: /page

  # Click action
  - intent: Click login
    action: click
    locator: "#login"
`;
      const testFlow = yamlToTestFlow(yaml);

      // Modify a statement
      const action = testFlow.statements![1] as Action;
      action.action_entity!.locator = '#new-login';

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# Navigate first'), 'should preserve first comment');
      assert.ok(output.includes('# Click action'), 'should preserve second comment');
      assert.ok(output.includes('#new-login'), 'should have modified locator');
    });

    it('should preserve comments after adding a statement', () => {
      const yaml = `goal: Test

statements:
  # Original step
  - URL: /page
`;
      const testFlow = yamlToTestFlow(yaml);
      testFlow.statements!.push({
        uid: 'new',
        type: StatementType.DRAFT,
        description: 'New step',
      });

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# Original step'), 'should preserve comment');
      assert.ok(output.includes('New step'), 'should have new statement');
    });

    it('should preserve comments after deleting a statement', () => {
      const yaml = `goal: Test

statements:
  # First
  - URL: /page

  # Second (will be deleted)
  - VERIFY: Something

  # Third
  - VERIFY: Final check
`;
      const testFlow = yamlToTestFlow(yaml);
      // Delete the second statement
      testFlow.statements!.splice(1, 1);

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# First'), 'should preserve first comment');
      assert.ok(output.includes('# Third'), 'should preserve third comment');
      assert.ok(output.includes('Final check'), 'should have third statement');
    });

    it('should preserve all comments and blank lines through debugger round-trip (regression)', () => {
      // Simulates the full debugger path:
      // 1. parseYamlTestFile strips comments during re-serialization
      // 2. extractAndAttachComments re-attaches from original YAML
      // 3. User modifies a statement
      // 4. testFlowToYaml emits comments back
      const originalYaml = `# 02 — VERIFY Assertions
# Demonstrates: enriched VERIFY (js: code) and draft VERIFY (AI-only)
# Enriched VERIFYs run JS first (<1s), falling back to AI if it fails.

goal: Verify inventory page elements

statements:
  - URL: /inventory.html

  # Enriched VERIFYs — fast, deterministic
  - VERIFY: The text 'Products' is visible as a heading on the page
    js: "await expect(page.getByText('Products')).toBeVisible({ timeout: 2000 })"

  - VERIFY: There are 6 product items displayed
    js: "await expect(page.locator('.inventory_item')).toHaveCount(6, { timeout: 2000 })"

  # Draft VERIFY — AI only
  - VERIFY: The sidebar menu button is visible
`;
      // Step 1: yamlToTestFlow (simulating parseYamlTestFile + extractAndAttachComments)
      const testFlow = yamlToTestFlow(originalYaml);

      // Step 2: Modify one statement (user edits in debugger)
      const action = testFlow.statements![1] as Action;
      action.description = 'The text Products is visible.';
      if (action.action_entity) {
        action.action_entity.action_description = action.description;
        action.action_entity.action_data!.kwargs.statement = action.description;
      }

      // Step 3: Save back to YAML
      const output = testFlowToYaml(testFlow);

      // Top-of-file comments preserved
      assert.ok(output.includes('# 02 — VERIFY Assertions'), 'should preserve top-of-file comment line 1');
      assert.ok(output.includes('# Enriched VERIFYs run JS first'), 'should preserve top-of-file comment line 3');

      // Inline comments preserved
      assert.ok(output.includes('# Enriched VERIFYs — fast, deterministic'), 'should preserve inline comment');
      assert.ok(output.includes('# Draft VERIFY — AI only'), 'should preserve draft comment');

      // Blank lines between statements preserved
      assert.ok(output.includes('inventory.html\n\n'), 'should have blank line after URL statement');

      // The modified statement is present
      assert.ok(output.includes('The text Products is visible.'), 'should have modified description');

      // Unmodified statements preserved
      assert.ok(output.includes('There are 6 product items displayed'), 'should preserve unmodified statement');
      assert.ok(output.includes('The sidebar menu button is visible'), 'should preserve draft verify');
    });

    it('should preserve top-of-file comment with blank line separation (regression)', () => {
      // The yaml library puts comments on doc.commentBefore when there's
      // a blank line between comments and the first key
      const yaml = `# File header comment
# Second line

goal: Test something

statements:
  - URL: /page
`;
      const testFlow = yamlToTestFlow(yaml);
      assert.ok(testFlow.comment, 'should extract top comment');
      assert.ok(testFlow.comment!.includes('File header comment'));

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# File header comment'), 'should emit top comment');
      assert.ok(output.includes('# Second line'), 'should emit second line');
      // Verify blank line between comment and goal
      const lines = output.split('\n');
      const commentEndIdx = lines.findIndex(l => l.includes('Second line'));
      const goalIdx = lines.findIndex(l => l.includes('goal:'));
      assert.ok(goalIdx > commentEndIdx + 1, 'should have blank line between comment and goal');
    });

    it('should preserve comments inside IF_ELSE branches', () => {
      const yaml = `goal: Test control flow

statements:
  # Check condition
  - IF: dialog is visible
    THEN:
      # Accept it
      - intent: Click accept
        action: click
        locator: "#accept"
    ELSE:
      # Nothing to do
      - intent: Skip
`;
      const testFlow = yamlToTestFlow(yaml);
      const ifElse = testFlow.statements![0] as IfElse;
      assert.equal(ifElse.then[0].comment, ' Accept it');
      assert.equal(ifElse.else![0].comment, ' Nothing to do');

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# Accept it'), 'should preserve THEN comment');
      assert.ok(output.includes('# Nothing to do'), 'should preserve ELSE comment');
    });

    it('should preserve comments inside WHILE_LOOP body', () => {
      const yaml = `goal: Test loops

statements:
  - WHILE: notifications visible
    timeout_seconds: 30
    DO:
      # Dismiss each one
      - intent: Click dismiss
        action: click
        locator: "#dismiss"
`;
      const testFlow = yamlToTestFlow(yaml);
      const loop = testFlow.statements![0] as WhileLoop;
      assert.equal(loop.body[0].comment, ' Dismiss each one');

      const output = testFlowToYaml(testFlow);
      assert.ok(output.includes('# Dismiss each one'), 'should preserve loop body comment');
    });
  });

  // ============================================================================
  // template_path round-trip
  // ============================================================================

  describe('template_path round-trip', () => {
    it('should serialize Step with template_path to template: syntax', () => {
      const flow: TestFlow = {
        goal: 'Test with template',
        statements: [
          {
            uid: 's1',
            type: StatementType.STEP,
            description: 'Login',
            template_path: './templates/login.yaml',
            template_params: { username: 'admin', password: 'secret' },
            statements: [
              { uid: 'a1', type: StatementType.DRAFT, description: 'Enter username' },
            ],
          } as Step,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('template: ./templates/login.yaml'), 'should emit template: path');
      assert.ok(yaml.includes('username: admin'), 'should emit params');
      assert.ok(yaml.includes('password: secret'), 'should emit params');
      assert.ok(!yaml.includes('STEP:'), 'should NOT emit STEP:');
      assert.ok(!yaml.includes('intent: Enter username'), 'should NOT inline child statements');
    });

    it('should serialize Step with template_path but no params', () => {
      const flow: TestFlow = {
        goal: 'Test with template',
        statements: [
          {
            uid: 's1',
            type: StatementType.STEP,
            description: 'Dismiss',
            template_path: '../dismiss.yaml',
            statements: [],
          } as Step,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('template: ../dismiss.yaml'));
      assert.ok(!yaml.includes('params:'), 'should NOT emit empty params');
    });

    it('should serialize normal Step (no template_path) as STEP:', () => {
      const flow: TestFlow = {
        goal: 'Normal step',
        statements: [
          {
            uid: 's1',
            type: StatementType.STEP,
            description: 'Group',
            statements: [
              { uid: 'a1', type: StatementType.DRAFT, description: 'Do something' },
            ],
          } as Step,
        ],
      };

      const yaml = testFlowToYaml(flow);
      assert.ok(yaml.includes('STEP: Group'));
      assert.ok(!yaml.includes('template:'));
    });

    it('should parse STEP with template_path and template_params', () => {
      const yaml = `
goal: test
statements:
  - STEP: Login
    template_path: ./login.yaml
    template_params:
      user: admin
    statements:
      - intent: click
`;
      const flow = yamlToTestFlow(yaml);
      const step = flow.statements![0] as Step;
      assert.equal(step.type, StatementType.STEP);
      assert.equal(step.template_path, './login.yaml');
      assert.deepEqual(step.template_params, { user: 'admin' });
    });

    it('should preserve template_path through full round-trip', () => {
      const yaml = `
goal: test
statements:
  - STEP: Login
    template_path: ./login.yaml
    template_params:
      user: admin
    statements:
      - intent: click
`;
      const flow = yamlToTestFlow(yaml);
      const output = testFlowToYaml(flow);
      assert.ok(output.includes('template: ./login.yaml'), 'template: should survive round-trip');
      assert.ok(output.includes('user: admin'), 'params should survive round-trip');
      assert.ok(!output.includes('STEP:'), 'should emit template: not STEP:');
    });
  });

  // ============================================================================
  // timeout metadata round-trip
  // ============================================================================

  describe('timeout metadata', () => {
    it('extractYamlMetadata should extract timeout', () => {
      const yaml = `
test_case_id: 42
timeout: 1800000
goal: test
statements:
  - intent: click
`;
      const meta = extractYamlMetadata(yaml);
      assert.equal(meta.test_case_id, 42);
      assert.equal(meta.timeout, 1800000);
    });

    it('extractYamlMetadata should omit timeout when not present', () => {
      const yaml = `
goal: test
statements:
  - intent: click
`;
      const meta = extractYamlMetadata(yaml);
      assert.equal(meta.timeout, undefined);
    });

    it('testFlowToYaml should include timeout from metadata', () => {
      const flow: TestFlow = {
        goal: 'test',
        statements: [
          { uid: 'a1', type: StatementType.DRAFT, description: 'click' },
        ],
      };

      const yaml = testFlowToYaml(flow, { timeout: 1800000 });
      assert.ok(yaml.includes('timeout: 1800000'));
    });

    it('testFlowToYaml should place timeout before statements', () => {
      const flow: TestFlow = {
        goal: 'test',
        statements: [
          { uid: 'a1', type: StatementType.DRAFT, description: 'click' },
        ],
      };

      const yaml = testFlowToYaml(flow, { timeout: 1800000 });
      const timeoutIndex = yaml.indexOf('timeout:');
      const statementsIndex = yaml.indexOf('statements:');
      assert.ok(timeoutIndex < statementsIndex, 'timeout should appear before statements');
    });

    it('should round-trip timeout through metadata', () => {
      const flow: TestFlow = {
        goal: 'test',
        baseURL: 'https://example.com',
        statements: [
          { uid: 'a1', type: StatementType.DRAFT, description: 'click' },
        ],
      };

      const yaml = testFlowToYaml(flow, { test_case_id: 99, timeout: 1800000 });
      const meta = extractYamlMetadata(yaml);
      assert.equal(meta.test_case_id, 99);
      assert.equal(meta.timeout, 1800000);
    });
  });
});
