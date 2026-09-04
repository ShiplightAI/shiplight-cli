/**
 * Playwright Sandbox Service
 *
 * Lightweight sandbox that wraps an externally-provided Playwright page and
 * WebAgent. Used when the debugger runs inside a Playwright test context,
 * inheriting all Playwright config features (baseURL, storageState, viewport, etc.).
 */

import * as path from "path";
import * as fs from "fs/promises";
import { pathToFileURL } from "url";
import * as os from "os";
import { parse as yamlParse } from "yaml";
import type { Page } from "playwright";
import { expect } from "@playwright/test";
import type { ActionEntity, ExecCodeResponse, ActionGenerationResponse } from "shiplight-types";
import { type WebAgent, ActionHelper, ActionHandler, AgentStepEventTypes } from "sdk-core";
import type { VariableStore } from "shiplight-types";
import type { SandboxService, AgentStepEventCallback, DebugInfo, RunStepResult } from "./types.js";
import type { TestContext } from "../../fixture.js";

export function getMaskedContext(variableStore: VariableStore | undefined): Record<string, unknown> | undefined {
  if (!variableStore) return undefined;
  const all = variableStore.getAll();
  const sensitiveKeys = variableStore.getAllSensitiveKeys();
  if (sensitiveKeys.size === 0) return all as Record<string, unknown>;
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    masked[key] = sensitiveKeys.has(key) ? "••••••••" : value;
  }
  return masked;
}

/**
 * Resolve a `call:` file reference to an absolute path, mirroring the
 * transpiler (`src/yaml-transpiler/actions.ts`):
 *   - bare paths (e.g. "helpers/auth.ts") resolve relative to the project root
 *     (falling back to the current working directory when it is unknown);
 *   - explicitly-relative paths ("./x", "../x") resolve relative to the YAML
 *     file's directory, matching how the transpiler emits them into the
 *     co-located spec.
 * Absolute paths are rejected by the caller before reaching here.
 */
export function resolveCallReferencePath(
  filePath: string,
  yamlDir: string,
  projectRoot: string | undefined,
): string {
  const base = filePath.startsWith(".") ? yamlDir : (projectRoot ?? process.cwd());
  return path.resolve(base, filePath);
}

/**
 * A sandbox backed by a Playwright-provided page and agent.
 * Since Playwright handles browser lifecycle, auth, baseURL, etc.,
 * this service just delegates to the agent for test operations.
 */
export class PlaywrightSandboxService implements SandboxService {
  private page: Page;
  private agent: WebAgent;
  private testContext?: TestContext;
  private testDir: string = process.cwd();
  private projectRoot?: string;
  private sessionId = "pw-" + Math.random().toString(36).slice(2, 10);
  private abortController: AbortController | null = null;
  private recorderStopResolver?: () => void;
  private recorderEnabled = false;
  private screenshotHistory: Array<{ stepId: string; path: string }> = [];
  private yamlFilePath?: string;
  private artifactsDir?: string;

  constructor(page: Page, agent: WebAgent, fixturesDir?: string, projectRoot?: string, testContext?: TestContext) {
    this.page = page;
    this.agent = agent;
    this.testContext = testContext;
    this.projectRoot = projectRoot;
    if (fixturesDir) {
      (this.agent as any)._getContext().testDataDir = fixturesDir;
    }
  }

  private cdpEndpoint: string | null = null;

  setCdpEndpoint(url: string): void {
    this.cdpEndpoint = url;
  }

  getCdpEndpoint(): string | null {
    if (this.cdpEndpoint) return this.cdpEndpoint;
    const browser = this.page.context().browser();
    if (!browser) return null;
    // wsEndpoint() is available on browsers launched via chromium.launch() but
    // not on Browser instances from Playwright's test runner.
    const ws = (browser as any).wsEndpoint?.();
    return typeof ws === "string" ? ws : null;
  }

  async createSession(config?: {
    startingUrl?: string;
    testFilePath?: string;
  }): Promise<{ sessionId: string }> {
    if (config?.testFilePath) {
      this.testDir = path.dirname(config.testFilePath);
      this.yamlFilePath = config.testFilePath;
      const root = this.projectRoot ?? this.testDir;
      const yamlBaseName = path.basename(config.testFilePath, ".test.yaml");
      this.artifactsDir = path.join(root, ".shiplight", "artifacts", yamlBaseName);

      // Apply the first parameter set's values as runtime variables so that
      // {{paramName}} references resolve correctly during interactive debugging.
      if (config.testFilePath.endsWith(".test.yaml")) {
        try {
          const yamlContent = await fs.readFile(config.testFilePath, "utf-8");
          const doc = yamlParse(yamlContent);
          const params: Array<{ name?: string; values?: Record<string, string> }> | undefined = doc?.parameters;
          if (params && params.length > 0 && params[0].values) {
            for (const [key, value] of Object.entries(params[0].values)) {
              this.agent.agentServices.saveVariable(key, value);
            }
          }
        } catch {
          // Non-critical — if parsing fails, variables just won't be pre-set
        }
      }
    }
    return { sessionId: this.sessionId };
  }

