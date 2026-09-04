/**
 * SessionManager
 *
 * Unified browser session management for both MCP server and copilot3.
 * Supports two modes:
 * - Create browser: Creates and manages browser lifecycle
 * - External page: Accepts an externally-provided page (browser lifecycle managed externally)
 *
 * Uses sdk-core's BrowserManager, WebAgent, and related services.
 *
 * Requires peer dependencies: sdk-core, playwright
 */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import crypto from "crypto";
import { connectBrowser } from "./relayBrowserCache.js";

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Generate a session ID in format: YYYY-MM-DD-HH-MM-SS-{4 char random id}
 */
function generateSessionId(): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/T/, '-')
    .replace(/:/g, '-')
    .replace(/\..+/, '');
  const randomSuffix = crypto.randomBytes(2).toString('hex');
  return `${timestamp}-${randomSuffix}`;
}
import type { Page, BrowserContext } from "playwright";
import {
  BrowserManager,
  Agent as WebAgent,
  createAgentContext,
  DomService,
  getActionEntityLocatorInfo,
  logger,
  type BrowserInstance,
  type WebAgentContext,
  type DOMState,
} from "sdk-core";
import { VariableStore, type LoginConfig, type LoginType } from "shiplight-types";
import { isPerfProfiling } from "../utils/perfProfiling.js";
import type {
  CreateSessionConfig,
  CreateSessionWithPageConfig,
  WebAgentConfig,
  TestAccountInfo,
  SessionInfo,
  ConsoleLog,
  NetworkLog,
  LogOptions,
  TaskOptions,
  TaskResult,
  PageInfo,
  ExtendedPageInfo,
  InspectPageResult,
  GetDomResult,
  GetLocatorResult,
  ActOptions,
  ActResult,
  ActionResultItem,
  ActionLogEntry,
  PageCacheMetadata,
  TestEvidenceManifest,
  LocatorEntry,
} from "./sessionTypes.js";

// Re-export WebAgent type for external use
export { WebAgent };

/**
 * Internal session state
 */
export interface SessionData {
  sessionId: string;

  // Session type
  sessionType: 'playwright' | 'relay';

  // Browser (optional - null if external page provided or relay session)
  browserInstance?: BrowserInstance;

  // Core (always present)
  page: Page;
  webAgent: WebAgent;
  agentContext: WebAgentContext;
  variableStore: VariableStore;

  // Logs
  consoleLogs: ConsoleLog[];
  networkLogs: NetworkLog[];

  // DOM state (for act tool)
  domState?: DOMState;

  // Action log (for test evidence)
  actionLog: ActionLogEntry[];

  // Abort handling
  abortController: AbortController;

  // Evidence recording (video + trace) for report generation
  recordEvidence?: boolean;
  tracePath?: string;
  // Action limits (optional)
  maxActions?: number;
  totalActions: number;

  // Relay connection (for relay sessions)
  relayConnection?: import('./sessionTypes.js').RelayConnection;

  // Timestamps
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface SessionManagerOptions {
  runDir?: string;
  terminationTimeout?: number | null;
  onBeforeAction?: (
    page: Page,
    actionName: string,
    actionParams: Record<string, any>,
    domState?: DOMState | null,
    isRecording?: boolean,
  ) => Promise<void>;
}

/**
 * SessionManager - unified browser session management
 *
 * Usage:
 * ```ts
 * import { BrowserManager, WebAgent, createAgentContext } from 'sdk-core';
 *
 * const sessionManager = new SessionManager({
 *   runDir: './.shiplight/inspect',
 * });
 *
 * // Mode 1: Create browser (MCP server use case)
 * const { sessionId } = await sessionManager.createSession({
 *   startingUrl: "https://example.com",
 *   browserOptions: { headless: true }
 * });
 *
 * // Mode 2: Accept external page (copilot3 use case)
 * const { sessionId } = await sessionManager.createSessionWithPage(page, {
 *   maxActions: 40
 * });
 * ```
 */
export class SessionManager {
  private sessions: Map<string, SessionData> = new Map();
  private browserManager: BrowserManager | null = null;
  private baseDebugPort: number = 9222;
  private runDir: string;
  private onBeforeAction?: SessionManagerOptions['onBeforeAction'];

  constructor(options: SessionManagerOptions = {}) {
    this.runDir = options.runDir || path.join(os.homedir(), ".shiplight/inspect");
    this.onBeforeAction = options.onBeforeAction;
    fs.mkdirSync(this.runDir, { recursive: true });
  }

