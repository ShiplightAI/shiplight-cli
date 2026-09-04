/**
 * Local int-runner API — self-contained fetch calls to the same-origin local server.
 * No Next.js, no Electron, no retry wrapper. Implements the same IntRunnerApi interface.
 */

import type { AgentStepEvent, EvaluationResult, LoginSessionResponse } from "@/common/interfaces/interactiveRun";
import { ExecCodeResponse } from "@/common/interfaces/interactiveRun";
import { ActionGenerationResponse } from "@/common/interfaces/testStepsInterface";
import type { ActionEntity } from "shiplight-types";
import { makeStreamingRequest } from "@/common/utils/streamingUtils";
import type { ExecutionHistoryEntry, ScreenshotResponse, TestSessionInfo } from "../../services/sandboxService";
import type { TestCase } from "@/common/models/testCase";
import type { IntRunnerApi } from "../testcase/TestFlowEditorController";
import { apiUrl } from "../../utils/apiBase";

const jsonHeaders: HeadersInit = { "Content-Type": "application/json" };

function historyToArray(map?: Map<string, ExecutionHistoryEntry>): Array<[string, string]> {
  if (!map || map.size === 0) return [];
  return Array.from(map.values()).map((e) => [e.description, e.feedback]);
}

// ─── IntRunnerApi methods ───────────────────────────────────────────────

const startInteractiveRun = async (
  testCase: TestCase,
  options?: { urlOverride?: string },
): Promise<TestSessionInfo> => {
  const session = await createSession(testCase, options);
  await startDebug(session);
  return session;
};

const loginSession = async (session: TestSessionInfo): Promise<LoginSessionResponse> => {
  const res = await fetch(apiUrl("/api/int-runner/login"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session }),
  });
  return res.json();
};

const executeCode = async (
  session: TestSessionInfo,
  code: string,
  stepId = "execute-code",
  isSync = false,
): Promise<ExecCodeResponse> => {
  const kwargs: Record<string, any> = { code };
  if (isSync) kwargs.isSync = true;
  const actionEntity: ActionEntity = {
    action_data: { action_name: "js_code", args: [], kwargs },
    url: "",
    action_description: "Execute JavaScript code",
    feedback: "",
  };
  const res = await fetch(apiUrl("/api/int-runner/execute-action"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session, actionEntity, stepId }),
  });
  return res.json();
};

const executeAction = async (
  session: TestSessionInfo,
  actionEntity: ActionEntity,
  stepId: string,
  withSelfHealing?: boolean,
  stmtUid?: string,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
): Promise<ExecCodeResponse> => {
  const res = await fetch(apiUrl("/api/int-runner/execute-action"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      session,
      actionEntity,
      stepId,
      withSelfHealing,
      stmtUid,
      executionHistory: historyToArray(executionHistoryMap),
    }),
  });
  return res.json();
};

const evaluateStatement = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
): Promise<EvaluationResult> => {
  const res = await fetch(apiUrl("/api/int-runner/evaluate"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      session,
      statement,
      stepId,
      executionHistory: historyToArray(executionHistoryMap),
    }),
  });
  return res.json();
};

const takeScreenshot = async (
  session: TestSessionInfo,
  s3Path: string,
  saveToHistory = false,
): Promise<ScreenshotResponse> => {
  const res = await fetch(apiUrl("/api/int-runner/screenshot"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session, s3Path, saveToHistory }),
  });
  return res.json();
};

const generateAction = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
  usePureVision?: boolean,
  includeDebugInfo?: boolean,
): Promise<ActionGenerationResponse> => {
  const res = await fetch(apiUrl("/api/int-runner/generate-action"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      session,
      statement,
      stepId,
      executionHistory: historyToArray(executionHistoryMap),
      usePureVision,
      includeDebugInfo: includeDebugInfo ?? false,
    }),
  });
  return res.json();
};

