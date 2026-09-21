import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const packageDir = new URL('../../', import.meta.url);
const provider = '@openrouter/ai-sdk-provider';

test('OpenRouter is installed as a public SDK runtime dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', packageDir), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const core = JSON.parse(readFileSync(new URL('../sdk-core/package.json', packageDir), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  assert.ok(manifest.dependencies[provider], `${provider} must be installed for SDK consumers`);
  assert.equal(manifest.dependencies[provider], core.dependencies[provider]);
});

// Like consumerDeclarations.test.ts, this inspects the actual build output.
// A dependency declaration alone must not hide an accidentally inlined provider.
test('the SDK bundle imports OpenRouter externally', () => {
  const distDir = new URL('dist/', packageDir);
  const imports = readdirSync(distDir)
    .filter((file) => file.endsWith('.js'))
    .flatMap((file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(new URL(file, distDir), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      return source.statements.flatMap((statement) =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
          ? [statement.moduleSpecifier.text]
          : [],
      );
    });
  assert.ok(imports.includes(provider), `${provider} must remain external; rebuild the SDK before testing`);
});
