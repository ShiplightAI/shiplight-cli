import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject, isMustApplyStrategy, toDependencyRange, resolveEnvSetupState, type ScaffoldResult } from './index.js';

/**
 * Regression tests for the shared scaffoldProject function.
 *
 * scaffoldProject backs `shiplight create` (apps/cli/src/commands/create.ts).
 * The MCP `scaffold_project` tool that used to share it was removed — test
 * authoring is CLI-owned so the parser that validates a project is the one
 * that runs it.
 *
 * A bug here ships straight to first-run, and we've been burned twice
 * already this release cycle — once by the duplicate `playwright` dep
 * causing "Requiring @playwright/test second time" at runtime, and once by
 * the missing `tests/example.test.yaml` causing quickstart recipes to
 * reference a file that didn't exist. These tests lock in the invariants
 * that made those regressions possible.
 *
 * The non-empty-directory behavior also matters: real users routinely point
 * scaffold at a repo that already has a package.json / .gitignore / .env
 * (the only common shape we've seen in the wild). The tool MUST NOT
 * overwrite those files — it surfaces them as `filesNeedingAgentMerge`
 * entries so the calling coding agent can do a careful in-place merge.
 */

/**
 * Any exact semver works — these tests assert the RANGE POLICY (caret pin),
 * not a particular release. `shiplight create` passes its own real version.
 */
const TEST_VERSION = '0.1.93';

function scaffold(opts: { projectPath: string; projectName?: string; shiplightVersion?: string }) {
  return scaffoldProject({ shiplightVersion: TEST_VERSION, ...opts });
}

