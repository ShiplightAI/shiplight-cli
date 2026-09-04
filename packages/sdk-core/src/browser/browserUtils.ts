import { Browser, BrowserContext, Page } from "playwright";
import { INIT_SCRIPT } from "./constants";
import logger from "../utils/logger";

/**
 * Get common Chromium args for browser launch
 * @param debugPort - Optional debug port. If not provided, no remote debugging port will be set.
 * @param disableSecurity - Whether to disable web security (CORS, etc). Default: true
 * @param isHeadless - Whether to run in headless mode. Default: false
 */
export function getCommonChromiumArgs(
  debugPort?: number | string,
  disableSecurity: boolean = true,
  isHeadless: boolean = false
): string[] {
  return [
    ...(debugPort !== undefined ? [
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
    ] : []),
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--timezone=America/Los_Angeles',
    ...(isHeadless ? ['--headless'] : []),
    ...(disableSecurity ? [
      '--disable-web-security',
      '--disable-site-isolation-trials',
      '--disable-features=IsolateOrigins,site-per-process',
      '--allow-running-insecure-content',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--ignore-certificate-errors-spki-list'
    ] : []),
  ];
}

/**
 * Create browser context with init script
 */
export async function newBrowserContext(browser: Browser, options?: any): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  context.addInitScript(INIT_SCRIPT);
  return context;
}

/**
 * Get browser CDP URL from debug port
 * This matches packages/common/browser/browserUtils.ts::getLocalCdpUrl
 */
export async function getBrowserCdpUrl(debugPort: number): Promise<string> {
  const wsEndpointResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/version`
  );
  const wsEndpointData: any = await wsEndpointResponse.json();
  // Replace localhost with 127.0.0.1 to avoid IPv6 issues
  const cdpUrl = wsEndpointData.webSocketDebuggerUrl;
  return cdpUrl.replace('localhost', '127.0.0.1');
}

export async function getPageWsUrl(debugPort: number, pageId: string): Promise<string> {
  const wsEndpointResponse = await fetch(
    `http://localhost:${debugPort}/json/list`
  );
  const wsEndpointData: any = await wsEndpointResponse.json();
  for (const target of wsEndpointData) {
    if (target.type === "page" && target.id === pageId) {
      return target.webSocketDebuggerUrl;
    }
  }
  throw new Error(`No page found for id: ${pageId}`);
}

export async function getPageInfo(page: Page): Promise<any> {
  const session = await page.context().newCDPSession(page);
  const targetInfo = await session.send("Target.getTargetInfo");
  await session.detach();
  return targetInfo.targetInfo;
}

