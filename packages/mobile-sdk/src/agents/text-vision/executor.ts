/**
 * Text-Vision Executor - Uses Appium with UIAutomator2 for selector-based automation
 *
 * Handles only Appium connection and driver operations.
 * Action execution and services are managed by TextVisionAgent.
 */

import { remote, type Browser } from 'webdriverio';
import { createLogger } from '../../utils/logger';

const log = createLogger('TextVisionExecutor');

/**
 * Configuration for Appium executor
 */
export interface AppiumConfig {
  /** Appium server host (default: localhost) */
  host?: string;

  /** Appium server port (default: 4723) */
  port?: number;

  /** Device UDID */
  udid: string;

  /** App package name (optional, for launching apps) */
  appPackage?: string;

  /** App activity name (optional, for launching apps) */
  appActivity?: string;

  /** Don't reset app state between sessions */
  noReset?: boolean;

  /** Platform version (e.g., "14") */
  platformVersion?: string;

  /** Automation name (default: UiAutomator2) */
  automationName?: string;
}

/**
 * Executor interface for different execution backends
 */
export interface IExecutor {
  /**
   * Connect to the device
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the device
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Get the underlying driver instance
   * @throws Error if not connected
   */
  getDriver(): Browser;

  /**
   * Take a screenshot
   * @returns Base64 encoded screenshot
   */
  screenshot(): Promise<string>;

  /**
   * Get screen dimensions
   */
  getScreenSize(): Promise<{ width: number; height: number }>;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum retry attempts after initial failure (default: 1) */
  maxRetries: number;

  /** Delay between retries in ms (default: 500) */
  retryDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 1,
  retryDelayMs: 500,
};

/**
 * TextVisionExecutor uses WebDriverIO to connect to Appium server.
 *
 * Handles only Appium connection and driver operations.
 * Action execution is delegated to ActionHandler with MobileAgentServices.
 */
export class TextVisionExecutor implements IExecutor {
  private driver: Browser | null = null;
  private config: AppiumConfig;

  constructor(config: AppiumConfig) {
    this.config = config;
  }

  /**
   * Connect to Appium server and create a session
   */
  async connect(): Promise<void> {
    if (this.driver) {
      log.debug('Already connected');
      return;
    }

    const capabilities: Record<string, any> = {
      platformName: 'Android',
      'appium:automationName': this.config.automationName || 'UiAutomator2',
      'appium:udid': this.config.udid,
      'appium:noReset': this.config.noReset ?? true,
    };

    if (this.config.platformVersion) {
      capabilities['appium:platformVersion'] = this.config.platformVersion;
    }

    if (this.config.appPackage) {
      capabilities['appium:appPackage'] = this.config.appPackage;
    }

    if (this.config.appActivity) {
      capabilities['appium:appActivity'] = this.config.appActivity;
    }

    log.info(`Connecting to ${this.config.host || 'localhost'}:${this.config.port || 4723}...`);
    log.debug(`Device: ${this.config.udid}`);

    this.driver = await remote({
      hostname: this.config.host || 'localhost',
      port: this.config.port || 4723,
      path: '/',
      capabilities,
      logLevel: 'warn',
    });

    log.info('Connected');
  }

  /**
   * Disconnect from Appium
   */
  async disconnect(): Promise<void> {
    if (this.driver) {
      log.debug('Disconnecting...');
      await this.driver.deleteSession();
      this.driver = null;
      log.debug('Disconnected');
    }
  }

  /**
   * Check if connected (driver exists, may not be valid session)
   */
  isConnected(): boolean {
    return this.driver !== null;
  }

  /**
   * Ensure we have a valid connection, reconnect if needed
   */
  async ensureConnected(): Promise<void> {
    if (!this.driver) {
      await this.connect();
      return;
    }

    // Try a simple operation to verify session is still valid
    try {
      await this.driver.getWindowSize();
    } catch {
      // Session is invalid, reconnect
      log.info('Session expired, reconnecting...');
      this.driver = null;
      await this.connect();
    }
  }

  /**
   * Take a screenshot
   * @returns Base64 encoded PNG screenshot
   */
  async screenshot(): Promise<string> {
    await this.ensureConnected();

    const base64 = await this.driver!.takeScreenshot();
    return `data:image/png;base64,${base64}`;
  }

  /**
   * Get page source (UI hierarchy XML)
   * Uses Appium's getPageSource which doesn't conflict with UIAutomator2
   */
  async getPageSource(): Promise<string> {
    await this.ensureConnected();

    return await this.driver!.getPageSource();
  }

  /**
   * Get screen dimensions
   */
  async getScreenSize(): Promise<{ width: number; height: number }> {
    await this.ensureConnected();
    return this.driver!.getWindowSize();
  }

  /**
   * Get the underlying WebDriverIO browser instance
   * @throws Error if not connected
   */
  getDriver(): Browser {
    if (!this.driver) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.driver;
  }

  /**
   * Launch an app by package name
   */
  async launchApp(appPackage: string): Promise<void> {
    await this.ensureConnected();
    await this.driver!.activateApp(appPackage);
  }

  /**
   * Close the current app
   */
  async closeApp(appPackage: string): Promise<void> {
    await this.ensureConnected();
    await this.driver!.terminateApp(appPackage);
  }

  /**
   * Check if an app is installed
   */
  async isAppInstalled(appPackage: string): Promise<boolean> {
    await this.ensureConnected();
    return this.driver!.isAppInstalled(appPackage);
  }
}

/**
 * @deprecated Use TextVisionExecutor instead. AppiumExecutor is an alias for backward compatibility.
 */
export const AppiumExecutor = TextVisionExecutor;