describe('scaffoldProject', () => {
  const dirsToClean: string[] = [];
  afterEach(() => {
    for (const d of dirsToClean) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
    dirsToClean.length = 0;
  });

  function makeTarget(): string {
    const dir = mkdtempSync(join(tmpdir(), 'shiplight-scaffold-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  describe('fresh-directory case', () => {
    it('creates exactly the expected files in a fresh target', () => {
      const target = makeTarget();
      const result = scaffold({ projectPath: target });

      assert.deepEqual(result.filesCreated.sort(), [
        '.env.example',
        '.gitignore',
        '.mcp.json',
        'auth/example.login.ts',
        'package.json',
        'playwright.config.ts',
        'tests/example.test.yaml',
      ]);
      assert.deepEqual(result.filesSkipped, []);
      assert.deepEqual(result.filesNeedingAgentMerge, []);

      for (const f of result.filesCreated) {
        assert.ok(
          existsSync(join(target, f)),
          `Expected ${f} to exist under ${target}`
        );
      }
    });

    it('creates the tests/ directory to hold the example', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      assert.ok(existsSync(join(target, 'tests')));
    });

    it('does not create a redundant example environment', () => {
      const target = makeTarget();
      const result = scaffold({ projectPath: target });

      assert.equal(existsSync(join(target, 'environments')), false);
      assert.equal(result.filesCreated.includes('environments/example.env.yaml'), false);
    });

    it('works when the target path does not yet exist', () => {
      const parent = makeTarget();
      const newTarget = join(parent, 'nested-new-dir');
      const result = scaffold({ projectPath: newTarget });
      assert.ok(existsSync(join(newTarget, 'package.json')));
      assert.equal(result.filesNeedingAgentMerge.length, 0);
    });
  });

  describe('package.json', () => {
    it('declares only shiplightai — no @playwright/test, no playwright, no dotenv', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'));

      // shiplightai is the only direct dep we own. @playwright/test comes
      // in via shiplightai's peerDependency — it must NOT be listed as a
      // direct dep to avoid the duplicate-install regression that shipped
      // in pre-0.1.49 scaffolds. dotenv is a transitive dep of shiplightai
      // and is loaded by `shiplight test` before user code runs, so adding
      // it to the scaffold would only pollute the user's dependency graph.
      assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['shiplightai']);
      // Caret-pinned to the scaffolding CLI's own version — never a floating
      // dist-tag. `"latest"` reads as self-updating to everyone who opens the
      // file, but npm resolves it once at install time, so a project can sit
      // on a months-old CLI while every reader assumes it is current. A
      // hardcoded `^0.1.0` in the template would be worse: caret is
      // minor-locked below 1.0.0, so new scaffolds would pin to the 0.1.x
      // line forever once 0.2.0 shipped.
      assert.equal(pkg.dependencies.shiplightai, `^${TEST_VERSION}`);
      assert.match(
        pkg.dependencies.shiplightai,
        /^\^\d+\.\d+\.\d+/,
        'shiplightai must be caret-pinned to an exact version, not a dist-tag',
      );

      assert.equal(
        '@playwright/test' in pkg.dependencies,
        false,
        '@playwright/test must not be in scaffolded dependencies — it comes via shiplightai peerDep'
      );
      assert.equal(
        'playwright' in pkg.dependencies,
        false,
        'playwright must not be in scaffolded dependencies — it is a transitive dep of @playwright/test'
      );
      assert.equal(
        'dotenv' in pkg.dependencies,
        false,
        'dotenv must not be in scaffolded dependencies — shiplightai already depends on it and loads .env files itself'
      );
    });

    it('defaults the name field to the directory basename', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'));
      assert.match(pkg.name, /^shiplight-scaffold-test-/);
    });

    it('honors an explicit projectName override', () => {
      const target = makeTarget();
      scaffold({ projectPath: target, projectName: 'acme-e2e' });
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'));
      assert.equal(pkg.name, 'acme-e2e');
    });

    it('uses ES module type and the standard shiplight test scripts', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'));
      assert.equal(pkg.type, 'module');
      assert.equal(pkg.scripts.test, 'shiplight test');
      assert.equal(pkg.scripts['test:headed'], 'shiplight test --headed');
    });

    it('declares engines.node >=22 so pnpm/yarn refuse to install on older Node', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'));
      // Shiplight requires Node 22. Declaring it in engines gives users an
      // early, explicit install-time failure on pnpm/yarn instead of a
      // cryptic runtime error from a newer Node API on an older runtime.
      assert.equal(pkg.engines?.node, '>=22');
    });
  });

  describe('playwright.config.ts', () => {
    it('imports shiplightConfig from shiplightai and spreads it', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const content = readFileSync(join(target, 'playwright.config.ts'), 'utf-8');
      assert.match(content, /from ['"]shiplightai['"]/);
      assert.match(content, /shiplightConfig\(\)/);
      assert.match(content, /\.\.\.shiplightConfig\(\)/);
    });
  });

  describe('.gitignore', () => {
    it('ignores node_modules, .env, test-results, and generated yaml specs', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const content = readFileSync(join(target, '.gitignore'), 'utf-8');
      assert.match(content, /^node_modules\/$/m);
      assert.match(content, /^\.env$/m);
      assert.match(content, /^test-results\/$/m);
      assert.match(content, /^\.shiplight\/$/m);
      assert.match(content, /^shiplight-report\/$/m);
      assert.match(content, /\*\.yaml\.spec\.ts/);
    });
  });

  describe('.env.example', () => {
    it('lists the three LLM provider API keys as commented-out entries', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const content = readFileSync(join(target, '.env.example'), 'utf-8');
      assert.match(content, /# GOOGLE_API_KEY=/);
      assert.match(content, /# ANTHROPIC_API_KEY=/);
      assert.match(content, /# OPENAI_API_KEY=/);
    });

    it('documents the WEB_AGENT_MODEL override', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const content = readFileSync(join(target, '.env.example'), 'utf-8');
      assert.match(content, /WEB_AGENT_MODEL/);
    });
  });

  describe('tests/example.test.yaml', () => {
    it('targets the static basic-form fixture used by the launch test project', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const yaml = readFileSync(join(target, 'tests/example.test.yaml'), 'utf-8');

      assert.match(yaml, /^goal: Verify the basic form can be completed and submitted successfully$/m);
      assert.match(yaml, /^base_url: https:\/\/static\.shiplight\.ai\/$/m);
      assert.match(yaml, /^  - URL: \/testing\/forms\/basic-form\.html$/m);
    });

    it('includes the representative form actions and mock values', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const yaml = readFileSync(join(target, 'tests/example.test.yaml'), 'utf-8');

      assert.match(yaml, /^    action: input_text$/m);
      assert.match(yaml, /^    action: set_date_for_native_date_picker$/m);
      assert.match(yaml, /^    text: Jane Doe$/m);
      assert.match(yaml, /^    date: 1995-05-15$/m);
      assert.match(yaml, /getByText\('🇦🇷 Argentina'\)/);
    });

    it('submits the form and verifies the success message', () => {
      const target = makeTarget();
      scaffold({ projectPath: target });
      const yaml = readFileSync(join(target, 'tests/example.test.yaml'), 'utf-8');

      assert.match(yaml, /getByRole\('button', \{ name: 'Submit Form' \}\)/);
      assert.match(yaml, /^  - VERIFY: A success message is displayed$/m);
    });
  });

  describe('non-empty target — agent merge contract', () => {
    it('does not overwrite an existing package.json — surfaces it for agent merge', () => {
      const target = makeTarget();
      const userPkg = {
        name: 'acme-app',
        version: '1.2.3',
        type: 'commonjs',
        dependencies: { lodash: '^4.17.0' },
      };
      writeFileSync(join(target, 'package.json'), JSON.stringify(userPkg, null, 2));

      const result = scaffold({ projectPath: target });

      // The user's file is preserved byte-for-byte
      const after = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'));
      assert.deepEqual(after, userPkg);

      assert.equal(result.filesCreated.includes('package.json'), false);
      const entry = result.filesNeedingAgentMerge.find((f) => f.path === 'package.json');
      assert.ok(entry, 'package.json should appear in filesNeedingAgentMerge');
      assert.equal(entry!.mergeStrategy, 'json_merge_deps_and_scripts');
      assert.equal(entry!.absPath, join(target, 'package.json'));
      // The merge template an agent applies must carry the same caret pin the
      // fresh-scaffold path writes — otherwise scaffolding into an existing
      // repo would reintroduce the floating dist-tag through the back door.
      assert.match(entry!.template, new RegExp(`"shiplightai":\\s*"\\^${TEST_VERSION}"`));
      assert.match(entry!.instructions, /existing package\.json/);
    });

    it('does not overwrite an existing .gitignore — returns lines_to_ensure for append', () => {
      const target = makeTarget();
      const userGitignore = 'dist/\nnode_modules/\n.idea/\n';
      writeFileSync(join(target, '.gitignore'), userGitignore);

      const result = scaffold({ projectPath: target });

      assert.equal(readFileSync(join(target, '.gitignore'), 'utf-8'), userGitignore);

      const entry = result.filesNeedingAgentMerge.find((f) => f.path === '.gitignore');
      assert.ok(entry, '.gitignore should appear in filesNeedingAgentMerge');
      assert.equal(entry!.mergeStrategy, 'append_missing_lines');
      assert.ok(Array.isArray(entry!.linesToEnsure));
      // Sanity-check a few representative lines made it in
      assert.ok(entry!.linesToEnsure!.includes('node_modules/'));
      assert.ok(entry!.linesToEnsure!.includes('.env'));
      assert.ok(entry!.linesToEnsure!.includes('*.yaml.spec.ts'));
      // Comments and blank lines must NOT make it into the ensure list
      assert.equal(
        entry!.linesToEnsure!.some((l) => l.startsWith('#') || l.length === 0),
        false
      );
    });

    it('does not overwrite an existing .mcp.json — surfaces it with merge_key=mcpServers', () => {
      const target = makeTarget();
      const userMcp = { mcpServers: { 'my-server': { command: 'foo' } } };
      writeFileSync(join(target, '.mcp.json'), JSON.stringify(userMcp, null, 2));

      const result = scaffold({ projectPath: target });

      assert.deepEqual(
        JSON.parse(readFileSync(join(target, '.mcp.json'), 'utf-8')),
        userMcp
      );

      const entry = result.filesNeedingAgentMerge.find((f) => f.path === '.mcp.json');
      assert.ok(entry, '.mcp.json should appear in filesNeedingAgentMerge');
      assert.equal(entry!.mergeStrategy, 'json_merge_under_key');
      assert.equal(entry!.mergeKey, 'mcpServers');
      assert.match(entry!.template, /shiplight/);
    });

    it('does not overwrite an existing .env.example — surfaces it for key append', () => {
      const target = makeTarget();
      const userEnv = '# Existing project secrets\nDATABASE_URL=\nSTRIPE_KEY=\n';
      writeFileSync(join(target, '.env.example'), userEnv);

      const result = scaffold({ projectPath: target });

      assert.equal(readFileSync(join(target, '.env.example'), 'utf-8'), userEnv);

      const entry = result.filesNeedingAgentMerge.find((f) => f.path === '.env.example');
      assert.ok(entry, '.env.example should appear in filesNeedingAgentMerge');
      assert.equal(entry!.mergeStrategy, 'append_missing_env_keys');
    });

    it('does not overwrite an existing playwright.config.ts — surfaces it for review_and_decide', () => {
      const target = makeTarget();
      const userCfg = "import { defineConfig } from '@playwright/test';\nexport default defineConfig({});\n";
      writeFileSync(join(target, 'playwright.config.ts'), userCfg);

      const result = scaffold({ projectPath: target });

      assert.equal(readFileSync(join(target, 'playwright.config.ts'), 'utf-8'), userCfg);

      const entry = result.filesNeedingAgentMerge.find(
        (f) => f.path === 'playwright.config.ts'
      );
      assert.ok(entry, 'playwright.config.ts should appear in filesNeedingAgentMerge');
      assert.equal(entry!.mergeStrategy, 'review_and_decide');
      assert.match(entry!.instructions, /Do not modify the file without explicit confirmation/);
    });

    it('skips example files that already exist (no agent action needed)', () => {
      const target = makeTarget();
      mkdirSync(join(target, 'auth'));
      mkdirSync(join(target, 'tests'));
      writeFileSync(join(target, 'auth/example.login.ts'), '// user version');
      writeFileSync(join(target, 'tests/example.test.yaml'), '# user version');

      const result = scaffold({ projectPath: target });

      assert.equal(readFileSync(join(target, 'auth/example.login.ts'), 'utf-8'), '// user version');
      assert.deepEqual(result.filesSkipped.sort(), [
        'auth/example.login.ts',
        'tests/example.test.yaml',
      ]);
      // None of these should appear in the merge list
      for (const f of result.filesNeedingAgentMerge) {
        assert.equal(f.path.startsWith('auth/'), false);
        assert.equal(f.path.startsWith('environments/'), false);
        assert.equal(f.path.startsWith('tests/'), false);
      }
    });

    it('mixed case: some files written, some skipped, some merge-needed (ESM project)', () => {
      const target = makeTarget();
      // Pre-existing ESM project with a package.json and a .gitignore.
      // Declaring "type": "module" sidesteps the CJS-deferral path so the
      // playwright.config.ts gets auto-written normally.
      writeFileSync(
        join(target, 'package.json'),
        '{"name":"acme","version":"1.0.0","type":"module"}'
      );
      writeFileSync(join(target, '.gitignore'), 'dist/\n');

      const result = scaffold({ projectPath: target });

      // The 6 non-colliding files get written
      assert.ok(result.filesCreated.includes('.env.example'));
      assert.ok(result.filesCreated.includes('.mcp.json'));
      assert.ok(result.filesCreated.includes('playwright.config.ts'));
      assert.ok(result.filesCreated.includes('auth/example.login.ts'));
      assert.ok(result.filesCreated.includes('tests/example.test.yaml'));
      // Lengths must be exact — a regression that double-bookkeeps a
      // colliding file into BOTH filesCreated and filesNeedingAgentMerge
      // would pass .includes() checks above.
      assert.equal(result.filesCreated.length, 5);
      assert.equal(result.filesNeedingAgentMerge.length, 2);

      // The 2 colliding files get surfaced for merge
      const mergePaths = result.filesNeedingAgentMerge.map((f) => f.path).sort();
      assert.deepEqual(mergePaths, ['.gitignore', 'package.json']);

      // Nothing is in the skip bucket (we only had collisions on merge-able files)
      assert.deepEqual(result.filesSkipped, []);
    });

    it('detects an existing playwright.config.js (variant) as a merge collision', () => {
      const target = makeTarget();
      const userJsCfg = "module.exports = { testDir: 'tests' };\n";
      writeFileSync(join(target, 'playwright.config.js'), userJsCfg);

      const result = scaffold({ projectPath: target });

      // User's .js file is preserved
      assert.equal(readFileSync(join(target, 'playwright.config.js'), 'utf-8'), userJsCfg);
      // No fresh .ts written next to the user's .js — that would shadow
      // their config (Playwright resolves .ts before .js).
      assert.equal(existsSync(join(target, 'playwright.config.ts')), false);

      const entry = result.filesNeedingAgentMerge.find(
        (f) => f.path === 'playwright.config.js'
      );
      assert.ok(entry, 'playwright.config.js should be surfaced as merge-required');
      assert.equal(entry!.mergeStrategy, 'review_and_decide');
      assert.match(entry!.instructions, /playwright\.config\.js/);
    });

    it('throws a clean error when the target path is a regular file (not a directory)', () => {
      const parent = makeTarget();
      const fileTarget = join(parent, 'README.md');
      writeFileSync(fileTarget, '# hi');

      assert.throws(
        () => scaffold({ projectPath: fileTarget }),
        /Cannot scaffold into .*: path exists and is not a directory/
      );
    });

    it('refuses to write any files when a required parent path is a non-directory', () => {
      const target = makeTarget();
      // Stray file at `auth` blocks `auth/example.login.ts`.
      writeFileSync(join(target, 'auth'), 'oops');

      assert.throws(
        () => scaffold({ projectPath: target }),
        /Cannot scaffold .*: parent path .* exists and is not a directory/
      );
      // Crucially, NO partial writes happened — fail fast, no rollback needed.
      assert.equal(existsSync(join(target, 'package.json')), false);
      assert.equal(existsSync(join(target, 'playwright.config.ts')), false);
      assert.equal(existsSync(join(target, '.mcp.json')), false);
    });

    it('resolves a relative projectPath to absolute before returning absPath', () => {
      const parent = makeTarget();
      // Use a nested path inside the temp dir and pass the relative form
      // (relative to process.cwd()) — scaffoldProject should resolve before
      // populating FileMergeRequest.absPath, which the agent's Read tool
      // requires to be absolute.
      const nested = join(parent, 'rel-target');
      mkdirSync(nested);
      writeFileSync(join(nested, 'package.json'), '{}');

      const relativeFromCwd = relative(process.cwd(), nested);
      const result = scaffold({ projectPath: relativeFromCwd });

      assert.ok(
        isAbsolute(result.projectPath),
        `result.projectPath must be absolute, got ${result.projectPath}`
      );
      const entry = result.filesNeedingAgentMerge.find((f) => f.path === 'package.json');
      assert.ok(entry);
      assert.ok(
        isAbsolute(entry!.absPath),
        `FileMergeRequest.absPath must be absolute, got ${entry!.absPath}`
      );
    });

    it('handles a basename containing a $-pattern without leaving {{name}} in the output', () => {
      // String.prototype.replace expands `$&`, `$1`, `$$`, etc. in the
      // REPLACEMENT-string overload. The implementation must use the
      // callback form so a basename like "weird$&dir" doesn't yield
      // a corrupted "name": "weird{{name}}dir".
      const parent = makeTarget();
      const tricky = join(parent, 'weird$&dir');
      mkdirSync(tricky);
      scaffold({ projectPath: tricky });
      const pkg = JSON.parse(readFileSync(join(tricky, 'package.json'), 'utf-8'));
      // sanitizeProjectName lowercases + replaces non-[a-z0-9._-] runs with
      // hyphens. "weird$&dir" → "weird-dir".
      assert.equal(pkg.name, 'weird-dir');
      assert.equal(/\{\{name\}\}/.test(pkg.name), false);
    });

    it('normalises an invalid derived basename to a valid npm package name', () => {
      const parent = makeTarget();
      // Uppercase + space: invalid npm name as-is, but normalisable.
      const ugly = join(parent, 'My App');
      mkdirSync(ugly);
      const result = scaffold({ projectPath: ugly });
      assert.equal(result.projectName, 'my-app');
      const pkg = JSON.parse(readFileSync(join(ugly, 'package.json'), 'utf-8'));
      assert.equal(pkg.name, 'my-app');
    });

    it('does not reject a symlink-to-directory as the project target (round-2 R2-1)', () => {
      // Regression: lstatSync-only checks treat a symlink-to-dir as a
      // non-directory and throw. statSync (or fallthrough via classifyPath)
      // must allow symlinked targets.
      const realDir = makeTarget();
      const linkParent = makeTarget();
      const linkPath = join(linkParent, 'project-link');
      symlinkSync(realDir, linkPath, 'dir');

      assert.doesNotThrow(() => scaffold({ projectPath: linkPath }));
      // The scaffold files materialize at the link's TARGET — that's fine,
      // it's what mkdir/writeFile would do anyway. The point is no throw.
      assert.ok(existsSync(join(realDir, 'package.json')));
    });

    it('accepts a symlinked subdirectory whose target is INSIDE the project root (round-2 R2-1)', () => {
      const target = makeTarget();
      // Real auth dir lives inside the project tree, so the symlink's
      // realpath stays contained — R3-2 containment check passes.
      const realAuth = join(target, '.shared-auth');
      mkdirSync(realAuth);
      symlinkSync(realAuth, join(target, 'auth'), 'dir');

      assert.doesNotThrow(() => scaffold({ projectPath: target }));
      assert.ok(existsSync(join(realAuth, 'example.login.ts')));
    });

    it('REJECTS a symlinked subdirectory whose target escapes the project root (round-3 R3-2)', () => {
      const target = makeTarget();
      const externalAuth = mkdtempSync(join(tmpdir(), 'external-auth-'));
      dirsToClean.push(externalAuth);
      symlinkSync(externalAuth, join(target, 'auth'), 'dir');

      assert.throws(
        () => scaffold({ projectPath: target }),
        /outside the project root/
      );
      // Critically: nothing was written into the escaping target.
      assert.equal(existsSync(join(externalAuth, 'example.login.ts')), false);
    });

    it('rejects a broken symlink as the project target with a clear error (round-2 R2-1)', () => {
      const parent = makeTarget();
      const broken = join(parent, 'broken-link');
      symlinkSync(join(parent, 'does-not-exist'), broken, 'dir');
      assert.throws(
        () => scaffold({ projectPath: broken }),
        /broken symlink/i
      );
    });

    it('rejects a dangling symlink at a plan target with a clear error (round-2 R2-2 + round-4 R4-4)', () => {
      // R2-2 demanded: a dangling symlink at <projectPath>/tests/example.test.yaml
      // must NOT cause writeFileSync to follow the link and create the file
      // outside the project. R4-4 strengthens the contract: rather than silently
      // routing the dangling link into filesSkipped (the round-2 fix), the
      // current behavior is to throw with a clear message so the user can
      // clean up the stale link.
      const target = makeTarget();
      mkdirSync(join(target, 'tests'));
      const externalTarget = join(tmpdir(), 'shiplight-test-should-never-be-written-' + Math.random().toString(36).slice(2));
      symlinkSync(externalTarget, join(target, 'tests/example.test.yaml'), 'file');

      assert.throws(
        () => scaffold({ projectPath: target }),
        /broken symlink/i,
      );
      // The external target must NOT have been written to.
      assert.equal(existsSync(externalTarget), false, 'must not write outside project via dangling symlink');
      // The symlink itself is still in place (we didn't clean up the user's tree).
      assert.ok(lstatSync(join(target, 'tests/example.test.yaml')).isSymbolicLink());
    });

    it('surfaces ALL playwright.config variants, not just the first (round-2 R2-5)', () => {
      const target = makeTarget();
      writeFileSync(join(target, 'playwright.config.ts'), "// existing ts\n");
      writeFileSync(join(target, 'playwright.config.js'), "// existing js\n");

      const result = scaffold({ projectPath: target });

      const variantPaths = result.filesNeedingAgentMerge
        .map((f) => f.path)
        .filter((p) => p.startsWith('playwright.config.'))
        .sort();
      assert.deepEqual(variantPaths, ['playwright.config.js', 'playwright.config.ts']);
      // And the user's content is preserved
      assert.equal(readFileSync(join(target, 'playwright.config.ts'), 'utf-8'), '// existing ts\n');
      assert.equal(readFileSync(join(target, 'playwright.config.js'), 'utf-8'), '// existing js\n');
    });

    it('does NOT auto-write playwright.config.ts when package.json EXPLICITLY declares CommonJS (round-2 R2-13)', () => {
      const target = makeTarget();
      writeFileSync(
        join(target, 'package.json'),
        JSON.stringify({ name: 'cjs-app', version: '1.0.0', type: 'commonjs' }, null, 2)
      );

      const result = scaffold({ projectPath: target });

      // R3-1: the defer only fires on EXPLICIT type:commonjs.
      assert.equal(existsSync(join(target, 'playwright.config.ts')), false);
      assert.equal(result.filesCreated.includes('playwright.config.ts'), false,
        'playwright.config.ts must not appear in filesCreated when deferred');
      const pwEntry = result.filesNeedingAgentMerge.find((f) => f.path === 'playwright.config.ts');
      assert.ok(pwEntry, 'playwright.config.ts should be in filesNeedingAgentMerge');
      assert.equal(pwEntry!.mergeStrategy, 'review_and_decide');
      assert.match(pwEntry!.instructions, /CommonJS|require\(/i);
    });

    it('DOES auto-write playwright.config.ts when package.json has no `type` field (round-3 R3-1)', () => {
      // R3-1 fix: a missing `type` field used to be treated as CJS,
      // forcing every legacy Node repo into the defer path. The new
      // behavior is to only defer on EXPLICIT type:commonjs; the very
      // common no-type case writes the ESM template normally.
      const target = makeTarget();
      writeFileSync(
        join(target, 'package.json'),
        JSON.stringify({ name: 'legacy-app', version: '1.0.0' }, null, 2)
      );

      const result = scaffold({ projectPath: target });

      assert.ok(result.filesCreated.includes('playwright.config.ts'));
      assert.ok(existsSync(join(target, 'playwright.config.ts')));
    });

    it('DOES auto-write playwright.config.ts when package.json is malformed/array (round-3 R3-5)', () => {
      // Array-shaped package.json used to misclassify as CJS via the
      // `typeof parsed === "object"` test. Now it returns "unknown",
      // which does NOT trigger defer.
      const target = makeTarget();
      writeFileSync(join(target, 'package.json'), '[{"name":"oops"}]');

      const result = scaffold({ projectPath: target });

      assert.ok(result.filesCreated.includes('playwright.config.ts'));
    });

    it('rejects a Node-core-module name (./test, ./fs) via the full builtinModules reserved-name set (round-3 R3-3)', () => {
      // Old NPM_RESERVED_NAMES only covered a handful of names; now we
      // pull the full list from node:module#builtinModules so `test`,
      // `fs`, `path`, etc. all fall back to the generic name.
      for (const reserved of ['test', 'fs', 'path', 'os', 'crypto']) {
        const parent = makeTarget();
        const ugly = join(parent, reserved);
        mkdirSync(ugly);
        const result = scaffold({ projectPath: ugly });
        assert.equal(result.projectName, 'shiplight-test-project',
          `derived name '${reserved}' should fall back to the generic project name`);
      }
    });

    it('surfaces preExistingTopLevelEntries for callers to detect "into existing repo" (round-3 R3-10)', () => {
      const target = makeTarget();
      writeFileSync(join(target, '.env'), 'EXISTING=1\n');
      writeFileSync(join(target, 'README.md'), '# my app\n');

      const result = scaffold({ projectPath: target });

      const entries = result.preExistingTopLevelEntries.slice().sort();
      assert.deepEqual(entries, ['.env', 'README.md']);
    });

    it('preExistingTopLevelEntries is empty for a truly-fresh scaffold target (round-3 R3-10)', () => {
      const target = makeTarget();
      const result = scaffold({ projectPath: target });
      assert.deepEqual(result.preExistingTopLevelEntries, []);
    });

    it('REJECTS a leaf symlink whose target escapes the project root (round-4 R4-1)', () => {
      // R3-2 covered DIRECTORY-symlink escapes (e.g. tests -> /external/dir).
      // R4-1 covers LEAF-FILE symlinks (e.g. package.json -> /external/file.json).
      // writeFileSync would otherwise follow the link and clobber the external file.
      const target = makeTarget();
      const externalParent = mkdtempSync(join(tmpdir(), 'external-leaf-'));
      dirsToClean.push(externalParent);
      const externalFile = join(externalParent, 'external-package.json');
      writeFileSync(externalFile, '{"name":"DO NOT TOUCH"}');
      symlinkSync(externalFile, join(target, 'package.json'), 'file');

      assert.throws(
        () => scaffold({ projectPath: target }),
        /symlink that resolves to .* outside the project root/,
      );
      // External file content untouched.
      assert.equal(readFileSync(externalFile, 'utf-8'), '{"name":"DO NOT TOUCH"}');
    });

    it('ACCEPTS a leaf symlink whose target stays inside the project root (round-4 R4-1)', () => {
      // Symmetry test: in-project leaf symlinks should still work as merge targets.
      const target = makeTarget();
      const innerActual = join(target, '.actual-package.json');
      writeFileSync(innerActual, '{"name":"acme"}');
      symlinkSync(innerActual, join(target, 'package.json'), 'file');

      // Should NOT throw — the leaf resolves inside the project.
      assert.doesNotThrow(() => scaffold({ projectPath: target }));
    });

    it('truncates a 215+ char derived basename to the safe-fallback name (round-4 R4-10)', () => {
      // npm rejects package names > 214 chars. sanitizeProjectName falls
      // back to the generic project name when the input would violate.
      const parent = makeTarget();
      const longName = 'a'.repeat(220);
      const longDir = join(parent, longName);
      mkdirSync(longDir);
      const result = scaffold({ projectPath: longDir });
      assert.equal(result.projectName, 'shiplight-test-project');
    });

    it('REJECTS a directory at an agent_merge leaf with clear messaging (round-5 R5-1 + round-6 R6-3)', () => {
      // A stray directory at .gitignore (or any other merge target) would
      // otherwise route to filesNeedingAgentMerge with abs_path pointing at
      // the directory — agent's Read would EISDIR. The error message
      // distinguishes "directory" from "symlink-to-directory" (R6-3).
      const target = makeTarget();
      mkdirSync(join(target, '.gitignore'));
      assert.throws(
        () => scaffold({ projectPath: target }),
        /is a directory, but a file is expected here/,
      );
    });

    it('REJECTS a symlink-to-directory at a merge leaf with the symlink-specific message (round-6 R6-3)', () => {
      const target = makeTarget();
      const targetDir = join(target, '.actual-dir');
      mkdirSync(targetDir);
      symlinkSync(targetDir, join(target, '.gitignore'), 'dir');
      assert.throws(
        () => scaffold({ projectPath: target }),
        /is a symlink that resolves to a directory.*Remove the symlink/,
      );
    });

    it('REJECTS a directory at a SKIP-plan leaf too (round-6 R6-2)', () => {
      // R5-1 originally only rejected directories at agent_merge leaves.
      // R6-2 extends to SKIP plans: a directory at tests/example.test.yaml
      // is broken regardless of strategy — npx shiplight test would EISDIR
      // trying to read the "file".
      const target = makeTarget();
      mkdirSync(join(target, 'tests'));
      mkdirSync(join(target, 'tests/example.test.yaml'));
      assert.throws(
        () => scaffold({ projectPath: target }),
        /is a directory, but a file is expected here/,
      );
    });

    it('readExistingPackageJsonType returns "unknown" for an oversize package.json (round-3 R3-13)', () => {
      // The 1 MiB size cap should short-circuit before readFileSync even
      // runs. We can't directly assert the helper's return value (it's
      // module-private) but we CAN verify the observable consequence:
      // when type is "unknown", scaffold treats playwright as ESM by
      // default (R3-1) — so playwright.config.ts gets auto-written.
      const target = makeTarget();
      // Generate >1 MiB of JSON. Whitespace makes it valid JSON; the parse
      // path is never reached anyway because of the size cap.
      const huge = '{"name":"x","scripts":{"a":"' + 'x'.repeat(1_200_000) + '"}}';
      writeFileSync(join(target, 'package.json'), huge);

      const result = scaffold({ projectPath: target });
      assert.ok(
        result.filesCreated.includes('playwright.config.ts'),
        'oversized package.json must route through "unknown" → ESM auto-write, not CJS-defer',
      );
    });

    it('ALLOWS an external-symlink leaf for a SKIP plan — over-strict rejection lifted (round-5 R5-2)', () => {
      // SKIP plans (auth/example.login.ts and tests/example.test.yaml) do not
      // write when the file exists, so an
      // external-symlink containment check would be over-strict. R5-2 lifts
      // the check for SKIP plans only — agent_merge plans still reject
      // (see "REJECTS a leaf symlink whose target escapes the project root").
      const target = makeTarget();
      const externalParent = mkdtempSync(join(tmpdir(), 'external-skip-'));
      dirsToClean.push(externalParent);
      const externalFile = join(externalParent, 'shared-example.login.ts');
      writeFileSync(externalFile, '// shared fixture');
      mkdirSync(join(target, 'auth'));
      symlinkSync(externalFile, join(target, 'auth/example.login.ts'), 'file');

      const result = scaffold({ projectPath: target });
      assert.ok(
        result.filesSkipped.includes('auth/example.login.ts'),
        'external-symlink SKIP plan should land in filesSkipped, not throw',
      );
      // External file untouched — same guarantee as the rejection case.
      assert.equal(readFileSync(externalFile, 'utf-8'), '// shared fixture');
    });

    it('surfaces ALL four playwright.config variants — .ts, .js, .mjs, .cjs (round-4 R4-14)', () => {
      const target = makeTarget();
      writeFileSync(join(target, 'playwright.config.ts'), '// ts\n');
      writeFileSync(join(target, 'playwright.config.js'), '// js\n');
      writeFileSync(join(target, 'playwright.config.mjs'), '// mjs\n');
      writeFileSync(join(target, 'playwright.config.cjs'), '// cjs\n');

      const result = scaffold({ projectPath: target });

      const variantPaths = result.filesNeedingAgentMerge
        .map((f) => f.path)
        .filter((p) => p.startsWith('playwright.config.'))
        .sort();
      assert.deepEqual(variantPaths, [
        'playwright.config.cjs',
        'playwright.config.js',
        'playwright.config.mjs',
        'playwright.config.ts',
      ]);
    });

    it('exposes originalProjectName so callers can warn about name rewrites (round-3 R3-9)', () => {
      const parent = makeTarget();
      const ugly = join(parent, 'My App');
      mkdirSync(ugly);
      const result = scaffold({ projectPath: ugly });
      assert.equal(result.originalProjectName, 'My App');
      assert.equal(result.projectName, 'my-app');
    });

    it('handles multiple {{name}} placeholders without leaking the literal placeholder (round-2 R2-14)', () => {
      // Defensive future-proofing: if the template ever grows a second
      // {{name}}, the new global-regex replace must substitute every
      // occurrence, not just the first. We assert the rendered template
      // has no stray `{{name}}` left.
      const target = makeTarget();
      scaffold({ projectPath: target, projectName: 'demo-app' });
      const pkg = readFileSync(join(target, 'package.json'), 'utf-8');
      assert.equal(/\{\{name\}\}/.test(pkg), false);
    });

    it('isMustApplyStrategy classifies each MergeStrategy exactly once (round-2 R2-7)', () => {
      // The allowlist is the canonical source of truth for "Shiplight cannot
      // run without this merge". Lock it in so a new strategy can't silently
      // fall into the must-apply bucket by complement.
      assert.equal(isMustApplyStrategy('json_merge_deps_and_scripts'), true);
      assert.equal(isMustApplyStrategy('append_missing_lines'), true);
      assert.equal(isMustApplyStrategy('json_merge_under_key'), true);
      assert.equal(isMustApplyStrategy('append_missing_env_keys'), true);
      assert.equal(isMustApplyStrategy('review_and_decide'), false);
    });

    it('every merge entry includes path, abs_path, strategy, instructions, template, and humanSummary', () => {
      const target = makeTarget();
      writeFileSync(join(target, 'package.json'), '{}');
      writeFileSync(join(target, '.gitignore'), '');
      writeFileSync(join(target, '.env.example'), '');
      writeFileSync(join(target, '.mcp.json'), '{}');
      writeFileSync(join(target, 'playwright.config.ts'), '');

      const result = scaffold({ projectPath: target });

      assert.equal(result.filesNeedingAgentMerge.length, 5);
      for (const entry of result.filesNeedingAgentMerge) {
        assert.ok(entry.path, `path must be set`);
        assert.ok(entry.absPath.startsWith(target), `absPath must be absolute under target`);
        assert.ok(entry.mergeStrategy, `mergeStrategy must be set`);
        assert.ok(entry.instructions.length > 20, `instructions must be a meaningful string`);
        assert.ok(entry.template.length > 0, `template must carry content`);
        assert.ok(entry.humanSummary && entry.humanSummary.length > 10, `humanSummary must be a short user-facing line`);
        // humanSummary must not leak agent verbs intended for the LLM
        assert.equal(/Read \+ Edit|merge_strategy|merge_key/.test(entry.humanSummary), false,
          `humanSummary should be human-readable, got: ${entry.humanSummary}`);
      }
    });
  });
});

