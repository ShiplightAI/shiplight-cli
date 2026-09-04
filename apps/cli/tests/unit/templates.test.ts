import { test, expect } from '@playwright/test';
import { expandTemplates } from '../../src/templates';
import { writeFileSync, mkdirSync } from 'fs';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createTempDir(): string {
  const dir = join(tmpdir(), 'shiplight-playwright-tests-' + Date.now() + '-' + Math.random().toString(36).slice(2));
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

// Template references expand into a STEP wrapper that preserves the reference
// and its metadata (template_path, template_params) with the resolved, param-
// substituted sub-statements nested under `statements`. This shape lets the
// debugger round-trip template references on save rather than flattening them.
test.describe('expandTemplates', () => {
  test('expands a simple template reference', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'login-template.yaml');
      writeFileSync(templatePath, `
params:
  - username
statements:
  - "Enter <<username>> in the username field"
  - Click login button
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            template: './login-template.yaml',
            params: { username: 'admin' },
          },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      expect(result.statements).toHaveLength(1);
      const step = result.statements[0];
      expect(step.STEP).toBe('login-template');
      expect(step.template_path).toBe('./login-template.yaml');
      expect(step.template_params).toEqual({ username: 'admin' });
      expect(step.statements).toHaveLength(2);
      expect(step.statements[0]).toBe('Enter admin in the username field');
      expect(step.statements[1]).toBe('Click login button');
    });
  });

  test('validates required params', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'requires-params.yaml');
      writeFileSync(templatePath, `
params:
  - username
  - password
statements:
  - Enter <<username>>
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            template: './requires-params.yaml',
            params: { username: 'admin' }, // missing password
          },
        ],
      };

      let error: Error | undefined;
      try {
        expandTemplates(rawDoc, sourceFile);
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.message).toContain('requires param "password"');
    });
  });

  test('detects circular references', async () => {
    await withTempDir((dir) => {
      const fileA = join(dir, 'a.yaml');
      const fileB = join(dir, 'b.yaml');

      writeFileSync(fileA, `
statements:
  - template: ./b.yaml
`);
      writeFileSync(fileB, `
statements:
  - template: ./a.yaml
`);

      const rawDoc = {
        goal: 'Test',
        statements: [{ template: './a.yaml' }],
      };

      let error: Error | undefined;
      try {
        expandTemplates(rawDoc, join(dir, 'test.yaml'));
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.message).toContain('Circular template reference');
    });
  });

  test('enforces max depth', async () => {
    await withTempDir((dir) => {
      // Create a chain of 6 templates (exceeds max depth of 5)
      for (let i = 0; i < 6; i++) {
        const content =
          i < 5
            ? `statements:\n  - template: ./t${i + 1}.yaml\n`
            : `statements:\n  - Final step\n`;
        writeFileSync(join(dir, `t${i}.yaml`), content);
      }

      const rawDoc = {
        goal: 'Test',
        statements: [{ template: './t0.yaml' }],
      };

      let error: Error | undefined;
      try {
        expandTemplates(rawDoc, join(dir, 'test.yaml'));
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeDefined();
      expect(error!.message).toContain('maximum depth');
    });
  });

  test('substitutes multiple params in the same statement', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'login.yaml');
      writeFileSync(templatePath, `
params:
  - username
  - password
statements:
  - "Enter <<username>> in the username field"
  - "Enter <<password>> in the password field"
  - Click login
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            template: './login.yaml',
            params: { username: 'alice', password: 's3cret' },
          },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      const step = result.statements[0];
      expect(step.statements).toHaveLength(3);
      expect(step.statements[0]).toBe('Enter alice in the username field');
      expect(step.statements[1]).toBe('Enter s3cret in the password field');
      expect(step.statements[2]).toBe('Click login');
    });
  });

  test('substitutes params inside action entity kwargs', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'fill-form.yaml');
      writeFileSync(templatePath, `
params:
  - email
statements:
  - description: "Enter <<email>>"
    action_entity:
      action_description: "Enter <<email>>"
      locator: "getByLabel('Email')"
      action_data:
        action_name: input_text
        kwargs:
          text: "<<email>>"
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            template: './fill-form.yaml',
            params: { email: 'user@test.com' },
          },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      expect(result.statements[0].statements).toHaveLength(1);
      const stmt = result.statements[0].statements[0];
      expect(stmt.description).toBe('Enter user@test.com');
      expect(stmt.action_entity.action_description).toBe('Enter user@test.com');
      expect(stmt.action_entity.action_data.kwargs.text).toBe('user@test.com');
    });
  });

  test('substitutes same param used multiple times in one statement', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'repeat.yaml');
      writeFileSync(templatePath, `
params:
  - name
statements:
  - "Hello <<name>>, welcome back <<name>>"
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            template: './repeat.yaml',
            params: { name: 'Bob' },
          },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      expect(result.statements[0].statements[0]).toBe('Hello Bob, welcome back Bob');
    });
  });

  test('leaves {{VAR}} intact when param is not in template params list', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'env-var.yaml');
      writeFileSync(templatePath, `
params:
  - username
statements:
  - "Login as <<username>> with token {{API_TOKEN}}"
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            template: './env-var.yaml',
            params: { username: 'admin' },
          },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      // username substituted, but {{API_TOKEN}} preserved for runtime env var interpolation
      expect(result.statements[0].statements[0]).toBe('Login as admin with token {{API_TOKEN}}');
    });
  });

  test('handles template with no params required', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'no-params.yaml');
      writeFileSync(templatePath, `
statements:
  - Step one
  - Step two
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          { template: './no-params.yaml' },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      const step = result.statements[0];
      expect(step.STEP).toBe('no-params');
      expect(step.statements).toHaveLength(2);
      expect(step.statements[0]).toBe('Step one');
      expect(step.statements[1]).toBe('Step two');
    });
  });

  test('substitutes params in nested template', async () => {
    await withTempDir((dir) => {
      // Inner template
      const innerPath = join(dir, 'inner.yaml');
      writeFileSync(innerPath, `
params:
  - value
statements:
  - "Inner got <<value>>"
`);

      // Outer template passes its own param through to inner
      const outerPath = join(dir, 'outer.yaml');
      writeFileSync(outerPath, `
params:
  - data
statements:
  - "Outer got <<data>>"
  - template: ./inner.yaml
    params:
      value: "<<data>>"
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            template: './outer.yaml',
            params: { data: 'hello' },
          },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      const outer = result.statements[0];
      expect(outer.STEP).toBe('outer');
      expect(outer.statements).toHaveLength(2);
      expect(outer.statements[0]).toBe('Outer got hello');
      const inner = outer.statements[1];
      expect(inner.STEP).toBe('inner');
      expect(inner.statements[0]).toBe('Inner got hello');
    });
  });

  test('tracks referenced template paths for cache invalidation', async () => {
    await withTempDir((dir) => {
      const innerPath = join(dir, 'inner.yaml');
      writeFileSync(innerPath, `
statements:
  - Inner step
`);

      const outerPath = join(dir, 'outer.yaml');
      writeFileSync(outerPath, `
statements:
  - Outer step
  - template: ./inner.yaml
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          { template: './outer.yaml' },
        ],
      };

      const { referencedTemplatePaths } = expandTemplates(rawDoc, sourceFile);
      expect(referencedTemplatePaths).toHaveLength(2);
      expect(referencedTemplatePaths).toContain(outerPath);
      expect(referencedTemplatePaths).toContain(innerPath);
    });
  });

  test('expands templates in nested STEP statements', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'helper.yaml');
      writeFileSync(templatePath, `
statements:
  - Helper step 1
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          {
            STEP: 'Parent step',
            statements: [
              { template: './helper.yaml' },
            ],
          },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      // The user's 'Parent step' STEP is preserved; the template ref inside it
      // expands into a nested helper STEP wrapper.
      const parent = result.statements[0];
      expect(parent.STEP).toBe('Parent step');
      const helper = parent.statements[0];
      expect(helper.STEP).toBe('helper');
      expect(helper.statements).toHaveLength(1);
      expect(helper.statements[0]).toBe('Helper step 1');
    });
  });

  test('expands templates in teardown', async () => {
    await withTempDir((dir) => {
      const templatePath = join(dir, 'cleanup.yaml');
      writeFileSync(templatePath, `
statements:
  - Clean up resources
`);

      const sourceFile = join(dir, 'test.yaml');
      const rawDoc = {
        goal: 'Test',
        statements: [
          'Main step',
        ],
        teardown: [
          { template: './cleanup.yaml' },
        ],
      };

      const { doc: result } = expandTemplates(rawDoc, sourceFile);
      expect(result.teardown).toHaveLength(1);
      const step = result.teardown[0];
      expect(step.STEP).toBe('cleanup');
      expect(step.statements).toHaveLength(1);
      expect(step.statements[0]).toBe('Clean up resources');
    });
  });
});
