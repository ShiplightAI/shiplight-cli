// lib/indexeddb/testCaseIndexedDB.ts
// IndexedDB Manager for Test Case caching with organization isolation

import { TestCaseDetails } from '@/common/view-models/testCaseDetails';
import { TestCaseResult } from '@/common/models/testCaseResult';

// =============================================================================
// TYPES
// =============================================================================

interface TestCaseIndexedDBRecord {
  // Primary key
  id: number;

  // Test case data (full TestCaseDetails structure)
  data: TestCaseDetails;

  // Metadata for sync
  version: number; // version number, for detecting server-side updates
  lastSyncedAt: string; // last sync time (ISO string)
  isDeleted: boolean; // soft delete flag
  deletedAt?: string; // delete time

  // Cache metadata
  cachedAt: string; // cache time
  cacheVersion: string; // cache version number (for schema migration)
}

interface SyncMetadata {
  key: 'metadata';
  lastSyncTime: string; // last successful sync timestamp
  lastFullSyncTime: string; // last full sync timestamp
  syncVersion: number; // sync protocol version
  organizationId: string; // current organization ID
  totalCount: number; // total record count
  schemaVersion: string; // IndexedDB schema version
}

type TestCaseFilterOptions = {
  page?: number;
  limit?: number;
  statuses?: string[];
  types?: string[];
  labelIds?: number[];
  devices?: string[];
  platform?: string[];
  folderId?: number;
};

// =============================================================================
// INDEXEDDB MANAGER
// =============================================================================

export class TestCaseIndexedDB {
  private dbName: string;
  private version: number = 1;
  private db: IDBDatabase | null = null;
  public readonly organizationId: string; // make public for instance comparison

  constructor(organizationId: string) {
    if (!organizationId) {
      throw new Error('Organization ID is required');
    }
    this.organizationId = organizationId;
    // database name includes organizationId to avoid conflicts between accounts
    this.dbName = `shiplight_test_cases_v2_${organizationId}`;
  }

