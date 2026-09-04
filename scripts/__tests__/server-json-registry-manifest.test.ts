/**
 * Keeps the MCP registry manifest (server.json) in step with the package it
 * describes.
 *
 * server.json is consumed only by the MCP registry, so nothing in the build,
 * the tests or the published tarball reads it. A drift here is invisible
 * locally and surfaces as a wrong or rejected registry entry — the same failure
 * mode as a dropped `mcpName`, which is guarded in publish-mcp.yml.
 *
 * publish-mcp.yml bumps server.json's root version AND packages[0].version
 * alongside package.json, in one step, so the three cannot drift. This guard
 * catches a manual edit that breaks that.
 *
 * packages[].version looks optional — the JSON Schema's Package.required is
 * registryType/identifier/transport, so `mcp-publisher validate` passes without
 * it — but the registry server rejects an npm package that omits it. Believing
 * the schema was the whole contract cost the 0.2.1 registry publish, after npm
 * had already been written and could not be taken back.
 *
 * `repository`, by contrast, really is optional and is omitted on purpose: the
 * source is private, and a link nobody outside the org can open is worse than
 * no link. See the repository tests below.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const manifest = JSON.parse(readFileSync(join(repoRoot, 'apps', 'mcp-server', 'server.json'), 'utf8')) as {
  name?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string };
  packages?: Array<{
    identifier?: string;
    version?: string;
    registryType?: string;
    transport?: { type?: string };
    environmentVariables?: Array<{ name?: string; description?: string; value?: string }>;
  }>;
};

const pkg = JSON.parse(
  readFileSync(join(repoRoot, 'apps', 'mcp-server', 'package.json'), 'utf8'),
) as { name?: string; version?: string; mcpName?: string };

describe('server.json tracks the published MCP package', () => {
  test('the registry name matches package.json mcpName', () => {
    // These are the two halves of registry ownership validation: the registry
    // reads mcpName off the published npm package and matches it to this name.
    assert.equal(manifest.name, pkg.mcpName);
  });

  test('the package identifier matches the npm package name', () => {
    assert.equal(manifest.packages?.[0]?.identifier, pkg.name);
  });

  test('the root version matches the package version', () => {
    // publish-mcp.yml bumps both in one step; this catches a manual edit that
    // touched only one, which nothing else would notice.
    assert.equal(manifest.version, pkg.version, 'server.json root version drifted from package.json');
  });

  test('packages[].version is present and matches the root version', () => {
    // The schema marks it optional (Package.required is
    // registryType/identifier/transport), so `mcp-publisher validate` passes
    // without it — but the registry server returns 400 "package version is
    // required for NPM packages". Omitting it failed the 0.2.1 registry publish
    // after npm had already been written, which is not recoverable by re-running
    // the release: npm versions cannot be replaced.
    assert.equal(
      manifest.packages?.[0]?.version,
      manifest.version,
      'packages[0].version must be present and equal the root version',
    );
  });

  test('declares the stdio npm package the registry should install', () => {
    assert.equal(manifest.packages?.[0]?.registryType, 'npm');
    assert.equal(manifest.packages?.[0]?.transport?.type, 'stdio');
  });

  test('PWDEBUG is declared as a fixed value with a usable description', () => {
    const pwdebug = manifest.packages?.[0]?.environmentVariables?.find((e) => e.name === 'PWDEBUG');
    assert.ok(pwdebug, 'PWDEBUG must be declared — the server needs it for semantic locators');

    // `value` (rather than a prompt) is correct here: the schema defines it as a
    // value that "should not be configurable by end users", and PWDEBUG has
    // exactly one valid setting.
    assert.equal(pwdebug.value, 'console');

    // Clients surface this string during configuration, so a placeholder like
    // "Environment variables" tells the user nothing.
    assert.ok(
      (pwdebug.description ?? '').length > 40,
      'PWDEBUG needs a description explaining what it does, not a placeholder',
    );
  });

  test('carries the discovery metadata the schema recommends', () => {
    assert.match(manifest.websiteUrl ?? '', /^https:\/\//);
  });

  test('advertises the public repository as the source', () => {
    // History: 0.2.0 shipped a repository.url pointing at a private monorepo, so every reader outside the org got a 404. The field
    // was then omitted rather than repointed, because no public repo held this
    // server's source and any substitute would have sent reviewers to unrelated
    // code. That constraint is gone — the source is public now — so the link
    // must be present and point at the repository that actually holds it.
    //
    // apps/mcp-server/scripts/repositoryLink.test.ts asserts the same thing in
    // the mcp-server lane, so a developer running that package's tests sees it
    // without waiting for this one.
    assert.equal(
      manifest.repository?.url,
      'https://github.com/ShiplightAI/shiplight-cli',
      'server.json must point readers at the public repository holding this server',
    );
    assert.equal(manifest.repository?.source, 'github');
  });

  test('if a repository is declared at all, it is a well-formed public GitHub link', () => {
    // Vacuous while the field is omitted. It becomes the guard the moment the
    // source is public and someone re-adds it — at which point the publish
    // preflight also fetches the URL anonymously and blocks on a 4xx.
    if (!manifest.repository) return;
    assert.match(manifest.repository.url ?? '', /^https:\/\/github\.com\//);
    assert.ok(manifest.repository.source, 'Repository requires both url and source');
  });
});
