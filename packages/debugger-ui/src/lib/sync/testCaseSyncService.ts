// lib/sync/testCaseSyncService.ts
// Sync Service for Test Case synchronization with IndexedDB

import { fetcher } from '@/utils/fetcher';
import { TestCaseDetails } from '@/common/view-models/testCaseDetails';
import { getTestCaseIndexedDB, TestCaseIndexedDB } from '../indexeddb/testCaseIndexedDB';

// =============================================================================
// TYPES
// =============================================================================

export interface SyncResult {
  success: boolean;
  testCaseChangesCount: number; // test cases changes count
  latestResultUpdatesCount: number; // latest run results changes count
  error?: Error;
  lastSyncTime: string;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncTime: string | null;
  lastSyncError: Error | null;
  syncInterval: number;
}

interface SyncResponse {
  changes: {
    created: TestCaseDetails[];
    updated: TestCaseDetails[];
    deleted: number[];
  };
  syncTime: string;
  hasMore: boolean;
  totalChanges: number;
}

interface LatestRunResultsResponse {
  success: boolean;
  results: Record<number, any | null>;
}

// =============================================================================
// SYNC SERVICE
// =============================================================================

export class TestCaseSyncService {
  private indexedDB: TestCaseIndexedDB | null = null;
  public readonly organizationId: string;
  private syncInterval: number = 60000; // 60秒
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private lastSyncTime: string | null = null;
  private lastSyncError: Error | null = null;
  private visibilityHandler: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  private syncPromise: Promise<SyncResult> | null = null; // Promise cache for deduplication

  constructor(organizationId: string) {
    if (!organizationId) {
      throw new Error('Organization ID is required');
    }
    this.organizationId = organizationId;
  }

  /**
   * Initialize the sync service
   */
  async init(): Promise<void> {
    this.indexedDB = await getTestCaseIndexedDB();
  }

  /**
   * Start automatic synchronization
   */
  startAutoSync(): void {
    if (this.syncTimer) {
      return; // Already started
    }

    // Initial sync after a short delay (using global deduplication)
    setTimeout(() => {
      syncTestCases().catch(console.error);
    }, 1000);

    // Set up periodic sync (using global deduplication)
    this.syncTimer = setInterval(() => {
      syncTestCases().catch(console.error);
    }, this.syncInterval);

    // Sync when page becomes visible (using global deduplication)
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        syncTestCases().catch(console.error);
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Sync when network comes back online (using global deduplication)
    this.onlineHandler = () => {
      syncTestCases().catch(console.error);
    };
    window.addEventListener('online', this.onlineHandler);
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
  }

  /**
   * Execute synchronization
   * Internal logic handles both test cases and latest run results separately
   * Uses Promise caching to deduplicate concurrent sync requests
   */
  async sync(): Promise<SyncResult> {
    // If there's already a sync in progress, return the existing promise
    if (this.syncPromise) {
      return this.syncPromise;
    }

    if (!this.indexedDB) {
      await this.init();
    }

    // Create and cache the sync promise
    this.syncPromise = this._performSync();

    // Clear the promise cache when sync completes (success or error)
    this.syncPromise
      .finally(() => {
        this.syncPromise = null;
      })
      .catch(() => {
        // Error already handled in _performSync
      });

    return this.syncPromise;
  }

