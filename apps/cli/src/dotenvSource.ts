/**
 * Source of truth for Shiplight-internal env reads. `.env` values override
 * the shell — otherwise a stale shell-level provider key (e.g. dev's
 * `OPENAI_API_KEY`) silently bypasses the Shiplight LLM proxy. CI-injected
 * env vars (process.env) are used as a base layer so they remain visible
 * when no `.env` file declares them. Falls back to raw `process.env` when
 * `loadShiplightEnv` was never called.
 */

import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// State lives on globalThis: tsup compiles each entry (config, fixture,
// cli) into its own self-contained bundle, each with its own inlined copy
// of this module. A module-level `let` would not be shared between the
// config bundle (which calls loadShiplightEnv) and the fixture bundle
// (which calls getShiplightEnv). A Symbol would be safer against key
// collisions but wouldn't survive cross-bundle identity, so a string key
// is the pragmatic choice.
const STASH_KEY = '__shiplightDotenvCache__';
type Stash = Record<string, string> | undefined;
function getStash(): Stash {
  return (globalThis as Record<string, unknown>)[STASH_KEY] as Stash;
}
function setStash(value: Stash): void {
  (globalThis as Record<string, unknown>)[STASH_KEY] = value;
}

/**
 * Walk up from `startDir` to `process.cwd()` and return existing .env file
 * paths, ordered closest-first. Shared between `loadShiplightEnv` and the
 * dotenv.config() loop in `config.ts` so the two stay in lockstep.
 */
export function findEnvFiles(startDir: string): string[] {
  const envFiles: string[] = [];
  let dir = path.resolve(startDir);
  const projectRoot = path.resolve(process.cwd());

  while (true) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) envFiles.push(envPath);
    if (dir === projectRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return envFiles;
}

/**
 * Build the merged Shiplight env view WITHOUT touching the global stash.
 *
 * Start from process.env so CI-injected secrets are visible even when no
 * .env file declares them. .env values are applied on top (furthest-out
 * file first, closest file last) so they override the shell, preserving
 * the original ".env wins" semantics.
 *
 * The CLI parent process needs this view — it must read the same
 * SHIPLIGHT_API_TOKEN the spawned Playwright process will read, and a local
 * user's token usually lives in `.env`, not the shell — but it must NOT
 * install a stash, because other parent-side readers (`createActionEntityCache`)
 * deliberately resolve against raw process.env today. Changing what they see is
 * a separate decision from adding a reader.
 */
export function readShiplightEnv(startDir: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) merged[k] = v;
  }
  const envFiles = findEnvFiles(startDir);
  for (let i = envFiles.length - 1; i >= 0; i--) {
    Object.assign(merged, dotenv.parse(fs.readFileSync(envFiles[i])));
  }
  return merged;
}

export function loadShiplightEnv(startDir: string): void {
  setStash(readShiplightEnv(startDir));
}

/**
 * Install the resolved `.env` view onto `process.env` for the CLI parent.
 *
 * The parent must resolve the SAME token the spawned Playwright child will, or
 * parent-side readers that go straight to `process.env` — the action-entity
 * cache and the org-settings pre-flight — disagree with the run they are
 * configuring. This mutates `process.env` rather than setting the stash so
 * those existing readers need no change to see the corrected view (SC-009).
 *
 * Exported so the parity is testable; `cli.ts` is an entry point with
 * import-time side effects and cannot be exercised directly.
 */
export function applyShiplightEnvToProcess(startDir: string): void {
  Object.assign(process.env, readShiplightEnv(startDir));
}

export function getShiplightEnv(): Record<string, string | undefined> {
  const stash = getStash();
  if (stash === undefined) {
    return process.env as Record<string, string | undefined>;
  }
  return stash;
}

/**
 * Test-only helper. Pass an object to set the stash; pass `undefined` to
 * reset back to the unloaded state (subsequent `getShiplightEnv` calls
 * fall back to `process.env`).
 */
export function __setShiplightEnvForTest(env: Record<string, string> | undefined): void {
  setStash(env);
}
