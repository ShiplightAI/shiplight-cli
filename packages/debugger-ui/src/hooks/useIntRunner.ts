import type { AgentStepEvent, EvaluationResult, LoginSessionResponse } from "@/common/interfaces/interactiveRun";
import { ExecCodeResponse } from "@/common/interfaces/interactiveRun";
import { ActionGenerationResponse } from "@/common/interfaces/testStepsInterface";
import type { ActionEntity } from "shiplight-types";
import { makeStreamingRequest } from "@/common/utils/streamingUtils";

import { withIntRunnerRetry } from "@/lib/int-runner-retry";
import { ExecutionHistoryEntry, ScreenshotResponse, SessionConfig, TestSessionInfo } from "@/services/sandboxService";
import { TestCase } from "@/common/models/testCase";

/**
 * Generates a unique idempotency key for API requests
 * Uses crypto.randomUUID if available, falls back to timestamp-based ID
 */
function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Creates headers with idempotency key support for int-runner APIs
 * In development, idempotency is optional based on environment variable
 */
function createIdempotentHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Check if int-runner idempotency is explicitly disabled (emergency kill switch)
  if (process.env.NEXT_PUBLIC_DISABLE_INT_RUNNER_IDEMPOTENCY !== 'true') {
    headers['Idempotency-Key'] = generateIdempotencyKey();
  }

  return headers;
}

/**
 * Creates an interactive run session for a test case
 * @param testCase The test case to run
 * @param options Optional configuration including URL override
 */
export const startInteractiveRun = async (
  testCase: TestCase,
  options?: { urlOverride?: string },
): Promise<TestSessionInfo> => {
  const response = await withIntRunnerRetry(() =>
    fetch(
      `/api/test-cases/${testCase.id}/interactive-run`,
      {
        method: "POST",
        headers: createIdempotentHeaders(),
        body: JSON.stringify({
          ...testCase,
          ...(options?.urlOverride && { urlOverride: options.urlOverride }),
        }),
      },
    )
  );
  return response.json();
};

/**
 * Creates an interactive run session for a given config
 */
export const startTestSession = async (config: SessionConfig): Promise<TestSessionInfo> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/new-session`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify(config),
    })
  );
  return response.json();
};

/**
 * Login to an existing session
 */
export const loginSession = async (session: TestSessionInfo): Promise<LoginSessionResponse> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/login`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
          session,
      }),
    })
  );
  return response.json();
};

/**
 * Executes code in the test session
 * @deprecated Use executeAction with a js_code action entity instead
 */
export const executeCode = async (
  session: TestSessionInfo,
  code: string,
  stepId: string = "execute-code",
  isSync: boolean = false
): Promise<ExecCodeResponse> => {
  // Create a js_code action entity with isSync if needed
  const kwargs: Record<string, any> = { code };
  if (isSync) {
    kwargs.isSync = true;
  }

  const actionEntity: ActionEntity = {
    action_data: {
      action_name: "js_code",
      args: [],
      kwargs
    },
    url: "",
    action_description: "Execute JavaScript code",
    feedback: ""
  };

  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/execute-action`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
          session,
          actionEntity,
          stepId,
      }),
    })
  );
  return response.json();
};

/**
 * Executes an action entity in the test session
 */
export const executeAction = async (
  session: TestSessionInfo,
  actionEntity: ActionEntity,
  stepId: string,
  withSelfHealing?: boolean,
  stmtUid?: string,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>
): Promise<ExecCodeResponse> => {
  // Extract and convert executionHistory - always send an array (empty if no history)
  let executionHistory: Array<[string, string]> = [];
  if (executionHistoryMap && executionHistoryMap.size > 0) {
    // Convert Map to array of [description, feedback] tuples, maintaining order
    executionHistory = Array.from(executionHistoryMap.values()).map(entry =>
      [entry.description, entry.feedback]
    );
    console.log(`Passing ${executionHistory.length} history entries to int-runner`);
  }

  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/execute-action`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
          session,
          actionEntity,
          stepId,
          withSelfHealing,
          stmtUid,
          executionHistory,
      }),
    })
  );
  return response.json();
};

