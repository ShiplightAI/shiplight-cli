import { TestAccountGroupType } from "../constants";

/**
 * Hook configuration for test environment.
 * Hooks are template (reusable group) references that run at specific points in the test lifecycle.
 */
export interface EnvironmentHooksConfig {
  /** Template ID to execute after login, before test steps */
  beforeTest?: number;
  /** Template ID to execute after test completes (in finally block) */
  afterTest?: number;
}

/**
 * Inline test account group configuration.
 * New preferred format - stored directly in environment config.
 */
export interface TestAccountGroupConfig {
  type: TestAccountGroupType;
  account_ids?: number[];
}

/**
 * Environment configuration for a test case.
 * Each config specifies how a test runs in a particular environment.
 */
export interface TestEnvironmentConfigEntity {
  environment_id: number;
  /** Inline test account group configuration */
  test_account_group: TestAccountGroupConfig;
  path?: string;
  is_default_debug?: boolean;
  hooks?: EnvironmentHooksConfig;
}
/**
 * Raw environment config as stored in the database.
 * May contain legacy test_account_group_id field.
 * This type is private to the DB service - external code uses TestEnvironmentConfigEntity.
 */
export interface LegacyTestEnvironmentConfig extends TestEnvironmentConfigEntity {
  /** Legacy field - converted to test_account_group before returning */
  test_account_group_id?: number;
}