describe('toDependencyRange', () => {
  it('caret-pins an exact version', () => {
    assert.equal(toDependencyRange('0.1.93'), '^0.1.93');
    assert.equal(toDependencyRange('1.0.0'), '^1.0.0');
  });

  it('preserves prerelease and build metadata', () => {
    assert.equal(toDependencyRange('0.2.0-beta.1'), '^0.2.0-beta.1');
    assert.equal(toDependencyRange('0.2.0+build.7'), '^0.2.0+build.7');
  });

  it('tolerates surrounding whitespace', () => {
    assert.equal(toDependencyRange('  0.1.93\n'), '^0.1.93');
  });

  for (const bad of ['latest', 'next', 'dev', '', '   ', '^0.1.93', '0.1', 'v0.1.93', '0.1.x']) {
    it(`rejects ${JSON.stringify(bad)} rather than writing it to package.json`, () => {
      // Every one of these produces a package.json that either cannot install
      // or silently floats. Failing here beats failing at the user's
      // `npm install`, which is where the original "latest" bug hid.
      assert.throws(() => toDependencyRange(bad), /not an exact semver version/);
    });
  }
});

describe('scaffolded package.json version pinning', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const target = () => {
    const d = mkdtempSync(join(tmpdir(), 'scaffold-version-'));
    dirs.push(d);
    return d;
  };

  it('writes the caller-supplied version, not a hardcoded one', () => {
    const dir = target();
    scaffoldProject({ projectPath: dir, shiplightVersion: '9.8.7' });
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    assert.equal(pkg.dependencies.shiplightai, '^9.8.7');
  });

  it('leaves no unsubstituted placeholder in the template', () => {
    const dir = target();
    scaffoldProject({ projectPath: dir, shiplightVersion: '1.2.3' });
    const raw = readFileSync(join(dir, 'package.json'), 'utf-8');
    assert.equal(raw.includes('{{'), false, `unsubstituted placeholder in:\n${raw}`);
    // Must still be valid JSON after substitution.
    JSON.parse(raw);
  });

  it('refuses to write anything when the version is unusable', () => {
    const dir = target();
    assert.throws(() => scaffoldProject({ projectPath: dir, shiplightVersion: 'latest' }));
    // Validation happens before any write, so a bad version must not leave a
    // half-scaffolded tree behind for the user to clean up.
    assert.equal(existsSync(join(dir, 'package.json')), false);
    assert.equal(existsSync(join(dir, 'playwright.config.ts')), false);
  });
});