  async executeLogin(_sessionId: string): Promise<{ status: string; details?: string }> {
    // Playwright handles auth via storageState / setup projects
    return { status: "success", details: "Handled by Playwright" };
  }

  async ensureBrowser(
    _sessionId: string
  ): Promise<{ page: Page; liveviewUrl: string }> {
    return { page: this.page, liveviewUrl: "" };
  }

  async startDebug(_sessionId: string): Promise<DebugInfo> {
    return {
      sessionId: this.sessionId,
      liveviewUrl: "",
      browserWsUrl: "",
    };
  }

  async executeAction(
    _sessionId: string,
    actionEntity: ActionEntity,
    stepId: string,
    options?: {
      withSelfHealing?: boolean;
      stmtUid?: string;
      executionHistory?: Array<[string, string]>;
    }
  ): Promise<any> {
    const actionData = actionEntity.action_data || actionEntity.action;
    if (!actionData) {
      throw new Error("ActionEntity has no action_data");
    }

    console.error(`[pw-sandbox] executeAction stepId=${JSON.stringify(stepId)} action_name=${JSON.stringify(actionData.action_name)} locator=${JSON.stringify(actionEntity.locator)} kwargs=${JSON.stringify(actionData.kwargs)}`);

    // Resolve the current active page — TabManager updates this when switch_tab
    // runs or a new tab opens (window.open / target="_blank" / go_to_url new_tab).
    // Using this.page directly would keep targeting the original tab after any switch.
    const activePage = this.agent.agentServices.validatePage(this.page);

    // Skip the prelude js_code action — in Playwright mode, the page already
    // has baseURL and storageState from the config. The prelude navigates to
    // PLAYWRIGHT_STARTING_URL which isn't set in this context.
    if (actionData.action_name === "js_code" && stepId === "prelude") {
      // Navigate to the base URL if the page is still on about:blank
      if (activePage.url() === "about:blank") {
        const url = actionData.kwargs?.code?.match(/PLAYWRIGHT_STARTING_URL \|\| '([^']*)'/)?.[1];
        if (url) {
          await activePage.goto(url, { waitUntil: "domcontentloaded" });
        }
      }
      return { status: "success" };
    }

    // js_code + isSync: expression evaluation for IF/WHILE conditions.
    // Evaluate the expression and return the result directly instead of
    // going through agent.step() which discards the return value.
    if (actionData.action_name === "js_code" && actionData.kwargs?.isSync === true) {
      return this.executeCode(_sessionId, actionData.kwargs.code || "");
    }

    // function action with path#export reference: resolve via dynamic import.
    // The transpiler handles this at compile time with static imports;
    // the interpreter resolves it at runtime here.
    if (actionData.action_name === "function" && actionData.kwargs?.functionName?.includes("#")) {
      return this.executeFunction(actionData.kwargs, actionData.args);
    }

    const stmtUid = options?.stmtUid;

    // Clear any previous healed entity for this statement before executing
    if (stmtUid) {
      this.agent.getNewActionEntities().delete(stmtUid);
    }

    let result: any;

    if (ActionHelper.isAiAction(actionEntity)) {
      // Mirror sandbox behavior: transpile to code and execute in-process.
      // ActionHandler.transpile() emits calls like agent.assert(page, stmt, stepId),
      // agent.run(page, stmt, stepId), etc. — so stepId is threaded through and
      // step tracking fires, matching what the v1 sandbox did via its VM executor.
      const handler = new ActionHandler();
      const codeLines = handler.transpile(actionEntity, stepId, stmtUid);
      const code = codeLines.join('\n');
      const fn = new Function('page', 'agent', `return (async () => { ${code} })();`);
      try {
        await fn(activePage, this.agent);
        const agentCtx = (this.agent as any)._getContext();
        result = { actionGenerationDebugInfo: agentCtx?.lastActionDebugInfo };
      } catch (error: any) {
        // Return an error response rather than throwing so the debug info
        // stored on the agent context (e.g. from a failed assertion) is still
        // surfaced to the frontend.
        const agentCtx = (this.agent as any)._getContext();
        return {
          status: 'error' as const,
          details: this.agent.getAgentNote() || error.message,
          actionGenerationDebugInfo: agentCtx?.lastActionDebugInfo,
          testContext: getMaskedContext(agentCtx?.variableStore),
        };
      }
    } else {
      const description = actionEntity.action_description || actionData.action_name;
      const canSelfHeal = !!options?.withSelfHealing && ActionHelper.canSelfHeal(actionEntity);

      result = await this.agent.step(
        activePage,
        async () => {
          await this.agent.execAction(actionData.action_name, activePage, actionEntity);
        },
        description,
        stepId,
        stmtUid,
        canSelfHeal,
      );
    }

