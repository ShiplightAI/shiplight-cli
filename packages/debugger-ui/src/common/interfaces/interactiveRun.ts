import { Environment } from "../models/environment";
import type { ActionEntity } from "shiplight-types";
import { ActionGenerationDebugInfo } from "shiplight-types";
import { TokenUsage } from "./tokenUsage";
export interface NewSessionRequest {
  startOptions: BrowserStartOptions;
  organizationId: string;
  /** Inline test account group configuration */
  testAccountGroup?: { type: string; account_ids?: number[] };
  environment?: Environment;
  disableAutoLogin?: boolean;
  deviceName?: string;
  disableSecurity?: boolean;
  /** Automatically dismiss modals during self-healing (default: false) */
  autoDismissModal?: boolean;
}

// sessionId is set in the cookie, acted as sticky session
// in the load balance.
export interface SessionResponse {
  status: 'success' | 'error';
  details?: string;
  sessionId?: string;
  testContext?: Record<string, any>;
}

export interface LoginSessionResponse {
  status: 'success' | 'error';
  details?: string;
}

export interface ExecCodeRequest {
  code: string;
  isSync: boolean;
}

// Canonical definition lives in shiplight-types; re-exported here for backward compatibility.
export type { ExecCodeResponse } from "shiplight-types";

export interface EvaluationRequest {
  statement: string;
}

interface SingleOpinion {
  conclusion: "true" | "false" | "unknown";
  explanation: string;
  model?: string;
}

export interface EvaluationResult {
  status: 'success' | 'error';
  conclusion: "true" | "false" | "unknown";
  explanation: string;
  model?: string;
  id?: string;
  other_opinions?: SingleOpinion[];
  artifacts?: Record<string, string>;
  token_usages?: TokenUsage[];
  debugInfo?: ActionGenerationDebugInfo;
}

export interface BrowserStartOptions {
  storageStateS3Path?: string;
  startingUrl?: string;
  testContext?: Record<string, any>;
  sensitiveKeys?: string[];
  organizationSettings?: Record<string, any>;
  testDataIds?: number[];
  deviceName?: string;
  /** Enable fake camera device + grant camera permission (Chromium-only) */
  enableCamera?: boolean;
  /** Enable fake microphone device + grant microphone permission (Chromium-only) */
  enableMicrophone?: boolean;
  /** Test data file ID to use for fake microphone audio capture */
  microphoneAudioFileId?: number | null;
  /** Enable loading a Chrome extension (Chromium-only) */
  enableExtension?: boolean;
  /** Test data file ID for the extension package (.crx or .zip) */
  extensionTestDataId?: number | null;
  /** Browser locale override (BCP 47 tag, e.g. 'en-US', 'fr-FR') */
  locale?: string;
  /** Browser timezone override (IANA timezone ID, e.g. 'America/New_York') */
  timezoneId?: string;
  /** Extra HTTP headers to send with every request in the browser context */
  extraHTTPHeaders?: Record<string, string>;
}

export interface GetSessionBrowserWsUrlResponse {
  status: 'success' | 'error';
  details?: string;
  url?: string;
}

/**
 * Event types from the streaming endpoint
 */
export enum AgentStepEventTypes {
  Started = 'started',
  Action = 'action',
  Completion = 'completion',
  Error = 'error',
  Aborted = 'aborted',
  Keepalive = 'keepalive',
}
export interface AgentStepEvent {
  type: AgentStepEventTypes;
  data?: any;
}

export interface AgentState {
  feedback: string;
  message: string;
  next_goal: string;

  // this is updated test context return to the frontend
  testContext?: Record<string, any>;
}

export interface AgentAction {
  agent_state: AgentState;
  action_entity: ActionEntity;
  debugInfo?: ActionGenerationDebugInfo;
}

/**
 * Callback function for handling stream events
 */
export type AgentStepEventCallback = (event: AgentStepEvent) => void;
