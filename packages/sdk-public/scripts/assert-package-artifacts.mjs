/**
 * `prepublishOnly` guard — runs before `pnpm publish`, the irreversible step.
 *
 * Deliberately not `prepack`: that hook is also run by consumers who re-pack an
 * installed copy (a `file:`/`portal:` dependency, a vendored or forked tree),
 * which would require shipping this script in the tarball for their sake.
 * `prepublishOnly` only ever runs from this repo, so the published package
 * stays free of build tooling. `sdk-core` uses the same hook.
 *
 * Declarations are emitted by `build:dts`, a separate stage from `tsup`. That
 * makes a JS-only `dist/` reachable in a way it was not when tsup emitted
 * both: run `npx tsup` on its own, or let `build:dts` fail after tsup has
 * already written its output, and the package still looks packable. Publishing
 * that tarball gives every consumer `TS7016: Could not find a declaration file
 * for module '@shiplightai/sdk'`, or silently types the whole SDK as `any`.
 *
 * Nothing else in the pack/publish path checks that the files `main`, `types`
 * and `exports` point at actually exist.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));

/** Every literal path the manifest promises, collected from main/types/exports. */
function declaredArtifacts(pkg) {
  const paths = new Set();
  for (const field of ['main', 'types']) {
    if (typeof pkg[field] === 'string') paths.add(pkg[field]);
  }

  const walk = (node) => {
    if (typeof node === 'string') {
      // Subpath patterns ("./*": "./dist/*.js") and bare-condition fallbacks
      // are not filenames; resolving them would reject a valid package.
      if (!node.includes('*')) paths.add(node);
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(pkg.exports);

  return [...paths];
}

const problems = [];

for (const path of declaredArtifacts(manifest)) {
  const absolute = resolve(packageDir, path);
  if (!existsSync(absolute)) {
    problems.push(`${path} does not exist`);
    continue;
  }
  if (statSync(absolute).size === 0) {
    problems.push(`${path} is empty`);
  }
}

// The declarations are produced by a different stage than the bundle, so check
// the rollup actually looks like a rollup rather than a partial write.
//
// Deliberately NOT an mtime comparison against the bundle: turbo restores
// cached outputs in lexicographic order, so a cache hit always lands
// index.d.ts a few hundred microseconds before index.js and every pack after
// the first would be rejected. Both files come from one cache entry keyed on
// the same input hash, so their relative timestamps carry no staleness signal.
// Truncation is prevented upstream anyway — build-declarations.mjs stages the
// rollup and moves it into place with a single rename.
const declarations = manifest.types && resolve(packageDir, manifest.types);
if (declarations && existsSync(declarations)) {
  if (!/^\s*export\b/m.test(readFileSync(declarations, 'utf8'))) {
    problems.push(`${manifest.types} declares no exports — the declaration rollup looks incomplete`);
  }
}

if (problems.length > 0) {
  console.error(
    `refusing to pack ${manifest.name}:\n` +
      problems.map((problem) => `  ${problem}`).join('\n') +
      '\n\nRun `pnpm build` (tsup AND build:dts) before packing.',
  );
  process.exit(1);
}