describe('resolveEnvSetupState', () => {
  // Ported from the deleted mcp-tools scaffold-mcp-wrapper "envInstruction
  // branching" suite — the four B-* scenarios plus fresh. These are the
  // branches that decide whether a user is told to `cp` over an existing
  // .env, so a reordered if-ladder must fail here, not in production.
  const base = (over: Partial<ReturnType<typeof scaffoldResultStub>>) => ({
    ...scaffoldResultStub(),
    ...over,
  });

  function scaffoldResultStub() {
    return {
      projectPath: '/tmp/x',
      projectName: 'x',
      originalProjectName: 'x',
      filesCreated: [] as string[],
      filesSkipped: [] as string[],
      filesNeedingAgentMerge: [] as { path: string }[],
      preExistingTopLevelEntries: [] as string[],
    };
  }

  it('fresh project → copy_example', () => {
    assert.equal(
      resolveEnvSetupState(base({ filesCreated: ['.env.example'] }) as unknown as ScaffoldResult),
      'copy_example',
    );
  });

  it('no .env but a pre-existing .env.example → copy_example_after_merge', () => {
    assert.equal(
      resolveEnvSetupState(
        base({ filesNeedingAgentMerge: [{ path: '.env.example' }] }) as unknown as ScaffoldResult,
      ),
      'copy_example_after_merge',
    );
  });

  it('.env exists, .env.example untouched → review_existing_env', () => {
    assert.equal(
      resolveEnvSetupState(
        base({ preExistingTopLevelEntries: ['.env'] }) as unknown as ScaffoldResult,
      ),
      'review_existing_env',
    );
  });

  it('.env exists AND .env.example pending merge → merge_example_then_diff (never cp)', () => {
    assert.equal(
      resolveEnvSetupState(
        base({
          preExistingTopLevelEntries: ['.env', '.env.example'],
          filesNeedingAgentMerge: [{ path: '.env.example' }],
        }) as unknown as ScaffoldResult,
      ),
      'merge_example_then_diff',
    );
  });

  it('.env exists AND fresh .env.example written → diff_fresh_example (never cp)', () => {
    assert.equal(
      resolveEnvSetupState(
        base({
          preExistingTopLevelEntries: ['.env'],
          filesCreated: ['.env.example'],
        }) as unknown as ScaffoldResult,
      ),
      'diff_fresh_example',
    );
  });

  it('merge takes precedence over fresh-write when both somehow apply', () => {
    // Guards the ladder ORDER, not just membership: if the fresh-example
    // check ever moves above the merge check, a both-true result would give
    // the weaker "diff" guidance instead of "merge first".
    assert.equal(
      resolveEnvSetupState(
        base({
          preExistingTopLevelEntries: ['.env'],
          filesCreated: ['.env.example'],
          filesNeedingAgentMerge: [{ path: '.env.example' }],
        }) as unknown as ScaffoldResult,
      ),
      'merge_example_then_diff',
    );
  });
});