  private async findAvailablePort(): Promise<number> {
    for (let port = this.baseDebugPort; port < this.baseDebugPort + 100; port++) {
      if (await isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available debug ports found in range ${this.baseDebugPort}–${this.baseDebugPort + 99}`);
  }

  private ensureBrowserManager(): void {
    if (!this.browserManager) {
      this.browserManager = new BrowserManager({ testDir: this.runDir });
    }
  }

  /**
   * Create a session that creates and manages its own browser.
   * Use this when you need a new browser instance.
   */
  async createSession(config: CreateSessionConfig): Promise<{ sessionId: string; url?: string }> {
    this.ensureBrowserManager();

    const sessionId = generateSessionId();
    const debugPort = await this.findAvailablePort();

    const browserOptions = config.browserOptions || {};

    let browserInstance: BrowserInstance | undefined;
    let page: Page | undefined;

    // Validate extension path exists before launching
    if (browserOptions.pathToExtension && !fs.existsSync(browserOptions.pathToExtension)) {
      throw new Error(`Extension directory not found: ${browserOptions.pathToExtension}`);
    }

    try {
      // Launch browser
      browserInstance = await this.browserManager!.launchBrowser({
        debugPort,
        viewport: browserOptions.viewport,
        isMobile: browserOptions.isMobile,
        hasTouch: browserOptions.hasTouch,
        userAgent: browserOptions.userAgent,
        colorScheme: browserOptions.colorScheme,
        timezoneId: browserOptions.timezoneId,
        geolocation: browserOptions.geolocation,
        headless: browserOptions.headless,
        disableSecurity: browserOptions.disableSecurity,
        recordVideo: browserOptions.recordEvidence,
        locale: browserOptions.locale,
        proxy: browserOptions.proxy,
        localStorageStatePath: browserOptions.storageStatePath,
        extensionPath: browserOptions.pathToExtension,
        userDataDir: browserOptions.userDataDir,
      });

      // Persistent contexts (extensions) already have a page; regular contexts need one created.
      // Filter out chrome-extension:// pages that extensions may open on startup.
      const existingPages = browserInstance.context.pages();
      page = existingPages.find(p => !p.url().startsWith('chrome-extension://'))
        ?? existingPages[0]
        ?? await browserInstance.context.newPage();

      // Navigate to starting URL if provided (before session setup)
      if (config.startingUrl && config.startingUrl !== "about:blank") {
        await page.goto(config.startingUrl, { waitUntil: "domcontentloaded" });
      }

      // Create session data with common initialization
      const sessionData = await this.createSessionData(
        sessionId,
        page,
        browserInstance.context,
        config.webAgentConfig,
        config.maxActions,
        browserInstance
      );

      sessionData.recordEvidence = browserOptions.recordEvidence ?? false;
      if (browserOptions.recordEvidence) {
        await browserInstance.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      }
      this.sessions.set(sessionId, sessionData);

      return { sessionId, url: page.url() };
    } catch (error) {
      // Cleanup on failure
      if (page) {
        await page.close().catch(() => {});
      }
      if (browserInstance && this.browserManager) {
        await this.browserManager.terminateBrowser(browserInstance).catch(() => {});
      }
      logger.info("[SessionManager.createSession] Failed:", error);
      throw error;
    }
  }

  /**
   * Create a session with an externally-provided page.
   * Use this when the browser lifecycle is managed externally (e.g., copilot3).
   */
  async createSessionWithPage(
    page: Page,
    config: CreateSessionWithPageConfig = {}
  ): Promise<{ sessionId: string }> {
    const sessionId = this.generateSessionId();

    // Use custom runDir if provided, otherwise use default
    const sessionRunDir = config.runDir || this.runDir;
    if (sessionRunDir !== this.runDir) {
      fs.mkdirSync(sessionRunDir, { recursive: true });
    }

    // Create session data (no browser instance - page is external)
    const sessionData = await this.createSessionData(
      sessionId,
      page,
      page.context(),
      config.webAgentConfig,
      config.maxActions,
      undefined // No browser instance
    );

    this.sessions.set(sessionId, sessionData);

    return { sessionId };
  }

  /**
   * Create a single relay session connected to the extension relay server.
   * All registered tabs appear as Pages within one BrowserContext.
   * TabManager auto-tracks pages via context.on('page') events.
   */
  async createRelaySession(
    cdpEndpointUrl: string
  ): Promise<{ sessionId: string }> {
    const sessionId = this.generateSessionId();

    try {
      const browser = await connectBrowser(cdpEndpointUrl);
      const context = browser.contexts()[0]; // single context from connectOverCDP

      if (!context) {
        throw new Error('No browser context available after CDP connection');
      }

      const pages = context.pages();
      const page = pages[0] || null; // may be null if no tabs registered yet

      // Create variable store and agent context
      const variableStore = new VariableStore();
      const agentContext = createAgentContext({
        variableStore,
        executionHistory: [],
        testDataDir: path.join(this.runDir, "files"),
      });

      // Create WebAgent and set up page tracking on context
      const webAgent = new WebAgent(agentContext);
      webAgent.agentServices.setupPageTracking(context);

      const sessionData: SessionData = {
        sessionId,
        sessionType: 'relay',
        page: page as any, // may be null — getPageForSession handles this via TabManager
        webAgent,
        agentContext,
        variableStore,
        consoleLogs: [],
        networkLogs: [],
        actionLog: [],
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        abortController: new AbortController(),
        totalActions: 0,
        relayConnection: {
          cdpUrl: cdpEndpointUrl,
          connectedAt: new Date(),
        },
      };

      this.sessions.set(sessionId, sessionData);

      return { sessionId };
    } catch (error) {
      logger.error(`[createRelaySession] FAILED:`, error);
      throw error;
    }
  }

  /**
   * Generate a human-readable session ID with timestamp and short random suffix
   * Format: 2026-01-01_21-00-35_a1b2
   */
  private generateSessionId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10); // 2026-01-01
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "-"); // 21-00-35
    const suffix = Math.random().toString(36).substring(2, 6); // a1b2
    return `${date}_${time}_${suffix}`;
  }

  /**
   * Common session data initialization
   */
  private async createSessionData(
    sessionId: string,
    page: Page,
    context: BrowserContext,
    webAgentConfig: WebAgentConfig | undefined,
    maxActions: number | undefined,
    browserInstance?: BrowserInstance
  ): Promise<SessionData> {
    // Set up console log capture
    const consoleLogs: ConsoleLog[] = [];
    page.on("console", (msg) => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
    });

    // Set up network log capture
    const networkLogs: NetworkLog[] = [];
    page.on("response", (response) => {
      networkLogs.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        timestamp: Date.now(),
      });
    });

    // Create variable store and agent context
    // Use provided variableStore from webAgentConfig if available, otherwise create a new empty one
    const variableStore = webAgentConfig?.variableStore ?? new VariableStore();
    const agentContext = createAgentContext({
      model: webAgentConfig?.model,
      variableStore,
      executionHistory: [],
      testDataDir: webAgentConfig?.testDataDir || path.join(this.runDir, "files"),
      downloadDir: webAgentConfig?.downloadDir,
      organizationId: webAgentConfig?.organizationId,
      organizationSettings: webAgentConfig?.organizationSettings,
    });

    // Create WebAgent instance
    const webAgent = new WebAgent(agentContext);

    // Set up page tracking on browser context
    webAgent.agentServices.setupPageTracking(context);

    // Set up test data downloader if provided
    if (webAgentConfig?.testDataDownloader) {
      webAgent.agentServices.setTestDataDownloader(
        webAgentConfig.testDataDownloader,
        webAgentConfig.testDataFileNames
      );
    }

    // Set up knowledge retriever if provided
    if (webAgentConfig?.knowledgeRetriever) {
      webAgent.agentServices.setKnowledgeRetriever(webAgentConfig.knowledgeRetriever);
    }

    return {
      sessionId,
      sessionType: 'playwright',
      browserInstance,
      page,
      webAgent,
      agentContext,
      variableStore,
      consoleLogs,
      networkLogs,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      actionLog: [],
      abortController: new AbortController(),
      maxActions,
      totalActions: 0,
    };
  }

  async closeSession(sessionId: string): Promise<{
    videoPath?: string;
    tracePath?: string;
    reportDataPath?: string;
    reportDataSaved?: boolean;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {};
    }

    // Relay sessions are system-managed and cannot be closed by the client
    if (session.sessionType === 'relay') {
      return {};
    }

    // Remove event listeners to prevent memory leaks
    session.page.removeAllListeners("console");
    session.page.removeAllListeners("response");

    // Save the Video reference before closing — page.video() returns null after the page is closed.
    // path() must be called after the context is terminated (video isn't finalized until then).
    let video = null;
    try {
      video = session.recordEvidence && session.browserInstance
        ? session.page.video()
        : null;
    } catch {
      // Ignore errors retrieving video reference; session cleanup must continue
    }

    // Stop trace recording before terminating the browser
    let tracePath: string | undefined;
    if (session.recordEvidence && session.browserInstance) {
      try {
        tracePath = path.join(this.runDir, 'traces', `${sessionId}.zip`);
        fs.mkdirSync(path.dirname(tracePath), { recursive: true });
        await session.browserInstance.context.tracing.stop({ path: tracePath });
        if (!fs.existsSync(tracePath)) {
          logger.warn('[SessionManager.closeSession] Trace file not created at expected path:', tracePath);
          tracePath = undefined;
        }
        session.tracePath = tracePath;
      } catch (e) {
        logger.warn('[SessionManager.closeSession] Failed to stop trace:', e);
        tracePath = undefined;
      }
    }

    // Close browser connection
    if (session.browserInstance && this.browserManager) {
      // Regular sessions: terminate browser via browser manager
      await this.browserManager.terminateBrowser(session.browserInstance);
    }
    // Relay sessions: Do NOTHING (OpenClaw pattern)
    // The Browser stays cached and connected. It auto-disconnects when
    // the CDP WebSocket closes, which triggers the "disconnected" event
    // and clears the cache automatically.
    // For error recovery, use forceDisconnect() from relayBrowserCache

    // Snapshot report data before deleting session so generate_html_report can run post-close.
    // Always write the snapshot (even for non-recording sessions) so that generate_html_report
    // can produce a clear "not started with record_evidence" error rather than the
    // confusing "Session X not found and no saved report data exists" message.
    await this.persistReportSnapshot(sessionId, session, { logPrefix: "[SessionManager.closeSession]" });

    this.sessions.delete(sessionId);

    let videoPath: string | undefined;
    if (video) {
      try {
        videoPath = await video.path() ?? undefined;
      } catch (e) {
        logger.info("[SessionManager.closeSession] Failed to retrieve video path:", e);
      }
    }

    const reportDataPath = path.join(this.runDir, sessionId, "report-data.json");
    const reportDataSaved = fs.existsSync(reportDataPath);

    return {
      ...(videoPath ? { videoPath } : {}),
      ...(tracePath ? { tracePath } : {}),
      ...(reportDataSaved ? { reportDataPath } : {}),
      reportDataSaved,
    };
  }

  async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Force disconnect a relay Browser connection (error recovery)
   * Call this when the Browser connection is corrupted and needs to be recreated
   */
  async forceDisconnectRelay(): Promise<void> {
    const { forceDisconnect } = await import('./relayBrowserCache.js');
    forceDisconnect();
  }

  getSession(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.lastAccessedAt = new Date();
    return {
      sessionId: session.sessionId,
      sessionType: session.sessionType === 'relay' ? 'relay' : 'browser',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      currentUrl: this.getPageForSession(session).url(),
      relayConnection: session.relayConnection,
    };
  }

  /**
   * Get all sessions
   */
  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(session => ({
      sessionId: session.sessionId,
      sessionType: session.sessionType === 'relay' ? 'relay' : 'browser',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      currentUrl: this.getPageForSession(session).url(),
      relayConnection: session.relayConnection,
    }));
  }

  /**
   * Get the internal session data (for advanced use cases)
   */
  getSessionData(sessionId: string): SessionData | null {
    return this.sessions.get(sessionId) || null;
  }

  getDebugPort(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.browserInstance?.debugPort;
  }

  /**
   * Get the current active page for a session.
   * This may differ from the initial page if new tabs were opened.
   */
  getPage(sessionId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return this.getPageForSession(session);
  }

  private getPageForSession(session: SessionData): Page {
    // Use the WebAgent's TabManager to get the current active page
    const currentPage = session.webAgent.agentServices.getCurrentPage();
    if (currentPage && !currentPage.isClosed()) {
      return currentPage;
    }

    // Fallback: validate the initial page
    if (session.page) {
      return session.webAgent.agentServices.validatePage(session.page);
    }

    throw new Error('No pages available in this session. Attach a tab via the Chrome extension first.');
  }

  /**
   * Get the WebAgent instance for a session
   */
  getWebAgent(sessionId: string): WebAgent {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.webAgent;
  }

  /**
   * Get the VariableStore for a session
   */
  getVariableStore(sessionId: string): VariableStore {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.variableStore;
  }

  async getCurrentUrl(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return this.getPageForSession(session).url();
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    await this.getPageForSession(session).goto(url, { waitUntil: "domcontentloaded" });
  }

  async loginWithTestAccount(sessionId: string, testAccount: TestAccountInfo): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (!testAccount.loginConfig || !testAccount.username || !testAccount.password) {
      return false;
    }

    try {
      const page = this.getPageForSession(session);
      const accountType = testAccount.loginConfig.account?.type as LoginType;
      const loginConfig: LoginConfig = {
        site_url: page.url(),
        account: {
          type: accountType,
          username: testAccount.username,
          password: testAccount.password,
          two_factor_auth_config: testAccount.loginConfig.account?.two_factor_auth_config,
        },
        additional_prompt: testAccount.loginConfig.additional_prompt,
        verification_hint: testAccount.loginConfig.verification_hint,
        num_verification_exprs: 0, // MCP sessions don't cache login state, skip validation_exprs generation
      };

      const result = await session.webAgent.loginPage(page, loginConfig);
      return result.success;
    } catch (error) {
      logger.info("Login failed:", error);
      return false;
    }
  }

  async getPageInfo(sessionId: string): Promise<PageInfo> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const page = this.getPageForSession(session);
    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  /**
   * Get session information including relay connection details
   */
  getSessionInfo(sessionId: string): SessionInfo {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Map internal session type to external session type
    const sessionType: 'browser' | 'android' | 'relay' =
      session.sessionType === 'relay' ? 'relay' : 'browser';

    return {
      sessionId: session.sessionId,
      sessionType,
      relayConnection: session.relayConnection,
    };
  }

  /**
   * Get extended page information including scroll position and viewport data
   */
  private async getExtendedPageInfo(page: Page): Promise<ExtendedPageInfo> {
    const [url, title, scrollY, viewportHeight, viewportWidth, totalHeight, totalWidth] = await Promise.all([
      Promise.resolve(page.url()),
      page.title(),
      page.evaluate(() => window.scrollY),
      page.evaluate(() => window.innerHeight),
      page.evaluate(() => window.innerWidth),
      page.evaluate(() => document.documentElement.scrollHeight),
      page.evaluate(() => document.documentElement.scrollWidth),
    ]);

    // Convert to int to handle fractional pixels
    const pixelsAbove = Math.floor(scrollY);
    const pixelsBelow = Math.floor(Math.max(0, totalHeight - (scrollY + viewportHeight)));

    return {
      url,
      title,
      viewportWidth: Math.floor(viewportWidth),
      viewportHeight: Math.floor(viewportHeight),
      pageWidth: Math.floor(totalWidth),
      pageHeight: Math.floor(totalHeight),
      scrollY: Math.floor(scrollY),
      pixelsAbove,
      pixelsBelow,
    };
  }

  async inspectPage(sessionId: string): Promise<InspectPageResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const runDir = path.join(this.runDir, sessionId);
    fs.mkdirSync(runDir, { recursive: true });
    const timestamp = Date.now();

    const page = this.getPageForSession(session);

    // Get DOM with full state (for caching)
    const domService = new DomService();
    const { domState, screenshot } = await domService.getClickableElementsWithScreenshot(page);
    let elementsText = domState.elementTree.clickableElementsToString();

    // Get extended page information
    const pageInfo = await this.getExtendedPageInfo(page);

    // Save SoM screenshot
    const screenshotPath = path.join(runDir, `screenshot-${timestamp}.png`);
    fs.writeFileSync(screenshotPath, screenshot);

    // Cache DOM state in session
    session.domState = domState;

    // Build rich DOM text with context (similar to Python implementation)
    const richDomText = await this.buildRichDomText(elementsText, pageInfo, session);

    // Write DOM text to file
    const domFilePath = path.join(runDir, `dom-${timestamp}.txt`);
    fs.writeFileSync(domFilePath, richDomText);

    return {
      screenshotPath,
      domText: richDomText,
      domFilePath,
      currentUrl: page.url(),
    };
  }

  /**
   * Get DOM tree with interactive elements.
   * When withScreenshot is true (default), also captures a SoM screenshot and saves page cache artifacts.
   */
  async getDom(sessionId: string, withScreenshot = true): Promise<GetDomResult> {
    const perf = isPerfProfiling();
    const t0 = perf ? performance.now() : 0;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const runDir = path.join(this.runDir, sessionId);
    fs.mkdirSync(runDir, { recursive: true });
    const timestamp = Date.now();

    const page = this.getPageForSession(session);

    // Capture clean screenshot (no SoM badges) for page cache artifacts
    let cleanScreenshot: Buffer | undefined;
    const tScreenshot = perf ? performance.now() : 0;
    if (withScreenshot) {
      cleanScreenshot = await page.screenshot({ type: 'png', fullPage: false });
    }
    const screenshotMs = perf ? performance.now() - tScreenshot : 0;

    // Timeout wrapper for DOM extraction — prevents indefinite hangs (e.g., relay CDP issues)
    const DOM_TIMEOUT_MS = 10_000;
    const tDom = perf ? performance.now() : 0;
    const domPromise = (async () => {
      const domService = new DomService();
      if (!withScreenshot) {
        const domState = await domService.getClickableElements(page, {
          highlightElements: false,
        });
        return { domState, screenshot: undefined };
      }
      return await domService.getClickableElementsWithScreenshot(page);
    })();

    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const url = page.url();
        reject(new Error(
          `inspect_page timed out after ${DOM_TIMEOUT_MS / 1000}s. ` +
          `Page: ${url} — The page may be unresponsive or blocking CDP commands. ` +
          `Try navigating to a simpler page or reloading.`
        ));
      }, DOM_TIMEOUT_MS);
    });

    const { domState, screenshot } = await Promise.race([domPromise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    let elementsText = domState.elementTree.clickableElementsToString();
    const domExtractionMs = perf ? performance.now() - tDom : 0;

    // Get extended page information
    const tPageInfo = perf ? performance.now() : 0;
    const pageInfo = await this.getExtendedPageInfo(page);
    const pageInfoMs = perf ? performance.now() - tPageInfo : 0;

    // Cache DOM state in session
    session.domState = domState;

    // Save SoM screenshot
    const tFileWrite = perf ? performance.now() : 0;
    let screenshotPath: string | undefined;
    if (screenshot) {
      screenshotPath = path.join(runDir, `screenshot-${timestamp}.png`);
      fs.writeFileSync(screenshotPath, screenshot);
    }

    // Build rich DOM text with context
    const richDomText = await this.buildRichDomText(elementsText, pageInfo, session);

    // Write DOM text to file
    const domFilePath = path.join(runDir, `dom-${timestamp}.txt`);
    fs.writeFileSync(domFilePath, richDomText);
    const fileWriteMs = perf ? performance.now() - tFileWrite : 0;

    // Capture url and title now (before page may navigate during fire-and-forget)
    const currentUrl = page.url();

    if (withScreenshot) {
      let pageTitle = '';
      try { pageTitle = await page.title(); } catch { /* ignore */ }
      // Fire-and-forget: save page cache artifacts
      this.savePageCacheArtifacts(currentUrl, pageTitle, richDomText, cleanScreenshot!, screenshot!, domState, page).catch(err => {
        logger.warn('[SessionManager] Failed to save page cache artifacts:', err);
      });
    }

    const totalMs = perf ? performance.now() - t0 : 0;
    return {
      domText: richDomText,
      domFilePath,
      screenshotPath,
      currentUrl,
      ...(perf && {
        duration_ms: Math.round(totalMs),
        timing: {
          screenshot_ms: Math.round(screenshotMs),
          dom_extraction_ms: Math.round(domExtractionMs),
          page_info_ms: Math.round(pageInfoMs),
          file_write_ms: Math.round(fileWriteMs),
        },
      }),
    };
  }

  /**
   * Build rich DOM text with page context, similar to Python's _get_browser_state_description
   */
  private async buildRichDomText(elementsText: string, pageInfo: ExtendedPageInfo, session: SessionData): Promise<string> {
    const hasContentAbove = pageInfo.pixelsAbove > 0;
    const hasContentBelow = pageInfo.pixelsBelow > 0;

    // Calculate page statistics
    const pagesAbove = pageInfo.viewportHeight > 0 ? pageInfo.pixelsAbove / pageInfo.viewportHeight : 0;
    const pagesBelow = pageInfo.viewportHeight > 0 ? pageInfo.pixelsBelow / pageInfo.viewportHeight : 0;
    const totalPages = pageInfo.viewportHeight > 0 ? pageInfo.pageHeight / pageInfo.viewportHeight : 0;
    const currentPagePosition = 
      pageInfo.pageHeight > pageInfo.viewportHeight 
        ? pageInfo.scrollY / Math.max(pageInfo.pageHeight - pageInfo.viewportHeight, 1)
        : 0;

    // Page info text
    const pageInfoText = `Page info: ${pageInfo.viewportWidth}x${pageInfo.viewportHeight}px viewport, ${pageInfo.pageWidth}x${pageInfo.pageHeight}px total page size, ${pagesAbove.toFixed(1)} pages above, ${pagesBelow.toFixed(1)} pages below, ${totalPages.toFixed(1)} total pages, at ${Math.round(currentPagePosition * 100)}% of page`;

    // Get tab information
    const context = session.page.context();
    const allPages = context.pages();
    const currentPage = this.getPageForSession(session);
    
    let tabsText = '';
    for (let i = 0; i < allPages.length; i++) {
      const tabPage = allPages[i];
      const tabUrl = tabPage.url();
      const tabTitle = await tabPage.title().catch(() => '');
      const isCurrent = tabPage === currentPage ? ' (current)' : '';
      tabsText += `Tab ${i}: ${tabUrl} - ${tabTitle.slice(0, 30)}${isCurrent}\n`;
    }

    // Add context to elements text
    if (elementsText !== '') {
      if (hasContentAbove) {
        elementsText = `... ${pageInfo.pixelsAbove} pixels above (${pagesAbove.toFixed(1)} pages) ...\n${elementsText}`;
      } else {
        elementsText = `[Start of page]\n${elementsText}`;
      }

      if (hasContentBelow) {
        elementsText = `${elementsText}\n... ${pageInfo.pixelsBelow} pixels below (${pagesBelow.toFixed(1)} pages)...`;
      } else {
        elementsText = `${elementsText}\n[End of page]`;
      }
    } else {
      elementsText = 'empty page';
    }

    // Build final text
    const sections = [];
    
    if (tabsText) {
      sections.push(`Current tab: ${currentPage.url()}`);
      sections.push(`Available tabs:\n${tabsText}`);
    }
    
    sections.push(pageInfoText);
    sections.push(`Interactive elements from top layer of the current page inside the viewport:\n${elementsText}`);

    return sections.join('\n\n');
  }

  async getLocator(sessionId: string, elementIndex: number): Promise<GetLocatorResult> {
    const perf = isPerfProfiling();
    const t0 = perf ? performance.now() : 0;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (!session.domState) {
      throw new Error(`No DOM state cached for session ${sessionId}. Call inspectPage first.`);
    }

    const domElement = session.domState.selectorMap.get(elementIndex);
    if (!domElement) {
      throw new Error(`Element index ${elementIndex} not found in DOM state. Available indices: ${Array.from(session.domState.selectorMap.keys()).join(", ")}`);
    }

    const page = this.getPageForSession(session);

    // Get locator info (locator, xpath, frame_path) using shared utility
    const locatorInfo = await getActionEntityLocatorInfo(page, domElement);

    // Get text content
    const text = domElement.getAllTextTillNextClickableElement(2);

    return {
      element_index: elementIndex,
      locator: locatorInfo.locator || null,
      xpath: locatorInfo.xpath || domElement.xpath,
      frame_path: locatorInfo.frame_path || [],
      tag_name: domElement.tagName,
      text: text.trim(),
      ...(perf && { duration_ms: Math.round(performance.now() - t0) }),
    };
  }

  getConsoleLogs(sessionId: string, options?: LogOptions): ConsoleLog[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    let logs = session.consoleLogs;

    if (options?.sinceTimestamp !== undefined) {
      logs = logs.filter((log) => log.timestamp >= options.sinceTimestamp!);
    }

    if (options?.logTypes && options.logTypes.length > 0) {
      logs = logs.filter((log) => options.logTypes!.includes(log.type));
    }

    return logs;
  }

  getNetworkLogs(sessionId: string, options?: LogOptions): NetworkLog[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    let logs = session.networkLogs;

    if (options?.sinceTimestamp !== undefined) {
      logs = logs.filter((log) => log.timestamp >= options.sinceTimestamp!);
    }

    if (options?.statusFilter) {
      if (options.statusFilter === "errors") {
        logs = logs.filter((log) => log.status && log.status >= 400);
      } else if (options.statusFilter === "success") {
        logs = logs.filter((log) => log.status && log.status >= 200 && log.status < 300);
      }
    }

    return logs;
  }

  clearLogs(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.consoleLogs.length = 0;
    session.networkLogs.length = 0;
  }

  async runTask(sessionId: string, task: string, options?: TaskOptions): Promise<TaskResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Create abort controller
    if (session.abortController.signal.aborted) {
      session.abortController = new AbortController();
    }

    // Create event handler: use provided callback or default to console logging
    const onEvent = options?.onEvent || this.createDefaultEventLogger();

    try {
      const page = this.getPageForSession(session);

      // Use runTask helper directly to get full event streaming
      const sdk = await import("sdk-core");
      const result = await sdk.runTask(
        task,
        page,
        session.webAgent.agentServices,
        onEvent,
        {
          abortSignal: options?.abortSignal || session.abortController.signal,
          maxSteps: options?.maxSteps,
          executionHistory: session.agentContext.executionHistory,
          variables: session.variableStore.getAll?.() || {},
          sensitiveKeys: session.variableStore.getAllSensitiveKeys?.() || [],
        }
      );

      return {
        success: result.status === 'success' && result.completed,
        actions: result.actionEntities || [],
        details: result.explanation || result.error,
        executionHistory: session.agentContext.executionHistory,
      };
    } catch (error) {
      return {
        success: false,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private createDefaultEventLogger() {
    return (event: any) => {
      logger.info(`[run_task event]`, JSON.stringify(event, null, 2));
    };
  }

  async stopTask(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (!session.abortController.signal.aborted) {
      session.abortController.abort();
      return true;
    }
    return false;
  }

  async act(sessionId: string, actions: Record<string, any>[], options?: ActOptions): Promise<ActResult> {
    const perf = isPerfProfiling();
    const t0 = perf ? performance.now() : 0;
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Actions that don't require DOM state (no element indices needed)
    const DOM_FREE_ACTIONS = new Set([
      'switch_tab', 'close_tab', 'go_to_url', 'go_back', 'reload_page',
      'wait', 'wait_for_page_ready', 'wait_for_download_complete', 'scroll_to_text',
    ]);

    const sdk = await import("sdk-core");
    const { toolRegistry, DomService } = sdk;
    const stopOnError = options?.stopOnError ?? true;

    const page = this.getPageForSession(session);
    const results: ActionResultItem[] = [];
    let overallSuccess = true;

    for (const actionInput of actions) {
      const actionName = Object.keys(actionInput)[0];
      const actionParams = actionInput[actionName] || {};

      // Check DOM state for actions that need element indices
      if (!session.domState && !DOM_FREE_ACTIONS.has(actionName)) {
        throw new Error(`No DOM state cached for session ${sessionId}. Call inspect_page first.`);
      }

      // Capture pre-action screenshot and URL so the report shows the state before the action executed
      const preUrl = page.url();
      let preScreenshot: Buffer | undefined;
      try {
        preScreenshot = await page.screenshot({ type: 'png', fullPage: false });
      } catch {
        // Screenshot may fail (e.g. page navigating), that's fine
      }

      const tAction = perf ? performance.now() : 0;
      try {
        const context = {
          page,
          agentServices: session.webAgent.agentServices,
          domService: new DomService(),
          domState: session.domState!,
          actionDescription: actionParams.description,
        };
        await this.onBeforeAction?.(page, actionName, actionParams, session.domState, !!(session.recordEvidence))?.catch(() => {});
        const result = await toolRegistry.execute(actionName, actionParams, context);
        const executeMs = perf ? performance.now() - tAction : 0;

        // Log action with the pre-action screenshot
        const tLog = performance.now();
        const { stepIndex: stepIdx } = await this.logAction(session, sessionId, actionName, actionParams.description || actionName, preUrl, result.success, preScreenshot, result.success ? undefined : result.error);
        const logMs = performance.now() - tLog;

        const executeMsR = Math.round(executeMs);
        const logMsR = Math.round(logMs);
        results.push({
          success: result.success,
          action_entity: result.actionEntity,
          message: result.message,
          error: result.error,
          duration_ms: executeMsR + logMsR,
          timing: { execute_ms: executeMsR, log_ms: logMsR },
          stepIndex: stepIdx,
        });

        if (!result.success) {
          overallSuccess = false;
          if (stopOnError) break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const executeMs = perf ? performance.now() - tAction : 0;

        // Log failed action with the pre-action screenshot
        const tLog = performance.now();
        const { stepIndex: stepIdx } = await this.logAction(session, sessionId, actionName, actionParams.description || actionName, preUrl, false, preScreenshot, errorMessage);
        const logMs = performance.now() - tLog;

        const executeMsR = Math.round(executeMs);
        const logMsR = Math.round(logMs);
        results.push({
          success: false,
          error: errorMessage,
          duration_ms: executeMsR + logMsR,
          timing: { execute_ms: executeMsR, log_ms: logMsR },
          stepIndex: stepIdx,
        });

        overallSuccess = false;
        if (stopOnError) break;
      }
    }

    // Extract DOM after actions (no screenshot) to save a round-trip.
    // Clear domState upfront so a failure/timeout forces the caller to re-invoke inspect_page.
    session.domState = undefined;
    let inspectData: { dom_file_path: string } | undefined;
    if (!session.abortController.signal.aborted) {
      try {
        // If the page isn't fully loaded, give it a brief settle period then recheck
        let ready = await page.evaluate(() => document.readyState) === 'complete';
        if (!ready) {
          await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => {});
          ready = await page.evaluate(() => document.readyState) === 'complete';
        }

        if (ready) {
          const domResult = await this.getDom(sessionId, false);
          inspectData = { dom_file_path: domResult.domFilePath };
        }
      } catch (err) {
        logger.debug('[SessionManager.act] Post-action DOM extraction failed:', err);
      }
    }

    return {
      success: overallSuccess,
      results,
      ...(perf && { duration_ms: Math.round(performance.now() - t0) }),
      ...inspectData,
    };
  }

  updateVariables(sessionId: string, variables: Record<string, any>, sensitiveKeys?: string[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const sensitiveKeySet = new Set(sensitiveKeys || []);

    for (const [key, value] of Object.entries(variables)) {
      const isSensitive = sensitiveKeySet.has(key);
      session.variableStore.set(key, value, isSensitive);
    }
  }

  /**
   * Get all variables for a session
   */
  getVariables(sessionId: string): Record<string, any> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.variableStore.getAll();
  }

  /**
   * Get variable names (keys only) for a session
   */
  getVariableNames(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return Object.keys(session.variableStore.getAll());
  }

  clearExecutionHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.agentContext.executionHistory = [];
  }

  addExecutionHistory(sessionId: string, task: string, feedback: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.agentContext.executionHistory?.push([task, feedback]);
  }

  /**
   * Get execution history for a session
   */
  getExecutionHistory(sessionId: string): Array<[string, string]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.agentContext.executionHistory || [];
  }

  // ===========================================================================
  // Action limit methods (from CopilotContext)
  // ===========================================================================

  /**
   * Get remaining actions available for task execution
   */
  getRemainingActions(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const maxActions = session.maxActions ?? Infinity;
    return Math.max(0, maxActions - session.totalActions);
  }

  /**
   * Add actions to the total counter
   */
  addActions(sessionId: string, count: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.totalActions += count;
  }

  /**
   * Check if max actions has been reached
   */
  isMaxActionsReached(sessionId: string): boolean {
    return this.getRemainingActions(sessionId) <= 0;
  }

  /**
   * Get total number of actions generated so far
   */
  getTotalActions(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.totalActions;
  }

  // ===========================================================================
  // Abort handling methods (from CopilotContext)
  // ===========================================================================

  /**
   * Create a new abort controller for a tool operation.
   * This creates a child controller that will be aborted when the session is aborted.
   */
  createAbortController(sessionId: string): AbortController {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const toolController = new AbortController();

    // Link to session abort - if session aborts, abort this tool too
    if (session.abortController.signal.aborted) {
      toolController.abort();
    } else {
      session.abortController.signal.addEventListener('abort', () => {
        toolController.abort();
      }, { once: true });
    }

    return toolController;
  }

  /**
   * Abort current task for a session
   */
  abortTask(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (!session.abortController.signal.aborted) {
      session.abortController.abort();
      return true;
    }
    return false;
  }

  /**
   * Reset the abort controller to allow new tasks after abort
   */
  resetAbortController(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.abortController = new AbortController();
  }

  /**
   * Check if the session has been aborted
   */
  isAborted(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.abortController.signal.aborted;
  }

  /**
   * Get the abort signal for passing to async operations
   */
  getAbortSignal(sessionId: string): AbortSignal {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.abortController.signal;
  }

  /**
   * Get the abort controller for passing to SDK
   */
  getAbortController(sessionId: string): AbortController {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.abortController;
  }

  // ===========================================================================
  // Artifact methods
  // ===========================================================================

  async getLocalArtifact(filePath: string): Promise<{ data: string; format: "base64" | "text"; size: number }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Artifact not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext);

    if (isImage) {
      const imageBuffer = fs.readFileSync(filePath);
      return {
        data: imageBuffer.toString("base64"),
        format: "base64",
        size: stats.size,
      };
    } else {
      const text = fs.readFileSync(filePath, "utf-8");
      return {
        data: text,
        format: "text",
        size: stats.size,
      };
    }
  }

  /**
   * Save the browser context's storage state (cookies, localStorage, IndexedDB) to a file.
   * The saved file can be loaded into future sessions via storageStatePath.
   */
  async saveStorageState(sessionId: string, filePath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const page = this.getPageForSession(session);
    await page.context().storageState({ path: filePath, indexedDB: true });
  }

  /**
   * Get the run directory for a session
   */
  getSessionDir(sessionId: string): string {
    return path.join(this.runDir, sessionId);
  }

  /**
   * Get the base run directory
   */
  getRunDir(): string {
    return this.runDir;
  }

  // ===========================================================================
  // Exploration Artifacts
  // ===========================================================================

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getActionLog(sessionId: string): ActionLogEntry[] {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.actionLog;
  }


  async saveTestEvidence(sessionId: string, testFilePath: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const testBaseName = path.basename(testFilePath, '.test.yaml');
    const artifactsDir = path.join(path.dirname(testFilePath), `${testBaseName}.artifacts`);
    fs.mkdirSync(artifactsDir, { recursive: true });

    const manifest: TestEvidenceManifest = {
      testFile: path.basename(testFilePath),
      createdAt: new Date().toISOString(),
      sessionId,
      steps: [],
    };

    for (const entry of session.actionLog) {
      const slug = this.slugify(entry.description);
      const stepFile = `step-${String(entry.stepIndex).padStart(3, '0')}-${slug}.png`;

      let copied = false;
      if (entry.screenshotPath && fs.existsSync(entry.screenshotPath)) {
        try {
          fs.copyFileSync(entry.screenshotPath, path.join(artifactsDir, stepFile));
          copied = true;
        } catch {
          logger.warn(`[SessionManager] Failed to copy screenshot for step ${entry.stepIndex}`);
        }
      }

      manifest.steps.push({
        stepIndex: entry.stepIndex,
        description: entry.description,
        actionName: entry.actionName,
        url: entry.url,
        timestamp: entry.timestamp,
        screenshotFile: copied ? stepFile : undefined,
        success: entry.success,
      });
    }

    fs.writeFileSync(
      path.join(artifactsDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    return artifactsDir;
  }

  private async logAction(
    session: SessionData,
    sessionId: string,
    actionName: string,
    description: string,
    url: string,
    success: boolean,
    screenshot?: Buffer,
    error?: string,
  ): Promise<{ stepIndex: number }> {
    const stepIndex = session.actionLog.length + 1;
    const runDir = path.join(this.runDir, sessionId);
    fs.mkdirSync(runDir, { recursive: true });

    let screenshotPath: string | undefined;
    if (screenshot) {
      screenshotPath = path.join(runDir, `step-${String(stepIndex).padStart(3, '0')}.png`);
      fs.writeFileSync(screenshotPath, screenshot);
    }

    session.actionLog.push({
      stepIndex,
      timestamp: Date.now(),
      url,
      description,
      actionName,
      screenshotPath,
      success,
      ...(error ? { error } : {}),
    });

    // Best-effort persistence: ensure report-data.json is always current in case close_session
    // crashes or the process is terminated mid-run.
    void this.persistReportSnapshot(sessionId, session, { logPrefix: "[SessionManager.logAction]" });

    return { stepIndex };
  }

  private async persistReportSnapshot(
    sessionId: string,
    session: SessionData,
    opts?: { logPrefix?: string },
  ): Promise<void> {
    const logPrefix = opts?.logPrefix ?? "[SessionManager.persistReportSnapshot]";
    try {
      const reportData = {
        recordEvidence: session.recordEvidence ?? false,
        tracePath: session.tracePath,
        createdAt: session.createdAt.toISOString(),
        actionLog: session.actionLog,
        consoleLogs: session.consoleLogs,
        networkLogs: session.networkLogs,
      };

      const runDir = path.join(this.runDir, sessionId);
      await fs.promises.mkdir(runDir, { recursive: true });

      // Atomic-ish write to avoid partially-written JSON if the process exits mid-write.
      const filePath = path.join(runDir, "report-data.json");
      const tmpPath = `${filePath}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(reportData), "utf8");
      await fs.promises.rename(tmpPath, filePath);
    } catch (e) {
      logger.warn(`${logPrefix} Failed to save report data snapshot:`, e);
    }
  }


