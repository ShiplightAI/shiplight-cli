/**
 * Default implementation of IAgentServices
 * Provides standard service methods that can be used by any agent implementation
 */

import * as fs from 'fs';
import * as path from 'path';
import { BrowserContext, Page } from 'playwright';
import { waitForPageAndFramesLoad } from '../browser/browserUtils';
import { replaceVariables } from 'shiplight-types';
import logger from '../utils/logger';
import { getSdkConfig } from '../config';
import { PreloadedKnowledge } from 'shiplight-types';
import * as agentWait from './agentWait';
import { WebAgentContext } from '../core/types';
import { TabManager } from '../browser/tabManager';
import { generateSync, createGuardrails } from 'otplib';

// Allow short secrets for backward compatibility with existing user TOTP setups.
// Default v13 requires 16 bytes minimum; many real-world secrets are shorter.
const lenientGuardrails = createGuardrails({ MIN_SECRET_BYTES: 1 });
import type { IAgent } from '../actions/types';

/**
 * Test data downloader function type
 * @param filePaths - Array of file names to download
 * @param filesDir - Directory where files should be downloaded to
 */
export type TestDataDownloader = (filePaths: string[], filesDir: string) => Promise<void>;

/**
 * Knowledge retriever function type
 * @param statement - The statement/task to retrieve relevant knowledges for
 * @param threshold - Similarity threshold for filtering results (optional)
 * @param topK - Maximum number of results to return (optional)
 * @param usageScenario - Usage scenario for filtering ('general' or 'login', optional)
 * @returns Array of relevant knowledges
 */
export type KnowledgeRetriever = (statement: string, threshold?: number, topK?: number, usageScenario?: 'general' | 'login') => Promise<PreloadedKnowledge[]>;

export function isBlankTab(page: Page): boolean {
  return page.url() === ':';
}

/**
 * Standard AgentServices implementation
 * Provides utility methods for agent operations
 * Uses AgentContext for state management
 */
export class AgentServices {
  private tabManager?: TabManager;
  private testDataDownloader?: TestDataDownloader;
  private testDataFileNames: string[] = [];
  private knowledgeRetriever?: KnowledgeRetriever;
  private extensionEnabled: boolean = false;

  /** Reference to the owning agent, set by WebAgent after construction */
  public agent: IAgent | undefined;

  constructor(private context: WebAgentContext) {}

  /**
   * Set the test data downloader function
   * Called by sandbox to inject S3 download capability
   * For exported tests, this is not set (files are pre-populated)
   */
  setTestDataDownloader(downloader: TestDataDownloader, fileNames?: string[]): void {
    this.testDataDownloader = downloader;
    this.testDataFileNames = fileNames ?? [];
  }

  public setupPageTracking(context: BrowserContext): void {
    this.tabManager = new TabManager(context);
  }

  public async switchTab(pageIndex: number): Promise<Page> {
    if (!this.tabManager) {
      throw new Error('Tab manager not initialized');
    }

    return await this.tabManager.switchToPage(pageIndex);
  }

  public async closeTab(pageIndex: number): Promise<void> {
    if (!this.tabManager) {
      throw new Error('Tab manager not initialized');
    }

    await this.tabManager.closePage(pageIndex);
  }

  /**
   * Get the current active page from TabManager
   * @returns The current page, or null if TabManager is not initialized or no pages exist
   */
  public getCurrentPage(): Page | null {
    if (!this.tabManager) {
      return null;
    }
    return this.tabManager.getCurrentPage();
  }

  /**
   * Validate and return a valid page reference
   * Used by generated code to ensure page variable is updated after tab operations
   *
   * @param page - The page reference to validate
   * @returns A valid page (either the same page if still valid, or the current active page)
   */
  public validatePage(page: Page): Page {
    // 1. Check if TabManager has a different current page
    const currentPage = this.getCurrentPage();
    if (currentPage && currentPage !== page && !currentPage.isClosed()) {
      logger.info(`[validatePage] Page changed, switching to ${currentPage.url()}`);
      return currentPage;
    }

    // 2. If passed page is closed, get last remaining page from context
    if (page.isClosed()) {
      const pages = page.context().pages().filter(p => !p.isClosed());
      if (pages.length > 0) {
        const newPage = pages[pages.length - 1];
        logger.info(`[validatePage] Page closed, switching to ${newPage.url()}`);
        return newPage;
      }
      logger.error('[validatePage] No valid pages found');
    }

    return page;
  }

  /**
   * Replace variable placeholders with actual values from context.
   * Supports: ${varName}, $varName, {{ varName }}, <secret>varName</secret>
   * @see replaceVariables from agentContextUtils for full documentation
   */
  replaceVariables(input: string): string {
    return replaceVariables(input, this.context.variableStore.getAll());
  }

