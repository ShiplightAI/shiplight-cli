/**
 * Guards the published type surface.
 *
 * @shiplightai/sdk re-exports types that originate in `sdk-core` and
 * `shiplight-types` — private workspace packages that are never published. If
 * the declaration build emits `from 'sdk-core'` instead of inlining those
 * types, every npm consumer gets `TS2307: Cannot find module 'sdk-core'`, or
 * silently `any`-typed exports when they compile with skipLibCheck.
 *
 * These tests read build output, so they need `pnpm build` first — which
 * `turbo.json` in this package enforces via `test:unit -> dependsOn: build`.
 *
 * Everything the tests compare against is derived from package.json,
 * api-extractor.json and src/index.ts rather than restated here. A hardcoded
 * copy would drift, and drift in either direction is harmful: a missed private
 * package publishes broken types, a missed public dependency blocks a release
 * that was fine.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(packageDir, '../..');
const distDir = resolve(packageDir, 'dist');
const declarationPath = resolve(distDir, 'index.d.ts');
const entryPath = resolve(packageDir, 'src/index.ts');

const buildHint = 'run `pnpm --filter @shiplightai/sdk build` first';

const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/** api-extractor.json is JSONC, so it needs the TypeScript config reader. */
function readJsonc(path: string): Record<string, unknown> {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  assert.equal(parsed.error, undefined, `could not parse ${relative(packageDir, path)}`);
  return parsed.config as Record<string, unknown>;
}

/**
 * Private workspace packages, derived from the `workspace:` protocol rather
 * than listed by hand, so adding a new one cannot silently escape the scan.
 *
 * Every dependency field is scanned, not just devDependencies: a private
 * package declared under `dependencies` would otherwise be treated as public
 * by all three guards at once — excluded from the leak scan and then helpfully
 * symlinked into the fake consumer, so nothing would notice until npm returned
 * 404 for it.
 */
const privatePackages = [
  ...new Set(
    [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies, manifest.optionalDependencies]
      .flatMap((field) => Object.entries(field ?? {}))
      .filter(([, spec]) => spec.startsWith('workspace:'))
      .map(([name]) => name),
  ),
].sort();

/**
 * Everything a real `npm install @shiplightai/sdk` puts on disk. Private
 * packages are subtracted so a misfiled workspace dependency cannot smuggle
 * itself into the fake consumer's node_modules.
 */
const publicDependencies = [
  ...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    '@types/node',
  ]),
].filter((name) => !privatePackages.includes(name));

/** Resolves a dependency whether pnpm placed it in the package or at the root. */
function dependencyDir(name: string): string | undefined {
  for (const base of [packageDir, repoRoot]) {
    const candidate = resolve(base, 'node_modules', name);
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return undefined;
}

function declarationFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Real module specifiers, via the TypeScript parser. A regex over the raw text
 * would also match import statements written inside JSDoc `@example` and
 * `@deprecated` prose, which api-extractor inlines verbatim from sdk-core.
 */
function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteral(node.argument.literal)) specifiers.push(node.argument.literal.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (ts.isStringLiteral(node.moduleReference.expression)) specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

/**
 * Star re-exports (`export * from './types'`) contribute names this parser
 * cannot see without resolving the target module. Rather than let the coverage
 * tests quietly go vacuous, they are reported so the caller can fail.
 */
function starExports(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements
    .filter((statement): statement is ts.ExportDeclaration => ts.isExportDeclaration(statement))
    .filter((statement) => !statement.exportClause || !ts.isNamedExports(statement.exportClause))
    .map((statement) =>
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? `export * from '${statement.moduleSpecifier.text}'`
        : 'export *',
    );
}

/** Every name a module exports, whether declared inline or re-exported. */
function exportedNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      }
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }

  return names;
}

/**
 * Types the rollup inlines without exporting. A consumer can hold values of
 * these types and reach them through indexed access (`AgentStepResult['actions']`)
 * but cannot name them directly.
 *
 * This is a deliberate boundary, not an oversight. Exporting them cascades:
 * sdk-core and shiplight-types each define a distinct `ActionEntity`, which
 * api-extractor disambiguates as `ActionEntity_2` — there is no single name to
 * publish. api-extractor's own `ae-forgotten-export` diagnostic is silenced for
 * that reason, so this baseline is what stops the set drifting instead.
 *
 * Adding an entry means accepting that consumers cannot name the type; removing
 * one means it became exportable and should be exported from src/index.ts.
 */
const inlinedPrivateTypes = [
  'ActionDataEntity',
  'ActionEntity',
  'ActionEntityLocatorInfo',
  'ActionGenerationDebugInfo',
  'KnowledgeImage',
  'MessageForLogging',
  'MessagePartForLogging',
  'PreloadedKnowledge',
  'TokenUsage',
];