const runStep = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  onEvent: (event: AgentStepEvent) => void,
  signal?: AbortSignal,
  timeoutMs = 300000,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
): Promise<void> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const combinedSignal = signal
    ? (() => {
        const c = new AbortController();
        const h = () => c.abort();
        signal.addEventListener("abort", h);
        controller.signal.addEventListener("abort", h);
        return c.signal;
      })()
    : controller.signal;

  try {
    await makeStreamingRequest<AgentStepEvent>(apiUrl("/api/int-runner/run-step"), onEvent, {
      method: "POST",
      body: { session, statement, stepId, executionHistory: historyToArray(executionHistoryMap) },
      signal: combinedSignal,
    });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`runStep timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && error.name === "AbortError") return;
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const executeDraftStep = async (
  session: TestSessionInfo,
  statement: string,
  stepId: string,
  onEvent: (event: AgentStepEvent) => void,
  signal?: AbortSignal,
  timeoutMs = 300000,
  executionHistoryMap?: Map<string, ExecutionHistoryEntry>,
  maxSteps?: number,
): Promise<void> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const combinedSignal = signal
    ? (() => {
        const c = new AbortController();
        const h = () => c.abort();
        signal.addEventListener("abort", h);
        controller.signal.addEventListener("abort", h);
        return c.signal;
      })()
    : controller.signal;

  try {
    await makeStreamingRequest<AgentStepEvent>(apiUrl("/api/int-runner/execute-step"), onEvent, {
      method: "POST",
      body: {
        session,
        statement,
        stepId,
        executionHistory: historyToArray(executionHistoryMap),
        maxSteps,
      },
      signal: combinedSignal,
    });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`executeDraftStep timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && error.name === "AbortError") return;
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const stopRunStep = async (
  session: TestSessionInfo,
): Promise<{ status: string; aborted: boolean; message?: string; details?: string }> => {
  const res = await fetch(apiUrl("/api/int-runner/stop-run-step"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session }),
  });
  return res.json();
};

const terminateSession = async (session: TestSessionInfo): Promise<any> => {
  const res = await fetch(apiUrl("/api/int-runner/terminate-session"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session }),
  });
  return res.json();
};

// ─── Session lifecycle (used by TestFlowEditorController internally) ────

export const createSession = async (
  testCase: TestCase,
  options?: { urlOverride?: string },
): Promise<TestSessionInfo> => {
  const res = await fetch(apiUrl("/api/int-runner/create-session"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      ...testCase,
      ...(options?.urlOverride && { urlOverride: options.urlOverride }),
    }),
  });
  const data = await res.json();
  if (data.status === "error") throw new Error(data.message || "Failed to create session");
  return data;
};

export const startDebug = async (
  session: TestSessionInfo,
): Promise<{ liveviewUrl: string; browserWsUrl: string }> => {
  const res = await fetch(apiUrl("/api/int-runner/start-debug"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session }),
  });
  const data = await res.json();
  if (data.status === "error") throw new Error(data.message || "Failed to start debug");
  return { liveviewUrl: data.liveviewUrl, browserWsUrl: data.browserWsUrl };
};

export const getLiveviewUrl = async (
  session: TestSessionInfo,
): Promise<{ liveviewUrl: string; browserWsUrl: string }> => {
  const res = await fetch(apiUrl("/api/int-runner/liveview-url"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ session }),
  });
  const data = await res.json();
  return { liveviewUrl: data.liveviewUrl, browserWsUrl: data.browserWsUrl };
};

// Note: no `getSessionStatus` export. The local debugger runs on dedicated
// compute (user's machine or their own testbox VM), so there's no shared
// browser pool to reclaim — the cloud's idle-timeout lifecycle doesn't apply.
// TestFlowEditorController's polling effect treats an absent getSessionStatus
// as "skip polling entirely", which avoids the false-positive "Session timed
// out" banner that any transient HTTP blip would otherwise trigger.

// ─── Assembled IntRunnerApi ─────────────────────────────────────────────

export const localIntRunnerApi: IntRunnerApi = {
  createSession,
  startInteractiveRun,
  startDebug,
  getLiveviewUrl,
  loginSession,
  executeCode,
  executeAction,
  evaluateStatement,
  takeScreenshot,
  generateAction,
  runStep,
  executeDraftStep,
  stopRunStep,
  terminateSession,
  keepAlive: (_session) => Promise.resolve({ status: 'success' }),
};
