import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// The test:browser lane builds the CLI first. Inspect all six engine bundles:
// splitting is disabled, so an undeclared provider bloats each one separately.
for (const entry of ['index', 'fixture', 'debugger-pw']) {
  for (const format of ['esm', 'cjs']) {
    const file = format === 'esm' ? `${entry}.js` : `cjs/${entry}.cjs`;
    test(`${file} keeps OpenRouter external`, () => {
      const source = ts.createSourceFile(
        file,
        readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      const imports: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          imports.push(node.moduleSpecifier.text);
        } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === 'require' && node.arguments.length === 1) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      assert.ok(imports.includes('@openrouter/ai-sdk-provider'), 'OpenRouter must not be inlined');
    });
  }
}