/** Top-level declarations the rollup emits without an `export` modifier. */
function unexportedDeclarations(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.push(statement.name.text);
    }
  }

  return names.sort();
}

/** The bare package a specifier belongs to, e.g. 'sdk-core/cloud-routing' -> 'sdk-core'. */
function packageOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
}

function assertBuilt(): void {
  assert.ok(existsSync(declarationPath), `dist/index.d.ts is missing — ${buildHint}`);
}

test('the scanned private packages match api-extractor bundledPackages', () => {
  const bundled = readJsonc(resolve(packageDir, 'api-extractor.json')).bundledPackages;

  // Checked explicitly so a missing or malformed key reports what is wrong,
  // rather than throwing "undefined is not iterable" out of the spread below.
  assert.ok(Array.isArray(bundled), 'api-extractor.json must declare bundledPackages as an array');

  assert.deepEqual(
    [...(bundled as string[])].sort(),
    privatePackages,
    'api-extractor must inline exactly the workspace-protocol devDependencies; ' +
      'a package in one list but not the other either leaks or fails to build',
  );
});

test('no declaration file in dist references a private workspace package', () => {
  assertBuilt();

  const files = declarationFiles(distDir);
  assert.ok(files.length > 0, `dist/ contains no .d.ts files — ${buildHint}`);

  const leaks: string[] = [];
  for (const file of files) {
    for (const specifier of moduleSpecifiers(parse(file))) {
      if (privatePackages.includes(packageOf(specifier))) {
        leaks.push(`${relative(packageDir, file)} imports '${specifier}'`);
      }
    }
  }

  assert.deepEqual(leaks, [], `published declarations must not reference private workspace packages:\n  ${leaks.join('\n  ')}`);
});

test('dist ships a single self-contained declaration file', () => {
  assertBuilt();

  // A regression to per-file declaration emit is how the private-package
  // imports came back last time — they moved into a chunk file that the
  // entry point re-exported.
  assert.deepEqual(
    declarationFiles(distDir).map((file) => relative(distDir, file)),
    ['index.d.ts'],
    'the api-extractor rollup must produce exactly one declaration file',
  );

  for (const specifier of moduleSpecifiers(parse(declarationPath))) {
    if (!specifier.startsWith('.')) continue;
    const base = resolve(distDir, specifier).replace(/\.(js|mjs|cjs)$/, '');
    const candidates = ['.d.ts', '.d.mts', '.d.cts', '/index.d.ts'].map((suffix) => `${base}${suffix}`);
    assert.ok(
      candidates.some((candidate) => existsSync(candidate)),
      `dist/index.d.ts imports '${specifier}', which is not present in dist/`,
    );
  }
});

test('the set of un-nameable inlined types has not drifted', () => {
  assertBuilt();

  // api-extractor's ae-forgotten-export is silenced, so without this nothing
  // reports a newly un-nameable type on the public surface.
  assert.deepEqual(
    unexportedDeclarations(parse(declarationPath)),
    [...inlinedPrivateTypes].sort(),
    'the rollup inlines a different set of un-exported types than the recorded baseline; ' +
      'export it from src/index.ts if consumers should be able to name it, ' +
      'otherwise update inlinedPrivateTypes with the reason',
  );
});

test('the entry point uses no star re-exports', () => {
  // This suite derives the expected public surface by parsing src/index.ts.
  // A star re-export hides names from that parse, which would silently empty
  // both the coverage test below and the generated consumer fixture — the two
  // checks that prove the rollup did not drop anything.
  assert.deepEqual(
    starExports(parse(entryPath)),
    [],
    'src/index.ts must enumerate its exports; star re-exports make the surface tests vacuous',
  );
});

test('dist re-exports every name the entry point exports', () => {
  assertBuilt();

  const declared = exportedNames(parse(declarationPath));
  const missing = [...exportedNames(parse(entryPath))].filter((name) => !declared.has(name)).sort();

  // api-extractor drops types it cannot reach, and `ae-forgotten-export` is
  // silenced in api-extractor.json, so nothing else would report this.
  assert.deepEqual(missing, [], `dist/index.d.ts is missing exports declared in src/index.ts: ${missing.join(', ')}`);
});

