import { TestFlow, ActionEntityStore } from "shiplight-types";
import { ActionEntity } from "shiplight-types";
import { TestEnvironmentConfigEntity } from "./testEnvironmentConfigEntity";

/**
 * Test case settings stored as JSON in the database.
 * Uses snake_case for JSON field names.
 *
 * Note: disable_auto_login and device_name are being migrated here from
 * the root-level TestCaseEntity fields. Use settings fields first, then
 * fallback to root-level fields for backward compatibility.
 */
export interface TestCaseSettings {
  /** Disable automatic login before test execution */
  disable_auto_login?: boolean;
  /** Device name for browser emulation (e.g., 'Desktop Chrome', 'iPhone 14') */
  device_name?: string;
  /** Automatically dismiss modals during self-healing (default: false) */
  auto_dismiss_modal?: boolean;
  /** Enable microphone access for the test browser (Chromium-only fake device support in runtime) */
  enable_microphone?: boolean;
  /** Test data file ID to use for fake audio capture when microphone is enabled */
  microphone_audio_file_id?: number | null;
  /** Enable camera access for the test browser (Chromium-only fake device support in runtime) */
  enable_camera?: boolean;
  /** Enable loading a Chrome extension for the test browser (Chromium-only) */
  enable_extension?: boolean;
  /** Test data file ID for the extension package (.crx or .zip) */
  extension_test_data_id?: number | null;
  /** Browser locale/language override (BCP 47 tag, e.g. 'en-US', 'fr-FR') */
  browser_language?: string | null;
  /** Browser timezone override (IANA timezone ID, e.g. 'America/New_York') */
  browser_timezone?: string | null;
  /**
   * @deprecated Use `failure_analysis.enabled` instead. Kept for backwards-compat reading.
   */
  disable_auto_analysis?: boolean;
  /**
   * @deprecated Use `failure_analysis.auto_fix_enabled` instead. Kept for backwards-compat reading.
   */
  disable_auto_fix?: boolean;
  /** Tri-state failure analysis settings (undefined = inherit from schedule/org) */
  failure_analysis?: {
    /** undefined = inherit, true = force on, false = force off */
    enabled?: boolean;
    /** undefined = inherit (default true), true/false = explicit override */
    auto_fix_enabled?: boolean;
  };
  /** Test-case-scoped variables. Override environment and global variables with the same name. */
  variables?: Array<{
    name: string;
    value: string;
    isSensitive: boolean;
  }>;
  /** Extra HTTP headers sent with every request in the browser context (e.g., custom auth headers) */
  extra_http_headers?: Record<string, string>;
}

// common/entities/testCaseEntity.ts
export interface TestCaseEntity {
  organization_id: string;
  id?: number;
  created_at?: string;
  status?: string;
  code_s3_path?: string;
  updated_at?: string;
  title?: string;
  description?: string;
  steps_s3_path?: string;
  agent_task_id?: number;
  action_steps?: ActionEntity[];
  test_data_ids?: number[];
  function_ids?: number[];
  reusable_step_ids?: number[];
  environment_configs?: TestEnvironmentConfigEntity[];
  test_account_ids?: number[]; // all test account ids that are associated with this test case
  test_flow?: TestFlow;
  /** Cached action entities keyed by statement UID - separate from test_flow for clean separation */
  action_entities?: ActionEntityStore;
  timeout_minutes?: number;
  created_by?: string;
  updated_by?: string;
  disable_auto_login?: boolean;
  device_name?: string;
  folder_id?: number;
  settings?: TestCaseSettings;
  metadata?: Record<string, unknown>;
}