  /**
   * Internal method to perform the actual sync
   * Separated from sync() to enable Promise caching
   */
  private async _performSync(): Promise<SyncResult> {
    if (this.isSyncing) {
      // This shouldn't happen due to Promise caching, but keep as safety check
      return {
        success: false,
        testCaseChangesCount: 0,
        latestResultUpdatesCount: 0,
        error: new Error('Sync already in progress'),
        lastSyncTime: this.lastSyncTime || new Date().toISOString(),
      };
    }

    this.isSyncing = true;
    this.lastSyncError = null;

    try {
      // Get sync metadata
      const metadata = await this.indexedDB!.getSyncMetadata();
      // Use current time as fallback instead of epoch time
      // This prevents sync from always starting from 1970
      const lastSyncTime = metadata?.lastSyncTime || new Date().toISOString();

      // 1. Sync test cases (include organizationId for validation)
      const syncResponse = (await fetcher.get(
        `/api/test-cases/sync?lastSyncTime=${encodeURIComponent(lastSyncTime)}&organizationId=${encodeURIComponent(this.organizationId)}`,
      )) as SyncResponse;

      // Apply changes to IndexedDB
      if (syncResponse.changes.created.length > 0) {
        await this.indexedDB!.bulkUpsert(syncResponse.changes.created);
      }
      if (syncResponse.changes.updated.length > 0) {
        await this.indexedDB!.bulkUpsert(syncResponse.changes.updated);
      }
      if (syncResponse.changes.deleted.length > 0) {
        await this.indexedDB!.bulkDelete(syncResponse.changes.deleted);
      }

      // 2. Sync latest run results (based on timestamp, include organizationId for validation)
      let latestResultUpdatesCount = 0;
      // let latestResultsResponse: LatestRunResultsResponse;
      const latestResultsResponse = (await fetcher.get(
        `/api/test-cases/latest-results?lastSyncTime=${encodeURIComponent(lastSyncTime)}&organizationId=${encodeURIComponent(this.organizationId)}`,
      )) as LatestRunResultsResponse;

      if (latestResultsResponse.results && Object.keys(latestResultsResponse.results).length > 0) {
        await this.indexedDB!.updateLatestRunResults(latestResultsResponse.results);
        latestResultUpdatesCount = Object.keys(latestResultsResponse.results).length;
      }

      // 3. Update sync metadata
      await this.indexedDB!.updateSyncMetadata({
        lastSyncTime: syncResponse.syncTime,
      });

      this.lastSyncTime = syncResponse.syncTime;

      // Dispatch sync event for SWR cache update
      // window.dispatchEvent(new CustomEvent('testcase-sync', { detail: { syncTime: syncResponse.syncTime } }));

      const result: SyncResult = {
        success: true,
        testCaseChangesCount: syncResponse.totalChanges,
        latestResultUpdatesCount,
        lastSyncTime: syncResponse.syncTime,
      };

      return result;
    } catch (error: any) {
      if (
        error?.response?.status === 409 ||
        error?.message?.includes('ORGANIZATION_MISMATCH') ||
        error?.message?.includes('status: 409')
      ) {
        await this.handleOrganizationMismatch();
      }
      this.lastSyncError = error instanceof Error ? error : new Error('Unknown sync error');
      const result: SyncResult = {
        success: false,
        testCaseChangesCount: 0,
        latestResultUpdatesCount: 0,
        error: this.lastSyncError,
        lastSyncTime: this.lastSyncTime || new Date().toISOString(),
      };
      return result;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Force a new sync (bypasses Promise cache)
   * Useful when you need to ensure a fresh sync even if one is in progress
   */
  async forceSync(): Promise<SyncResult> {
    // Clear any existing sync promise
    this.syncPromise = null;
    return this.sync();
  }

  /**
   * Full sync (for initial load or reset)
   */
  async fullSync(): Promise<void> {
    if (!this.indexedDB) {
      await this.init();
    }

    // Clear existing data
    await this.indexedDB!.clear();

    let cursor: string | undefined;
    let hasMore = true;
    let totalLoaded = 0;

    while (hasMore) {
      const url = cursor
        ? `/api/test-cases/full-sync?cursor=${cursor}&limit=500`
        : `/api/test-cases/full-sync?limit=500`;

      const fullSyncResponse = (await fetcher.get(url)) as {
        testCases: TestCaseDetails[];
        cursor?: string;
        hasMore: boolean;
        totalCount: number;
      };

      if (fullSyncResponse.testCases.length > 0) {
        await this.indexedDB!.bulkUpsert(fullSyncResponse.testCases);
        totalLoaded += fullSyncResponse.testCases.length;
      }

      cursor = fullSyncResponse.cursor;
      hasMore = fullSyncResponse.hasMore;
    }

    // Get all latest run results using epoch time (to get all results for initial load)
    // This is done once after all test cases are loaded
    try {
      const latestResults = (await fetcher.get(
        `/api/test-cases/latest-results?lastSyncTime=${encodeURIComponent(new Date(0).toISOString())}&organizationId=${encodeURIComponent(this.organizationId)}`,
      )) as LatestRunResultsResponse;
      if (latestResults.results && Object.keys(latestResults.results).length > 0) {
        await this.indexedDB!.updateLatestRunResults(latestResults.results);
      }
    } catch (error) {
      console.error('[TestCaseSyncService] Failed to fetch latest run results during full sync:', error);
      // Continue even if latest run results fail
    }

    // Update sync metadata with current time (not epoch time)
    // This ensures next sync will use current time, not epoch time
    const now = new Date().toISOString();
    await this.indexedDB!.updateSyncMetadata({
      lastSyncTime: now,
      lastFullSyncTime: now,
      totalCount: totalLoaded,
    });

    // Dispatch sync event
    // window.dispatchEvent(new CustomEvent('testcase-sync', { detail: { syncTime: now, fullSync: true } }));
  }

  /**
   * Get all test cases after syncing latest changes
   * This method ensures data is up-to-date before returning
   * @returns All test cases from IndexedDB after sync
   */
  async getAll(): Promise<TestCaseDetails[]> {
    if (!this.indexedDB) {
      await this.init();
    }

    // Check if IndexedDB is empty
    const existingData = await this.indexedDB!.getAll();

    if (existingData.length === 0) {
      // If IndexedDB is empty, perform full sync first
      await this.fullSync();
    } else {
      // If IndexedDB has data, perform incremental sync to get latest changes
      await this.sync();
    }

    // Return all data from IndexedDB after sync
    return await this.indexedDB!.getAll();
  }

  /**
   * Get sync status
   */
  getSyncStatus(): SyncStatus {
    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      lastSyncError: this.lastSyncError,
      syncInterval: this.syncInterval,
    };
  }

  /**
   * Handle organization mismatch (organization changed in another tab)
   */
  private async handleOrganizationMismatch(): Promise<void> {
    // Dispatch event to notify components to refresh organization
    window.dispatchEvent(new CustomEvent('organization-mismatch', { detail: { organizationId: this.organizationId } }));

    // Stop auto sync
    // this.stopAutoSync();
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.stopAutoSync();
    this.indexedDB = null;
  }
}

// =============================================================================
// SINGLETON INSTANCE MANAGER
// =============================================================================

// Single global instance since a user can only have one organization at a time
let globalInstance: TestCaseSyncService | null = null;

// Global sync promise cache for deduplication
let globalSyncPromise: Promise<SyncResult> | null = null;

/**
 * Get or create the single global TestCaseSyncService instance
 */
export async function getTestCaseSyncService(): Promise<TestCaseSyncService> {
  if (!globalInstance) {
    throw new Error('TestCaseSyncService not initialized');
  }
  return globalInstance;
}

export async function initializeTestCaseSyncService(organizationId: string): Promise<TestCaseSyncService> {
  if (!globalInstance) {
    globalInstance = new TestCaseSyncService(organizationId);
    await globalInstance.init();
    return globalInstance;
  }

  if (globalInstance.organizationId !== organizationId) {
    globalInstance.destroy();
    globalInstance = new TestCaseSyncService(organizationId);
    await globalInstance.init();
  }

  return globalInstance;
}

/**
 * Sync with global deduplication
 * Since a user can only have one organization at a time, we use a single global instance and promise
 * This ensures only one sync is running at any time, even if called from different places
 */
export async function syncTestCases(): Promise<SyncResult> {
  // Check if there's already a global sync in progress
  if (globalSyncPromise) {
    return globalSyncPromise;
  }

  // Get the sync service instance
  const service = await getTestCaseSyncService();

  // Create sync promise and cache it globally
  globalSyncPromise = service.sync();

  // Clear the global cache when sync completes
  globalSyncPromise
    .finally(() => {
      globalSyncPromise = null;
    })
    .catch(() => {
      // Error already handled in sync()
    });

  return globalSyncPromise;
}

/**
 * Destroy the global instance (e.g., on logout)
 */
export function destroyTestCaseSyncService(): void {
  if (globalInstance) {
    globalInstance.destroy();
    globalInstance = null;
  }
  globalSyncPromise = null;
}