test('a strict consumer outside the workspace can import the public types', () => {
  assertBuilt();

  // The check must run outside the monorepo. Inside it, pnpm's node_modules
  // symlinks resolve `sdk-core` and `shiplight-types`, so a leak type-checks
  // cleanly here while failing for everyone who installs from npm.
  const consumerDir = mkdtempSync(resolve(realpathSync(tmpdir()), 'shiplight-sdk-consumer-'));

  try {
    const installedPackage = resolve(consumerDir, 'node_modules/@shiplightai/sdk');
    mkdirSync(installedPackage, { recursive: true });
    cpSync(distDir, resolve(installedPackage, 'dist'), { recursive: true });
    writeFileSync(
      resolve(installedPackage, 'package.json'),
      JSON.stringify({
        name: '@shiplightai/sdk',
        version: '0.0.0-test',
        type: 'module',
        types: 'dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      }),
    );

    // Symlinked rather than copied so pnpm's store layout keeps resolving
    // their own transitive dependencies (playwright -> playwright-core).
    // Isolation is unaffected: the SDK itself is a real copy, so resolving
    // `sdk-core` from inside its declarations walks up through the temp
    // directory and never reaches the workspace.
    for (const dependency of publicDependencies) {
      const source = dependencyDir(dependency);
      if (!source) continue;
      const target = resolve(consumerDir, 'node_modules', dependency);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target, 'dir');
    }

    const exported = [...exportedNames(parse(entryPath))].sort();
    assert.ok(exported.length > 0, 'src/index.ts exports nothing — the fixture would prove nothing');

    // Importing every exported name is what catches a symbol the rollup
    // dropped — TS2305 fires on the import clause itself, whether or not the
    // name is used afterwards. Nothing below restates an export name: a
    // hardcoded usage would break on a rename and be reported as "a real
    // consumer cannot type-check", pointing at the wrong cause.
    const fixture = [`import {\n${exported.map((name) => `  ${name},`).join('\n')}\n} from '@shiplightai/sdk';`, ``];

    // One real call, guarded on the names still existing, so the fixture also
    // proves the documented `AgentStepResult` contract rather than only that
    // the identifiers resolve.
    if (exported.includes('createAgent') && exported.includes('AgentStepResult')) {
      fixture.push(
        `const agent = createAgent({ model: 'gemini-3-flash-preview' });`,
        `export const result: Promise<AgentStepResult> = agent.act({} as Parameters<typeof agent.act>[0], 'Click submit');`,
        ``,
      );
    }

    writeFileSync(resolve(consumerDir, 'consumer.ts'), fixture.join('\n'));

    // A file that must not compile. If tsc silently does nothing — wrong bin,
    // rejected flag, OOM — this probe stops reporting its error and the whole
    // check is exposed as fail-open instead of passing vacuously.
    writeFileSync(resolve(consumerDir, 'probe.ts'), 'export const wrong: number = "not a number";\n');

    const probe = runTsc(consumerDir, 'probe.ts');
    assert.match(
      probe.output,
      /probe\.ts\(1,14\): error TS2322/,
      `the type-check harness is not reporting errors, so this test proves nothing:\n${probe.output}`,
    );

    const consumer = runTsc(consumerDir, 'consumer.ts');
    const diagnostics = consumer.output.split('\n').filter((line) => /error TS\d+/.test(line));

    // Diagnostics with no `file(line,col):` prefix are global — a bad flag, a
    // missing lib, an internal error. They mean the compile never happened, so
    // they must fail rather than be filtered away as third-party noise.
    const global = diagnostics.filter((line) => !/^\S.*\(\d+,\d+\): error TS\d+/.test(line));
    assert.deepEqual(global, [], `tsc did not run a real type-check:\n  ${global.join('\n  ')}`);

    // Third-party declarations (playwright, @types/node) can produce noise
    // that varies with the TypeScript version and is not this package's
    // concern. Only errors attributed to the SDK or the consumer count.
    const ours = diagnostics.filter((line) => line.startsWith('consumer.ts') || line.includes('@shiplightai/sdk'));
    assert.deepEqual(ours, [], `a real consumer cannot type-check against dist/:\n  ${ours.join('\n  ')}`);
  } finally {
    rmSync(consumerDir, { recursive: true, force: true });
  }
});

/**
 * Runs tsc and returns its diagnostics. skipLibCheck is deliberately off: it
 * suppresses TS2307 inside .d.ts files, which is exactly what this file is
 * here to catch.
 *
 * Throws — rather than returning empty output — when the compiler cannot be
 * launched at all, so a missing or relocated binary fails loudly instead of
 * looking like a clean compile.
 */
function runTsc(cwd: string, file: string): { status: number; output: string } {
  const tscBin = dependencyDir('typescript');
  assert.ok(tscBin, 'typescript is not installed, so the consumer type-check cannot run');

  const bin = resolve(tscBin, 'bin/tsc');
  assert.ok(existsSync(bin), `expected the tsc binary at ${bin}`);

  const args = [
    bin,
    '--noEmit',
    '--strict',
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--target',
    'es2022',
    '--lib',
    'es2022,dom',
    file,
  ];

  try {
    return { status: 0, output: execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string; code?: string };
    if (typeof failure.status !== 'number') {
      throw new Error(`could not run tsc (${failure.code ?? 'unknown error'}): ${failure.stderr ?? failure.stdout ?? ''}`);
    }
    return { status: failure.status, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}
