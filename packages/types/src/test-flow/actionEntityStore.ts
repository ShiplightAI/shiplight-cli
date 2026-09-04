/**
 * Action Entity Store Types
 * Types for storing action entities separately from test flows
 */

import type { ActionEntity } from './actionEntity';
import type { Action, Statement, TestFlow } from './testFlow';
import { getStatementContainers } from './statementTreeWalker';

/**
 * Source of a store update - tracks who/what updated the store entry
 */
export type StoreUpdateSource =
  | { source: 'runner'; test_run_id: number }
  | { source: 'sandbox'; user_id: number }
  | { source: 'generation' };

/**
 * A single entry in the action entity store
 */
export interface ActionStoreEntry {
  /** The stored action entity */
  action_entity: ActionEntity;
  /** ISO 8601 UTC timestamp of when this entry was last updated */
  updated_at: string;
  /** Information about what updated this store entry */
  updated_by: StoreUpdateSource;
  /**
   * Fingerprint of the statement's INLINE action entity at the time this entry was
   * written — i.e. what this entry superseded. The entry applies only while the inline
   * entity still fingerprints the same; once the YAML is edited, the edit is what runs.
   * See `fingerprintActionEntity` / `isStoreEntryApplicable`.
   *
   * Optional: entries written before fingerprinting existed carry no value and are
   * grandfathered (served as before) until their next heal re-stamps them.
   */
  source_fingerprint?: string;
}

/**
 * Store for action entities, keyed by statement UID
 *
 * This store is kept separately from the test flow to allow:
 * - Self-healed actions to be persisted without modifying user's test flow
 * - Clear separation between user intent (test flow) and system data (store)
 * - Tracking of when/how action entities were updated
 */
export interface ActionEntityStore {
  /** Schema version for future migrations */
  version: '1.0';
  /** Map of statement UID to stored action entity */
  entries: Record<string, ActionStoreEntry>;
}

/**
 * Create an empty action entity store
 */
export function createEmptyStore(): ActionEntityStore {
  return {
    version: '1.0',
    entries: {},
  };
}

/**
 * Create a store entry for a runner update
 *
 * `sourceFingerprint` records the inline entity this heal superseded; omit it only where
 * the inline entity is genuinely unavailable at the call site (the Playwright fixture
 * sees a healed entity and a UID, not the YAML). The CLI's post-run write-back stamps
 * entries it can attribute to a file, so an unstamped entry is a grandfathered one — see
 * `isStoreEntryApplicable`.
 */
export function createRunnerStoreEntry(
  actionEntity: ActionEntity,
  testRunId: number,
  sourceFingerprint?: string
): ActionStoreEntry {
  return {
    action_entity: actionEntity,
    updated_at: new Date().toISOString(),
    updated_by: { source: 'runner', test_run_id: testRunId },
    ...(sourceFingerprint !== undefined && { source_fingerprint: sourceFingerprint }),
  };
}

/**
 * Update a store entry for a statement
 *
 * @param store - The store to update (will be mutated)
 * @param stmtUid - Statement UID
 * @param actionEntity - The action entity to store
 * @param source - The source of the update
 * @returns The updated store
 */
export function updateStoreEntry(
  store: ActionEntityStore,
  stmtUid: string,
  actionEntity: ActionEntity,
  source: StoreUpdateSource
): ActionEntityStore {
  store.entries[stmtUid] = {
    action_entity: actionEntity,
    updated_at: new Date().toISOString(),
    updated_by: source,
  };
  return store;
}

/**
 * Merge pending store updates into an existing store
 *
 * @param existingStore - The existing store (or undefined for new store)
 * @param updates - Map of stmt.uid to ActionStoreEntry
 * @returns Merged store
 */
export function mergeStoreUpdates(
  existingStore: ActionEntityStore | undefined,
  updates: Map<string, ActionStoreEntry>
): ActionEntityStore {
  const store: ActionEntityStore = existingStore ?? {
    version: '1.0',
    entries: {},
  };

  for (const [stmtUid, entry] of updates) {
    store.entries[stmtUid] = entry;
  }

  return store;
}

/**
 * Check if a store has any entries
 */
export function isStoreEmpty(store: ActionEntityStore | undefined): boolean {
  if (!store) return true;
  return Object.keys(store.entries).length === 0;
}

/**
 * Get the number of entries in a store
 */
export function getStoreSize(store: ActionEntityStore | undefined): number {
  if (!store) return 0;
  return Object.keys(store.entries).length;
}

// =============================================================================
// Action Entity Merging (for loading from DB)
// =============================================================================

/**
 * Merge action entities from store into test flow statements
 *
 * This function takes action entities from the separate store (action_entities DB column)
 * and merges them into the test flow's inline action_entity fields.
 *
 * After merging:
 * - All statements have their latest action_entity inline
 * - The store can be cleared (it's been merged into test_flow)
 * - Downstream components only see inline action_entity, no store concept
 *
 * Resolution priority:
 * - Store entry wins over inline action_entity (store has latest)
 * - User locator (action.locator) is NOT touched - it's applied later at execution time
 *
 * @param testFlow - Test flow (may have inline action_entity on some actions)
 * @param actionEntities - Action entity store from DB (has latest cached entities)
 * @returns New TestFlow with merged action entities
 */
export function mergeActionEntitiesIntoTestFlow(
  testFlow: TestFlow,
  actionEntities?: ActionEntityStore
): TestFlow {
  // If no store or empty store, return testFlow as-is
  if (!actionEntities || Object.keys(actionEntities.entries).length === 0) {
    return testFlow;
  }

  // Merge into statements
  const mergedStatements = mergeIntoStatements(testFlow.statements ?? [], actionEntities);

  // Merge into teardown if present
  const mergedTeardown = testFlow.teardown
    ? mergeIntoStatements(testFlow.teardown, actionEntities)
    : undefined;

  return {
    ...testFlow,
    statements: mergedStatements,
    teardown: mergedTeardown,
  };
}

/**
 * Recursively merge store entries into statements
 */
function mergeIntoStatements(
  statements: Statement[],
  store: ActionEntityStore
): Statement[] {
  return statements.map((stmt) => mergeIntoStatement(stmt, store));
}

/**
 * Merge store entry into a single statement (recursive for nested statements)
 */
function mergeIntoStatement(stmt: Statement, store: ActionEntityStore): Statement {
  // Handle ACTION statements specially
  if (stmt.type === 'ACTION') {
    const action = stmt as Action;
    const storeEntry = store.entries[action.uid];

    if (storeEntry) {
      // Store entry exists - use it (overwrites inline action_entity)
      return {
        ...action,
        action_entity: storeEntry.action_entity,
      };
    }
    // No store entry - keep inline action_entity as-is
    return action;
  }

  // For container statements, recursively merge into children
  const containers = getStatementContainers(stmt);
  if (containers.length === 0) {
    return stmt;
  }

  // Build updated statement with merged containers
  const updates: Record<string, Statement[]> = {};
  for (const container of containers) {
    updates[container.key] = mergeIntoStatements(container.statements, store);
  }

  return { ...stmt, ...updates } as Statement;
}