/**
 * Evaluates a statement/condition in the test session
 */
export const evaluateStatement = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>
): Promise<EvaluationResult> => {
  // Extract and convert executionHistory - always send an array (empty if no history)
  let executionHistory: Array<[string, string]> = [];
  if (executionHistoryMap && executionHistoryMap.size > 0) {
    // Convert Map to array of [description, feedback] tuples, maintaining order
    executionHistory = Array.from(executionHistoryMap.values()).map(entry =>
      [entry.description, entry.feedback]
    );
    console.log(`Passing ${executionHistory.length} history entries to evaluate`);
  }

  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/evaluate`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
          session,
          statement,
          stepId,
          executionHistory,
      }),
    })
  );
  return response.json();
};

/**
 * Take a screenshot of the current browser window
 * @param session
 * @param statement
 * @param s3Path - The S3 path to upload the screenshot to
 * @returns
 */
export const takeScreenshot = async (session: TestSessionInfo, s3Path: string, saveToHistory: boolean = false): Promise<ScreenshotResponse> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/screenshot`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
          session,
          s3Path,
          saveToHistory,
      }),
    })
  );
  return response.json();
};

/**
 * Generates an action entity from a statement description
 */
export const generateAction = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
  usePureVision?: boolean,
  includeDebugInfo?: boolean
): Promise<ActionGenerationResponse> => {
  // Extract and convert executionHistory - always send an array (empty if no history)
  let executionHistory: Array<[string, string]> = [];
  console.log(`🔍 generateAction - executionHistoryMap:`, executionHistoryMap);
  console.log(`🔍 generateAction - executionHistoryMap size:`, executionHistoryMap?.size);
  if (executionHistoryMap && executionHistoryMap.size > 0) {
    // Convert Map to array of [description, feedback] tuples, maintaining order
    executionHistory = Array.from(executionHistoryMap.values()).map(entry =>
      [entry.description, entry.feedback]
    );
    console.log(`Passing ${executionHistory.length} history entries to generate-action`);
  } else {
    console.log(`⚠️ No execution history to pass (map is ${executionHistoryMap ? 'empty' : 'undefined'}), sending empty array`);
  }

  const requestBody = {
    session,
    statement,
    stepId,
    executionHistory,
    usePureVision,
    includeDebugInfo: includeDebugInfo ?? false, // Include debug info only if explicitly requested
  };

  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/generate-action`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify(requestBody),
    })
  );

  return response.json();
};

/**
 * Executes an agent task with streaming support
 */
export const runStep = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  onEvent: (event: AgentStepEvent) => void,
  signal?: AbortSignal,
  timeoutMs: number = 300000, // 5 minutes default timeout
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>
): Promise<void> => {
  // Extract and convert executionHistory - always send an array (empty if no history)
  let executionHistory: Array<[string, string]> = [];
  if (executionHistoryMap && executionHistoryMap.size > 0) {
    // Convert Map to array of [description, feedback] tuples, maintaining order
    executionHistory = Array.from(executionHistoryMap.values()).map(entry =>
      [entry.description, entry.feedback]
    );
    console.log(`Passing ${executionHistory.length} history entries to run-step`);
  }

  // Create an AbortController for timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);

  // Combine the timeout signal with any provided signal
  const combinedSignal = signal ?
    // If a signal is provided, we need to handle both signals
    (() => {
      const combinedController = new AbortController();

      // Abort if either signal is triggered
      const abortHandler = () => {
        console.log('\x1b[31m%s\x1b[0m', `[RunStep] Aborting run step request`);
        combinedController.abort();
      };
      signal.addEventListener('abort', abortHandler);
      timeoutController.signal.addEventListener('abort', abortHandler);

      return combinedController.signal;
    })() :
    timeoutController.signal;

  try {
    // Streaming endpoints should not use idempotency
    // Each stream is unique and real-time
    await makeStreamingRequest<AgentStepEvent>(
      `/api/int-runner/run-step`,
      onEvent,
      {
        method: "POST",
        body: {
          session,
          statement,
          stepId,
          executionHistory,
        },
        signal: combinedSignal,
      }
    );
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`runStep timed out after ${timeoutMs}ms`);
    }

    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`[useIntRunner] ✗ RunStep aborted for session ${session.sessionId}`);
      return;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Execute a DRAFT statement using multi-step AI execution
 * DRAFT statements have no cached action, so this always uses runStep for AI generation
 */
export const executeDraftStep = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  onEvent: (event: AgentStepEvent) => void,
  signal?: AbortSignal,
  timeoutMs: number = 300000, // 5 minutes default timeout
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
  maxSteps?: number,
): Promise<void> => {
  // Extract and convert executionHistory - always send an array (empty if no history)
  let executionHistory: Array<[string, string]> = [];
  if (executionHistoryMap && executionHistoryMap.size > 0) {
    // Convert Map to array of [description, feedback] tuples, maintaining order
    executionHistory = Array.from(executionHistoryMap.values()).map(entry =>
      [entry.description, entry.feedback]
    );
    console.log(`Passing ${executionHistory.length} history entries to execute-step`);
  }

  // Create an AbortController for timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);

  // Combine the timeout signal with any provided signal
  const combinedSignal = signal ?
    // If a signal is provided, we need to handle both signals
    (() => {
      const combinedController = new AbortController();

      // Abort if either signal is triggered
      const abortHandler = () => {
        console.log('\x1b[31m%s\x1b[0m', `[ExecuteDraftStep] Aborting execute step request`);
        combinedController.abort();
      };
      signal.addEventListener('abort', abortHandler);
      timeoutController.signal.addEventListener('abort', abortHandler);

      return combinedController.signal;
    })() :
    timeoutController.signal;

  try {
    // Streaming endpoints should not use idempotency
    // Each stream is unique and real-time
    await makeStreamingRequest<AgentStepEvent>(
      `/api/int-runner/execute-step`,
      onEvent,
      {
        method: "POST",
        body: {
          session,
          statement,
          stepId,
          executionHistory,
          maxSteps,
        },
        signal: combinedSignal,
      }
    );
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`executeDraftStep timed out after ${timeoutMs}ms`);
    }

    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`[useIntRunner] ✗ ExecuteDraftStep aborted for session ${session.sessionId}`);
      return;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Stops an ongoing agent step execution
 */
export const stopRunStep = async (session: TestSessionInfo): Promise<{ status: string; aborted: boolean; message?: string; details?: string }> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/stop-run-step`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
        session,
      }),
    })
  );
  return response.json();
};

