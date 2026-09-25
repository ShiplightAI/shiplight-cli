import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUALITY_ROOT = '.quality';

function collectYaml(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) collectYaml(rel, acc);
    else if (/\.ya?ml$/.test(entry.name)) acc.push(rel);
  }
  return acc;
}

interface Declared {
  /** The yaml file the reference was declared in. */
  file: string;
  /** Dotted trail to the declaring node, e.g. `expectations.4.evidence.2`. */
  trail: string;
  value: string;
}

/**
 * `observation_path` names a build artifact produced by a workflow run rather
 * than a file in the tree, so it is the one `_path` key that must not be
 * resolved against the repository.
 */
const NON_FILE_KEYS = new Set(['observation_path']);

function holdsFilePath(key: string): boolean {
  if (NON_FILE_KEYS.has(key)) return false;
  // `path` covers source_refs/evidence entries; the `*_path` scalars carry the
  // spec, plan, tasks, test-report and quality-map references in project-map.yaml.
  return key === 'path' || key.endsWith('_path');
}

/**
 * Every value under a key that holds a file path, with its location.
 *
 * Deliberately not extended to `code_refs` / `legacy_refs` / `archived_drafts`:
 * those are prose lines that begin with a path and continue with commentary or a
 * glob, so resolving them means guessing where the path ends. They also point at
 * the retired v1 monorepo, which is not in this repository by design.
 */
function declaredPaths(file: string): Declared[] {
  const found: Declared[] = [];
  const walk = (node: unknown, trail: string[]): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, [...trail, String(i)]));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (holdsFilePath(key) && typeof value === 'string') {
        found.push({ file, trail: trail.join('.') || '<root>', value });
      }
      walk(value, [...trail, key]);
    }
  };
  walk(parse(readFileSync(path.join(REPO_ROOT, file), 'utf-8')), []);
  return found;
}

/**
 * A reference resolves either from the repository root or from `.quality/`. The
 * second form is load-bearing: each feature map names the shared project map as
 * a bare `project-map.yaml`, which lives beside the `evidence/` directory rather
 * than inside it.
 */
function resolves(ref: Declared): boolean {
  if (/^https?:\/\//.test(ref.value)) return true;
  // '', '.' and './' all join to REPO_ROOT, which exists — the same vacuous
  // pass this guard exists to prevent.
  if (!ref.value.trim() || /^\.\/?$/.test(ref.value.trim())) return false;
  return (
    existsSync(path.join(REPO_ROOT, ref.value)) ||
    existsSync(path.join(REPO_ROOT, QUALITY_ROOT, ref.value))
  );
}

/**
 * The release-analysis scanner reads `.quality/` as its input, and a reference
 * to a file that is not there aborts the scan rather than degrading it — the
 * run reports "repository facts are incomplete" and produces no findings at all.
 *
 * Nothing in the build ever opened these files, so four references to files that
 * had never existed in this repository's history survived from the initial
 * commit until a scan tripped over one. They are ordinary data: they go stale
 * exactly when a test moves or a surface is deleted, which is when nobody is
 * looking at the yaml.
 */
describe('.quality reference integrity', () => {
  it('declares no path that is missing from the repository', () => {
    const declared = collectYaml(QUALITY_ROOT).flatMap(declaredPaths);

    // Without a floor this passes vacuously. The maps are input to an external
    // scanner whose schema this repository does not own: if a future revision
    // renames `path`, every file yields nothing, `dangling` is empty, and the
    // guard reports success while checking nothing at all.
    assert.ok(
      declared.length >= 50,
      `expected .quality to declare many file references, found ${declared.length} — has the schema changed?`
    );

    const dangling = declared
      .filter((ref) => !resolves(ref))
      .map((ref) => `${ref.file} :: ${ref.trail} -> ${ref.value}`);

    assert.deepEqual(
      dangling,
      [],
      `.quality references files that do not exist:\n  ${dangling.join('\n  ')}\n` +
        'Repoint the reference at the file that carries the behaviour now, or drop it if the surface is gone.'
    );
  });

  it('gives every evidence entry a distinct id', () => {
    // Findings are reported against these ids. Two entries sharing one makes a
    // result ambiguous about which test it came from.
    const ids = collectYaml(QUALITY_ROOT)
      .filter((file) => /quality-map\.ya?ml$/.test(file))
      .flatMap((file) => {
        const doc = parse(readFileSync(path.join(REPO_ROOT, file), 'utf-8')) as {
          expectations?: { evidence?: { id?: string }[] }[];
        };
        return (doc.expectations ?? []).flatMap((exp) =>
          (exp.evidence ?? []).map((ev) => {
            // An entry with no id would otherwise collide with every other such
            // entry and be reported as a duplicate of `undefined`, naming no
            // entry a maintainer could find.
            assert.ok(ev.id, `${file} has an evidence entry with no id`);
            return `${file}::${ev.id}`;
          })
        );
      });

    assert.ok(ids.length >= 20, `expected many evidence entries, found ${ids.length}`);

    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(duplicates, [], `duplicate evidence ids: ${duplicates.join(', ')}`);
  });
});
