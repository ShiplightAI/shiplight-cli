/**
 * Verdict logic for the `repository.url` preflight in publish-mcp-registry.ts.
 *
 * Split out from the script because that file executes its checks at import
 * time — importing it to test anything would run the whole release preflight.
 * The HTTP call stays in the script; only the decision lives here.
 */

export type RepositoryLinkVerdict =
  | { kind: 'omitted' }
  | { kind: 'reachable'; detail: string }
  | { kind: 'unknown'; detail: string }
  | { kind: 'broken'; detail: string };

/**
 * 4xx codes that mean "try again", not "this is not visible to you":
 * 408 request timeout, 425 too early (TLS early data refused), 429 rate limited.
 */
const TRANSIENT_4XX = new Set(['408', '425', '429']);

/**
 * Decide what an anonymous fetch of `repository.url` means for a release.
 *
 * `repository` is optional in the registry schema, and ours is deliberately
 * absent: the server's source lives in a private monorepo, and a link nobody
 * can open is worse than no link at all. Pointing it at some other public
 * Shiplight repo is not a fix either — the field exists so reviewers can read
 * *this server's* code, so a wrong repo misleads exactly the people it is meant
 * to serve.
 *
 * Only a 4xx blocks, and only a 4xx that means "you cannot see this". A 5xx or
 * an unreachable host is trouble at GitHub's end or on the runner, and must not
 * turn a good release red. Nor may 408 and 429: an anonymous request from a
 * shared CI runner IP can be rate-limited or time out on a repo that is
 * perfectly public, and blocking a release on that would be a false alarm.
 *
 * @param url    the manifest's repository.url, if it has one
 * @param status the HTTP status from an anonymous, redirect-following GET;
 *               empty when the request itself failed
 */
export function classifyRepositoryLink(
  url: string | undefined,
  status: string,
): RepositoryLinkVerdict {
  if (!url) {
    return { kind: 'omitted' };
  }
  // Any 2xx, not just 200: a public repo answers 200 today, but there is no
  // reason to treat some other success code as an unknown.
  if (/^2\d\d$/.test(status)) {
    return { kind: 'reachable', detail: `${url} — publicly reachable (HTTP ${status})` };
  }
  if (/^4\d\d$/.test(status) && !TRANSIENT_4XX.has(status)) {
    return {
      kind: 'broken',
      detail:
        `repository.url ${url} returns HTTP ${status} to an anonymous request, so it is private or ` +
        `missing and would publish as a broken link. Either drop the repository field, or point it ` +
        `at a public repo that really holds this server's source.`,
    };
  }
  if (status) {
    return { kind: 'unknown', detail: `${url} returned HTTP ${status} — not a blocking 4xx, not failing the release` };
  }
  return { kind: 'unknown', detail: `could not reach ${url} — skipping this check` };
}
