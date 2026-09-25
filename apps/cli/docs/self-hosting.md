# Self-hosting

Run the Shiplight CLI and browsers on your own machines or CI runners, bring
your own AI provider key, and keep the action cache and test reports in storage
you control. No Shiplight account or API token is involved.

> **Shiplight Cloud shuts down on October 31, 2026.** The hosted LLM proxy,
> the cloud action cache, and report upload stop working then, and
> `SHIPLIGHT_API_TOKEN` stops resolving anything. After that date this page
> describes the only way to run Shiplight — so treat it as the migration
> path, not just an option.

This page covers the parts of that setup the CLI decides: which AI provider it
calls, where it reads and writes cached actions, and what it does with reports.
For the YAML statement language see
[YAML-TEST-LANGUAGE-SPEC.md](./YAML-TEST-LANGUAGE-SPEC.md).

## 1. Bring your own key

Set one provider key. The model is auto-selected from the first key present;
`WEB_AGENT_MODEL` overrides it.

```dotenv
GOOGLE_API_KEY=...
# or ANTHROPIC_API_KEY=sk-ant-...
# or OPENAI_API_KEY=sk-...
# or OPENROUTER_API_KEY=sk-or-v1-...   # also set WEB_AGENT_MODEL=openrouter:<provider>/<model>

WEB_AGENT_FALLBACK_MODELS=
SHIPLIGHT_TELEMETRY=0
```

Put this in your project's git-ignored `.env`, or inject it from your CI secret
store. The provider bills AI usage to your own account.

These two are not interchangeable when both are present: `readShiplightEnv`
(`apps/cli/src/dotenvSource.ts`) starts from `process.env` and then applies each
`.env` on top, so **`.env` wins over the runner environment**. A committed or
left-over `.env` therefore overrides the `env:` block in the CI example below —
which is the same stale-value problem this page warns about for
`SHIPLIGHT_API_TOKEN`.

| Variable | Effect |
|---|---|
| `WEB_AGENT_FALLBACK_MODELS` | Comma-separated `provider:model` list tried when the primary model fails. Set it empty to disable the built-in cross-provider chain, so a run never reaches a provider you did not configure. |
| `SHIPLIGHT_TELEMETRY=0` | Disables the CLI's anonymous usage event. `DO_NOT_TRACK=1` does the same. |
| `SHIPLIGHT_API_TOKEN` | **Remove it** from `.env` and from the runner environment. Its presence is what opts a CI run into the cloud action cache — see below. It stops working entirely on October 31, 2026. |

Shiplight reads environment variables through an explicit allowlist
(`SDK_ENV_ALLOWLIST` in `apps/cli/src/fixture.ts`): a variable not on that list is never
forwarded into the SDK config. Model selection is the exception — `WEB_AGENT_MODEL`,
`WEB_AGENT_FALLBACK_MODELS` and `COMPUTER_USE_MODEL` are resolved separately and passed
to `createAgentContext` as parameters, so they take effect without appearing on the
allowlist.

## 2. Choose the action cache backend

Shiplight saves self-healed actions from passing tests so later runs replay the
repaired locator instead of asking a model again. `SHIPLIGHT_ACTION_CACHE_BACKEND`
selects where those live (`createActionEntityCache` in
`apps/cli/src/cache/actionEntityCacheStore.ts`):

| Value | Behaviour |
|---|---|
| `auto` (default) | Cloud when `CI` is set **and** `SHIPLIGHT_API_TOKEN` is present; local otherwise. |
| `local` | Filesystem only, even in CI with a token present. |
| `cloud` | Requires `SHIPLIGHT_API_TOKEN`; throws without one. |

For self-hosting, set it explicitly:

```
SHIPLIGHT_ACTION_CACHE_BACKEND=local
```

`auto` would already pick local once the token is gone, but being explicit means
a token reappearing in the environment — a leftover secret, a shared runner
image — cannot silently redirect your cache to Shiplight Cloud.

