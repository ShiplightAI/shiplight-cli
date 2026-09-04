#!/usr/bin/env node
// Generate (or prepend) a CHANGELOG.md entry for a publishable package at
// release time. Invoked by .github/workflows/publish-cli.yml and publish-mcp.yml
// right after the version bump and before `pnpm pack`, so the entry ships inside
// the npm tarball (CHANGELOG.md is listed in each package's `files`).
//
// The entry is derived from the git commits since the package's previous release
// bump, filtered to the paths that actually get bundled into the tarball — the
// package directory plus its transitive workspace dependency tree (deps AND
// devDeps, because tsup inlines bundled workspace packages that are declared as
// devDependencies). Commits touching only unrelated apps (async-tier, core-api,
// frontend, …) are intentionally excluded so a CLI/MCP customer's changelog only
// reflects code they actually run.
//
// Usage:
//   node scripts/gen-changelog.mjs \
//     --app-dir apps/cli \
//     --package shiplightai \
//     --version 0.1.95 \
//     --out apps/cli/CHANGELOG.md \
//     --prev-bump-grep "bump shiplightai to"
//   Optional: --date YYYY-MM-DD (defaults to today, UTC), --repo-root <path>.
//
// The pure functions below (classifyCommit, groupCommits, renderVersionSection,
// parseChangelog, composeChangelog, collectBundlePaths) are unit-tested in
// scripts/__tests__/gen-changelog.test.mjs; main() is the thin impure shell.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// --- Classification -------------------------------------------------------

const SECTION_ORDER = [
  '⚠ Breaking Changes',
  'Features',
  'Bug Fixes',
  'Performance',
  'Reverts',
  'Other Changes',
];

const TYPE_TO_SECTION = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  revert: 'Reverts',
};

const CONVENTIONAL =
  /^(?<type>\w+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<desc>.+)$/;

// A release version-bump commit ("chore(cli): bump shiplightai to 0.1.95").
// These are pure release plumbing and must never appear in a changelog — and
// because CLI and MCP release independently off the same main, each package's
// commit range routinely contains the OTHER package's bump commit too.
//
// Matched narrowly — `chore` type, a single package token, and a trailing
// semver — so a genuine change whose subject merely mentions bumping something
// to a version (e.g. "feat(cli): bump default LLM timeout to v2.0.0") is NOT
// dropped from the changelog.
const BUMP_RE = /^chore(?:\([^)]*\))?:\s*bump\s+\S+\s+to\s+v?\d+\.\d+\.\d+\s*$/i;

export function isReleaseBumpCommit(subject) {
  return BUMP_RE.test(subject);
}

export function classifyCommit(subject) {
  const clean = subject.trim();
  const m = CONVENTIONAL.exec(clean);
  if (!m) {
    return { section: 'Other Changes', type: null, scope: null, description: clean, breaking: false };
  }
  const { type, scope, bang, desc } = m.groups;
  const breaking = bang === '!';
  const section = breaking
    ? '⚠ Breaking Changes'
    : TYPE_TO_SECTION[type.toLowerCase()] || 'Other Changes';
  return {
    section,
    type: type.toLowerCase(),
    scope: scope ? scope.trim() : null,
    description: desc.trim(),
    breaking,
  };
}

// commits: [{ hash, subject }] in git-log order (newest first).
// Returns Map<section, Array<{hash, subject, ...classification}>> preserving order.
export function groupCommits(commits) {
  const groups = new Map();
  for (const c of commits) {
    if (isReleaseBumpCommit(c.subject)) continue;
    const info = classifyCommit(c.subject);
    if (!groups.has(info.section)) groups.set(info.section, []);
    groups.get(info.section).push({ ...c, ...info });
  }
  return groups;
}

function formatLine(c) {
  const scope = c.scope ? `**${c.scope}:** ` : '';
  const short = c.hash ? ` (${c.hash.slice(0, 7)})` : '';
  return `- ${scope}${c.description}${short}`;
}

