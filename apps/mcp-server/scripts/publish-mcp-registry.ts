/**
 * Publish @shiplightai/mcp to the public MCP registry.
 *
 * Usage (from apps/mcp-server):
 *   node --import tsx scripts/publish-mcp-registry.ts            # preflight + validate only
 *   node --import tsx scripts/publish-mcp-registry.ts --publish  # actually publish
 *
 * Safe by default: without --publish this runs every check and stops before
 * logging in, so it can be run any time to confirm the manifest is releasable.
 *
 * The signing key is needed only for --publish; every earlier check is
 * unauthenticated, so the preflight runs without one. It is taken from, in order:
 *   1. MCP_REGISTRY_PRIVATE_KEY  — raw 64-char hex (used by CI; no PEM on disk)
 *   2. MCP_REGISTRY_KEY          — path to a PEM file
 *   3. ~/.ssh/MCP_registry-key.pem
 *
 * Two things about mcp-publisher (verified against 1.8.0) shape this script:
 *
 * 1. There is NO `--dry-run` flag. It is absent from `publish --help`, from the
 *    top-level help, and from the binary's strings. Worse, passing it is not
 *    rejected — `mcp-publisher publish --dry-run` silently ignores the flag and
 *    PUBLISHES FOR REAL. The actual no-op check is the separate `validate`
 *    subcommand, which is what this script uses.
 *
 * 2. `login dns` accepts the private key only as `--private-key`, so it lands in
 *    the process argv and is visible to other users on the machine via `ps` for
 *    the lifetime of that call. The CLI offers no env-var or stdin alternative,
 *    so this is unavoidable rather than a choice made here. The key is never
 *    logged, never written to disk, and never included in error output.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRepositoryLink } from './repositoryLink.js';
import { resolveSigningKey } from './signingKey.js';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST = join(packageRoot, 'server.json');
const PACKAGE_JSON = join(packageRoot, 'package.json');
const KEY_PATH = process.env.MCP_REGISTRY_KEY ?? join(homedir(), '.ssh', 'MCP_registry-key.pem');
/** CI supplies the hex key directly so no PEM is ever written to the runner. */
const KEY_HEX = process.env.MCP_REGISTRY_PRIVATE_KEY?.trim();
const DOMAIN = 'shiplight.ai';
const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1/servers';
/** Derived from the manifest name below, so a rename cannot silently query the wrong server. */
let REGISTRY_SEARCH = '';

const shouldPublish = process.argv.includes('--publish');

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Retry a read against a service we may have written to seconds earlier.
 *
 * Both npm and the registry are read here immediately after a publish, so a
 * miss usually means propagation lag rather than absence. Retrying keeps a
 * transient blip from being reported as "not published", which sends the
 * operator to the wrong remedy.
 */
