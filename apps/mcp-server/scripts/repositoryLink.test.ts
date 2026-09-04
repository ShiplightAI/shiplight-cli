import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRepositoryLink, type RepositoryLinkVerdict } from './repositoryLink.js';

/**
 * A repository URL that no anonymous reader can open. Used as input for the
 * classifier's 404 handling — it is deliberately not a real Shiplight repo.
 */
const UNREACHABLE_URL = 'https://github.com/ShiplightAI/not-a-public-repo';

/** The public repository this server's source actually lives in. */
const PUBLIC_URL = 'https://github.com/ShiplightAI/shiplight-cli';

/** Narrows away the `omitted` case, which carries no message. */
function detailOf(verdict: RepositoryLinkVerdict): string {
  assert.notEqual(verdict.kind, 'omitted', 'expected a verdict with a message');
  return (verdict as Exclude<RepositoryLinkVerdict, { kind: 'omitted' }>).detail;
}

describe('classifyRepositoryLink', () => {
  it('reports an absent repository field as omitted, not broken', () => {
    assert.deepEqual(classifyRepositoryLink(undefined, ''), { kind: 'omitted' });
    // An empty string is the same situation, and must not fall through to the
    // "could not reach" branch and imply a network problem.
    assert.deepEqual(classifyRepositoryLink('', '404'), { kind: 'omitted' });
  });

  it('accepts a URL that answers 2xx anonymously', () => {
    // GitHub answers 200 for a public repo; the other codes are here so an
    // unusual success response is not misfiled as an unknown.
    for (const status of ['200', '203', '204']) {
      assert.equal(
        classifyRepositoryLink('https://github.com/ShiplightAI/examples', status).kind,
        'reachable',
        `HTTP ${status} should be accepted`,
      );
    }
  });

  it('blocks the release when the repo is private (GitHub answers 404 anonymously)', () => {
    // The regression this guards: 0.2.0 shipped with a link into the private
    // monorepo, which every reader outside the org sees as a 404.
    const verdict = classifyRepositoryLink(UNREACHABLE_URL, '404');
    assert.equal(verdict.kind, 'broken');
    assert.match(verdict.detail, /404/);
    assert.match(verdict.detail, /private or missing/);
  });

  it('blocks on any 4xx that means "not visible to you", not just 404', () => {
    for (const status of ['400', '401', '403', '410', '451', '499']) {
      assert.equal(
        classifyRepositoryLink(UNREACHABLE_URL, status).kind,
        'broken',
        `HTTP ${status} should block`,
      );
    }
  });

  it('does not block on a 5xx or an unreachable host', () => {
    // GitHub being down, or no network on the runner, is not evidence that the
    // link is bad — failing here would red-light an otherwise good release.
    //
    // 301 is here for completeness of the function's own contract rather than
    // as a case the script will meet: curl runs with -L, so it reports the
    // status after redirects and hands us the final code, not the 301.
    for (const status of ['500', '502', '503', '301', '']) {
      assert.equal(
        classifyRepositoryLink(UNREACHABLE_URL, status).kind,
        'unknown',
        `HTTP "${status}" should not block`,
      );
    }
  });

  it('does not block on a transient 4xx', () => {
    // An anonymous request from a shared CI runner IP can be rate-limited or
    // time out against a repo that is perfectly public. Treating that as a
    // broken link would fail a good release for a reason unrelated to the URL.
    for (const status of ['408', '425', '429']) {
      assert.equal(
        classifyRepositoryLink('https://github.com/ShiplightAI/examples', status).kind,
        'unknown',
        `HTTP ${status} is transient and should not block`,
      );
    }
  });

  it('distinguishes a failed request from a non-4xx response in its message', () => {
    assert.match(detailOf(classifyRepositoryLink(UNREACHABLE_URL, '')), /could not reach/);
    assert.match(detailOf(classifyRepositoryLink(UNREACHABLE_URL, '503')), /HTTP 503/);
  });
});

describe('server.json', () => {
  const manifest = JSON.parse(
    readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'server.json'), 'utf8'),
  ) as { repository?: { url?: string } };

  it('links the public repository', () => {
    // Checked without a network call so it holds in any environment. Until this
    // repo went public the field was omitted, because the only source was a
    // private monorepo and every reader outside the org got a 404. Now there is
    // a repository they can actually open, so the link must be present and be
    // that one.
    assert.equal(
      manifest.repository?.url,
      PUBLIC_URL,
      'server.json must point readers at the public repository holding this server.',
    );
  });
});
