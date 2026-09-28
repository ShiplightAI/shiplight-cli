import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const packageDir = new URL('../', import.meta.url);
const provider = '@openrouter/ai-sdk-provider';

// tsup.config.ts builds `npmExternals` from this package's own dependencies, so a
// provider that only sdk-core declares is invisible to it. sdk-core is inlined
// via noExternal, esbuild follows the import, and the whole provider lands in the
// bundle — 0.2.3 grew 13.7% that way and tripped the release size gate.
test('OpenRouter is declared as an mcp-server runtime dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', packageDir), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const core = JSON.parse(readFileSync(new URL('../../packages/sdk-core/package.json', packageDir), 'utf8')) as {
    dependencies: Record<string, string>;
  };

  assert.ok(manifest.dependencies[provider], `${provider} must be declared so tsup keeps it external`);
  assert.equal(
    manifest.dependencies[provider],
    core.dependencies[provider],
    `${provider} must track the range sdk-core resolves, or the two copies can diverge`,
  );
});

// A dependency declaration alone must not hide an accidentally inlined provider,
// so read the built bundle rather than trusting the manifest.
//
// Skipped rather than failed when dist/ is absent: publish-mcp.yml runs its unit
// gate before "Build MCP server", and the PR unit lane's pretest hook builds this
// package's dependencies but not the package itself. The tarball size delta in
// publish-mcp.yml is the gate that catches an inlined provider in CI; this test
// is the local signal that says why.
test('the mcp-server bundle imports OpenRouter externally', (t) => {
  const bundle = new URL('dist/index.js', packageDir);
  let source: string;
  try {
    source = readFileSync(bundle, 'utf8');
  } catch {
    t.skip('dist/index.js not built — run `pnpm --filter @shiplightai/mcp build` to run this check');
    return;
  }

  const parsed = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = parsed.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );

  assert.ok(imports.includes(provider), `${provider} must remain external; it is inlined into the bundle`);
});