  private async savePageCacheArtifacts(
    url: string,
    title: string,
    richDomText: string,
    cleanScreenshot: Buffer,
    somScreenshot: Buffer,
    domState: DOMState,
    page: Page,
  ): Promise<void> {
    const artifactsBase = path.join(this.runDir, 'artifacts');
    const dir = path.join(artifactsBase, this.normalizeUrlToDir(url));
    fs.mkdirSync(dir, { recursive: true });

    // Write screenshots
    fs.writeFileSync(path.join(dir, 'screenshot.png'), cleanScreenshot);
    fs.writeFileSync(path.join(dir, 'som-screenshot.png'), somScreenshot);

    // Write DOM text
    fs.writeFileSync(path.join(dir, 'dom.txt'), richDomText);

    // Build locators from selectorMap (cap at 100)
    const locators: LocatorEntry[] = [];
    let count = 0;
    for (const [index, element] of domState.selectorMap.entries()) {
      if (count >= 100) break;
      locators.push({
        elementIndex: index,
        tagName: element.tagName,
        text: element.getAllTextTillNextClickableElement(2).trim(),
        xpath: element.xpath,
        framePath: [],
      });
      count++;
    }
    fs.writeFileSync(path.join(dir, 'locators.json'), JSON.stringify(locators, null, 2));

    // Write metadata
    let viewport = { width: 0, height: 0 };
    try {
      const vs = page.viewportSize();
      if (vs) viewport = vs;
    } catch { /* ignore */ }

    const metadata: PageCacheMetadata = {
      url,
      title,
      capturedAt: new Date().toISOString(),
      viewport,
      elementCount: domState.selectorMap.size,
    };
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  }

  private normalizeUrlToDir(url: string): string {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      let pathname = parsed.pathname;
      // Remove trailing slash
      if (pathname.endsWith('/') && pathname.length > 1) {
        pathname = pathname.slice(0, -1);
      }

      let dirName: string;
      if (pathname === '/' || pathname === '') {
        dirName = '_root';
      } else {
        // Sanitize path segments
        const segments = pathname.split('/').filter(Boolean).map(s =>
          s.replace(/[^a-zA-Z0-9._-]/g, '_')
        );
        dirName = segments.join(path.sep);
      }

      // Append short hash of query string to distinguish /search?q=foo from /search?q=bar
      if (parsed.search) {
        const hash = crypto.createHash('md5').update(parsed.search).digest('hex').slice(0, 6);
        dirName = `${dirName}_${hash}`;
      }

      return path.join(hostname, dirName);
    } catch {
      // Fallback for non-URL strings
      return url.replace(/[^a-zA-Z0-9._-]/g, '_');
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  }
}