// Render a single "## <version> (<date>)" section (no trailing newline).
export function renderVersionSection({ version, date, commits }) {
  const groups = groupCommits(commits);
  const hasAny = [...groups.values()].some((a) => a.length);
  const lines = [`## ${version} (${date})`, ''];
  if (!hasAny) {
    lines.push(
      '_Maintenance release — no user-facing changes in the published package or its bundled SDK._',
    );
    return lines.join('\n').trimEnd();
  }
  for (const section of SECTION_ORDER) {
    const items = groups.get(section);
    if (!items || !items.length) continue;
    lines.push(`### ${section}`, '');
    for (const c of items) lines.push(formatLine(c));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// --- Changelog file assembly ---------------------------------------------

function defaultHeader(packageName) {
  return (
    '# Changelog\n\n' +
    `All notable changes to \`${packageName}\` are documented here. ` +
    'This file is generated automatically at release time from the commits ' +
    'that touch the published package and its bundled SDK.'
  );
}

// Split an existing CHANGELOG.md into its header block and per-version entries.
export function parseChangelog(existing, packageName) {
  const text = (existing || '').trim();
  if (!text.startsWith('# Changelog')) {
    return { header: defaultHeader(packageName), entries: [] };
  }
  const firstEntry = text.search(/\n## /);
  if (firstEntry === -1) return { header: text.trimEnd(), entries: [] };
  const header = text.slice(0, firstEntry).trimEnd();
  const body = text.slice(firstEntry + 1); // starts at the first "## "
  const entries = body
    .split(/\n(?=## )/)
    .map((s) => s.trimEnd())
    .filter(Boolean);
  return { header, entries };
}

export function composeChangelog({ header, entries }) {
  return [header, ...entries].join('\n\n') + '\n';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Prepend `section` for `version`, replacing any existing same-version entry so
// re-runs (e.g. a promote after a dry-run) stay idempotent rather than duplicate.
export function upsertVersion(existing, section, { packageName, version }) {
  const { header, entries } = parseChangelog(existing, packageName);
  const sameVersion = new RegExp(`^## ${escapeRegExp(version)} `);
  const kept = entries.filter((e) => !sameVersion.test(e));
  return composeChangelog({ header, entries: [section, ...kept] });
}

// --- Workspace dependency graph (impure helpers) -------------------------

// Map every workspace package name -> its repo-relative directory.
function buildNameToDir(repoRoot) {
  const map = new Map();
  for (const group of ['apps', 'packages']) {
    const base = path.join(repoRoot, group);
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const pj = path.join(base, d, 'package.json');
      if (!fs.existsSync(pj)) continue;
      try {
        const name = JSON.parse(fs.readFileSync(pj, 'utf8')).name;
        if (name) map.set(name, `${group}/${d}`);
      } catch {
        // ignore unparseable package.json
      }
    }
  }
  return map;
}

// Source that ships inside a package but is NOT reachable by walking
// `workspace:` deps, because the dependency is a build-time shell-out rather
// than a package.json edge.
//
// apps/cli's tsup `onSuccess` does `cd ../frontend && vite build --config
// vite.debugger.config.ts` (plus the shell config), and the emitted assets ship
// in the tarball under dist/. apps/cli declares no dependency on
// packages/debugger-ui, so without these entries a debugger-only fix reaches users and
// never appears in the changelog — which is exactly what happened to
// "fix debugger code step descriptions" and "test code action description
// updates" before 0.1.96.
//
// Only the debugger subtree is listed. packages/debugger-ui also carries
// vendored models and shared components that the debugger imports but a
// CLI customer never sees; listing the whole package would put unrelated
// changes in their changelog.
export const BUILD_TIME_BUNDLE_PATHS = {
  'apps/cli': [
    'packages/debugger-ui/src/components/local-debugger',
    'packages/debugger-ui/src/components/local-debugger-shell',
    'packages/debugger-ui/src/components/testcase/debugger',
    'packages/debugger-ui/src/components/testcase/editor',
    'packages/debugger-ui/vite.debugger.config.ts',
    'packages/debugger-ui/vite.debugger-shell.config.ts',
  ],
};

// Files that live inside a bundled path but cannot change the published
// artifact, so a commit touching only these is not a customer-facing change.
// turbo.json shapes the task graph and nothing else.
export const NON_SHIPPING_GLOBS = ['**/turbo.json'];

// Walk the workspace dependency graph from startRel (depth-first via the stack),
// following only `workspace:` deps/devDeps. Pure: `readDeps(rel)` returns the
// workspace dep NAMES for a dir. Traversal order does not matter — the result is
// sorted — only reachability, which the `seen` set makes cycle-safe.
// `extraPaths` covers build-time bundling the graph cannot express.
export function collectBundlePaths(startRel, nameToDir, readDeps, extraPaths = []) {
  const seen = new Set();
  const stack = [startRel];
  const out = new Set(extraPaths);
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.add(rel);
    for (const name of readDeps(rel)) {
      const dir = nameToDir.get(name);
      if (dir) stack.push(dir);
    }
  }
  return [...out].sort();
}

function makeReadDeps(repoRoot, nameToDir) {
  return (rel) => {
    const pj = path.join(repoRoot, rel, 'package.json');
    if (!fs.existsSync(pj)) return [];
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
    } catch {
      return [];
    }
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return Object.entries(all)
      .filter(([name, ver]) => String(ver).startsWith('workspace') && nameToDir.has(name))
      .map(([name]) => name);
  };
}

// --- git helpers (impure) -------------------------------------------------

function git(args, repoRoot) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: repoRoot });
}

