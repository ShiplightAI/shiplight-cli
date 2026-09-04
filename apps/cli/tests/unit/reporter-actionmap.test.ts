import { test, expect } from '@playwright/test';
import { parseYamlTestFile } from '../../src/yamlParser';
import { extractActionStepsFromTestFlow } from 'shiplight-types';
import { writeFileSync, mkdirSync } from 'fs';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createTempDir(): string {
  const dir = join(tmpdir(), 'shiplight-reporter-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function withTempDir(fn: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = createTempDir();
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

test.describe('reporter actionStepsMap with templates', () => {
  test('includes steps after template when basePath is provided', async () => {
    await withTempDir((dir) => {
      const templatesDir = join(dir, 'templates');
      mkdirSync(templatesDir, { recursive: true });

      writeFileSync(join(templatesDir, 'dismiss-banner.tmpl.yaml'), `
statements:
  - intent: Dismiss cookie banner
    action: click
    locator: getByTestId('dismiss-banner')
`);

      const testsDir = join(dir, 'tests');
      mkdirSync(testsDir, { recursive: true });

      const yamlContent = `
name: Test with template
goal: Verify template expansion in reporter
base_url: https://example.com
statements:
  - URL: /
  - template: templates/dismiss-banner.tmpl.yaml
  - intent: Click submit button
    action: click
    locator: getByTestId('submit')
`;
      const yamlPath = join(testsDir, 'example.test.yaml');
      writeFileSync(yamlPath, yamlContent);

      const parsed = parseYamlTestFile(yamlContent, yamlPath, dir);
      const actionStepsMap = extractActionStepsFromTestFlow(parsed.testFlow!);

      expect(Object.keys(actionStepsMap).length).toBeGreaterThan(0);
      // main.0 = URL: /
      expect(actionStepsMap['main.0']).toBeDefined();
      expect(actionStepsMap['main.0'].action_entity?.action_data?.action_name).toBe('go_to_url');
      // main.1 = template expanded as STEP → child at main.1.0
      expect(actionStepsMap['main.1.0']).toBeDefined();
      expect(actionStepsMap['main.1.0'].description).toContain('Dismiss cookie banner');
      // main.2 = click submit (the step AFTER the template)
      expect(actionStepsMap['main.2']).toBeDefined();
      expect(actionStepsMap['main.2'].description).toContain('Click submit button');
      expect(actionStepsMap['main.2'].action_entity?.action_data?.action_name).toBe('click');
    });
  });

  test('returns empty map when basePath is missing and template cannot be resolved', async () => {
    await withTempDir((dir) => {
      const templatesDir = join(dir, 'templates');
      mkdirSync(templatesDir, { recursive: true });

      writeFileSync(join(templatesDir, 'helper.tmpl.yaml'), `
statements:
  - intent: Helper step
    action: click
    locator: getByTestId('helper')
`);

      // Place the YAML in a subdirectory so relative resolution fails
      const testsDir = join(dir, 'tests');
      mkdirSync(testsDir, { recursive: true });

      const yamlContent = `
name: Test with unresolvable template
goal: Template should fail without basePath
base_url: https://example.com
statements:
  - URL: /
  - template: templates/helper.tmpl.yaml
  - intent: This should not appear
    action: click
    locator: getByTestId('btn')
`;
      const yamlPath = join(testsDir, 'example.test.yaml');
      writeFileSync(yamlPath, yamlContent);

      // Simulate the old reporter behavior: no basePath
      let actionStepsMap: Record<string, unknown> = {};
      try {
        const parsed = parseYamlTestFile(yamlContent, yamlPath);
        actionStepsMap = extractActionStepsFromTestFlow(parsed.testFlow!);
      } catch {
        // This is the bug: template expansion throws, entire enrichment lost
      }

      expect(Object.keys(actionStepsMap).length).toBe(0);
    });
  });

  test('handles STEP + IF_ELSE + template in combination', async () => {
    await withTempDir((dir) => {
      const templatesDir = join(dir, 'templates');
      mkdirSync(templatesDir, { recursive: true });

      writeFileSync(join(templatesDir, 'setup.tmpl.yaml'), `
statements:
  - intent: Setup step A
    action: click
    locator: getByTestId('setup-a')
  - intent: Setup step B
    action: click
    locator: getByTestId('setup-b')
`);

      const yamlContent = `
name: Complex test
goal: Test complex flow with template
base_url: https://example.com
statements:
  - URL: /
  - IF: user is logged in
    THEN: []
    ELSE:
      - intent: Click login
        action: click
        locator: getByTestId('login')
  - template: templates/setup.tmpl.yaml
  - STEP: "Main test flow"
    statements:
      - intent: Click action button
        action: click
        locator: getByTestId('action')
      - intent: Type search query
        action: input_text
        locator: getByTestId('search')
        text: hello
  - WAIT_UNTIL: results appear
    timeout_seconds: 30
`;
      const yamlPath = join(dir, 'test.test.yaml');
      writeFileSync(yamlPath, yamlContent);

      const parsed = parseYamlTestFile(yamlContent, yamlPath, dir);
      const actionStepsMap = extractActionStepsFromTestFlow(parsed.testFlow!);

      // main.0 = URL
      expect(actionStepsMap['main.0']).toBeDefined();
      // main.1 = IF_ELSE
      expect(actionStepsMap['main.1']).toBeDefined();
      expect(actionStepsMap['main.1'].description).toContain('IF');
      // main.1.else.0 = login click
      expect(actionStepsMap['main.1.else.0']).toBeDefined();
      // main.2 = template STEP → children at main.2.0, main.2.1
      expect(actionStepsMap['main.2.0']).toBeDefined();
      expect(actionStepsMap['main.2.0'].description).toContain('Setup step A');
      expect(actionStepsMap['main.2.1']).toBeDefined();
      expect(actionStepsMap['main.2.1'].description).toContain('Setup step B');
      // main.3 = STEP → children at main.3.0, main.3.1
      expect(actionStepsMap['main.3.0']).toBeDefined();
      expect(actionStepsMap['main.3.0'].description).toContain('Click action button');
      expect(actionStepsMap['main.3.1']).toBeDefined();
      expect(actionStepsMap['main.3.1'].description).toContain('Type search query');
      // main.4 = WAIT_UNTIL
      expect(actionStepsMap['main.4']).toBeDefined();
      expect(actionStepsMap['main.4'].action_entity?.action_data?.action_name).toBe('ai_wait_until');
    });
  });
});
