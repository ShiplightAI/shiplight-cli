/**
 * SandboxService Interface
 *
 * Common interface for debugger sandbox services.
 * Implemented by LocalSandboxService (standalone) and PlaywrightSandboxService (Playwright-bootstrapped).
 */

import type { Page } from "playwright";
import type { ActionEntity } from "shiplight-types";
import type { AgentStepEvent } from "sdk-core";

export type AgentStepEventCallback = (event: AgentStepEvent) => void;

export interface DebugInfo {
  sessionId: string;
  liveviewUrl: string;
  browserWsUrl: string;
}

export interface RunStepResult {
  success: boolean;
  actions: ActionEntity[];
  details?: string;
}

export interface SandboxService {
  // CDP endpoint
  getCdpEndpoint(): string | null;

  // Session lifecycle
  createSession(config?: { startingUrl?: string; testFilePath?: string }): Promise<{ sessionId: string }>;
  executeLogin(sessionId: string): Promise<{ status: string; details?: string }>;
  ensureBrowser(sessionId: string): Promise<{ page: Page; liveviewUrl: string }>;
  startDebug(sessionId: string): Promise<DebugInfo>;
  terminateSession(sessionId: string): Promise<void>;
  cleanupAll(): Promise<void>;

  // Action execution
  executeAction(
    sessionId: string,
    actionEntity: ActionEntity,
    stepId: string,
    options?: {
      withSelfHealing?: boolean;
      stmtUid?: string;
      executionHistory?: Array<[string, string]>;
    }
  ): Promise<any>;

  /** Execute raw JS code and return its result. Used for IF/WHILE condition evaluation. */
  executeCode?(
    sessionId: string,
    code: string,
  ): Promise<{ status: string; result?: any; details?: string }>;
  runStep(
    sessionId: string,
    statement: string,
    stepId: string,
    onEvent: AgentStepEventCallback,
    executionHistory?: Array<[string, string]>
  ): Promise<RunStepResult>;
  stopRunStep(sessionId: string): boolean;

  // AI features
  evaluate(
    sessionId: string,
    statement: string,
    executionHistory?: Array<[string, string]>
  ): Promise<Record<string, any>>;
  generateAction(
    sessionId: string,
    statement: string,
    stepId: string,
    options?: {
      executionHistory?: Array<[string, string]>;
      usePureVision?: boolean;
      includeDebugInfo?: boolean;
    }
  ): Promise<any>;
  takeScreenshot(sessionId: string, stepId?: string): Promise<{ screenshot: string; screenshotPath?: string }>;

  /** Return accumulated artifacts (screenshots) from the current session. */
  getSessionArtifacts?(sessionId: string): {
    outputDir?: string;
    screenshots: Array<{ stepId: string; path: string }>;
  };

  // Recording
  startRecorder(
    sessionId: string,
    onEvent: (event: any) => void,
    testIdAttributeName?: string,
  ): Promise<void>;
  stopRecorder(sessionId: string): Promise<void>;

}
