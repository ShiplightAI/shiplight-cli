/**
 * Stub for @/hooks/useIntRunner in the embedded local debugger SPA.
 *
 * The real useIntRunner targets the cloud API with bare paths like
 * `/api/int-runner/start-recorder`. In the embedded debugger, all int-runner
 * requests must be prefixed with `/debugger/:sessionId` so the outer CLI
 * server can proxy them to the inner Playwright process. This stub replaces
 * the recorder functions with apiUrl()-aware versions.
 */

import { makeStreamingRequest } from "@/common/utils/streamingUtils";
import { apiUrl } from "../../../utils/apiBase";
import type { TestSessionInfo } from "@/services/sandboxService";

export const startRecorder = async (
  session: TestSessionInfo,
  onEvent: (event: unknown) => void,
  testIdAttributeName?: string,
  signal?: AbortSignal,
  timeoutMs = 300000,
): Promise<void> => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const combinedSignal = signal
    ? (() => {
        const c = new AbortController();
        const h = () => c.abort();
        signal.addEventListener("abort", h);
        timeoutController.signal.addEventListener("abort", h);
        return c.signal;
      })()
    : timeoutController.signal;

  try {
    await makeStreamingRequest(apiUrl("/api/int-runner/start-recorder"), onEvent, {
      method: "POST",
      body: { session, testIdAttributeName },
      signal: combinedSignal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`startRecorder timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const stopRecorder = async (session: TestSessionInfo): Promise<{ status: string }> => {
  const res = await fetch(apiUrl("/api/int-runner/stop-recorder"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session }),
  });
  return res.json();
};