### What the local cache stores

One JSON file per test file, under `.shiplight/action-cache/`, named after the
test path with `/` replaced by `__`:

```
.shiplight/action-cache/
  login__checkout.test.yaml.json
  showcase__01-self-healing.test.yaml.json
```

Each file holds entries keyed by statement UID. Two behaviours matter when you
plan CI storage:

- **Only passing tests write entries.** The Playwright fixture writes healed
  entities to the run's output directory only when `testInfo.status === 'passed'`
  (`apps/cli/src/fixture.ts`), and the post-run step merges those into the cache.
  An entity resolved during a failing test is never served to a later run.
- **A stale entry degrades to a miss, not a wrong action.** Every entry records a
  `source_fingerprint` of the inline action entity it superseded — action name,
  kwargs, locator, xpath. `isStoreEntryApplicable`
  (`packages/types/src/test-flow/actionEntityFingerprint.ts`) serves the entry
  only while the YAML still fingerprints the same. Edit the statement and the
  cached entry stops applying: the edit runs, heals if it needs to, and re-stamps
  the same key.

The local backend keys entries by path alone. The cloud backend prefixes the
branch name (`main:showcase/01.test.yaml`), so it partitions per branch on the
server. Self-hosted, that partitioning is yours to arrange — which is what the
CI cache key below does.

## 3. Persist the cache across CI runs

Restore `.shiplight/action-cache/` before the run and save it after, using your
CI provider's cache storage.

Upgrade the CLI first, and commit the lockfile so CI installs the same version:

```bash
npm install --save-dev shiplightai@latest
```

### GitHub Actions

Add your provider key as a repository Actions secret, plus any application
credentials your tests need. Save as `.github/workflows/e2e-cache.yml`:

```yaml
name: E2E with BYOK and local action cache

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: false

jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      SHIPLIGHT_ACTION_CACHE_BACKEND: local
      GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
      WEB_AGENT_FALLBACK_MODELS: ""
      SHIPLIGHT_TELEMETRY: "0"
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npx playwright install --with-deps chromium

      - name: Restore action cache
        id: action-cache
        uses: actions/cache/restore@v4
        with:
          path: .shiplight/action-cache
          key: shiplight-action-v1-${{ github.workflow }}-${{ github.ref }}-${{ github.run_id }}-${{ github.run_attempt }}
          restore-keys: |
            shiplight-action-v1-${{ github.workflow }}-${{ github.ref }}-
            shiplight-action-v1-${{ github.workflow }}-

      - name: Run tests
        id: tests
        run: npx shiplight test

      - name: Save action cache
        if: ${{ !cancelled() && steps.tests.outcome != 'skipped' && hashFiles('.shiplight/action-cache/*.json') != '' }}
        uses: actions/cache/save@v4
        with:
          path: .shiplight/action-cache
          key: ${{ steps.action-cache.outputs.cache-primary-key }}
```

The save step still runs when some tests fail, because passing tests in the same
run may have produced useful repairs.

### How the cache key works

GitHub cache entries are **immutable**: a key that already exists cannot be
overwritten. A stable key would therefore freeze the cache at whatever the first
run produced. So the save key is unique per run — `run_id` plus `run_attempt`,
which increments when you rerun a run — and reuse comes from `restore-keys`,
which matches by **prefix** and returns the most recent match.

The key segments:

- `shiplight-action-v1` — namespace and a manually managed version. Bump `v1` to
  start a fresh cache.
- `github.workflow` — the workflow's `name:` field, not its filename. Renaming
  the workflow starts a new cache lineage.
- `github.ref` — the branch or other ref: `refs/heads/main` on a branch push,
  `refs/pull/42/merge` on a pull request, `refs/tags/v1.2.0` on a tag.
- `github.run_id` / `github.run_attempt` — what makes each save unique.

