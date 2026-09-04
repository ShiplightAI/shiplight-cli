/**
 * Session shapes shared across the debugger UI.
 *
 * This file used to be the sandbox HTTP client for the hosted product. Every
 * function in it called the v1 API and none survived into the debugger bundle —
 * the ten modules that import this file all take types only. The client was
 * removed in August 2026; only the type declarations remain.
 */

import type { Environment } from "@/common/models/environment";
import type { TestAccountGroupConfig } from "@/common/entities/testEnvironmentConfigEntity";

export interface ExecutionHistoryEntry {
  description: string;
  feedback: string;
}

export interface TestSessionInfo {
  sessionId: string;
  searchParams: string;
  // Optional fields used when creating a new session
  status?: string;
  details?: string;
  liveviewUrl?: string;
  liveviewUrlType?: string;
  testContext?: Record<string, any>;
}

export interface ScreenshotResponse {
  status: string;
  message?: string;
}

export interface SessionConfig {
  organizationId: string;
  /** Inline test account group configuration */
  testAccountGroup?: TestAccountGroupConfig;
  startingUrl?: string;
  environment?: Environment;
  disableAutoLogin?: boolean;
  testDataIds?: number[];
  deviceName?: string;
  /** Enable fake camera device + grant camera permission (Chromium-only) */
  enableCamera?: boolean;
  /** Enable fake microphone device + grant microphone permission (Chromium-only) */
  enableMicrophone?: boolean;
  /** Automatically dismiss modals during self-healing (default: false) */
  autoDismissModal?: boolean;
  /** Test data file ID to use for fake microphone audio capture */
  microphoneAudioFileId?: number | null;
  /** Enable loading a Chrome extension (Chromium-only) */
  enableExtension?: boolean;
  /** Test data file ID for the extension package (.crx or .zip) */
  extensionTestDataId?: number | null;
  /** Browser locale override (BCP 47 tag, e.g. 'en-US') */
  locale?: string;
  /** Browser timezone override (IANA timezone ID, e.g. 'America/New_York') */
  timezoneId?: string;
  /** Extra HTTP headers to send with every request in the browser context */
  extraHTTPHeaders?: Record<string, string>;
  /** Test-case-scoped variables from testCase.settings.variables */
  testCaseVariables?: Array<{ name: string; value: string; isSensitive: boolean }>;
}
