/**
 * Builds the published declaration file: `tsc` emits per-file declarations,
 * api-extractor rolls them into one self-contained `dist/index.d.ts` with the
 * private workspace packages inlined.
 *
 * This is a script rather than an `&&` chain for three reasons:
 *
 *  - api-extractor runs WITHOUT `--local`. In local mode it computes
 *    `succeeded = errorCount === 0`, ignoring warnings, and every diagnostic
 *    this package configures is a warning — so `--local` made the declaration
 *    build incapable of failing.
 *  - The staging directory is cleaned before the run as well as after. A
 *    trailing `rm -rf` in an `&&` chain is skipped on failure, leaving
 *    declarations for deleted or renamed sources to be rolled into the next
 *    build.
 *  - The rollup is moved into `dist/` with a single rename. Watch mode
 *    (`tsup --watch --onSuccess`) SIGTERMs this process on every save, and
 *    writing api-extractor's output directly to the published path meant an
 *    interrupted run could leave a truncated `dist/index.d.ts`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stagingDir = resolve(packageDir, '.tmp');
const stagedRollup = resolve(stagingDir, 'rollup/index.d.ts');
const publishedRollup = resolve(packageDir, 'dist/index.d.ts');

function run(command, args) {
  execFileSync(command, args, { cwd: packageDir, stdio: 'inherit' });
}

function bin(name) {
  const path = resolve(packageDir, 'node_modules/.bin', name);
  if (!existsSync(path)) {
    throw new Error(`${name} is not installed at ${path} — run \`pnpm install\``);
  }
  return path;
}

try {
  rmSync(stagingDir, { recursive: true, force: true });

  run(bin('tsc'), ['-p', 'tsconfig.build.json']);
  // No --local: warnings must be fatal here.
  run(bin('api-extractor'), ['run']);

  if (!existsSync(stagedRollup)) {
    throw new Error(`api-extractor reported success but produced no rollup at ${stagedRollup}`);
  }

  mkdirSync(dirname(publishedRollup), { recursive: true });
  renameSync(stagedRollup, publishedRollup);
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}