The two restore prefixes form a fallback chain:

1. `…-<workflow>-<ref>-` — this branch or PR's own most recent cache. On a PR,
   this is what makes the second and later pushes reuse the first push's repairs.
2. `…-<workflow>-` — anything else in scope. On a PR that means the base
   branch's cache, so a PR's **first** run starts warm instead of cold.

Without the second prefix a pull request never matches anything: its ref is
`refs/pull/N/merge`, which shares no prefix with `main`'s keys.

### Branch scoping is enforced above the key

GitHub decides cache *visibility* independently of the key. A run can restore
caches from its own branch, the default branch, and — for a pull request — the
base branch. It can never read another branch's or another PR's cache, whatever
the key says.

Two consequences:

- You cannot build one shared pool across all branches. `main` is the baseline;
  branches read through from it and write only to themselves.
- You do not need the ref in the key to stop one PR poisoning another, or a PR
  poisoning `main`. That isolation already exists. The ref only decides which
  cache a run *prefers*.

### Growth and eviction

Every run writes a new entry and nothing deletes the old ones. They age out on
GitHub's own terms: 7 days without a hit, or least-recently-used eviction once
the repository passes 10 GB of cache.

### Matrix and sharded runs

Include the shard or project identifier in **both** the save key and the first
restore prefix, so each shard owns its cache.

A cache entry is an immutable tarball of the whole directory, so concurrent
shards do not merge. Two shards that both restore the same baseline save disjoint
supersets of it, and the next run's prefix match simply takes the most recent.
Give each shard its own key and that stops mattering.

## 4. Runner and report storage

The example runs on GitHub-hosted `ubuntu-latest`. For your own registered Linux
runner, change `runs-on` to `[self-hosted, linux, x64]` and make sure it has the
browser dependencies and network access the tests need. Note that GitHub's cache
storage still lives on GitHub — point the cache steps at your internal cache
service if all storage must stay on your infrastructure.

Test output lands in two directories, both of which you can archive as CI
artifacts or copy to internal storage:

| Directory | Contents |
|---|---|
| `shiplight-report/<runId>` | The HTML report and its `report-data.json`. `shiplight-report/latest` symlinks to the most recent run. |
| `test-results/<runId>` | Playwright artifacts — traces, screenshots, and the per-test `new-action-entities.json` the cache write-back reads. |

### These artifacts can hold typed values

Treat `.shiplight/action-cache/` and `test-results/` as secret-bearing, not as
ordinary build output. A healed action is cached with its `kwargs` verbatim
(`fingerprintActionEntity` in `packages/types/src/test-flow/actionEntityFingerprint.ts`),
so an `input_text` keeps the string that was typed; Playwright traces and
screenshots capture form input the same way. Nothing on the write path redacts.

A value is stripped only when its variable was declared `sensitive: true` under
`use.variables` — `isDeclaredSensitive` in `apps/cli/src/fixture.ts` is what sets
the flag, and a variable saved during a run never gets it. So declare every
credential sensitive, and give cache and artifact storage the same access rules
as any other secret: a branch-scoped Actions cache restored through
`restore-keys` is readable by later runs on that branch.

`npx shiplight report` regenerates the HTML report from saved artifacts and is
safe to run: it uploads to Shiplight Cloud only when the upload flag is truthy
**and** `SHIPLIGHT_API_TOKEN` is set (`maybeUploadToCloud` in
`apps/cli/src/commands/report.ts`). Two variables set that flag —
`SHIPLIGHT_REPORT_TO_CLOUD` and the legacy `REPORT_TO_CLOUD` alias, which
`isReportToCloudEnabled` still honours — so scrub both from a runner image you
inherited. With the token removed, as above, nothing leaves your infrastructure.

Merge sharded reports into one with `shiplight report --merge`:

```bash
npx shiplight report --merge all-shards/*/shiplight-report/ -o shiplight-report
```
