import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isReleaseBumpCommit,
  classifyCommit,
  groupCommits,
  renderVersionSection,
  parseChangelog,
  composeChangelog,
  upsertVersion,
  collectBundlePaths,
  BUILD_TIME_BUNDLE_PATHS,
  NON_SHIPPING_GLOBS,
} from '../gen-changelog.mjs';

test('isReleaseBumpCommit matches CLI and MCP bump commits (both scopes)', () => {
  assert.equal(isReleaseBumpCommit('chore(cli): bump shiplightai to 0.1.95'), true);
  assert.equal(isReleaseBumpCommit('chore(mcp): bump @shiplightai/mcp to 0.1.79'), true);
  assert.equal(isReleaseBumpCommit('chore(mcp-server): bump @shiplightai/mcp to 0.1.77'), true);
  // Not a bump commit — must not be swallowed.
  assert.equal(isReleaseBumpCommit('feat(cli): bump the retry ceiling to a config value'), false);
  assert.equal(isReleaseBumpCommit('fix(sdk-core): sanitize verification codes'), false);
  // A real feature whose subject happens to mention bumping something to a
  // semver must survive — the filter is a release-bump filter, not a keyword.
  assert.equal(isReleaseBumpCommit('feat(cli): bump default LLM timeout to v2.0.0'), false);
  assert.equal(isReleaseBumpCommit('fix(sdk-core): bump retry budget to 3.0.0 seconds'), false);
});

test('classifyCommit maps conventional types to sections and extracts scope', () => {
  assert.deepEqual(classifyCommit('feat(cli): add LLM tier selection'), {
    section: 'Features',
    type: 'feat',
    scope: 'cli',
    description: 'add LLM tier selection',
    breaking: false,
  });
  assert.equal(classifyCommit('fix(sdk-core,shiplight-tools): x').section, 'Bug Fixes');
  assert.equal(classifyCommit('perf: speed up parsing').section, 'Performance');
  assert.equal(classifyCommit('revert: undo the thing').section, 'Reverts');
  // Unknown type and non-conventional subjects fall through to Other Changes.
  assert.equal(classifyCommit('refactor(cli): move code').section, 'Other Changes');
  assert.equal(classifyCommit('docs: update readme').section, 'Other Changes');
  assert.equal(classifyCommit('just a plain message').section, 'Other Changes');
  assert.equal(classifyCommit('just a plain message').description, 'just a plain message');
});

test('classifyCommit flags breaking changes (! before colon)', () => {
  const c = classifyCommit('feat(api)!: drop the legacy flag');
  assert.equal(c.breaking, true);
  assert.equal(c.section, '⚠ Breaking Changes');
});

test('groupCommits drops bump commits and buckets by section', () => {
  const commits = [
    { hash: 'aaaaaaa', subject: 'chore(cli): bump shiplightai to 0.1.95' },
    { hash: 'bbbbbbb', subject: 'feat(cli): add tier selection' },
    { hash: 'ccccccc', subject: 'fix(sdk-core): sanitize codes' },
    { hash: 'ddddddd', subject: 'chore(mcp): bump @shiplightai/mcp to 0.1.79' },
    { hash: 'eeeeeee', subject: 'refactor(cli): tidy' },
  ];
  const groups = groupCommits(commits);
  assert.equal(groups.get('Features').length, 1);
  assert.equal(groups.get('Bug Fixes').length, 1);
  assert.equal(groups.get('Other Changes').length, 1);
  // Both bump commits are gone.
  const total = [...groups.values()].reduce((n, a) => n + a.length, 0);
  assert.equal(total, 3);
});

