/**
 * VariableStore - Shared variable storage for TestContext and WebAgent
 *
 * This class provides a centralized store for test variables that can be
 * accessed by both the user-facing TestContext and the internal WebAgent.
 */

/**
 * JSON-serializable format for VariableStore
 * Used in config files to store variables with sensitivity information
 */
export interface VariableStoreJSON {
  data: Record<string, any>;
  sensitiveKeys: string[];
}

export class VariableStore {
  private data: Record<string, any> = {};
  private sensitive: Set<string> = new Set();

  /**
   * Get a variable value by key
   */
  get(key: string): any {
    return this.data[key];
  }

  /**
   * Set a variable value
   * @param key - Variable name
   * @param value - Variable value
   * @param sensitive - Whether this variable contains sensitive data (e.g., passwords)
   */
  set(key: string, value: any, sensitive = false): void {
    this.data[key] = value;
    if (sensitive) {
      this.sensitive.add(key);
    } else if (this.sensitive.has(key)) {
      // If previously marked as sensitive but now not, remove from sensitive set
      this.sensitive.delete(key);
    }
  }

  /**
   * Get all variables as a plain object
   * Returns a shallow copy to prevent external modifications
   */
  getAll(): Record<string, any> {
    return { ...this.data };
  }

  /**
   * Check if a variable is marked as sensitive
   */
  isSensitive(key: string): boolean {
    return this.sensitive.has(key);
  }

  /**
   * Get all sensitive keys
   * Returns a new Set to prevent external modifications
   */
  getAllSensitiveKeys(): Set<string> {
    return new Set(this.sensitive);
  }

  /**
   * Delete a variable
   */
  delete(key: string): boolean {
    this.sensitive.delete(key);
    return delete this.data[key];
  }

  /**
   * Clear all variables
   */
  clear(): void {
    this.data = {};
    this.sensitive.clear();
  }

  /**
   * Check if a variable exists
   */
  has(key: string): boolean {
    return key in this.data;
  }

  /**
   * Get the number of variables
   */
  get size(): number {
    return Object.keys(this.data).length;
  }

  /**
   * Merge another VariableStore into this one
   * Values from the other store override existing values
   */
  merge(other: VariableStore): void {
    for (const [key, value] of Object.entries(other.getAll())) {
      this.set(key, value, other.isSensitive(key));
    }
  }

  /**
   * Serialize to JSON-compatible format for config files
   */
  toJSON(): VariableStoreJSON {
    return {
      data: { ...this.data },
      sensitiveKeys: Array.from(this.sensitive),
    };
  }

  /**
   * Create a VariableStore from JSON format
   */
  static fromJSON(json: Partial<VariableStoreJSON>): VariableStore {
    const store = new VariableStore();
    if (json.data) {
      const sensitiveSet = new Set(json.sensitiveKeys || []);
      for (const [key, value] of Object.entries(json.data)) {
        store.set(key, value, sensitiveSet.has(key));
      }
    }
    return store;
  }
}
