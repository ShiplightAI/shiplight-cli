import fs from "fs";
import os from "os";
import path from "path";
import { Browser, BrowserContext, Cookie, chromium, firefox, webkit } from "playwright";
import { BrowserType, ADDRESS_BAR_HEIGHT, getDeviceBrowserType, getBrowserWindowSize, getDeviceChannel, getDeviceOptions, getRecordVideoSize } from "shiplight-types";
import { INIT_SCRIPT } from "./constants";
import { getBrowserCdpUrl, getCommonChromiumArgs, setWindowBounds } from "./browserUtils";
import { registerBrowser, unregisterBrowser } from "./registryClient";
import logger from "../utils/logger";

type StorageStateFile = {
  cookies?: Cookie[];
  origins?: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
};

async function loadStorageStateToPersistentContext(context: BrowserContext, storageStatePath: string): Promise<void> {
  const storageState = JSON.parse(fs.readFileSync(storageStatePath, "utf-8")) as StorageStateFile;

  if (storageState.cookies?.length) {
    await context.addCookies(storageState.cookies);
  }
}

export interface BrowserInstance {
  debugPort?: number;
  browser: Browser;
  context: BrowserContext;
  startTime: Date;
  timeout: NodeJS.Timeout | null;
  browserWsUrl: string;
  downloadsBasePath?: string;
  browserType: BrowserType;
  userDataDir?: string;
  /** If true, userDataDir is a temp directory that should be cleaned up on terminate */
  isTempUserDataDir?: boolean;
  /** Dev-box browser registry id (null when disabled or registration failed) */
  registryId?: string | null;
}

export interface BrowserManagerConfig {
  /** Base directory for videos/downloads/states. If not provided, directories won't be created. */
  testDir?: string;
  /** Auto-termination timeout in ms. null = disabled (default). */
  terminationTimeout?: number | null;
  /** Override headless mode. Default: true (or false if PLAYWRIGHT_HEADED=true) */
  headless?: boolean;
  /** Additional chromium args to pass to the browser */
  additionalArgs?: string[];
}

export interface BrowserLaunchOptions {
  /** Debug port for CDP (Chrome DevTools Protocol). Required for devtools URLs and CDP WebSocket access. */
  debugPort?: number;
  /** Path to storage state file for session restoration */
  localStorageStatePath?: string;
  /** Enable video recording (requires testDir in config) */
  recordVideo?: boolean;
  /** Enable camera permission + fake device flags (Chromium-only) */
  enableCamera?: boolean;
  /** Enable microphone permission + fake device flags (Chromium-only) */
  enableMicrophone?: boolean;
  /** Absolute path to .wav file for fake audio capture (requires enableMicrophone) */
  fakeAudioCapturePath?: string;
  /** Absolute path to unpacked extension directory (.crx/.zip should be unpacked beforehand) */
  extensionPath?: string;
  /** Override user data dir for persistent context */
  userDataDir?: string;
  /** Disable web security (CORS, etc). Default: true */
  disableSecurity?: boolean;
  /** Override headless mode for this launch */
  headless?: boolean;
  /** Proxy configuration */
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  /** Device name for viewport/user-agent emulation (legacy — prefer explicit viewport/isMobile/hasTouch) */
  deviceName?: string;
  /** Custom viewport size */
  viewport?: { width: number; height: number };
  /** Emulate mobile device behavior */
  isMobile?: boolean;
  /** Enable touch events */
  hasTouch?: boolean;
  /** Custom user agent string */
  userAgent?: string;
  /** Emulated color scheme */
  colorScheme?: "light" | "dark" | "no-preference";
  /** Timezone ID (e.g., 'America/New_York') */
  timezoneId?: string;
  /** Emulated geolocation */
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  /** Cookies to set on the browser context */
  cookies?: Cookie[];
  /** Browser locale setting. Default: 'en-US' */
  locale?: string;
  /** Extra HTTP headers to send with every request in the browser context */
  extraHTTPHeaders?: Record<string, string>;
}