function findPrevBumpSha(grep, repoRoot) {
  try {
    const out = git(
      ['log', '--format=%H', '-1', '--fixed-strings', `--grep=${grep}`],
      repoRoot,
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function readCommits(range, paths, repoRoot, excludeGlobs = []) {
  const args = ['log', '--no-merges', '--format=%H%x1f%s'];
  if (range) args.push(range);
  args.push('--', ...paths, ...excludeGlobs.map((glob) => `:(exclude,glob)${glob}`));
  const out = git(args, repoRoot);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split('\x1f');
      return { hash, subject };
    });
}

// --- main -----------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args['repo-root'] || process.cwd();
  const appDir = args['app-dir'];
  const packageName = args.package;
  const version = args.version;
  const out = args.out;
  const prevBumpGrep = args['prev-bump-grep'];
  const date = args.date || new Date().toISOString().slice(0, 10);

  for (const [k, v] of Object.entries({
    'app-dir': appDir,
    package: packageName,
    version,
    out,
    'prev-bump-grep': prevBumpGrep,
  })) {
    if (!v) {
      console.error(`gen-changelog: missing required --${k}`);
      process.exit(1);
    }
  }

  const nameToDir = buildNameToDir(repoRoot);
  const readDeps = makeReadDeps(repoRoot, nameToDir);
  const paths = collectBundlePaths(appDir, nameToDir, readDeps, BUILD_TIME_BUNDLE_PATHS[appDir] ?? []);

  const prevSha = findPrevBumpSha(prevBumpGrep, repoRoot);
  const range = prevSha ? `${prevSha}..HEAD` : null;
  const commits = readCommits(range, paths, repoRoot, NON_SHIPPING_GLOBS);

  const section = renderVersionSection({ version, date, commits });

  const outPath = path.resolve(repoRoot, out);
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  const next = upsertVersion(existing, section, { packageName, version });
  fs.writeFileSync(outPath, next);

  console.error(
    `gen-changelog: ${packageName}@${version} — ${commits.length} commit(s) across ${paths.length} path(s) since ${prevSha ? prevSha.slice(0, 7) : '(start of history)'}`,
  );
  // Emit the new section to stdout so the workflow can surface it in the log.
  console.log(section);
}

// Run only when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
