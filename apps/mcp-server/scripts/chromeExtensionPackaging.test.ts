/**
 * Packaging guard for the bundled Chrome relay extension (003 contract C7).
 *
 * `@shiplightai/mcp@0.1.62` shipped without `chrome-extension/`, so
 * `shiplight-mcp --chrome-extension-path` pointed at a directory that did not
 * exist. Nothing failed the build: the copy step is a shell `cp` appended to
 * `build`, and no test looked at its result, so only manual inspection caught
 * it after release.
 *
 * This runs in `test:unit`, which the publish workflow gates on. It asserts
 * both ends of the copy — the source the build reads, and the manifest entry
 * that lets the copied directory into the tarball — plus the copied output
 * itself once a build has produced it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const sourceExtension = path.resolve(pkgRoot, '../../packages/mcp-tools/chrome-extension');
const copiedExtension = path.join(pkgRoot, 'chrome-extension');

/** What `--chrome-extension-path` needs for Chrome to load the relay. */
const REQUIRED_ENTRIES = ['manifest.json', 'background.js', 'icons'] as const;

function assertExtensionComplete(root: string, label: string): void {
  for (const entry of REQUIRED_ENTRIES) {
    const target = path.join(root, entry);
    assert.ok(
      existsSync(target),
      `${label} is missing ${entry}. Chrome cannot load the relay extension without it, ` +
        `and --chrome-extension-path would point at an incomplete directory.`,
    );
  }
  assert.ok(
    statSync(path.join(root, 'icons')).isDirectory(),
    `${label}: icons must be a directory`,
  );
}

describe('Chrome relay extension packaging (contract C7)', () => {
  it('the source directory the build copies from is complete', () => {
    assert.ok(
      existsSync(sourceExtension),
      `missing ${sourceExtension} — the build\'s copy step would produce nothing`,
    );
    assertExtensionComplete(sourceExtension, 'packages/mcp-tools/chrome-extension');
  });

  it('manifest.json is valid JSON declaring the background service worker', () => {
    const manifest = JSON.parse(readFileSync(path.join(sourceExtension, 'manifest.json'), 'utf8'));
    // A manifest that parses but points at a missing script loads as a broken
    // extension, which reads to a user exactly like the missing-directory bug.
    const declared: string | undefined =
      manifest.background?.service_worker ?? manifest.background?.scripts?.[0];
    assert.ok(declared, 'manifest declares no background script');
    assert.ok(
      existsSync(path.join(sourceExtension, declared)),
      `manifest declares background "${declared}" but that file is not in the extension`,
    );
  });

  it('package.json ships chrome-extension in the tarball', () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    assert.ok(
      Array.isArray(pkg.files) && pkg.files.includes('chrome-extension'),
      'package.json "files" must list chrome-extension, or the copied directory is ' +
        'built and then silently excluded from the published tarball',
    );
    assert.match(
      pkg.scripts?.build ?? '',
      /chrome-extension/,
      'the build script must still copy the extension',
    );
  });

  it('a built package contains the copied extension', (t) => {
    if (!existsSync(path.join(pkgRoot, 'dist'))) {
      t.skip('package not built in this working tree — the publish lane builds before testing');
      return;
    }
    assert.ok(
      existsSync(copiedExtension),
      'dist/ exists but chrome-extension/ does not: the build\'s copy step did not run ' +
        'or failed. This is the exact state that shipped in 0.1.62.',
    );
    assertExtensionComplete(copiedExtension, 'apps/mcp-server/chrome-extension');
  });
});