function retry<T>(label: string, attempts: number, fn: () => T): T {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        const waitMs = i * 3000;
        console.log(`  ${label}: attempt ${i}/${attempts} failed, retrying in ${waitMs / 1000}s`);
        execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${waitMs})`]);
      }
    }
  }
  throw lastError;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function step(label: string): void {
  console.log(`\n▸ ${label}`);
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
step('Preflight');

try {
  const version = run('mcp-publisher', ['--help']);
  void version;
  console.log('  mcp-publisher: found');
} catch {
  fail('mcp-publisher is not installed. Install it (e.g. `brew install mcp-publisher`) and retry.');
}

if (!existsSync(MANIFEST)) fail(`server.json not found at ${MANIFEST}`);

// A key is needed only to sign the DNS login before publishing. Demanding one
// here regardless broke the script's own safe mode: the dry-run path in
// publish-mcp.yml runs without --publish and is not given the secret, so it
// died at preflight and never reached the validate it exists to run.
const keyFileExists = !KEY_HEX && existsSync(KEY_PATH);
const keyVerdict = resolveSigningKey({
  keyHex: KEY_HEX,
  keyPath: KEY_PATH,
  keyFileExists,
  keyFileMode: keyFileExists ? statSync(KEY_PATH).mode & 0o777 : undefined,
  shouldPublish,
});
if (keyVerdict.kind === 'blocked') fail(keyVerdict.detail);
console.log(`  signing key:   ${keyVerdict.detail}`);

// ---------------------------------------------------------------------------
// Version consistency — the registry entry must describe a package that exists
// ---------------------------------------------------------------------------
step('Version consistency');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  name?: string;
  version?: string;
  repository?: { url?: string; source?: string };
  packages?: Array<{ identifier?: string; version?: string }>;
};
const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
  name?: string;
  version?: string;
  mcpName?: string;
};

const manifestVersion = manifest.version;
if (!manifest.name) fail('server.json has no name.');
REGISTRY_SEARCH = `${REGISTRY_BASE}?search=${encodeURIComponent(manifest.name)}`;

if (manifest.name !== pkg.mcpName) {
  fail(`server.json name (${manifest.name}) does not match package.json mcpName (${pkg.mcpName}). Registry ownership validation compares these.`);
}
if (manifest.packages?.[0]?.identifier !== pkg.name) {
  fail(`server.json identifier (${manifest.packages?.[0]?.identifier}) does not match the npm package name (${pkg.name}).`);
}
// packages[].version is required in practice, whatever the schema says.
//
// The JSON Schema lists Package.required as registryType/identifier/transport,
// so `mcp-publisher validate` passes without a version — but the registry server
// rejects the submission: 400 "package version is required for NPM packages".
// Validation is schema-only and cannot see that rule, so this is the one gate
// that catches it before a publish. It was omitted on the belief that the schema
// was the whole contract, and that failed the 0.2.1 registry publish after npm
// had already been written.
const pkgVersion = manifest.packages?.[0]?.version;
if (pkgVersion === undefined) {
  fail(
    'server.json omits packages[0].version. The registry rejects an npm package without it ' +
      '("package version is required for NPM packages") even though mcp-publisher validate passes.',
  );
}
if (pkgVersion !== manifestVersion) {
  fail(
    `server.json packages[0].version (${pkgVersion}) does not match the root version (${manifestVersion}). ` +
      'They name the same release; the publish workflow bumps both together.',
  );
}
if (manifestVersion !== pkg.version) {
  fail(`server.json version (${manifestVersion}) does not match apps/mcp-server/package.json (${pkg.version}). The publish workflow bumps package.json only — update server.json to match before publishing.`);
}

// The registry entry points at an npm package; publishing a version npm does
// not have would advertise something nobody can install.
//
// In CI this runs seconds after `npm publish`, so a miss is far more likely to
// be registry propagation lag than a genuinely missing version — hence the
// retries, and hence surfacing the real error rather than asserting "not
// published", which would send the operator to re-publish something already live.
let npmVersion = '';
try {
  npmVersion = retry('npm view', 4, () =>
    run('npm', ['view', `${pkg.name}@${manifestVersion}`, 'version']).trim(),
  );
} catch (error) {
  const detail = ((error as { stderr?: string }).stderr ?? (error as Error).message ?? '').trim().split('\n')[0];
  if (shouldPublish) {
    fail(
      `Could not confirm ${pkg.name}@${manifestVersion} on npm after 4 attempts: ${detail}\n` +
        `  If the package genuinely is not published, publish it first (gh workflow run publish-mcp.yml).\n` +
        `  If it IS published, this is an npm read failure — retry rather than re-publishing.`,
    );
  }
  // Preflight-only (including the dry-run path in CI, where NEW is not on npm
  // yet by design): report and continue rather than blocking the check.
  console.log(`  npm: ${manifestVersion} not visible yet (${detail || 'lookup failed'}) — expected on a dry run`);
}
if (npmVersion) {
  console.log(`  manifest ${manifestVersion} · package.json ${pkg.version} · npm ${npmVersion} — consistent`);
} else {
  console.log(`  manifest ${manifestVersion} · package.json ${pkg.version} — consistent (npm not checked)`);
}

// ---------------------------------------------------------------------------
// Repository link — optional, but if present it must be publicly readable
// ---------------------------------------------------------------------------
//
// The field is deliberately absent from server.json; see repositoryLink.ts for
// why, and for the verdict rules this check applies. It exists because the
// private monorepo URL shipped once already, in 0.2.0.
step('Repository link');
const repoUrl = manifest.repository?.url;
let repoStatus = '';
if (repoUrl) {
  // Anonymous on purpose: the link has to resolve for someone with no access to
  // our org, which is exactly what an authenticated `gh api` call cannot prove.
  //
  // The URL comes from a file committed to this repo, so anyone who can set it
  // can already edit this script — but -L makes us follow wherever it points,
  // and this job holds the domain signing key. --proto/--proto-redir keep the
  // whole chain on https, and --max-redirs caps it, so a redirect cannot walk
  // us onto file:// or an instance-metadata endpoint. -- ends option parsing so
  // a URL beginning with a dash is read as a URL, not as a flag.
  try {
    repoStatus = run('curl', [
      '-s',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code}',
      '-L',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--max-redirs',
      '3',
      '--max-time',
      '30',
      '--',
      repoUrl,
    ]).trim();
  } catch {
    // Leave repoStatus empty — classifyRepositoryLink reads that as "could not
    // reach", which does not block a release.
  }
}
const repoVerdict = classifyRepositoryLink(repoUrl, repoStatus);
if (repoVerdict.kind === 'broken') {
  fail(repoVerdict.detail);
} else if (repoVerdict.kind === 'omitted') {
  console.log('  omitted — the source is private; nothing to link (see scripts/repositoryLink.ts)');
} else {
  console.log(`  ${repoVerdict.detail}`);
}

// ---------------------------------------------------------------------------
// Is this version already in the registry?
// ---------------------------------------------------------------------------
step('Registry state');

let alreadyPublished = false;
try {
  // -f so an HTTP error is an error rather than an HTML body that JSON.parse
  // rejects with a misleading message.
  const body = retry('registry query', 3, () => run('curl', ['-sSf', REGISTRY_SEARCH]));
  const parsed = JSON.parse(body) as { servers?: Array<{ server?: { name?: string; version?: string } }> };
  const existing = (parsed.servers ?? [])
    .map((s) => s.server)
    .filter((s) => s?.name === manifest.name);

  if (existing.length === 0) {
    console.log('  no existing entry — this would be the first publish');
  } else {
    for (const s of existing) console.log(`  registry has ${s?.name}@${s?.version}`);
    alreadyPublished = existing.some((s) => s?.version === manifestVersion);
  }
} catch (error) {
  // Fail closed. Treating an unreadable registry as "nothing published" would
  // bypass the duplicate guard precisely when we cannot see what is there.
  const detail = ((error as Error).message ?? '').trim().split('\n')[0];
  if (shouldPublish) {
    fail(`Could not read the registry to check for an existing ${manifestVersion} entry: ${detail}`);
  }
  console.log(`  could not query the registry (${detail}) — skipping the duplicate check in preflight`);
}

if (alreadyPublished) {
  console.log(`\n  ${manifest.name}@${manifestVersion} is already published.`);
  console.log('  Bump the version in server.json AND apps/mcp-server/package.json to publish an update.');
  if (shouldPublish) fail('Refusing to republish an existing version.');
}

// ---------------------------------------------------------------------------
// Validate — this is the real dry run; `publish --dry-run` does not exist
// ---------------------------------------------------------------------------
step('Validate manifest');
try {
  const out = run('mcp-publisher', ['validate', MANIFEST]);
  console.log(out.trim().split('\n').map((l) => `  ${l}`).join('\n') || '  ok');
} catch (error) {
  const e = error as { stdout?: string; stderr?: string };
  console.error((e.stdout ?? '') + (e.stderr ?? ''));
  fail('server.json failed validation.');
}

if (!shouldPublish) {
  console.log('\n✓ Preflight passed. Re-run with --publish to log in and publish.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------
step('Authenticate (DNS)');
console.log('  note: mcp-publisher takes the key as a CLI argument, so it is briefly visible in `ps`.');

// CI passes the hex directly so no private key is ever written to the runner's
// disk. Locally we derive it from the PEM, parsed here rather than through a
// shell pipeline so the value never reaches shell history or an intermediate
// process.
let privateKey: string;
if (KEY_HEX) {
  privateKey = KEY_HEX;
} else {
  let keyText: string;
  try {
    keyText = run('openssl', ['pkey', '-in', KEY_PATH, '-noout', '-text']);
  } catch (error) {
    // An encrypted or malformed key otherwise escapes as a raw stack trace.
    // openssl's own stderr is the useful part; it does not echo key material.
    const detail = ((error as { stderr?: string }).stderr ?? '').trim().split('\n')[0];
    fail(`Could not read ${KEY_PATH}: ${detail || 'openssl failed'}. An encrypted key must be decrypted first.`);
  }
  const privMatch = /priv:\s*\n([\s0-9a-f:]+)/.exec(keyText);
  if (!privMatch) fail(`Could not extract a private key from ${KEY_PATH}.`);
  privateKey = privMatch[1].replace(/[\s:]/g, '');
}

if (!/^[0-9a-f]{64}$/.test(privateKey)) {
  // Never echo the value — only its shape.
  fail(`Signing key is not a 64-character hex ed25519 key (got ${privateKey.length} chars).`);
}
console.log(`  using a ${privateKey.length}-char ed25519 key (value not shown)`);

try {
  execFileSync('mcp-publisher', ['login', 'dns', '--domain', DOMAIN, '--private-key', privateKey], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch {
  // Deliberately not echoing the command — it contains the key.
  fail(`DNS login failed for domain ${DOMAIN}.`);
}

step('Publish');
try {
  execFileSync('mcp-publisher', ['publish', MANIFEST], { stdio: ['ignore', 'inherit', 'inherit'] });
} catch {
  fail('Publish failed.');
}

step('Verify');
// The publish already succeeded. Verification is a courtesy check against a
// search index that lags, so it must never turn a good publish into a red job —
// that invites a re-run, which would publish a second npm version.
try {
  const body = retry('registry verify', 3, () => run('curl', ['-sSf', REGISTRY_SEARCH]));
  const parsed = JSON.parse(body) as {
    servers?: Array<{ server?: { name?: string; version?: string }; _meta?: Record<string, { status?: string }> }>;
  };
  const hit = (parsed.servers ?? []).find(
    (s) => s.server?.name === manifest.name && s.server?.version === manifestVersion,
  );
  if (hit) {
    const meta = hit._meta?.['io.modelcontextprotocol.registry/official'];
    console.log(`  ${manifest.name}@${manifestVersion} is live (status: ${meta?.status ?? 'unknown'})`);
  } else {
    console.log(`  not indexed yet — the publish succeeded; the registry search lags behind writes.`);
    console.log(`  check later: curl "${REGISTRY_SEARCH}"`);
  }
} catch (error) {
  console.log(`  could not verify (${(error as Error).message.split('\n')[0]}) — the publish itself succeeded.`);
}

console.log('\n✓ Published to the MCP registry.');
