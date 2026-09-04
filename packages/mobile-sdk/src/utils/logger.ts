/**
 * Simple logger with log levels
 *
 * Log levels (from most to least verbose):
 * - DEBUG: All verbose logs
 * - INFO: Important logs only
 * - WARN: Warnings and errors
 * - ERROR: Errors only
 * - SILENT: No logs
 *
 * Set via LOG_LEVEL environment variable (default: INFO)
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SILENT';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

function getLogLevel(): LogLevel {
  const level = (process.env.LOG_LEVEL || 'INFO').toUpperCase() as LogLevel;
  return LOG_LEVELS[level] !== undefined ? level : 'INFO';
}

function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const logger = {
  debug: (prefix: string, message: string) => {
    if (shouldLog('DEBUG')) {
      console.log(`[${prefix}] ${message}`);
    }
  },

  info: (prefix: string, message: string) => {
    if (shouldLog('INFO')) {
      console.log(`[${prefix}] ${message}`);
    }
  },

  warn: (prefix: string, message: string) => {
    if (shouldLog('WARN')) {
      console.warn(`[${prefix}] ${message}`);
    }
  },

  error: (prefix: string, message: string) => {
    if (shouldLog('ERROR')) {
      console.error(`[${prefix}] ${message}`);
    }
  },
};

/**
 * Create a prefixed logger for a specific component
 */
export function createLogger(prefix: string) {
  return {
    debug: (message: string) => logger.debug(prefix, message),
    info: (message: string) => logger.info(prefix, message),
    warn: (message: string) => logger.warn(prefix, message),
    error: (message: string) => logger.error(prefix, message),
  };
}
