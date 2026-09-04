/**
 * Int-Runner Routes
 *
 * Local HTTP routes mirroring the cloud /api/int-runner/* API shape.
 * Backed by LocalSandboxService instead of cloud sandbox.
 */

import { Router } from "express";
import type { SandboxService } from "../services/types.js";

export function createIntRunnerRouter(sandbox: SandboxService): Router {
  const router = Router();

  /**
   * GET /api/browser-cdp — return CDP WebSocket URL of the running browser
   */
  router.get("/api/browser-cdp", async (_req, res) => {
    const cdpUrl = sandbox.getCdpEndpoint();
    if (!cdpUrl) {
      return res.status(404).json({
        error: "No browser running. Start a debug session first.",
      });
    }
    res.json({ cdpUrl });
  });

  /**
   * POST /api/int-runner/create-session
   */
  router.post("/api/int-runner/create-session", async (req, res) => {
    try {
      // startingUrl may come directly or from testFlow.url (when frontend sends the full testCase)
      const startingUrl = req.body.startingUrl || req.body.testFlow?.url || req.body.urlOverride;
      const testFilePath = req.body.testFilePath;
      const result = await sandbox.createSession({ startingUrl, testFilePath });
      res.json({
        status: "success",
        sessionId: result.sessionId,
        searchParams: "",
      });
    } catch (error: any) {
      console.error("[debugger] create-session error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  /**
   * POST /api/int-runner/login — execute AI-driven login if config is provided
   */
  router.post("/api/int-runner/login", async (req, res) => {
    try {
      const { session } = req.body;
      if (!session?.sessionId) {
        return res.status(400).json({ status: "error", message: "Missing session" });
      }
      const result = await sandbox.executeLogin(session.sessionId);
      res.json(result);
    } catch (error: any) {
      console.error("[debugger] login error:", error);
      res.status(500).json({ status: "error", details: error.message });
    }
  });

  /**
   * POST /api/int-runner/liveview-url — not used in local mode (headed browser)
   */
  router.post("/api/int-runner/liveview-url", async (req, res) => {
    const { session } = req.body;
    if (!session?.sessionId) {
      return res.status(400).json({ status: "error", message: "Missing session" });
    }
    // Local mode runs headed — no liveview URL needed
    res.json({ liveviewUrl: "", browserWsUrl: "" });
  });

  /**
   * POST /api/int-runner/end-debug — end debug mode
   */
  router.post("/api/int-runner/end-debug", async (req, res) => {
    const { session } = req.body;
    if (!session?.sessionId) {
      return res.status(400).json({ status: "error", message: "Missing session" });
    }
    res.json({ status: "success" });
  });

  /**
   * POST /api/int-runner/start-debug
   */
  router.post("/api/int-runner/start-debug", async (req, res) => {
    try {
      const { session } = req.body;
      if (!session?.sessionId) {
        return res.status(400).json({ status: "error", message: "Missing session" });
      }
      const info = await sandbox.startDebug(session.sessionId);
      res.json({
        status: "success",
        ...info,
      });
    } catch (error: any) {
      console.error("[debugger] start-debug error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  /**
   * POST /api/int-runner/execute-action
   */
  router.post("/api/int-runner/execute-action", async (req, res) => {
    try {
      const { session, actionEntity, stepId, withSelfHealing, stmtUid, executionHistory } = req.body;
      if (!session?.sessionId || !actionEntity) {
        return res.status(400).json({ status: "error", message: "Missing session or actionEntity" });
      }
      const result = await sandbox.executeAction(session.sessionId, actionEntity, stepId, {
        withSelfHealing,
        stmtUid,
        executionHistory,
      });
      res.json(result);
    } catch (error: any) {
      console.error("[debugger] execute-action error:", error);
      res.status(500).json({ status: "error", details: error.message });
    }
  });

  /**
   * POST /api/int-runner/run-step — SSE streaming
   */
  router.post("/api/int-runner/run-step", async (req, res) => {
    const { session, statement, stepId, executionHistory } = req.body;
    if (!session?.sessionId || !statement) {
      return res.status(400).json({ success: false, message: "Session and statement required" });
    }

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await sandbox.runStep(session.sessionId, statement, stepId, writeEvent, executionHistory);
    } catch (error: any) {
      writeEvent({ type: "error", data: { message: error.message } });
    } finally {
      res.end();
    }
  });

  /**
   * POST /api/int-runner/execute-step — SSE streaming (DRAFT step execution)
   */
  router.post("/api/int-runner/execute-step", async (req, res) => {
    const { session, statement, stepId, executionHistory, maxSteps } = req.body;
    if (!session?.sessionId || !statement) {
      return res.status(400).json({ success: false, message: "Session and statement required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      // For DRAFT steps, use the same runStep with maxSteps passed via options
      await sandbox.runStep(session.sessionId, statement, stepId, writeEvent, executionHistory);
    } catch (error: any) {
      writeEvent({ type: "error", data: { message: error.message } });
    } finally {
      res.end();
    }
  });

  /**
   * POST /api/int-runner/stop-run-step
   */
  router.post("/api/int-runner/stop-run-step", async (req, res) => {
    try {
      const { session } = req.body;
      if (!session?.sessionId) {
        return res.status(400).json({ status: "error", message: "Missing session" });
      }
      const aborted = sandbox.stopRunStep(session.sessionId);
      res.json({ status: "success", aborted });
    } catch (error: any) {
      console.error("[debugger] stop-run-step error:", error);
      res.status(500).json({ status: "error", aborted: false, details: error.message });
    }
  });

  /**
   * POST /api/int-runner/evaluate
   */
  router.post("/api/int-runner/evaluate", async (req, res) => {
    try {
      const { session, statement, stepId, executionHistory } = req.body;
      if (!session?.sessionId || !statement) {
        return res.status(400).json({ status: "error", message: "Missing session or statement" });
      }
      const result = await sandbox.evaluate(session.sessionId, statement, executionHistory);
      res.json(result);
    } catch (error: any) {
      console.error("[debugger] evaluate error:", error);
      res.status(500).json({
        status: "error",
        conclusion: "unknown",
        explanation: error.message,
      });
    }
  });

  /**
   * POST /api/int-runner/generate-action
   */
  router.post("/api/int-runner/generate-action", async (req, res) => {
    try {
      const { session, statement, stepId, executionHistory, usePureVision, includeDebugInfo } = req.body;
      if (!session?.sessionId || !statement) {
        return res.status(400).json({ status: "error", message: "Missing session or statement" });
      }
      const result = await sandbox.generateAction(session.sessionId, statement, stepId, {
        executionHistory,
        usePureVision,
        includeDebugInfo,
      });
      res.json(result);
    } catch (error: any) {
      console.error("[debugger] generate-action error:", error);
      res.status(500).json({ status: "error", details: error.message });
    }
  });

  /**
   * POST /api/int-runner/screenshot
   */
  router.post("/api/int-runner/screenshot", async (req, res) => {
    try {
      const { session, s3Path } = req.body;
      if (!session?.sessionId) {
        return res.status(400).json({ status: "error", message: "Missing session" });
      }
      // Extract step identifier from the s3Path (e.g. "s3://bucket/org/test/<uid>_before.png" → "<uid>_before")
      let stepId: string | undefined;
      if (s3Path) {
        const basename = s3Path.split("/").pop()?.replace(/\.png$/, "");
        if (basename) stepId = basename;
      }
      const result = await sandbox.takeScreenshot(session.sessionId, stepId);
      res.json({ status: "success", ...result });
    } catch (error: any) {
      console.error("[debugger] screenshot error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  /**
   * GET /api/int-runner/session-artifacts — return accumulated screenshots
   */
  router.get("/api/int-runner/session-artifacts", async (_req, res) => {
    try {
      const artifacts = sandbox.getSessionArtifacts?.("default") ?? { screenshots: [] };
      res.json(artifacts);
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  /**
   * POST /api/int-runner/start-recorder — SSE streaming recorder events
   */
  router.post("/api/int-runner/start-recorder", async (req, res) => {
    const { session, testIdAttributeName } = req.body;
    if (!session?.sessionId) {
      return res.status(400).json({ status: "error", message: "Missing session" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await sandbox.startRecorder(session.sessionId, writeEvent, testIdAttributeName);
    } catch (error: any) {
      writeEvent({ type: "error", data: { message: error.message } });
    } finally {
      res.end();
    }
  });

  /**
   * POST /api/int-runner/stop-recorder
   */
  router.post("/api/int-runner/stop-recorder", async (req, res) => {
    try {
      const { session } = req.body;
      if (!session?.sessionId) {
        return res.status(400).json({ status: "error", message: "Missing session" });
      }
      await sandbox.stopRecorder(session.sessionId);
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("[debugger] stop-recorder error:", error);
      res.status(500).json({ status: "error", details: error.message });
    }
  });

  /**
   * POST /api/int-runner/terminate-session
   */
  router.post("/api/int-runner/terminate-session", async (req, res) => {
    try {
      const { session } = req.body;
      if (!session?.sessionId) {
        return res.status(400).json({ status: "error", message: "Missing session" });
      }
      await sandbox.terminateSession(session.sessionId);
      res.json({ status: "success", details: `Session ${session.sessionId} terminated` });
    } catch (error: any) {
      console.error("[debugger] terminate-session error:", error);
      res.status(500).json({ status: "error", details: error.message });
    }
  });

  /**
   * POST /api/int-runner/session-status — always active for local sessions
   */
  router.post("/api/int-runner/session-status", async (req, res) => {
    const { session } = req.body;
    if (!session?.sessionId) {
      return res.status(400).json({ status: "timed_out" });
    }
    res.json({ status: "active", remainingSeconds: 9999 });
  });

  return router;
}
