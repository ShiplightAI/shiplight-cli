/**
 * Simple logger for test runtime
 */

import sdkConfig from '../config';
import { LogLevel } from './logLevel';

// Re-export LogLevel for convenience
export { LogLevel };

class Logger {
  /**
   * Get current log level from SDK config
   * This is read dynamically so configureSdk() changes take effect immediately
   */
  private getLevel(): LogLevel {
    return sdkConfig.get('logLevel');
  }

  private isStderrOnly(): boolean {
    return sdkConfig.get('stderrOnly') === true;
  }

  debug(...args: any[]): void {
    if (this.getLevel() <= LogLevel.DEBUG) {
      if (this.isStderrOnly()) {
        console.error('[DEBUG]', ...args);
      } else {
        console.log('[DEBUG]', ...args);
      }
    }
  }

  info(...args: any[]): void {
    if (this.getLevel() <= LogLevel.INFO) {
      if (this.isStderrOnly()) {
        console.error('[INFO]', ...args);
      } else {
        console.log('[INFO]', ...args);
      }
    }
  }

  log(...args: any[]): void {
    this.info(...args);
  }

  warn(...args: any[]): void {
    if (this.getLevel() <= LogLevel.WARN) {
      console.warn('[WARN]', ...args);
    }
  }

  error(...args: any[]): void {
    if (this.getLevel() <= LogLevel.ERROR) {
      console.error('[ERROR]', ...args);
    }
  }

  setLevel(level: LogLevel): void {
    // Update the SDK config so it persists
    sdkConfig.set('logLevel', level);
  }
}

// Export singleton instance
const logger = new Logger();
export default logger;
