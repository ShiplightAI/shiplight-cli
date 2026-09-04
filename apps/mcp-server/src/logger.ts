/**
 * MCP Server Logger
 *
 * For STDIO-based MCP servers, we must NEVER write to stdout.
 * All logging output goes to stderr to avoid corrupting JSON-RPC messages.
 */

const LOG_LEVEL_ERROR = 1;
const LOG_LEVEL_WARN = 2;
const LOG_LEVEL_INFO = 3;
const LOG_LEVEL_DEBUG = 4;

class MCPLogger {
  private static _instance: MCPLogger;
  private _logLevel: number;

  private constructor() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case "ERROR":
        this._logLevel = LOG_LEVEL_ERROR;
        break;
      case "WARN":
        this._logLevel = LOG_LEVEL_WARN;
        break;
      case "INFO":
        this._logLevel = LOG_LEVEL_INFO;
        break;
      case "DEBUG":
        this._logLevel = LOG_LEVEL_DEBUG;
        break;
      default:
        this._logLevel = LOG_LEVEL_INFO;
    }
  }

  static getInstance(): MCPLogger {
    if (!MCPLogger._instance) {
      MCPLogger._instance = new MCPLogger();
    }
    return MCPLogger._instance;
  }

  setLevel(level: number): void {
    this._logLevel = level;
  }

  debug(...args: unknown[]): void {
    if (this._logLevel >= LOG_LEVEL_DEBUG) {
      console.error("[DEBUG]", ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this._logLevel >= LOG_LEVEL_INFO) {
      console.error("[INFO]", ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this._logLevel >= LOG_LEVEL_WARN) {
      console.error("[WARN]", ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this._logLevel >= LOG_LEVEL_ERROR) {
      console.error("[ERROR]", ...args);
    }
  }

  log(...args: unknown[]): void {
    this.info(...args);
  }
}

const logger = MCPLogger.getInstance();
export default logger;

export const LogLevel = {
  ERROR: LOG_LEVEL_ERROR,
  WARN: LOG_LEVEL_WARN,
  INFO: LOG_LEVEL_INFO,
  DEBUG: LOG_LEVEL_DEBUG,
};