test('renderVersionSection produces ordered markdown with scope and short hash', () => {
  const section = renderVersionSection({
    version: '0.1.95',
    date: '2026-07-23',
    commits: [
      { hash: 'bbbbbbbdeadbeef', subject: 'feat(cli): add tier selection' },
      { hash: 'cccccccdeadbeef', subject: 'fix(sdk-core): sanitize codes' },
    ],
  });
  assert.match(section, /^## 0\.1\.95 \(2026-07-23\)/);
  // Section ordering: Features must come before Bug Fixes.
  assert.ok(section.indexOf('### Features') < section.indexOf('### Bug Fixes'));
  assert.match(section, /- \*\*cli:\*\* add tier selection \(bbbbbbb\)/);
  assert.match(section, /- \*\*sdk-core:\*\* sanitize codes \(ccccccc\)/);
  // No trailing newline (composition controls spacing).
  assert.equal(section, section.trimEnd());
});

test('renderVersionSection emits a maintenance note when nothing survives filtering', () => {
  const section = renderVersionSection({
    version: '0.1.96',
    date: '2026-07-24',
    commits: [{ hash: 'aaaaaaa', subject: 'chore(cli): bump shiplightai to 0.1.96' }],
  });
  assert.match(section, /Maintenance release/);
  assert.doesNotMatch(section, /### /);
});

test('parseChangelog splits header from entries; composeChangelog round-trips', () => {
  const file =
    '# Changelog\n\nintro text\n\n## 0.1.94 (2026-07-20)\n\n### Features\n\n- a\n\n## 0.1.93 (2026-07-18)\n\n- b\n';
  const { header, entries } = parseChangelog(file, 'shiplightai');
  assert.match(header, /^# Changelog/);
  assert.match(header, /intro text/);
  assert.equal(entries.length, 2);
  assert.match(entries[0], /^## 0\.1\.94/);
  assert.match(entries[1], /^## 0\.1\.93/);
  const composed = composeChangelog({ header, entries });
  assert.match(composed, /## 0\.1\.94/);
  assert.match(composed, /## 0\.1\.93/);
});

test('parseChangelog synthesizes a header when the file is empty/new', () => {
  const { header, entries } = parseChangelog('', 'shiplightai');
  assert.match(header, /^# Changelog/);
  assert.match(header, /`shiplightai`/);
  assert.equal(entries.length, 0);
});

test('upsertVersion prepends a new version above older ones', () => {
  const existing =
    '# Changelog\n\nintro\n\n## 0.1.94 (2026-07-20)\n\n### Features\n\n- old\n';
  const section = renderVersionSection({
    version: '0.1.95',
    date: '2026-07-23',
    commits: [{ hash: 'bbbbbbb', subject: 'feat(cli): new thing' }],
  });
  const next = upsertVersion(existing, section, { packageName: 'shiplightai', version: '0.1.95' });
  assert.ok(next.indexOf('## 0.1.95') < next.indexOf('## 0.1.94'), 'newest on top');
  assert.match(next, /intro/);
});

test('upsertVersion is idempotent — re-running the same version replaces, not duplicates', () => {
  let file = '# Changelog\n\nintro\n';
  const section = renderVersionSection({
    version: '0.1.95',
    date: '2026-07-23',
    commits: [{ hash: 'bbbbbbb', subject: 'feat(cli): new thing' }],
  });
  file = upsertVersion(file, section, { packageName: 'shiplightai', version: '0.1.95' });
  file = upsertVersion(file, section, { packageName: 'shiplightai', version: '0.1.95' });
  const occurrences = file.split('## 0.1.95').length - 1;
  assert.equal(occurrences, 1);
});

test('collectBundlePaths walks the workspace graph and excludes unrelated apps', () => {
  const nameToDir = new Map([
    ['shiplightai', 'apps/cli'],
    ['sdk-core', 'packages/sdk-core'],
    ['shiplight-tools', 'packages/shiplight-tools'],
    ['shiplight-types', 'packages/types'],
    ['async-tier', 'apps/async-tier'],
  ]);
  const depGraph = {
    'apps/cli': ['sdk-core', 'shiplight-tools'],
    'packages/sdk-core': ['shiplight-types'],
    'packages/shiplight-tools': ['sdk-core'],
    'packages/types': [],
  };
  const readDeps = (rel) => depGraph[rel] || [];
  const paths = collectBundlePaths('apps/cli', nameToDir, readDeps);
  assert.deepEqual(paths, [
    'apps/cli',
    'packages/sdk-core',
    'packages/shiplight-tools',
    'packages/types',
  ]);
  // async-tier is a workspace package but not reachable → must be excluded.
  assert.ok(!paths.includes('apps/async-tier'));
});

test('collectBundlePaths includes build-time paths the dependency graph cannot reach', () => {
  const nameToDir = new Map([['shiplightai', 'apps/cli']]);
  const readDeps = () => [];

  // apps/cli bundles the debugger UI by invoking packages/debugger-ui's vite
  // builds from tsup's onSuccess, with no package.json edge to follow.
  const paths = collectBundlePaths('apps/cli', nameToDir, readDeps, [
    'packages/debugger-ui/vite.debugger.config.ts',
    'packages/debugger-ui/src/components/testcase/editor',
  ]);

  assert.deepEqual(paths, [
    'apps/cli',
    'packages/debugger-ui/src/components/testcase/editor',
    'packages/debugger-ui/vite.debugger.config.ts',
  ]);
});

test('collectBundlePaths does not duplicate an extra path already reachable via deps', () => {
  const nameToDir = new Map([
    ['shiplightai', 'apps/cli'],
    ['sdk-core', 'packages/sdk-core'],
  ]);
  const readDeps = (rel) => (rel === 'apps/cli' ? ['sdk-core'] : []);

  const paths = collectBundlePaths('apps/cli', nameToDir, readDeps, ['packages/sdk-core']);
  assert.deepEqual(paths, ['apps/cli', 'packages/sdk-core']);
});

test('BUILD_TIME_BUNDLE_PATHS covers the CLI debugger source that ships in the tarball', () => {
  // apps/cli has no package.json dependency on packages/debugger-ui, so a
  // debugger-only fix is invisible to the changelog without these entries.
  const cli = BUILD_TIME_BUNDLE_PATHS['apps/cli'];
  assert.ok(Array.isArray(cli) && cli.length > 0, 'apps/cli must declare its build-time bundle paths');
  assert.ok(
    cli.every((p) => p.startsWith('packages/debugger-ui/')),
    'only the debugger subtree is bundled — listing the whole package would put ' +
      'unrelated vendored-model changes in a CLI changelog',
  );
  // The editor tree is what "fix debugger code step descriptions" touched.
  assert.ok(cli.includes('packages/debugger-ui/src/components/testcase/editor'));
  assert.ok(cli.includes('packages/debugger-ui/src/components/local-debugger'));
});

test('NON_SHIPPING_GLOBS excludes task-graph config that cannot affect the artifact', () => {
  // A commit touching only turbo.json (e.g. the test:browser scoping change)
  // reached the changelog because apps/cli/turbo.json is inside the app dir.
  assert.ok(NON_SHIPPING_GLOBS.includes('**/turbo.json'));
});

test('collectBundlePaths terminates on dependency cycles', () => {
  const nameToDir = new Map([
    ['a', 'packages/a'],
    ['b', 'packages/b'],
  ]);
  const depGraph = { 'packages/a': ['b'], 'packages/b': ['a'] };
  const readDeps = (rel) => depGraph[rel] || [];
  const paths = collectBundlePaths('packages/a', nameToDir, readDeps);
  assert.deepEqual(paths, ['packages/a', 'packages/b']);
});
