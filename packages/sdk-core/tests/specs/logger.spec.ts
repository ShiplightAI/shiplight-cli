/**
 * Tests for Logger stderrOnly configuration
 *
 * Verifies that the logger routes output to stdout or stderr
 * based on the stderrOnly SDK config flag.
 */

import { test, expect } from '@playwright/test';
import { configureSdk } from '../../src/config';
import logger, { LogLevel } from '../../src/utils/logger';

// Helper to capture writes to a stream
function captureStream(stream: NodeJS.WriteStream) {
  const chunks: string[] = [];
  const originalWrite = stream.write;
  stream.write = ((chunk: any, ...args: any[]) => {
    chunks.push(String(chunk));
    return originalWrite.call(stream, chunk, ...args);
  }) as typeof stream.write;
  return {
    chunks,
    restore: () => { stream.write = originalWrite; },
  };
}

test.describe('Logger stderrOnly', () => {
  test.beforeEach(() => {
    // Reset to defaults: INFO level, stderrOnly off
    configureSdk({ logLevel: LogLevel.DEBUG, stderrOnly: false });
  });

  test.afterEach(() => {
    configureSdk({ logLevel: LogLevel.INFO, stderrOnly: false });
  });

  test('debug and info write to stdout by default', () => {
    const stdout = captureStream(process.stdout);
    const stderr = captureStream(process.stderr);
    try {
      logger.info('hello stdout');
      logger.debug('debug stdout');

      expect(stdout.chunks.some(c => c.includes('hello stdout'))).toBe(true);
      expect(stdout.chunks.some(c => c.includes('debug stdout'))).toBe(true);
      // Should NOT appear on stderr
      expect(stderr.chunks.some(c => c.includes('hello stdout'))).toBe(false);
      expect(stderr.chunks.some(c => c.includes('debug stdout'))).toBe(false);
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });

  test('debug and info write to stderr when stderrOnly is true', () => {
    configureSdk({ stderrOnly: true });

    const stdout = captureStream(process.stdout);
    const stderr = captureStream(process.stderr);
    try {
      logger.info('hello stderr');
      logger.debug('debug stderr');

      expect(stderr.chunks.some(c => c.includes('hello stderr'))).toBe(true);
      expect(stderr.chunks.some(c => c.includes('debug stderr'))).toBe(true);
      // Should NOT appear on stdout
      expect(stdout.chunks.some(c => c.includes('hello stderr'))).toBe(false);
      expect(stdout.chunks.some(c => c.includes('debug stderr'))).toBe(false);
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });

  test('warn and error always write to stderr regardless of stderrOnly', () => {
    configureSdk({ stderrOnly: false });

    const stderr = captureStream(process.stderr);
    try {
      logger.warn('a warning');
      logger.error('an error');

      expect(stderr.chunks.some(c => c.includes('a warning'))).toBe(true);
      expect(stderr.chunks.some(c => c.includes('an error'))).toBe(true);
    } finally {
      stderr.restore();
    }
  });

  test('stderrOnly can be toggled dynamically', () => {
    const stdout = captureStream(process.stdout);
    const stderr = captureStream(process.stderr);
    try {
      logger.info('first on stdout');
      expect(stdout.chunks.some(c => c.includes('first on stdout'))).toBe(true);

      configureSdk({ stderrOnly: true });
      logger.info('now on stderr');
      expect(stderr.chunks.some(c => c.includes('now on stderr'))).toBe(true);
      // "now on stderr" should not be on stdout
      expect(stdout.chunks.some(c => c.includes('now on stderr'))).toBe(false);
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });
});
