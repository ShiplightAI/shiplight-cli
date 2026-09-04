import { test, expect } from '@playwright/test';
import { parseYamlTestFile } from '../../src/yamlParser';
import { suiteToYaml, yamlToTestFlow } from 'shiplight-types';
import { stringify as yamlStringify } from 'yaml';

test.describe('parseYamlTestFile', () => {
  test('parses basic YAML test flow', () => {
    const yaml = `
goal: Login to the app
base_url: https://example.com
statements:
  - intent: Navigate to login page
  - intent: Enter credentials
`;
    const result = parseYamlTestFile(yaml);
    expect(result.testFlow!.goal).toBe('Login to the app');
    expect(result.testFlow!.baseURL).toBe('https://example.com');
    expect(result.testFlow!.statements).toHaveLength(2);
  });

  test('extracts name extension', () => {
    const yaml = `
name: Custom Test Name
goal: Test something
base_url: https://example.com
statements:
  - intent: Do something
`;
    const result = parseYamlTestFile(yaml);
    expect(result.name).toBe('Custom Test Name');
    expect(result.testFlow!.goal).toBe('Test something');
  });

  test('extracts tags extension', () => {
    const yaml = `
tags:
  - smoke
  - auth
goal: Test login
base_url: https://example.com
statements:
  - intent: Login
`;
    const result = parseYamlTestFile(yaml);
    expect(result.tags).toEqual(['smoke', 'auth']);
  });

  test('extracts use extension', () => {
    const yaml = `
use:
  headless: true
  viewport:
    width: 1280
    height: 720
goal: Test with options
base_url: https://example.com
statements:
  - intent: Do something
`;
    const result = parseYamlTestFile(yaml);
    expect(result.use).toEqual({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });
  });

  test('handles YAML with flat action syntax', () => {
    const yaml = `
goal: Click test
base_url: https://example.com
statements:
  - action: click
    description: Click Submit
    locator: "getByRole('button', { name: 'Submit' })"
`;
    const result = parseYamlTestFile(yaml);
    expect(result.testFlow!.statements).toHaveLength(1);
    expect(result.testFlow!.statements[0].type).toBe('ACTION');
  });

  test('handles VERIFY shorthand', () => {
    const yaml = `
goal: Verify test
base_url: https://example.com
statements:
  - VERIFY: User is logged in
`;
    const result = parseYamlTestFile(yaml);
    expect(result.testFlow!.statements).toHaveLength(1);
    const stmt = result.testFlow!.statements[0];
    expect(stmt.type).toBe('ACTION');
    expect((stmt as any).action_entity?.action_data?.action_name).toBe('verify');
  });

  /* ================================================================
   * CODE shorthand
   * ================================================================ */

  test.describe('CODE shorthand', () => {
    test('single-line CODE shorthand parses to ACTION with js_code', () => {
      const yaml = `
goal: CODE test
base_url: https://example.com
statements:
  - CODE: "await page.route('**/api', r => r.abort())"
`;
      const result = parseYamlTestFile(yaml);
      expect(result.testFlow!.statements).toHaveLength(1);
      const stmt = result.testFlow!.statements[0];
      expect(stmt.type).toBe('ACTION');
      expect((stmt as any).action_entity?.action_data?.action_name).toBe('js_code');
      expect((stmt as any).action_entity?.action_data?.kwargs?.code).toBe(
        "await page.route('**/api', r => r.abort())",
      );
    });

    test('multiline CODE shorthand parses to ACTION with multiline code', () => {
      const yaml = `
goal: CODE test
base_url: https://example.com
statements:
  - CODE: |
      await page.route('**/api/users', (route) => route.fulfill({
        status: 200,
        body: JSON.stringify([{ name: 'John' }]),
      }));
`;
      const result = parseYamlTestFile(yaml);
      const stmt = result.testFlow!.statements[0];
      expect(stmt.type).toBe('ACTION');
      expect((stmt as any).action_entity?.action_data?.action_name).toBe('js_code');
      const code = (stmt as any).action_entity?.action_data?.kwargs?.code as string;
      expect(code).toContain("await page.route('**/api/users'");
      expect(code).toContain('route.fulfill');
    });
  });

  /* ================================================================
   * Execution Control Annotations
   * ================================================================ */

  test.describe('execution control', () => {
    test('extracts timeout from single-test', () => {
      const yaml = `
goal: Test with timeout
base_url: https://example.com
timeout: 30000
statements:
  - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.timeout).toBe(30000);
      expect(result.testFlow).toBeDefined();
    });

    test('extracts skip: true from single-test', () => {
      const yaml = `
goal: Skipped test
base_url: https://example.com
skip: true
statements:
  - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.skip).toBe(true);
    });

    test('extracts skip with reason from single-test', () => {
      const yaml = `
goal: Skipped test
base_url: https://example.com
skip: "Blocked by bug #123"
statements:
  - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.skip).toBe('Blocked by bug #123');
    });

    test('extracts fail: true from single-test', () => {
      const yaml = `
goal: Failing test
base_url: https://example.com
fail: true
statements:
  - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.fail).toBe(true);
    });

    test('extracts only: true from single-test', () => {
      const yaml = `
goal: Focused test
base_url: https://example.com
only: true
statements:
  - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.only).toBe(true);
    });

    test('extracts slow: true from single-test', () => {
      const yaml = `
goal: Slow test
base_url: https://example.com
slow: true
statements:
  - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.slow).toBe(true);
    });

    test('extracts execution control from suite tests', () => {
      const yaml = `
suite:
  base_url: https://example.com
  tests:
    - name: Skipped test
      skip: true
      timeout: 60000
      statements:
        - intent: Do something
    - name: Normal test
      statements:
        - intent: Do something else
`;
      const result = parseYamlTestFile(yaml);
      expect(result.suite!.tests[0].skip).toBe(true);
      expect(result.suite!.tests[0].timeout).toBe(60000);
      expect(result.suite!.tests[1].skip).toBeUndefined();
      expect(result.suite!.tests[1].timeout).toBeUndefined();
    });
  });

  /* ================================================================
   * Feature 11: Test Suites
   * ================================================================ */

  test.describe('suite parsing', () => {
    test('parses suite with multiple tests', () => {
      const yaml = `
name: My Suite
tags: [smoke]

suite:
  tests:
    - name: Test A
      statements:
        - intent: Do step A
    - name: Test B
      statements:
        - intent: Do step B
`;
      const result = parseYamlTestFile(yaml);
      expect(result.suite).toBeDefined();
      expect(result.testFlow).toBeUndefined();
      expect(result.name).toBe('My Suite');
      expect(result.tags).toEqual(['smoke']);
      expect(result.suite!.tests).toHaveLength(2);
      expect(result.suite!.tests[0].name).toBe('Test A');
      expect(result.suite!.tests[1].name).toBe('Test B');
    });

    test('suite test has goal from name', () => {
      const yaml = `
suite:
  tests:
    - name: Test A
      statements:
        - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.suite!.tests[0].testFlow.goal).toBe('Test A');
    });

    test('rejects mix of suite and goal/statements', () => {
      const yaml = `
goal: Some test
statements:
  - intent: Do something
suite:
  tests:
    - name: Test A
      statements:
        - intent: Do something
`;
      expect(() => parseYamlTestFile(yaml)).toThrow(/cannot have both/i);
    });

    test('rejects suite test without name', () => {
      const yaml = `
suite:
  tests:
    - statements:
        - intent: Do something
`;
      expect(() => parseYamlTestFile(yaml)).toThrow(/must have a "name" field/);
    });

    test('rejects suite test without statements', () => {
      const yaml = `
suite:
  tests:
    - name: Empty test
`;
      expect(() => parseYamlTestFile(yaml)).toThrow(/must have a non-empty "statements" array/);
    });

    test('rejects empty suite tests array', () => {
      const yaml = `
suite:
  tests: []
`;
      expect(() => parseYamlTestFile(yaml)).toThrow(/non-empty "tests" array/);
    });
  });

  /* ================================================================
   * Feature 12: Lifecycle Hooks
   * ================================================================ */

  test.describe('hook parsing', () => {
    test('extracts single-test hooks', () => {
      const yaml = `
goal: Test with hooks
base_url: https://example.com

beforeEach:
  - intent: Navigate to login page

afterEach:
  - intent: Clear session

statements:
  - intent: Do the test
`;
      const result = parseYamlTestFile(yaml);
      expect(result.beforeEach).toHaveLength(1);
      expect(result.afterEach).toHaveLength(1);
      expect(result.testFlow).toBeDefined();
    });

    test('extracts suite hooks', () => {
      const yaml = `
suite:
  base_url: https://example.com

  beforeAll:
    - intent: Setup global state

  afterAll:
    - intent: Cleanup global state

  beforeEach:
    - intent: Navigate to page

  afterEach:
    - intent: Clear state

  tests:
    - name: Test A
      statements:
        - intent: Do something
`;
      const result = parseYamlTestFile(yaml);
      expect(result.suite!.beforeAll).toHaveLength(1);
      expect(result.suite!.afterAll).toHaveLength(1);
      expect(result.suite!.beforeEach).toHaveLength(1);
      expect(result.suite!.afterEach).toHaveLength(1);
    });
  });

  /* ================================================================
   * Feature 13: Parameterized Tests
   * ================================================================ */

  test.describe('parameter parsing', () => {
    test('extracts parameters from single-test', () => {
      const yaml = `
goal: Login test
base_url: https://example.com

parameters:
  - name: admin
    values:
      username: admin@test.com
      role: Administrator
  - name: editor
    values:
      username: editor@test.com
      role: Editor

statements:
  - intent: "Enter {{username}}"
`;
      const result = parseYamlTestFile(yaml);
      expect(result.parameters).toHaveLength(2);
      expect(result.parameters![0].name).toBe('admin');
      expect(result.parameters![0].values.username).toBe('admin@test.com');
      expect(result.parameters![1].name).toBe('editor');
    });

    test('extracts parameters from suite test', () => {
      const yaml = `
suite:
  base_url: https://example.com
  tests:
    - name: Login
      parameters:
        - name: user1
          values:
            email: user1@test.com
        - name: user2
          values:
            email: user2@test.com
      statements:
        - intent: "Enter {{email}}"
`;
      const result = parseYamlTestFile(yaml);
      expect(result.suite!.tests[0].parameters).toHaveLength(2);
      expect(result.suite!.tests[0].parameters![0].name).toBe('user1');
    });

    test('rejects parameter set without name', () => {
      const yaml = `
goal: Test
base_url: https://example.com
parameters:
  - values:
      key: value
statements:
  - intent: Do something
`;
      expect(() => parseYamlTestFile(yaml)).toThrow(/must have a "name" field/);
    });

    test('rejects parameter set without values', () => {
      const yaml = `
goal: Test
base_url: https://example.com
parameters:
  - name: test
statements:
  - intent: Do something
`;
      expect(() => parseYamlTestFile(yaml)).toThrow(/must have a "values" object/);
    });
  });

  test.describe('suiteToYaml round-trip', () => {
    test('round-trips a suite with base_url, hooks, and tests', () => {
      const yaml = `
name: My Suite
tags:
  - e2e
suite:
  base_url: https://example.com
  beforeAll:
    - URL: /setup
  beforeEach:
    - URL: /home
  afterEach:
    - intent: Clean up
  afterAll:
    - URL: /teardown
  tests:
    - name: Test A
      statements:
        - intent: Do something
    - name: Test B
      skip: true
      statements:
        - VERIFY: Page loaded
`;
      const parsed = parseYamlTestFile(yaml);
      expect(parsed.suite).toBeDefined();
      const suite = parsed.suite!;

      // Build TestFlow with testGroup (mirrors debugger route logic)
      const parseHookStatements = (hookArray: any[]) => {
        if (!hookArray || hookArray.length === 0) return [];
        const miniDoc = { goal: '_hook', statements: hookArray };
        return yamlToTestFlow(yamlStringify(miniDoc)).statements ?? [];
      };

      const suiteTestFlow = {
        version: '1.3.0' as const,
        baseURL: parsed.use?.baseURL as string | undefined,
        testGroup: {
          beforeAll: parseHookStatements(suite.beforeAll),
          afterAll: parseHookStatements(suite.afterAll),
          beforeEach: parseHookStatements(suite.beforeEach),
          afterEach: parseHookStatements(suite.afterEach),
          tests: suite.tests.map((t) => ({
            name: t.name,
            statements: t.testFlow.statements ?? [],
            teardown: t.testFlow.teardown,
            skip: t.skip,
          })),
        },
      };

      const yamlOut = suiteToYaml(suiteTestFlow, {
        name: 'My Suite',
        tags: ['e2e'],
        use: parsed.use,
      });

      // Parse the output again and verify structure is preserved
      const reparsed = parseYamlTestFile(yamlOut);
      expect(reparsed.name).toBe('My Suite');
      expect(reparsed.tags).toEqual(['e2e']);
      expect(reparsed.suite).toBeDefined();
      // base_url is merged into use.baseURL by the parser, not stored in suite
      expect(reparsed.use).toEqual({ baseURL: 'https://example.com' });
      expect(reparsed.suite!.beforeAll).toHaveLength(1);
      expect(reparsed.suite!.beforeEach).toHaveLength(1);
      expect(reparsed.suite!.afterEach).toHaveLength(1);
      expect(reparsed.suite!.afterAll).toHaveLength(1);
      expect(reparsed.suite!.tests).toHaveLength(2);
      expect(reparsed.suite!.tests[0].name).toBe('Test A');
      expect(reparsed.suite!.tests[1].name).toBe('Test B');
      expect(reparsed.suite!.tests[1].skip).toBe(true);
    });
  });
});