// Set window bounds using CDP (copied from the internal shared package)
export const setWindowBounds = async (page: Page, width: number, height: number): Promise<void> => {
  // Set window bounds using CDP
  const cdpSession = await page.context().newCDPSession(page);
  const windowIdResult = await cdpSession.send('Browser.getWindowForTarget');
  await cdpSession.send('Browser.setWindowBounds', {
    windowId: windowIdResult.windowId,
    bounds: {
      width: width,
      height: height,
      windowState: 'normal', // Ensure window is not minimized/maximized
    },
  });
  try {
    await Promise.race([
      cdpSession.detach(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CDP detach timeout')), 1000))
    ]);
  } catch (error) {
    // Ignore timeout errors for CDP detach
  }
};

// Page load stabilization constants
const MINIMUM_WAIT_PAGE_LOAD_TIME_MS = 0.5 * 1000;
const MAXIMUM_WAIT_PAGE_LOAD_TIME_MS = 30.0 * 1000;
const WAIT_FOR_NETWORK_IDLE_PAGE_LOAD_TIME_MS = 1.0 * 1000;
const PREPOPULATE_REQUESTS_LOOKBACK_MS = 3.0 * 1000;

/**
 * Wait for stable network (no pending requests for idle timeout)
 * Filters out irrelevant requests like analytics, ads, streaming, etc.
 */
async function waitForStableNetwork(page: Page, maxWaitTimeMs: number): Promise<void> {
  const pendingRequests = new Set<any>();
  let lastActivity = Date.now();

  const RELEVANT_RESOURCE_TYPES = new Set([
    'document',
    'stylesheet',
    'image',
    'font',
    'script',
    'iframe',
  ]);

  const RELEVANT_CONTENT_TYPES = new Set([
    'text/html',
    'text/css',
    'application/javascript',
    'image/',
    'font/',
    'application/json',
  ]);

  const IGNORED_URL_PATTERNS = [
    // Analytics and tracking
    'analytics', 'tracking', 'telemetry', 'beacon', 'metrics',
    // Ad-related
    'doubleclick', 'adsystem', 'adserver', 'advertising',
    // Social media widgets
    'facebook.com/plugins', 'platform.twitter', 'linkedin.com/embed',
    // Live chat and support
    'livechat', 'zendesk', 'intercom', 'crisp.chat', 'hotjar',
    // Push notifications
    'push-notifications', 'onesignal', 'pushwoosh',
    // Background sync/heartbeat
    'heartbeat', 'ping', 'alive',
    // WebRTC and streaming
    'webrtc', 'rtmp://', 'wss://',
    // Common CDNs for dynamic content
    'cloudfront.net', 'fastly.net',
  ];

  const isIgnoredUrl = (url: string): boolean => {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.startsWith('data:') || lowerUrl.startsWith('blob:')) {
      return true;
    }
    return IGNORED_URL_PATTERNS.some(pattern => lowerUrl.includes(pattern));
  };

  const onRequest = (request: any) => {
    const resourceType = request.resourceType();
    const url = request.url();

    if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) return;
    if (isIgnoredUrl(url)) return;

    const headers = request.headers();
    if (headers['purpose'] === 'prefetch' || ['video', 'audio'].includes(headers['sec-fetch-dest'])) {
      return;
    }

    pendingRequests.add(request);
    lastActivity = Date.now();
  };

  const onResponse = async (response: any) => {
    const request = response.request();
    if (!pendingRequests.has(request)) return;

    const contentType = (response.headers()['content-type'] || '').toLowerCase();

    // Skip if content type indicates streaming or real-time data
    const isStreaming = [
      'streaming', 'video', 'audio', 'webm', 'mp4',
      'event-stream', 'websocket', 'protobuf'
    ].some(t => contentType.includes(t));

    if (isStreaming) {
      pendingRequests.delete(request);
      return;
    }

    // Only process relevant content types
    const isRelevantContentType = [...RELEVANT_CONTENT_TYPES].some(ct => contentType.startsWith(ct));
    if (!isRelevantContentType) {
      pendingRequests.delete(request);
      return;
    }

    // Skip if response is too large
    const contentLengthHeader = response.headers()['content-length'];
    if (contentLengthHeader) {
      try {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (contentLength > 5 * 1024 * 1024) { // 5MB
          pendingRequests.delete(request);
          return;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    pendingRequests.delete(request);
    lastActivity = Date.now();
  };

  // Pre-populate with requests already in-flight before listeners were attached
  // Only consider requests started within the last 3 seconds
  const lookbackTime = Date.now() - PREPOPULATE_REQUESTS_LOOKBACK_MS;
  for (const request of await (page as any).requests()) {
    const resourceType = request.resourceType();
    const url = request.url();
    const timing = request.timing();
    if (
      RELEVANT_RESOURCE_TYPES.has(resourceType) &&
      !isIgnoredUrl(url) &&
      timing.responseEnd === -1 &&
      timing.startTime >= lookbackTime
    ) {
      pendingRequests.add(request);
      lastActivity = Date.now();
    }
  }
  logger.debug(`[waitForStableNetwork] Pre-populated ${pendingRequests.size} in-flight requests`);

  page.on('request', onRequest);
  page.on('response', onResponse);

  try {
    const startTime = Date.now();
    const idleTimeoutMs = WAIT_FOR_NETWORK_IDLE_PAGE_LOAD_TIME_MS;

    while (true) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Sleep 100ms
      const now = Date.now();

      if (pendingRequests.size === 0 && (now - lastActivity) >= idleTimeoutMs) {
        logger.debug(`[waitForStableNetwork] Network idle after ${now - startTime}ms`);
        break;
      }

      if (now - startTime > maxWaitTimeMs) {
        logger.debug(`[waitForStableNetwork] Max wait time exceeded (${maxWaitTimeMs}ms), pending: ${pendingRequests.size}`);
        break;
      }
    }
  } finally {
    // Clean up event listeners
    page.removeListener('request', onRequest);
    page.removeListener('response', onResponse);
  }
}

/**
 * Wait for page and frames to fully load
 * Ensures page is fully loaded before continuing by waiting for network to be idle
 * @param page - The page to wait for
 * @param maxWaitTimeMs - Maximum time to wait for network to stabilize
 * @param minWaitTimeMs - Minimum time to wait before returning (ensures page has time to render)
 */
export async function waitForPageAndFramesLoad(
  page: Page,
  maxWaitTimeMs: number = MAXIMUM_WAIT_PAGE_LOAD_TIME_MS,
  minWaitTimeMs: number = MINIMUM_WAIT_PAGE_LOAD_TIME_MS
): Promise<void> {
  const startTime = Date.now();

  try {
    await Promise.all([
      page.waitForLoadState('load', { timeout: maxWaitTimeMs }).catch(() => {}),
      waitForStableNetwork(page, maxWaitTimeMs),
    ]);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed during network stabilization: ${error.message}`);
    } else {
      throw new Error(`An unknown error occurred during network stabilization.`);
    }
  }

  const elapsedMs = Date.now() - startTime;
  const remainingMs = Math.max(minWaitTimeMs - elapsedMs, 0);

  if (remainingMs > 0) {
    await new Promise(resolve => setTimeout(resolve, remainingMs));
  }
}