/**
 * Terminates a test session
 */
export const terminateSession = async (session: TestSessionInfo): Promise<any> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/terminate-session`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
          session,
      }),
    })
  );
  return response.json();
};

/**
 * Reloads user functions in the test session
 */
export const reloadFunctions = async (session: TestSessionInfo): Promise<ExecCodeResponse> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/reload-functions`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
          session,
      }),
    })
  );
  return response.json();
};

/**
 * Starts Playwright recorder with streaming events
 */
export const startRecorder = async (
  session: TestSessionInfo,
  onEvent: (event: any) => void,
  testIdAttributeName?: string,
  signal?: AbortSignal,
  timeoutMs: number = 300000 // 5 minutes default timeout
): Promise<void> => {
  // Create an AbortController for timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);

  // Combine the timeout signal with any provided signal
  const combinedSignal = signal ?
    (() => {
      const combinedController = new AbortController();
      const abortHandler = () => combinedController.abort();
      signal.addEventListener('abort', abortHandler);
      timeoutController.signal.addEventListener('abort', abortHandler);
      return combinedController.signal;
    })() :
    timeoutController.signal;

  try {
    // Streaming endpoints should not use idempotency
    // Each stream is unique and real-time
    await makeStreamingRequest<any>(
      `/api/int-runner/start-recorder`,
      onEvent,
      {
        method: "POST",
        body: {
          session,
          testIdAttributeName,
        },
        signal: combinedSignal,
      }
    );
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`startRecorder timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Stops Playwright recorder
 */
export const stopRecorder = async (session: TestSessionInfo): Promise<{ status: string }> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/stop-recorder`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
        session,
      }),
    })
  );
  return response.json();
};