    // Include agentNote as details (e.g. AI verify explanation)
    const agentNote = this.agent.getAgentNote();
    const agentCtx = (this.agent as any)._getContext();
    const variableStore = agentCtx?.variableStore;
    const response: ExecCodeResponse = {
      ...result,
      status: "success" as const,
      testContext: getMaskedContext(variableStore),
    };
    if (agentNote) {
      response.details = agentNote;
    }

    if (stmtUid) {
      const newEntity = this.agent.getNewActionEntities().get(stmtUid);
      if (newEntity) {
        // Strip element_index from kwargs — it's a runtime DOM reference, not stable for replay
        const { element_index: _ei, ...stableKwargs } = newEntity.action_data?.kwargs || {};
        response.newActionEntity = {
          ...newEntity,
          action_data: newEntity.action_data ? {
            ...newEntity.action_data,
            kwargs: stableKwargs,
          } : newEntity.action_data,
        };
      }
    }
    return response;
  }

  async runStep(
    _sessionId: string,
    statement: string,
    stepId: string,
    onEvent: AgentStepEventCallback,
    executionHistory?: Array<[string, string]>
  ): Promise<RunStepResult> {
    const collectedActions: ActionEntity[] = [];

    this.abortController = new AbortController();

    try {
      // Use agent.run for AI-driven step execution (supports onAction callback)
      const result = await this.agent.run(
        this.agent.agentServices.validatePage(this.page),
        statement,
        stepId,
        {
          onAction: (actionEntity: ActionEntity) => {
            collectedActions.push(actionEntity);
            onEvent({
              type: AgentStepEventTypes.Action,
              data: { action_entity: actionEntity },
            });
          },
        },
      );

      const variableStore = (this.agent as any)._getContext()?.variableStore;
      onEvent({
        type: AgentStepEventTypes.Completion,
        data: {
          success: result?.success ?? true,
          details: result?.details,
          testContext: getMaskedContext(variableStore),
        },
      });

      return {
        success: result?.success ?? true,
        actions: collectedActions,
        details: result?.details,
      };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Execute a function action with a path#export reference.
   * Dynamically imports the file and calls the named export,
   * resolving args the same way the transpiler does (page, agent, literals, variables).
   */
  private async executeFunction(
    kwargs: Record<string, unknown>,
    legacyActionArgs?: unknown[],
  ): Promise<ExecCodeResponse> {
    const ref = kwargs.functionName as string;
    const [filePath, exportName] = ref.split("#");

    try {
      // Mirror the transpiler (see resolveCallReferencePath): bare paths resolve
      // relative to the project root; explicitly-relative paths resolve relative
      // to the YAML file's directory. Absolute paths are rejected outright.
      if (path.isAbsolute(filePath)) {
        return { status: "error", details: `Absolute paths are not supported in call: references. Use a path relative to the project root (got: "${filePath}")` };
      }
      const resolvedPath = resolveCallReferencePath(filePath, this.testDir, this.projectRoot);
      // Node.js ESM requires file:// URLs for absolute paths on Windows —
      // a bare "C:\..." is parsed as a URL with scheme "c:" and rejected.
      const mod = await import(pathToFileURL(resolvedPath).href);
      const fn = mod[exportName];
      if (typeof fn !== "function") {
        return {
          status: "error",
          details: `Export "${exportName}" not found or not a function in ${filePath}`,
        };
      }

      // Extract the actual parameter names from the function source so we can
      // inject system params (page, agent, …) regardless of what was stored in
      // the YAML (old actions may be missing system params entirely, or store
      // them with TypeScript type annotations like "page: Page").
      const fnSource = fn.toString();
      const sigMatch = fnSource.match(/\(([^)]*)\)/);
      const fnParamNames: string[] = sigMatch && sigMatch[1].trim()
        ? sigMatch[1].split(",").map((p: string) => p.split(":")[0].trim().replace(/\?$/, ""))
        : [];

      // New `call:` syntax is positional and values retain their YAML types.
      // Legacy actions use named parameter arrays, sometimes with values in
      // action_data.args rather than kwargs.parameterValues.
      const positionalArgs: unknown[] | undefined = Array.isArray(kwargs.args)
        ? kwargs.args
        : undefined;

      // Build a lookup from bare param name → stored value (handles "url: string" → "url").
      const storedNames: string[] = Array.isArray(kwargs.parameterNames)
        ? (kwargs.parameterNames as unknown[]).map(String)
        : [];
      const storedValues: unknown[] = Array.isArray(kwargs.parameterValues)
        ? kwargs.parameterValues
        : Array.isArray(legacyActionArgs)
          ? legacyActionArgs
          : [];
      const storedByName: Record<string, unknown> = {};
      storedNames.forEach((raw, i) => {
        const bare = raw.split(":")[0].trim();
        storedByName[bare] = storedValues[i] ?? "";
      });

      const activePage = this.agent.agentServices.validatePage(this.page);
      const resolveArgument = (value: unknown): unknown => {
        if (value === "page") return activePage;
        if (value === "agent") return this.agent;
        if (value === "request") return this.page.context().request;
        if (value === "testContext") return this.testContext;
        if (typeof value === "string" && value.startsWith("$")) {
          return this.agent.agentServices.readVariable(value.substring(1));
        }
        return value;
      };

      // Build resolved args in function-signature order so system params land
      // in the right position even if legacy data omitted them.
      const resolvedArgs = fnParamNames.map((name) => {
        if (name === "page") return activePage;
        if (name === "agent") return this.agent;
        if (name === "request") return this.page.context().request;
        if (name === "testContext") return this.testContext;
        const value = storedByName[name] ?? "";
        return resolveArgument(value);
      });

      const argsToUse = positionalArgs && positionalArgs.length > 0
        ? positionalArgs.map(resolveArgument)
        : fnParamNames.length > 0
          ? resolvedArgs
          : storedValues.map(resolveArgument);

      await fn(...argsToUse);
      return { status: "success" };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: "error",
        details: `Function call failed: ${ref} — ${msg}`,
      };
    }
  }

  async executeCode(
    _sessionId: string,
    code: string,
  ): Promise<{ status: string; result?: any; details?: string }> {
    try {
      // Always use async IIFE so `await` expressions work in conditions
      const fn = new Function('page', 'expect', 'agent', `return (async () => { return (${code}); })();`);
      const result = await fn(this.agent.agentServices.validatePage(this.page), expect, this.agent);
      return { status: "success", result };
    } catch (error: unknown) {
      return { status: "error", details: error instanceof Error ? error.message : String(error) };
    }
  }

  stopRunStep(_sessionId: string): boolean {
    if (this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  async evaluate(
    _sessionId: string,
    statement: string,
    _executionHistory?: Array<[string, string]>
  ): Promise<Record<string, any>> {
    try {
      const success = await this.agent.evaluate(this.agent.agentServices.validatePage(this.page), statement);
      return {
        status: "success",
        conclusion: success ? "true" : "false",
        explanation: success ? `Condition met: ${statement}` : `Condition not met: ${statement}`,
      };
    } catch (error: any) {
      return {
        status: "error",
        conclusion: "unknown",
        explanation: error.message,
      };
    }
  }

  async generateAction(
    _sessionId: string,
    statement: string,
    stepId: string,
    options?: {
      executionHistory?: Array<[string, string]>;
      usePureVision?: boolean;
      includeDebugInfo?: boolean;
    }
  ): Promise<ActionGenerationResponse> {
    const result = await this.agent.generate(
      this.agent.agentServices.validatePage(this.page),
      statement,
      stepId,
      options?.usePureVision
    );

    const action = result.actions?.[0];
    if (!action) {
      return {
        status: "error",
        explanation: result.details || "Failed to generate action",
        debugInfo: result.debugInfo,
      };
    }

    return {
      status: "success",
      action,
      explanation: result.details,
      debugInfo: result.debugInfo,
      completes_instruction: result.success,
    };
  }

  async takeScreenshot(_sessionId: string, stepId?: string): Promise<{ screenshot: string; screenshotPath?: string }> {
    const screenshot = await this.agent.agentServices.validatePage(this.page).screenshot();
    const id = stepId ?? `debug-${this.screenshotHistory.length}`;

    // Write directly to .shiplight/artifacts/<testcase>/<stepId>/screenshot.png
    let screenshotPath: string;
    if (this.artifactsDir) {
      const stepDir = path.join(this.artifactsDir, id.replace(/\./g, "-"));
      await fs.mkdir(stepDir, { recursive: true });
      screenshotPath = path.join(stepDir, "screenshot.png");
    } else {
      screenshotPath = path.join(os.tmpdir(), `shiplight-screenshot-${Date.now()}.png`);
    }
    await fs.writeFile(screenshotPath, screenshot);
    this.screenshotHistory.push({ stepId: id, path: screenshotPath });

    return {
      screenshot: screenshot.toString("base64"),
      screenshotPath,
    };
  }

  getSessionArtifacts(_sessionId: string): {
    outputDir?: string;
    screenshots: Array<{ stepId: string; path: string }>;
  } {
    return {
      outputDir: this.artifactsDir,
      screenshots: [...this.screenshotHistory],
    };
  }

  // ========================= Recorder =========================

  async startRecorder(
    _sessionId: string,
    onEvent: (event: any) => void,
    testIdAttributeName?: string,
  ): Promise<void> {
    const context = this.page.context();

    const recorderPromise = new Promise<void>((resolve) => {
      this.recorderStopResolver = resolve;
    });

    const recorderEventSink = {
      actionAdded: (_page: Page, actionInContext: any, code: string) => {
        onEvent({
          type: "actionAdded",
          action: actionInContext.action,
          code,
          timestamp: Date.now(),
        });
      },
      actionUpdated: (_page: Page, actionInContext: any, code: string) => {
        onEvent({
          type: "actionUpdated",
          action: actionInContext.action,
          code,
          timestamp: Date.now(),
        });
      },
      signalAdded: (_page: Page, signal: any) => {
        onEvent({
          type: "signal",
          signal: signal.signal,
          timestamp: Date.now(),
        });
      },
    };

    if (this.recorderEnabled) {
      (context as any)._onRecorderEventSink = recorderEventSink;
      await this.page.evaluate(() => (window as any).__pw_recorderSetMode?.("recording")).catch(() => {});
    } else {
      // Intercept shadow DOM creation to inject CSS that hides assert buttons
      // and enlarges the record button. Must be registered BEFORE _enableRecorder
      // so it catches the <x-pw-glass> shadow root creation.
      // Hide the entire recorder overlay — the live view toolbar in the SPA handles recording UX
      const recorderCSS = "x-pw-overlay { display: none !important; }";
      await context.addInitScript(`(() => {
        const orig = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(init) {
          const shadow = orig.call(this, init);
          if (this.tagName && this.tagName.toLowerCase() === 'x-pw-glass') {
            const s = document.createElement('style');
            s.textContent = '${recorderCSS}';
            shadow.appendChild(s);
          }
          return shadow;
        };
      })()`);
      // Run the intercept on already-open pages so it's ready before the overlay is injected
      for (const p of context.pages()) {
        await p.evaluate(`(() => {
          const orig = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function(init) {
            const shadow = orig.call(this, init);
            if (this.tagName && this.tagName.toLowerCase() === 'x-pw-glass') {
              const s = document.createElement('style');
              s.textContent = '${recorderCSS}';
              shadow.appendChild(s);
            }
            return shadow;
          };
        })()`).catch(() => {});
      }

      await (context as any)._enableRecorder(
        {
          mode: "recording",
          recorderMode: "api",
          handleSIGINT: false,
          omitCallTracking: true,
          testIdAttributeName: testIdAttributeName || "data-testid",
        },
        recorderEventSink,
      );
      await this.page.evaluate(() => (window as any).__pw_recorderSetMode?.("recording")).catch(() => {});
    }

    this.recorderEnabled = true;
    await recorderPromise;
  }

  async stopRecorder(_sessionId: string): Promise<void> {
    (this.page.context() as any)._onRecorderEventSink = undefined;
    await this.page.evaluate(() => (window as any).__pw_recorderSetMode?.("standby")).catch(() => {});
    if (this.recorderStopResolver) {
      this.recorderStopResolver();
      this.recorderStopResolver = undefined;
    }
  }

  async terminateSession(_sessionId: string): Promise<void> {
    // Don't close the page — Playwright owns it
    console.error("[debugger] Playwright session released");
  }

  async cleanupAll(): Promise<void> {
    // No-op — Playwright handles cleanup
  }
}