  /**
   * Initialize the IndexedDB database
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // create test_cases object store (no indexes needed, data is loaded into memory)
        if (!db.objectStoreNames.contains('test_cases')) {
          db.createObjectStore('test_cases', {
            keyPath: 'id',
          });
        }

        // Create sync_metadata object store
        if (!db.objectStoreNames.contains('sync_metadata')) {
          db.createObjectStore('sync_metadata', {
            keyPath: 'key',
          });
        }
      };
    });
  }

  /**
   * Get the database instance (ensure it's initialized)
   */
  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) {
      throw new Error('Failed to initialize IndexedDB');
    }
    return this.db;
  }

  /**
   * Bulk upsert test cases
   */
  async bulkUpsert(testCases: TestCaseDetails[]): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases'], 'readwrite');
    const store = transaction.objectStore('test_cases');

    const now = new Date().toISOString();
    const version = Date.now(); // Use timestamp as version

    // Collect all operations (get + put) as promises
    const operationPromises: Promise<void>[] = [];

    for (const testCaseDetails of testCases) {
      const testCaseId = testCaseDetails.testCase?.id;
      if (!testCaseId) {
        continue; // Skip test cases without ID
      }

      const recordOrganizationId = String(testCaseDetails.testCase?.organizationId ?? '');
      if (recordOrganizationId && recordOrganizationId !== this.organizationId) {
        console.warn('[TestCaseIndexedDB] Skip cross-organization upsert', {
          testCaseId,
          recordOrganizationId,
          dbOrganizationId: this.organizationId,
        });
        continue;
      }

      const record: TestCaseIndexedDBRecord = {
        id: testCaseId,
        data: testCaseDetails,
        version,
        lastSyncedAt: now,
        isDeleted: false,
        cachedAt: now,
        cacheVersion: '1.0',
      };

      // Create a promise that handles get + put for this test case
      const operationPromise = new Promise<void>((resolve, reject) => {
        const getRequest = store.get(testCaseId);
        getRequest.onsuccess = () => {
          const existing = getRequest.result;

          if (!record.data.latestRunResult && existing?.data?.latestRunResult) {
            record.data.latestRunResult = existing?.data?.latestRunResult;
          }

          const putRequest = store.put(record);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
      });

      operationPromises.push(operationPromise);
    }

    // Wait for all operations to complete
    await Promise.all(operationPromises);

    // Wait for transaction to complete
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Bulk delete test cases (soft delete)
   */
  async bulkDelete(ids: number[]): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases'], 'readwrite');
    const store = transaction.objectStore('test_cases');

    const now = new Date().toISOString();

    // Collect all operations (get + put) as promises
    const operationPromises: Promise<void>[] = [];

    for (const id of ids) {
      // Create a promise that handles get + put for this id
      const operationPromise = new Promise<void>((resolve, reject) => {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
          const existing = getRequest.result;
          if (existing) {
            // Update existing record with deleted flag
            const updated: TestCaseIndexedDBRecord = {
              ...existing,
              isDeleted: true,
              deletedAt: now,
              lastSyncedAt: now,
            };
            const putRequest = store.put(updated);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          } else {
            // Create a minimal deleted record
            const deleted: TestCaseIndexedDBRecord = {
              id,
              data: {
                testCase: { id, organization_id: this.organizationId } as any,
                latestRunResult: null,
                environment: null,
                testAccountGroup: null,
              },
              version: Date.now(),
              lastSyncedAt: now,
              isDeleted: true,
              deletedAt: now,
              cachedAt: now,
              cacheVersion: '1.0',
            };
            const putRequest = store.put(deleted);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          }
        };
        getRequest.onerror = () => reject(getRequest.error);
      });

      operationPromises.push(operationPromise);
    }

    // Wait for all operations to complete
    await Promise.all(operationPromises);

    // Wait for transaction to complete
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Update latestRunResult for test cases (without updating the entire test case)
   */
  async updateLatestRunResults(results: Record<number, TestCaseResult | null>): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases'], 'readwrite');
    const store = transaction.objectStore('test_cases');

    // Collect all operations (get + put) as promises
    const operationPromises: Promise<void>[] = [];

    for (const [testCaseIdStr, latestRunResult] of Object.entries(results)) {
      const testCaseId = parseInt(testCaseIdStr, 10);
      if (isNaN(testCaseId)) continue;

      // Create a promise that handles get + put for this test case
      const operationPromise = new Promise<void>((resolve, reject) => {
        const getRequest = store.get(testCaseId);
        getRequest.onsuccess = () => {
          const record = getRequest.result;
          if (record && !record.isDeleted) {
            // Update latestRunResult in the data
            record.data.latestRunResult = latestRunResult;
            record.lastSyncedAt = new Date().toISOString();

            const putRequest = store.put(record);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          } else {
            // Record doesn't exist or is deleted, skip
            resolve();
          }
        };
        getRequest.onerror = () => reject(getRequest.error);
      });

      operationPromises.push(operationPromise);
    }

    // Wait for all operations to complete
    await Promise.all(operationPromises);

    // Wait for transaction to complete
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get all test cases (excluding deleted ones)
   * Loads all data into memory and filters in memory
   */
  async getAll(): Promise<TestCaseDetails[]> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases'], 'readonly');
    const store = transaction.objectStore('test_cases');

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result as TestCaseIndexedDBRecord[];
        // Filter out deleted records in memory
        const results = records.filter((r) => !r.isDeleted).map((r) => r.data);
        resolve(results);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Get test case by ID
   */
  async getById(id: number): Promise<TestCaseDetails | null> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases'], 'readonly');
    const store = transaction.objectStore('test_cases');

    return new Promise((resolve, reject) => {
      const request = store.get(id);

      request.onsuccess = () => {
        const record = request.result as TestCaseIndexedDBRecord | undefined;
        if (record && !record.isDeleted) {
          resolve(record.data);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Get test cases by filter
   * Loads all data into memory and filters in memory
   */
  async getByFilter(filter: TestCaseFilterOptions): Promise<TestCaseDetails[]> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases'], 'readonly');
    const store = transaction.objectStore('test_cases');

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result as TestCaseIndexedDBRecord[];
        // Filter out deleted records and apply filters in memory
        let filtered = records.filter((r) => !r.isDeleted).map((r) => r.data);

        // Apply filters in memory
        if (filter.statuses && filter.statuses.length > 0) {
          filtered = filtered.filter((tc) => filter.statuses!.includes(tc.testCase.status as string));
        }

        if (filter.folderId !== undefined) {
          filtered = filtered.filter((tc) => tc.testCase.folderId === filter.folderId);
        }

        // Apply pagination
        if (filter.page && filter.limit) {
          const startIndex = (filter.page - 1) * filter.limit;
          const endIndex = startIndex + filter.limit;
          filtered = filtered.slice(startIndex, endIndex);
        }

        resolve(filtered);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Get sync metadata
   */
  async getSyncMetadata(): Promise<SyncMetadata | null> {
    const db = await this.getDB();
    const transaction = db.transaction(['sync_metadata'], 'readonly');
    const store = transaction.objectStore('sync_metadata');

    return new Promise((resolve, reject) => {
      const request = store.get('metadata');

      request.onsuccess = () => {
        resolve((request.result as SyncMetadata) || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Update sync metadata
   */
  async updateSyncMetadata(metadata: Partial<SyncMetadata>): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction(['sync_metadata'], 'readwrite');
    const store = transaction.objectStore('sync_metadata');

    // Get existing metadata (need to do this in a separate transaction or before creating the new one)
    // Since we're already in a transaction, we can't call getSyncMetadata which creates its own transaction
    // So we'll get it directly in this transaction
    const existing = await new Promise<SyncMetadata | null>((resolve, reject) => {
      const getRequest = store.get('metadata');
      getRequest.onsuccess = () => {
        resolve((getRequest.result as SyncMetadata) || null);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });

    // Only use epoch time as fallback if there's no existing metadata at all
    // If we're updating metadata, we should always use a valid time
    const defaultLastSyncTime = existing?.lastSyncTime || new Date().toISOString();
    const defaultLastFullSyncTime = existing?.lastFullSyncTime || new Date().toISOString();

    const updated: SyncMetadata = {
      key: 'metadata',
      lastSyncTime: metadata.lastSyncTime !== undefined ? metadata.lastSyncTime : defaultLastSyncTime,
      lastFullSyncTime: metadata.lastFullSyncTime !== undefined ? metadata.lastFullSyncTime : defaultLastFullSyncTime,
      syncVersion: metadata.syncVersion ?? existing?.syncVersion ?? 1,
      organizationId: this.organizationId,
      totalCount: metadata.totalCount ?? existing?.totalCount ?? 0,
      schemaVersion: metadata.schemaVersion ?? existing?.schemaVersion ?? '1.0',
    };

    // Put the updated metadata
    await new Promise<void>((resolve, reject) => {
      const request = store.put(updated);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Wait for transaction to complete
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases', 'sync_metadata'], 'readwrite');

    const testCasesStore = transaction.objectStore('test_cases');
    const metadataStore = transaction.objectStore('sync_metadata');

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const request = testCasesStore.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = metadataStore.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    ]);
  }

  /**
   * Clear deleted records older than maxAge (in days)
   * Loads all data into memory and filters in memory
   */
  async clearDeleted(maxAge: number = 30): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction(['test_cases'], 'readwrite');
    const store = transaction.objectStore('test_cases');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAge);

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result as TestCaseIndexedDBRecord[];
        const deletePromises: Promise<void>[] = [];

        // Filter deleted records in memory and delete old ones
        for (const record of records) {
          if (record.isDeleted && record.deletedAt) {
            const deletedDate = new Date(record.deletedAt);
            if (deletedDate < cutoffDate) {
              deletePromises.push(
                new Promise<void>((resolveDelete, rejectDelete) => {
                  const deleteRequest = store.delete(record.id);
                  deleteRequest.onsuccess = () => resolveDelete();
                  deleteRequest.onerror = () => rejectDelete(deleteRequest.error);
                }),
              );
            }
          }
        }

        Promise.all(deletePromises)
          .then(() => resolve())
          .catch((error) => reject(error));
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// =============================================================================
// SINGLETON INSTANCE MANAGER
// =============================================================================

// Single global instance since a user can only have one organization at a time
let globalInstance: TestCaseIndexedDB | null = null;

/**
 * Get or create the single global TestCaseIndexedDB instance
 * Since a user can only have one organization at a time, we use a single global instance
 * OrganizationId is retrieved from global storage (set by AuthProvider)
 */
export async function getTestCaseIndexedDB(): Promise<TestCaseIndexedDB> {
  if (!globalInstance) {
    throw new Error('TestCaseIndexedDB not initialized');
  }
  return globalInstance;
}

export async function initializeTestCaseIndexedDB(organizationId: string): Promise<TestCaseIndexedDB> {
  if (!globalInstance) {
    globalInstance = new TestCaseIndexedDB(organizationId);
    await globalInstance.init();
    return globalInstance;
  }

  if (globalInstance.organizationId !== organizationId) {
    globalInstance.close();
    globalInstance = new TestCaseIndexedDB(organizationId);
    await globalInstance.init();
  }

  return globalInstance;
}

/**
 * Close the global instance (e.g., on logout or organization change)
 */
export function closeTestCaseIndexedDB(): void {
  if (globalInstance) {
    globalInstance.close();
    globalInstance = null;
  }
}