/**
 * Sends a keep-alive ping to reset the session idle timer.
 */
export const keepAlive = async (
  session: TestSessionInfo,
): Promise<{ status: string }> => {
  try {
    const response = await withIntRunnerRetry(() =>
      fetch(`/api/int-runner/keep-alive`, {
        method: "POST",
        headers: createIdempotentHeaders(),
        body: JSON.stringify({ session }),
      })
    );
    return response.json();
  } catch {
    return { status: 'error' };
  }
};

/**
 * Gets session idle status (read-only, does NOT reset idle timer).
 * Returns 'error' on transient failures (network issues, server errors) so
 * callers can skip without treating them as a real timeout.
 */
export const getSessionStatus = async (
  session: TestSessionInfo,
): Promise<{ status: 'active' | 'idle_warning' | 'timed_out' | 'error'; remainingSeconds?: number }> => {
  try {
    const response = await withIntRunnerRetry(() =>
      fetch(`/api/int-runner/session-status`, {
        method: "POST",
        headers: createIdempotentHeaders(),
        body: JSON.stringify({ session }),
      })
    );
    if (!response.ok) {
      // Non-2xx (e.g. 500) is a transient server error, not a real timeout
      return { status: 'error' };
    }
    return response.json();
  } catch {
    return { status: 'error' };
  }
};

// ===== SANDBOX SESSION LIFECYCLE =====
// These functions support the lazy-browser pattern:
// createSession → lightweight session without browser
// startDebug → launch browser on demand
// endDebug → end debug (keep browser if still in use)
// getLiveviewUrl → get liveview URL for a session
//

/**
 * Create a session (no browser).
 */
export const createSession = async (
  testCase: TestCase,
  options?: { urlOverride?: string },
): Promise<TestSessionInfo> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/create-session`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({
        ...testCase,
        ...(options?.urlOverride && { urlOverride: options.urlOverride }),
      }),
    })
  );
  const data = await response.json();
  if (data.status === 'error') {
    throw new Error(data.message || 'Failed to create session');
  }
  return data;
};

/**
 * Launch browser in an existing session.
 */
export const startDebug = async (
  session: TestSessionInfo,
): Promise<{ liveviewUrl: string; browserWsUrl: string }> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/start-debug`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({ session }),
    })
  );
  const data = await response.json();
  if (data.status === 'error') {
    throw new Error(data.message || 'Failed to start debug');
  }
  return { liveviewUrl: data.liveviewUrl, browserWsUrl: data.browserWsUrl };
};

/**
 * Get the liveview URL for a session.
 */
export const getLiveviewUrl = async (
  session: TestSessionInfo,
): Promise<{ liveviewUrl: string; browserWsUrl: string }> => {
  const response = await fetch(`/api/int-runner/liveview-url`, {
    method: "POST",
    headers: createIdempotentHeaders(),
    body: JSON.stringify({ session }),
  });
  const data = await response.json();
  if (data.status === 'error') {
    throw new Error(data.message || 'Failed to get liveview URL');
  }
  return { liveviewUrl: data.liveviewUrl, browserWsUrl: data.browserWsUrl };
};

/**
 * End debug mode in a session.
 */
export const endDebug = async (
  session: TestSessionInfo,
): Promise<{ status: string }> => {
  const response = await withIntRunnerRetry(() =>
    fetch(`/api/int-runner/end-debug`, {
      method: "POST",
      headers: createIdempotentHeaders(),
      body: JSON.stringify({ session }),
    })
  );
  return response.json();
};