  getTestDataFileNames(): string[] {
    return this.testDataFileNames;
  }

  /**
   * Get the absolute path to a test data file
   * @param fileName - Name of the file in the test data directory
   * @returns Absolute path to the file
   */
  getTestDataFilePath(fileName: string): string {
    const testDataDir = this.context.testDataDir || process.cwd();
    return path.join(testDataDir, fileName);
  }

  /**
   * Download test data files on demand (used by upload_file action)
   * Checks local cache first, only downloads missing files
   * @param filePaths - Array of file paths/names to download
   */
  async downloadTestDataFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) {
      logger.debug('[AgentServices] No file paths provided for download');
      return;
    }

    const filesDir = this.context.testDataDir || process.cwd();

    // Check which files are missing locally
    const missingFiles = filePaths.filter(filePath => {
      const fileName = path.basename(filePath);
      const localPath = path.join(filesDir, fileName);
      const exists = fs.existsSync(localPath);
      if (exists) {
        logger.debug(`[AgentServices] File already exists locally: ${fileName}`);
      }
      return !exists;
    });

    if (missingFiles.length === 0) {
      logger.debug('[AgentServices] All files exist locally, no download needed');
      return;
    }

    if (!this.testDataDownloader) {
      // No downloader configured - files should already exist (exported tests)
      logger.debug('[AgentServices] No test data downloader configured, assuming files are pre-populated');
      return;
    }

    logger.info(`[AgentServices] Downloading ${missingFiles.length} test data files: ${missingFiles.join(', ')}`);
    await this.testDataDownloader(missingFiles, filesDir);
  }

  /**
   * Wait for a download to complete
   * @param page - Playwright Page object
   * @param timeoutSeconds - Maximum time to wait in seconds
   */
  async waitForDownloadComplete(page: Page, timeoutSeconds: number): Promise<void> {
    return agentWait.waitForDownloadComplete(page, this.context, timeoutSeconds);
  }

  /**
   * Get the file path of the most recently downloaded file
   * @returns The file path if download is completed, null otherwise
   */
  getRecentDownloadedFilePath(): string | null {
    if (!this.context.downloadStatus) {
      logger.debug('No download found');
      return null;
    }

    if (this.context.downloadStatus.status !== 'completed') {
      logger.debug(`Download is ${this.context.downloadStatus.status}, not completed`);
      return null;
    }

    if (!this.context.downloadStatus.filePath) {
      logger.warn('Download completed but file path is missing');
      return null;
    }

    logger.info(`Retrieved recent download path: ${this.context.downloadStatus.filePath}`);
    return this.context.downloadStatus.filePath;
  }

  addSensitive(name: string, value: any): void {
    this.context.variableStore.set(name, value, true);
  }

  /**
   * Save a variable to the context
   * @param name - Variable name (without $ prefix)
   * @param value - Value to save
   */
  saveVariable(name: string, value: any): void {
    // Remove $ prefix if present
    const cleanName = name.startsWith('$') ? name.slice(1) : name;
    this.context.variableStore.set(cleanName, value);
    logger.debug(`Saved variable: ${cleanName} = ${JSON.stringify(value)}`);

    // Set agentNote to inform future steps about the saved variable
    this.context.agentNote = `A new value is saved to the variable "${cleanName}".`;
  }

  /**
   * Add a note to the current step execution
   * This note will be included in the execution history for future steps
   * @param note - Note to add to the execution context
   */
  addNote(note: string): void {
    if (!note || note.trim() === '') {
      return;
    }

    // Append to existing agentNote with newline if it already has content
    if (this.context.agentNote) {
      this.context.agentNote += `\n${note.trim()}`;
    } else {
      this.context.agentNote = note.trim();
    }
  }

  /**
   * Read a variable from the context
   * @param name - Variable name (without $ prefix)
   * @returns The variable value, or undefined if not found
   */
  readVariable(name: string): any {
    // Remove $ prefix if present
    const cleanName = name.startsWith('$') ? name.slice(1) : name;
    const value = this.context.variableStore.get(cleanName);
    logger.debug(`Read variable: ${cleanName} = ${JSON.stringify(value)}`);
    return value;
  }

  /**
   * Generate 2FA code from secret key
   */
  async generate2faCode(secretKey: string): Promise<string> {
    try {
      // Generate the TOTP code
      const code = generateSync({ secret: secretKey, guardrails: lenientGuardrails });

      logger.info(`Generated 2FA code: ${code}`);
      return code;
    } catch (error: any) {
      logger.error(`Failed to generate 2FA code: ${error.message}`);
      throw new Error(`Failed to generate 2FA code: ${error.message}`);
    }
  }

  /**
   * Get DOM text from page
   */
  async getDOMText(page: Page): Promise<string> {
    return await page.evaluate(() => document.body.innerText);
  }

  /**
   * Wait for page and frames to fully load
   * Ensures page is fully loaded before continuing by waiting for network to be idle
   * @param page - Playwright Page object
   * @param maxWaitTimeMs - Maximum time to wait in milliseconds (default: 30000ms)
   */
  async waitUntilStable(page: Page, maxWaitTimeMs?: number): Promise<void> {
    return waitForPageAndFramesLoad(page, maxWaitTimeMs);
  }

  /**
   * Update the current page reference
   * Called by actions like switch_tab and go_to_url (with new_tab) when the active page changes
   * @param page - New page instance
   */
  setPage(page: Page): void {
    if (this.context.setPage) {
      logger.info('[AgentServices] Calling setPage callback');
      this.context.setPage(page);
    } else {
      logger.debug('[AgentServices] setPage callback not configured');
    }
  }

  /**
   * Get the LLM model configured for this agent.
   * Throws if no model is configured — this only happens for AI-powered actions.
   */
  getModel(): string {
    if (!this.context.model) {
      throw new Error(
        "No LLM model configured. An LLM model is required for AI-powered actions (login, verify, ai_extract, ai_wait_until, etc.). " +
        "Set GOOGLE_API_KEY or ANTHROPIC_API_KEY in your MCP server configuration."
      );
    }
    return this.context.model;
  }

  /**
   * Ordered fallback models for the web agent (provider:model), tried in order
   * when the primary model fails with an availability error. Empty = no fallback.
   */
  getFallbackModels(): string[] {
    return this.context.fallbackModels ?? [];
  }

  /**
   * Get the computer use model configured for this agent.
   */
  getComputerUseModel(): string | undefined {
    return this.context.computer_use_model;
  }

  /**
   * Ordered fallback computer-use models (provider:model), tried in order when
   * the primary computer-use model fails with an availability error. Empty = no
   * fallback. Distinct from getFallbackModels() (web-agent) — these must be
   * computer-use-capable.
   */
  getComputerUseFallbackModels(): string[] {
    return this.context.computer_use_fallback_models ?? [];
  }

  /**
   * Get the variable store for accessing and setting test variables
   */
  get variableStore() {
    return this.context.variableStore;
  }

  /**
   * Get the download directory configured for this agent
   */
  getDownloadDir(): string | undefined {
    return this.context.downloadDir;
  }

  getActionSettings(): Record<string, any> {
    return this.context.organizationSettings?.action_code_conversion_settings || {};
  }

  /**
   * Get interactive class names from organization settings
   * @returns Array of interactive class names (empty if not configured)
   */
  getInteractiveClassNames(): string[] {
    return this.context.organizationSettings?.agent_settings?.interactive_class_names || [];
  }

  /**
   * Get iframe domains that should use Playwright frame fallback when inaccessible to in-page DOM traversal
   * @returns Array of domain names (empty if not configured)
   */
  getIframeFallbackDomains(): string[] {
    return this.context.organizationSettings?.agent_settings?.iframe_fallback_domains || [];
  }

  /**
   * Get whether to use clean screenshot for assertion
   * @returns True if clean screenshot should be used, false otherwise
   */
  isUseCleanScreenshotForAssertion(): boolean {
    return this.context.organizationSettings?.use_clean_screenshot_for_assertion ?? true;
  }

  /**
   * Get whether knowledge images are enabled for this organization
   * @returns True if knowledge images should be included in LLM prompts
   */
  isKnowledgeImagesEnabled(): boolean {
    return this.context.organizationSettings?.agent_settings?.enable_knowledge_images || false;
  }

  /**
   * Get whether sliced screenshots are enabled for this organization
   * Sliced screenshots split the image into 3 parts (left/middle/right) to maximize token usage
   *
   * Can be overridden via USE_SLICED_SCREENSHOTS env var in sandbox for local testing:
   *   USE_SLICED_SCREENSHOTS=true pnpm dev
   *
   * @returns True if sliced screenshots should be used
   */
  isSlicedScreenshotsEnabled(): boolean {
    return this.context.organizationSettings?.agent_settings?.use_sliced_screenshots || false;
  }

  /**
   * Get whether sliced screenshots should be resized to 768x768
   * @returns True if sliced screenshots should be resized
   */
  isResizeSlicedScreenshotsEnabled(): boolean {
    return this.context.organizationSettings?.agent_settings?.resize_sliced_screenshots || false;
  }

  /**
   * Get whether accessibility tree should be used for element detection (experimental)
   * Uses Chrome DevTools Protocol Accessibility API for authoritative interactive element detection
   *
   * Can be overridden via USE_ACCESSIBILITY_TREE env var in sandbox for local testing:
   *   USE_ACCESSIBILITY_TREE=true pnpm dev
   *
   * @returns True if accessibility tree should be used
   */
  isAccessibilityTreeEnabled(): boolean {
    return this.context.organizationSettings?.agent_settings?.use_accessibility_tree || false;
  }

  /**
   * Get whether action intent filtering is enabled.
   * When enabled, DOM extraction filters elements based on the intended action type
   * (click, input, scroll) to reduce noise and improve action generation accuracy.
   *
   * @returns True if action intent filtering should be used
   */
  isActionIntentFilteringEnabled(): boolean {
    return this.context.organizationSettings?.agent_settings?.use_action_intent_filtering || false;
  }

  /**
   * Get whether to use the TypeScript DOM tree implementation
   * The TypeScript version is compiled from index.ts and provides the same functionality
   * with better type safety for future enhancements.
   *
   * Can be overridden via USE_DOM_TREE_TS env var for local testing:
   *   USE_DOM_TREE_TS=true pnpm dev
   *
   * @returns True if TypeScript DOM tree should be used
   */
  isDomTreeTsEnabled(): boolean {
    // Host-supplied override for local testing, read from the injected SDK
    // config rather than process.env (FR-010). An empty value means "unset" —
    // hosts populate every allowlisted key, using '' for absent ones — so it
    // falls through to organization settings instead of forcing false.
    const envOverride = getSdkConfig().env?.USE_DOM_TREE_TS;
    if (envOverride) {
      return envOverride === 'true' || envOverride === '1';
    }
    return this.context.organizationSettings?.agent_settings?.use_dom_tree_ts || false;
  }

  /**
   * Set whether a Chrome extension is loaded for this session.
   * When enabled, DOM tree traversal starts from document root instead of body,
   * so extension-injected elements in <head> are visible.
   */
  setExtensionEnabled(enabled: boolean): void {
    this.extensionEnabled = enabled;
  }

  /**
   * Get DomService options based on organization settings
   * This is a convenience method to pass to new DomService(page, options)
   *
   * @returns DomServiceOptions with useDomTreeTs and domTreeRoot flags
   */
  getDomServiceOptions(): { useDomTreeTs: boolean; domTreeRoot: 'body' | 'document' } {
    return {
      useDomTreeTs: this.isDomTreeTsEnabled(),
      domTreeRoot: this.extensionEnabled ? 'document' : 'body',
    };
  }

  /**
   * Set the knowledge retriever function
   * Called by sandbox/test-fixtures to inject knowledge retrieval capability
   *
   * - Sandbox: uses core-api to retrieve knowledges per statement
   * - Test-fixtures (runner mode): uses core-api to retrieve knowledges per statement
   * - Test-fixtures (offline mode): returns all preloaded knowledges
   *
   * @param retriever - Function that retrieves knowledges for a given statement
   */
  setKnowledgeRetriever(retriever: KnowledgeRetriever): void {
    this.knowledgeRetriever = retriever;
  }

  /**
   * Check if knowledge retriever is configured
   * Used to determine if knowledge retrieval functionality is available
   *
   * @returns True if knowledge retriever is configured, false otherwise
   */
  hasKnowledgeRetriever(): boolean {
    return this.knowledgeRetriever !== undefined;
  }

  /**
   * Retrieve relevant knowledges for a statement
   * Used by action generation and evaluation to get context-relevant knowledge
   *
   * @param statement - The statement/task to retrieve relevant knowledges for
   * @param threshold - Similarity threshold for filtering results (optional)
   * @param topK - Maximum number of results to return (optional)
   * @param usageScenario - Usage scenario for filtering ('general' or 'login', optional)
   * @returns Array of relevant knowledges (empty if no retriever configured)
   */
  async retrieveKnowledges(statement: string, threshold?: number, topK?: number, usageScenario?: 'general' | 'login'): Promise<PreloadedKnowledge[]> {
    if (!this.knowledgeRetriever) {
      logger.debug('[AgentServices] No knowledge retriever configured');
      return [];
    }

    try {
      const knowledges = await this.knowledgeRetriever(statement, threshold, topK, usageScenario);
      logger.debug(`[AgentServices] Retrieved ${knowledges.length} knowledges for statement`);
      return knowledges;
    } catch (error: any) {
      logger.warn(`[AgentServices] Failed to retrieve knowledges: ${error.message}`);
      return [];
    }
  }
}