export class BrowserManager {
  private videoBasePath?: string;
  private statesBasePath?: string;
  private downloadsBasePath?: string;
  private testDir?: string;
  private readonly terminationTimeout: number | null;
  private readonly defaultHeadless: boolean;
  private readonly additionalArgs: string[];

  constructor(config: BrowserManagerConfig = {}) {
    // Set up directories only if testDir is provided
    if (config.testDir) {
      this.testDir = config.testDir;
      this.videoBasePath = path.join(config.testDir, "videos");
      this.statesBasePath = path.join(config.testDir, "states");
      this.downloadsBasePath = path.join(config.testDir, "downloads");

      fs.mkdirSync(this.videoBasePath, { recursive: true });
      fs.mkdirSync(this.statesBasePath, { recursive: true });
      fs.mkdirSync(this.downloadsBasePath, { recursive: true });
    }

    this.terminationTimeout = config.terminationTimeout ?? null;
    this.defaultHeadless = config.headless ?? false;
    this.additionalArgs = config.additionalArgs ?? [];
  }

  async launchBrowser(options: BrowserLaunchOptions = {}): Promise<BrowserInstance> {
    const debugPort = options.debugPort;
    let isHeadless = options.headless ?? this.defaultHeadless;
    const browserType = getDeviceBrowserType(options.deviceName);
    const deviceChannel = getDeviceChannel(options.deviceName);
    const isChromium = browserType === BrowserType.Chromium;
    const hasExtension = Boolean(options.extensionPath);

    logger.info(`[BrowserManager] Launching ${browserType} browser for device: ${options.deviceName || 'default'}${debugPort ? ` on port ${debugPort}` : ''}`);

    // Build launch options based on browser type
    const launchOptions: any = {
      headless: isHeadless,
    };

    // Chromium-specific options
    if (isChromium) {
      if (hasExtension && isHeadless) {
        logger.warn('[BrowserManager] Extension requested in headless mode; forcing headed mode to load extension.');
        isHeadless = false;
        launchOptions.headless = false;
      }

      const fakeDeviceArgs: string[] = [];
      if (options.enableCamera || options.enableMicrophone) {
        fakeDeviceArgs.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');

        // Add audio capture flag only if microphone is enabled and audio file path is provided
        if (options.enableMicrophone && options.fakeAudioCapturePath) {
          fakeDeviceArgs.push(`--use-file-for-fake-audio-capture=${options.fakeAudioCapturePath}`);
          logger.info(`[BrowserManager] Using fake audio capture file: ${options.fakeAudioCapturePath}`);
        }
      }

      const extensionArgs: string[] = hasExtension && options.extensionPath
        ? [
          `--disable-extensions-except=${options.extensionPath}`,
          `--load-extension=${options.extensionPath}`,
        ]
        : [];

      launchOptions.args = [
        ...getCommonChromiumArgs(debugPort, options.disableSecurity ?? true, isHeadless),
        ...fakeDeviceArgs,
        ...extensionArgs,
        ...this.additionalArgs,
      ];

      // Add channel if the device specifies one (for branded browsers like Chrome or Edge)
      if (deviceChannel) {
        launchOptions.channel = deviceChannel;
        logger.debug(`[BrowserManager] Launching browser with channel: ${deviceChannel}`);
      }
    }

    // Launch the appropriate browser
    const deviceOptions = getDeviceOptions(options.deviceName);
    const recordVideoSize = getRecordVideoSize(options.deviceName);

    // Build context options — start with device defaults, then apply explicit overrides
    const contextOptions: any = {
      acceptDownloads: true,
      ...deviceOptions,
      timezoneId: options.timezoneId || "America/Los_Angeles",
      locale: options.locale || "en-US",
    };

    // Explicit emulation overrides
    if (options.viewport) {
      contextOptions.viewport = options.viewport;
      // Set screen to match viewport so window.screen reports consistent dimensions,
      // especially for persistent contexts where CDP window bounds override Playwright's viewport.
      contextOptions.screen = options.viewport;
    }
    if (options.isMobile !== undefined) contextOptions.isMobile = options.isMobile;
    if (options.hasTouch !== undefined) contextOptions.hasTouch = options.hasTouch;
    if (options.userAgent) contextOptions.userAgent = options.userAgent;
    if (options.colorScheme) contextOptions.colorScheme = options.colorScheme;
    if (options.geolocation) {
      contextOptions.geolocation = options.geolocation;
      contextOptions.permissions = [...(contextOptions.permissions || []), 'geolocation'];
    }

    const persistentStorageStatePath = hasExtension && isChromium ? options.localStorageStatePath : undefined;
    if (options.localStorageStatePath && !persistentStorageStatePath) {
      contextOptions.storageState = options.localStorageStatePath;
    }

    if (options.recordVideo && this.videoBasePath) {
      contextOptions.recordVideo = {
        dir: this.videoBasePath,
        size: { width: recordVideoSize.width, height: recordVideoSize.height },
      };
    }

    if (options.proxy) {
      contextOptions.proxy = options.proxy;
    }

    if (options.extraHTTPHeaders && Object.keys(options.extraHTTPHeaders).length > 0) {
      contextOptions.extraHTTPHeaders = options.extraHTTPHeaders;
    }

    let browser: Browser;
    let context: BrowserContext;

    let resolvedUserDataDir: string | undefined;
    let isTempUserDataDir = false;
    const usePersistentContext = isChromium && (hasExtension || Boolean(options.userDataDir));

    if (usePersistentContext) {
      if (options.userDataDir) {
        resolvedUserDataDir = options.userDataDir;
      } else {
        // Extensions need a profile dir — create a unique temp one (cleaned up on terminateBrowser)
        const baseDir = this.testDir || fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-'));
        resolvedUserDataDir = path.join(baseDir, `ext-profile-${Date.now()}`);
        fs.mkdirSync(resolvedUserDataDir, { recursive: true });
        isTempUserDataDir = true;
      }
      const persistentOptions = { ...launchOptions, ...contextOptions };
      context = await chromium.launchPersistentContext(resolvedUserDataDir, persistentOptions);
      if (persistentStorageStatePath) {
        await loadStorageStateToPersistentContext(context, persistentStorageStatePath);
        logger.info(`[BrowserManager] Loaded storage state into persistent context from ${persistentStorageStatePath}`);
      }
      browser = context.browser() as Browser;
      logger.info(`[BrowserManager] Launched persistent context${options.extensionPath ? ` for extension at ${options.extensionPath}` : ` with profile at ${resolvedUserDataDir}`}`);
    } else {
      switch (browserType) {
        case BrowserType.Firefox:
          browser = await firefox.launch(launchOptions);
          break;
        case BrowserType.Webkit:
          browser = await webkit.launch(launchOptions);
          break;
        case BrowserType.Chromium:
        default:
          browser = await chromium.launch(launchOptions);
          break;
      }
      context = await browser.newContext(contextOptions);
    }
    context.addInitScript(INIT_SCRIPT);

    // Grant browser permissions
    if (isChromium) {
      const permissions: string[] = ['clipboard-read', 'clipboard-write'];
      if (options.enableCamera) permissions.push('camera');
      if (options.enableMicrophone) permissions.push('microphone');
      try {
        await context.grantPermissions(permissions);
        logger.info(`[BrowserManager] Granted permissions: ${permissions.join(', ')}`);
      } catch (error) {
        logger.warn('[BrowserManager] Failed to grant permissions:', error);
      }
    } else if (options.enableCamera || options.enableMicrophone) {
      logger.warn('[BrowserManager] Camera/microphone enabled but browser is not Chromium; ignoring.');
    }

    // Set cookies if provided
    if (options.cookies && options.cookies.length > 0) {
      // Update expiration to be dynamic (365 days from now)
      const expires = (Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000;
      const cookiesWithExpires = options.cookies.map(cookie => ({
        ...cookie,
        expires,
      }));
      await context.addCookies(cookiesWithExpires);
      logger.info(`[BrowserManager] Added ${options.cookies.length} cookies to browser context with expires=${expires}`);
    }

    // Set window bounds for Chromium browsers
    const customViewport = options.viewport;
    const windowSize = customViewport
      ? { width: customViewport.width, height: customViewport.height + ADDRESS_BAR_HEIGHT }
      : getBrowserWindowSize(options.deviceName);
    logger.info(`[BrowserManager] windowSize=${JSON.stringify(windowSize)}`);
    if (isChromium) {
      const applyWindowBounds = async (page: import('playwright').Page) => {
        try {
          await setWindowBounds(page, windowSize.width, windowSize.height);
          if (customViewport) {
            await page.setViewportSize(customViewport);
          }
        } catch (error) {
          logger.warn('[BrowserManager] Failed to set window bounds via CDP:', error);
        }
      };

      // Apply to pages that already exist (persistent contexts open a page before this point)
      for (const page of context.pages()) {
        await applyWindowBounds(page);
      }

      // Apply to future pages
      context.on('page', applyWindowBounds);
    }

    // Get WebSocket URL (CDP is only available for Chromium with a debug port)
    let wsEndpointData = '';
    if (isChromium && debugPort !== undefined) {
      try {
        wsEndpointData = await getBrowserCdpUrl(debugPort);
      } catch (error) {
        logger.warn('[BrowserManager] Failed to get CDP WebSocket URL:', error);
      }
    }

    // Dev-box: register with the browser registry so the UI can attach a
    // live-view panel. No-op outside the dev box (OMNITERM_BROWSER_REGISTRY_URL unset).
    let registryId: string | null = null;
    if (wsEndpointData) {
      registryId = await registerBrowser({
        cdpUrl: wsEndpointData,
        label: `agent ${options.deviceName ?? browserType}`,
        pid: process.pid,
      });
      if (registryId) {
        logger.info(`[BrowserManager] Registered browser with dev-box registry id=${registryId}`);
      }
    }

    const browserInstance: BrowserInstance = {
      debugPort,
      browser,
      context,
      startTime: new Date(),
      timeout: null,
      browserWsUrl: wsEndpointData,
      downloadsBasePath: this.downloadsBasePath,
      browserType,
      userDataDir: resolvedUserDataDir,
      isTempUserDataDir,
      registryId,
    };

    // Set auto-termination timeout if configured
    if (this.terminationTimeout !== null) {
      const timeoutHandle = setTimeout(() => {
        logger.info(`[BrowserManager] Browser auto-terminated after ${this.terminationTimeout}ms`);
        this.terminateBrowser(browserInstance).catch((err) =>
          logger.error('[BrowserManager] Error terminating browser:', err)
        );
      }, this.terminationTimeout);

      browserInstance.timeout = timeoutHandle;
    }

    return browserInstance;
  }

  async terminateBrowser(instance: BrowserInstance): Promise<void> {
    if (instance.timeout) {
      clearTimeout(instance.timeout);
    }

    await unregisterBrowser(instance.registryId ?? null);
    await instance.context.close();
    await instance.browser.close();

    // Clean up temp user data directory for extension sessions
    if (instance.isTempUserDataDir && instance.userDataDir) {
      try {
        fs.rmSync(instance.userDataDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn('[BrowserManager] Failed to clean up temp user data dir:', instance.userDataDir, err);
      }
    }
  }

  /** Get the configured video base path, or undefined if testDir was not provided */
  getVideoBasePath(): string | undefined {
    return this.videoBasePath;
  }

  /** Get the configured states base path, or undefined if testDir was not provided */
  getStatesBasePath(): string | undefined {
    return this.statesBasePath;
  }

  /** Get the configured downloads base path, or undefined if testDir was not provided */
  getDownloadsBasePath(): string | undefined {
    return this.downloadsBasePath;
  }
}
