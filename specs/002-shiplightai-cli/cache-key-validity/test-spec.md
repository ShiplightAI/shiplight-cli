# Test Spec: Action-entity cache key — identity vs validity

**Scope**: change within feature `002-shiplightai-cli` (working tree on `feng/workspace`,
uncommitted) — separating a statement's **identity** (its UID) from a cached entity's
**validity** (a `source_fingerprint` on the store entry), and making the UID
checkout-independent.
**Source material**:
- [Feature spec](../spec.md) — FR-011 (action-entity caching: "key cache entries by a
  stable statement hash"), User Story 1 (`shiplight test`, declared **P1**)
- Sibling contracts: [cache-effectiveness/test-spec.md](../cache-effectiveness/test-spec.md)
  (measures what this cache serves), [cache-batching/test-spec.md](../cache-batching/test-spec.md)
  (same subsystem, server side)
- Implementation: `packages/types/src/test-flow/{actionEntityFingerprint,actionEntityStore}.ts`,
  `packages/shiplight-tools/src/yaml-transpiler/{statementIdentityPath,yamlParser,statements}.ts`,
  `apps/cli/src/{transpile.ts,cache/inlineFingerprintMap.ts,commands/test.ts}`
- Originating review: a high-effort multi-agent code review of the first attempt at this
  fix (10 verified findings), which is what established that the UID is an identity with
  four consumers rather than a cache key with one.
**Testing posture**: repo-root [TESTING.md](../../../TESTING.md) (policy chain step 2).
**Test report**: [test-report.md](./test-report.md)

## Priority derivation

User Story 1 declares **P1** for `shiplight test`, and FR-011's caching serves that
command, so P1 is the carried default for every behavior below. Two behaviors are marked
**inferred P2** where the consequence is a one-time or cosmetic degradation rather than a
wrong test result; those are flagged inline and are this session's judgment, not an
upstream declaration.

## The defect this closes

Cache entries are written **only** by self-healing (`webAgent.ts:1089`, `:1403`), so every
entry asserts: *the inline entity at this statement failed; this is what worked instead.*
Nothing re-checked that assertion. The UID is derived from position and description only,
so editing a `locator:`, an `xpath:`, or an action's kwargs left the key unchanged and the
healed entity kept winning the priority contest in `transpileAction` — silently shadowing
the fix with the entity it superseded. Editing `text:` on an input was the sharpest form:
the run kept typing the old value.

The first attempt folded the entity into the UID. That closes the shadowing but breaks the
UID's other three jobs, which is what the review surfaced and what the invariants below now
pin.

## Testing What

### Product Behaviors

- **A hand-edited locator, xpath, or kwarg is what runs.** A superseded cache entry never
  shadows an edit to the statement it superseded. — P1 (declared, US1)
- **A cached entity still serves while the YAML it superseded is unchanged.** The fix must
  not buy correctness by disabling the cache. — P1 (declared, US1)
- **Upgrading does not empty an existing cache.** Entries written before the field existed
  keep working until their next heal stamps them. — P1 (declared, US1)
- **A statement's failure screenshots stay attached to it across an edit** — including the
  edit the user is making *because* they opened the debugger to fix that statement. —
  inferred P2

### Implementation / System Invariants

- **The UID is an identity, not a validity token.** Four consumers depend on it being
  independent of statement content: the cache key, the `stmtUid` passed to `agent.step`,
  the `<uid>_before` / `<uid>_after` artifact directory names, and post-run cache
  attribution (`specContent.includes(uid)`). Deriving it from content detaches artifacts on
  edit and breaks attribution under watch/UI mode, where workers rewrite the spec mid-run.
  — P1
- **UIDs are checkout-independent.** The store's outer key (branch + repo-relative path) is
  built to travel between machines; the entry keys inside it must travel too, or CI
  downloads a populated store and misses every key. — P1
- **UIDs use POSIX separators.** Otherwise a Windows and a Linux runner in one matrix fork
  the cache despite an identical relative path. — P1
- **Repo anchoring matches git's own resolution.** A worktree's `.git` is a *file* and is
  still a root; nested repos take the nearest root; no repo falls back to the path as given.
  — P1
- **Repo and branch stay OUT of the UID.** The store key already carries both, and a
  branch-dependent UID would additionally wipe a developer's local cache on every in-place
  branch switch, since the local store key has no branch in it. — P1
- **The fingerprint moves on semantics**: locator, xpath, action name, kwarg value, kwarg
  added. — P1
- **The fingerprint holds still on noise**: kwarg key order at any depth, YAML scalar
  retyping (`text: 123` vs `text: "123"`), and capture-time entity debris that YAML
  round-tripping strips anyway. Array order is semantics and must move it. — P1
- **The empty-string fingerprint is distinct from an absent one.** `''` means "this
  statement had no inline entity" and stops applying the moment the YAML grows one;
  `undefined` means "written before fingerprinting existed" and is grandfathered.
  Conflating them grandfathers an entry that superseded nothing, forever. — P1
- **Re-heals overwrite the same key.** Store size stays bounded by statement count; an edit
  creates no new key and therefore no orphan. — P1
- **The transpile→write-back bridge is merged, not replaced.** The transpiler's mtime skip
  means one pass need not walk every file, while a statement healed this run may have been
  transpiled by an earlier one. — P1

### Risk-Based Behaviors

- **No overstated cache credit.** A refused entry must report as `original`, never as a
  cache hit, or the run's cache summary counts a hit for an entry that never applied. — P1
- **The bridge degrades, never corrupts.** An unwritable `.shiplight/`, a corrupt or absent
  map, or a UID the map has no record of must all fall back to the grandfathered path — a
  run must never fail, and an entry must never be stamped with a guess. A wrong stamp
  refuses a valid entry permanently. — P1
- **No new secret egress.** Verified rather than assumed: `{{VAR}}` placeholders are
  substituted at runtime in `sdk-core` (`agentHelpers.replaceVariables`), so the YAML — and
  therefore the fingerprint — carries `{{TEST_PASS}}`, not its value. Separately, the
  cached `action_entity` already ships `action_data.kwargs` to the cloud today, so
  fingerprinting kwargs introduces no new class of egress. — P1

### Operational / Release Behaviors

- **One cold cache on upgrade, accepted deliberately.** The repo-relative path change moves
  every UID once, so the first run after upgrade re-heals, reports zero cache hits, and
  takes the re-heal time. The user accepted this over carrying a dual-read migration.
  Bounded to one run per repo. — P1
- **Screenshots captured before the upgrade detach once**, since nothing prunes
  `.shiplight/artifacts/`. Cosmetic and self-correcting on the next run. — inferred P2
- **No user working-tree churn.** The new map lands in `.shiplight/`, and generated specs
  are `*.yaml.spec.ts` — both gitignored in this repo *and* in the scaffolded template, so
  neither surfaces as an unexpected diff. — P1

### Stakeholder Confidence Goals

- A user who fixes a locator by hand can trust the fix is what runs, and can still see the
  screenshots of the failure that prompted the fix.
- CI owners can trust the shared cache is reachable from any checkout path, and that a
  cross-OS matrix does not silently fork it.
- Release owners know the exact upgrade cost (one cold run) and that it is bounded, not
  recurring.

## Evidence Strategy

Every changed behavior is deterministic logic plus filesystem wiring. There is no browser,
provider, or live-service surface in this diff, so per the capability map `e2e` / `agent` /
`manual` cannot prove anything here that `unit` does not — capability, not cost, excludes
them. `TESTING.md` prefers `unit`/`contract`/`integration` for exactly this shape of change.

| What | Priority | Viable How | Selected How | Why | Residual Risk |
| --- | --- | --- | --- | --- | --- |
| Edited locator/kwarg is what runs | P1 (declared) | unit | **unit** — transpile a store stamped against the pre-edit YAML against the post-edit YAML | Asserts the product behavior at the seam that decides it, with the real transpiler | none |
| Cache still serves unchanged YAML | P1 (declared) | unit | **unit** — same store, unedited YAML, healed locator present in output | Without this the gate could pass by never serving anything | none |
| Legacy entries grandfathered | P1 (declared) | unit | **unit** — entry with no stamp, asserted served | The upgrade path is otherwise unobservable until release | Real upgrade from a populated pre-release cache not exercised (accepted) |
| UID independent of content | P1 (declared) | unit | **unit** — UID equality across a locator edit, asserted inside the gate test | Pins the property the other three consumers rely on | Artifact and attribution consumers asserted via the UID property, not end-to-end |
| UID checkout-independent | P1 (declared) | unit | **unit** — two fixture repos at different absolute roots | Directly reproduces the laptop-vs-CI miss | Real cross-machine cloud round-trip not exercised (accepted) |
| POSIX separators | P1 (declared) | unit | **unit** — assert no backslash in output; relative input with backslashes normalises | The cross-OS fork is invisible on a single-OS CI lane | Not run on a real Windows runner (accepted) |
| Repo anchoring (worktree / nested / none) | P1 (declared) | unit | **unit** — `.git` as file, nested `.git`, and no `.git` fixtures | Encodes git's own resolution rules where they matter | Real `git worktree` not invoked; the `.git`-file shape is reproduced |
| Repo/branch excluded from UID | P1 (declared) | static/review | **review** — asserted by construction; the identity path function takes no branch input | There is no branch input to exercise; the proof is the absent parameter | none |
| Fingerprint moves on semantics | P1 (declared) | unit | **unit** — locator, xpath, action name, kwarg value, kwarg added | Each is a distinct shadowing vector | none |
| Fingerprint stable under noise | P1 (declared) | unit | **unit** — key order (flat + nested), scalar retyping, entity debris, array order | Each false invalidation silently discards a validated heal | none |
| `''` vs `undefined` fingerprint | P1 (declared) | unit | **unit** — all four combinations asserted | A one-character conflation grandfathers entries forever | none |
| Serialization frozen | P1 (declared) | unit | **unit** — golden fingerprint string | Relational assertions all survive a stringifier change; only a golden value fails | none |
| Bridge merge semantics | P1 (declared) | unit | **unit** — two merges, later wins, earlier survives | The mtime skip makes replacement lossy in a way no other test would catch | none |
| Bridge degrades safely | P1 (declared) | unit | **unit** — absent, malformed, non-object, unwritable target, corrupt-then-merge | Each is a distinct path to either a failed run or a wrong stamp | none |
| Stamping selects and does not mutate | P1 (declared) | unit | **unit** — spec-membership filter, stamp applied, `''` preserved, absent left unstamped, input not mutated | Extracted as a pure exported function precisely so this is directly assertable | Assembly into the upload payload asserted at the helper, not on a live PUT |
| Refused entry reports `original` | P1 (declared) | unit | **unit** — observer output asserted on the edited-YAML transpile | Keeps the cache-effectiveness metric honest about its own denominator | none |
| No new secret egress | P1 (declared) | static/review | **review** — runtime substitution confirmed in `sdk-core`; kwargs already shipped by the cached entity | Inspection is the capable proof; there is no secret path to exercise | none |
| Artifacts stay attached across an edit | inferred P2 | integration | **none — knowingly accepted gap** | Needs a real failing run to write artifact directories, then a debugger read-back | Covered indirectly: artifacts are named by UID, and UID stability across edits *is* asserted |
| One cold cache on upgrade | P1 (declared) | integration | **none — accepted, by decision** | The user chose the cold run over a dual-read migration; there is no transitional code to test | First real upgrade observes it; bounded to one run |
| Gitignore coverage | P1 (declared) | static | **review** — `.shiplight/` and `*.yaml.spec.ts` confirmed in repo `.gitignore` and `scaffold/templates/gitignore.tpl` | A grep is the capable proof | none |

Out of scope:

- Whether cached replay produces *correct* test outcomes — that is FR-011's own contract.
- The cache-effectiveness metric itself — see the sibling spec; this change only guarantees
  a refused entry is not counted as a hit.
- Server-side cache API behavior (caps, upsert) — the cloud service, see `cache-batching`.
- Pruning dead entries under a server-side cap — untouched here; this change adds no
  orphans, but pre-existing ones remain.

## Test Cases

### CACHE-KEY-T01 Cached entity applies only while it supersedes the YAML

- Testing what: the core product behavior (edit wins), its inverse (unchanged YAML still
  served), the grandfather clause, UID stability across an edit, and the `original`
  reporting of a refused entry.
- Source refs: `statements.ts:161-172`, `actionEntityFingerprint.ts`.
- Preconditions: none — temp dirs only, no accounts, no external services.
- Automated checks:
  ```bash
  cd packages/types && pnpm build   # shiplight-tools resolves shiplight-types via dist
  cd ../shiplight-tools && node --test --import tsx \
    src/yaml-transpiler/actionEntityFingerprintGate.test.ts
  ```
- Pass criteria: the healed locator appears for unedited YAML; after a locator edit the
  edited locator appears and the healed one does not; the same holds for a kwarg-only edit;
  an unstamped entry is still served; the observer reports exactly `['original']` for the
  refused case; UIDs are asserted equal across the edit inside the test.
- Cleanup: temp directory removed in `after`.

### CACHE-KEY-T02 Fingerprint semantics

- Testing what: what moves the fingerprint, what must not, the `''`/`undefined`
  distinction, and the frozen serialization.
- Source refs: `packages/types/src/test-flow/actionEntityFingerprint.ts`.
- Preconditions: none — pure functions, no filesystem.
- Automated checks:
  ```bash
  cd packages/types && node --test --import tsx \
    src/test-flow/actionEntityFingerprint.test.ts
  ```
- Pass criteria: locator / xpath / action-name / kwarg-value / kwarg-added each change the
  value; kwarg key order (flat and nested), scalar retyping, and entity debris do not;
  array order does; the legacy `action` alias fingerprints identically to `action_data`;
  the golden string matches exactly; `isStoreEntryApplicable` returns true for a match and
  for `undefined`, false for a mismatch and for `''` against a present entity.

### CACHE-KEY-T03 Statement identity is checkout-independent

- Testing what: repo-relative derivation, POSIX normalisation, git anchoring rules, and
  that statement UIDs follow all of it.
- Source refs: `statementIdentityPath.ts`, `yamlParser.ts:computeDeterministicUid`.
- Preconditions: none — fixture repos are temp dirs with a `.git` entry; no git binary is
  invoked and no real repository is touched.
- Automated checks:
  ```bash
  cd packages/shiplight-tools && node --test --import tsx \
    src/yaml-transpiler/statementIdentityPath.test.ts
  ```
- Pass criteria: an absolute path reduces to its repo-relative form; two fixture repos at
  different absolute roots yield the same identity **and** the same statement UID; a `.git`
  *file* (worktree shape) anchors; the nearest root wins when repos nest; no repo falls
  back to the given path; output contains no backslash; different files in one repo still
  differ; UIDs are stable across repeated parses.
- Cleanup: temp directories removed in `afterEach`; the memoised repo-root cache is reset
  in `beforeEach`/`afterEach` so fixtures cannot leak into each other.

### CACHE-KEY-T04 Transpile→write-back bridge and stamping

- Testing what: the map's merge semantics and failure modes, and the pure selection/stamping
  step that consumes it.
- Source refs: `apps/cli/src/cache/inlineFingerprintMap.ts`,
  `apps/cli/src/commands/test.ts:selectStampedFileEntries`.
- Preconditions: none.
- Automated checks:
  ```bash
  cd apps/cli && node --test --experimental-test-module-mocks --import tsx \
    src/cache/inlineFingerprintMap.test.ts
  ```
- Pass criteria: round-trip; a second merge adds and overwrites without dropping the first;
  `''` survives the round-trip; an empty batch writes nothing; absent / malformed /
  non-object files read as empty; an unwritable target does not throw; a corrupt file is
  merged over rather than propagated. For stamping: only spec-mentioned UIDs are kept, the
  recorded fingerprint is applied, `''` is applied rather than dropped, an unrecorded UID is
  left unstamped, and the input entry is not mutated.

### CACHE-KEY-T05 Whole-suite regression and type safety

- Testing what: that separating identity from validity broke nothing in the three packages
  that carry it, including the existing cache-effectiveness and transpiler suites.
- Source refs: whole diff.
- Preconditions: `pnpm install`; `packages/types` and `packages/shiplight-tools` built, in
  that order — the CLI resolves both through `dist`, so testing the CLI against unbuilt
  sources measures the previous build.
- Automated checks:
  ```bash
  cd packages/types && pnpm build && pnpm test
  cd ../shiplight-tools && pnpm build && pnpm test
  cd ../../apps/cli && pnpm test:unit
  pnpm --filter shiplight-types typecheck
  pnpm --filter shiplight-tools typecheck
  pnpm --filter shiplightai typecheck
  pnpm --filter @shiplightai/test typecheck
  ```
- Pass criteria: zero failures in all three suites; all four typechecks clean. The CLI
  suite's single skip is the `report --merge` case that self-skips without `dist/cli.js`.
- If not executable: mark `BLOCKED`, never assume.

## Fixtures And Environments

No product environment is involved. The changed code is CLI- and library-internal; every
test runs against temp directories with no network, no browser, and no credentials.

### Local Development

- Accounts / roles: none.
- Data fixtures: `mkdtemp` directories holding `.test.yaml` files, generated
  `.yaml.spec.ts`, fixture `.git` entries (directory and file forms), and
  `.shiplight/inline-fingerprints.json`.
- External service fixtures: none — no cache API call is made and no git binary is invoked.
- Environment setup: `pnpm install`, then build `packages/types` before
  `packages/shiplight-tools` before running the CLI suite.
- Secret availability: none required. No fixture contains a credential; `{{VAR}}`
  placeholders in YAML fixtures are literal placeholder text.
- Mutation policy: `seeded_fixtures_only` — temp dirs only, removed in hooks.
- Known local limitations: no real cross-machine cloud round-trip, no Windows runner, no
  real `git worktree`, no real upgrade from a populated pre-release cache.

### Dev / Staging / Production

- Not applicable. This change ships inside the `shiplightai` package and
  `@shiplightai/mcp`'s dependency chain; its runtime environment is the customer's own CI.
  The one-time cold cache is observable on the first real run after release — recorded as a
  deferred item in the report, not as a claim.

## Report Expectations

- Report path: [test-report.md](./test-report.md).
- Status vocabulary per `_shared/vocabularies.md`.
- No secrets: no fixture, command, or output in this contract contains a credential.
- Record the exact commands including the build prerequisites, and call out the accepted
  cold-cache cost and the untested artifact-reattachment path as findings rather than
  burying them.

## Coverage Notes

- Every behavior maps to a listed strategy. Four are knowingly accepted gaps rather than
  tests: artifact reattachment end-to-end, the real upgrade cold-cache, a real Windows
  runner, and a real cross-machine cloud round-trip. Each is recorded with what would prove
  it.
- Two behaviors are proven by review rather than execution (repo/branch exclusion from the
  UID, and no-new-secret-egress). Both are inspection-provable and have no exercisable path.
- CACHE-KEY-T05 is the only case with build prerequisites; its command chain includes them
  in dependency order, because running it without them measures the previous build.
- The negative control matters here and is recorded in the report: reverting the gate must
  fail T01, and reverting the identity wiring must fail T03's cross-checkout case. Tests
  that pass in both states are noted as invariants, not as proof of this change.
