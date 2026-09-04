/**
 * Run ID
 *
 * One `shiplight test` invocation is one run ID. It names the Playwright
 * `outputDir` (`test-results/<runId>`) and the report folder
 * (`shiplight-report/<runId>`).
 *
 * Lives in its own module because BOTH sides of the spawn need it: the parent
 * (`commands/test.ts`) mints it and exports it as `SHIPLIGHT_RUN_ID` so it can
 * scope its post-test scan to this run's artifacts, and the child's
 * `shiplightConfig()` reads that same value back. Importing it from `config.ts`
 * instead would drag `@playwright/test` into the CLI bundle for one date string.
 */

/** `YYYY-MM-DDTHH-MM-SS-mmm`, in local time — filename-safe and sortable. */
export function generateRunId(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

/**
 * The run ID for the current invocation: an already-published
 * `SHIPLIGHT_RUN_ID` if there is one, otherwise a fresh one.
 *
 * Honoring the existing value is what keeps parent and child on the same ID,
 * and what lets a caller pin a run (sharded CI, watch mode re-evaluating the
 * config) by exporting it themselves.
 *
 * An EMPTY value counts as absent, not as a pin. `SHIPLIGHT_RUN_ID=` would
 * otherwise collapse `test-results/<runId>` back to `test-results/` — the
 * unscoped directory whose stale artifacts the run scoping exists to skip.
 */
export function resolveRunId(env: NodeJS.ProcessEnv): string {
  return env.SHIPLIGHT_RUN_ID || generateRunId();
}
