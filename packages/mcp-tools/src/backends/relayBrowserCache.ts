/**
 * Relay Browser Connection Cache
 *
 * Manages a single cached CDP connection to the relay server.
 * Key insight: Cache Browser connections and let them disconnect naturally.
 * Never explicitly close - the "disconnected" event auto-clears the cache.
 */

import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { logger } from 'sdk-core';

interface ConnectedBrowser {
  browser: Browser;
  cdpUrl: string;
  onDisconnected: () => void;
}

// Global cache
let cached: ConnectedBrowser | null = null;
let connecting: Promise<Browser> | null = null;

function normalizeCdpUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Connect to CDP endpoint, with caching.
 * Returns cached Browser if available, otherwise creates new connection.
 */
export async function connectBrowser(cdpUrl: string): Promise<Browser> {
  const normalized = normalizeCdpUrl(cdpUrl);

  // Return cached if URL matches
  if (cached?.cdpUrl === normalized) {
    logger.info(`[RelayCache] Reusing cached Browser connection`);
    return cached.browser;
  }

  // If already connecting, wait for it
  if (connecting) {
    logger.info(`[RelayCache] Waiting for in-progress connection...`);
    return await connecting;
  }

  // Connect with retry logic
  const connectWithRetry = async (): Promise<Browser> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = 60000;
        logger.info(`[RelayCache] Connecting to CDP (attempt ${attempt + 1})...`);

        const browser = await chromium.connectOverCDP(normalized, { timeout });
        logger.info(`[RelayCache] Connected to CDP successfully`);

        // Setup disconnection handler
        const onDisconnected = () => {
          if (cached?.browser === browser) {
            logger.info(`[RelayCache] Browser disconnected, clearing cache`);
            cached = null;
          }
        };

        cached = { browser, cdpUrl: normalized, onDisconnected };
        browser.on('disconnected', onDisconnected);

        logger.info(`[RelayCache] Cached Browser connection for future reuse`);
        return browser;
      } catch (err) {
        lastErr = err;
        const delay = 250 + attempt * 250;
        logger.warn(`[RelayCache] Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    logger.error(`[RelayCache] All connection attempts failed:`, lastErr);
    throw lastErr instanceof Error ? lastErr : new Error('CDP connect failed');
  };

  connecting = connectWithRetry().finally(() => {
    connecting = null;
  });

  return await connecting;
}

/**
 * Force disconnect (error recovery)
 */
export function forceDisconnect(): void {
  if (!cached) {
    logger.info(`[RelayCache] No cached connection to disconnect`);
    return;
  }

  const cur = cached;
  cached = null;
  connecting = null;

  // Remove disconnected listener to prevent race
  if (cur.onDisconnected && typeof cur.browser.off === 'function') {
    cur.browser.off('disconnected', cur.onDisconnected);
  }

  // Fire-and-forget close
  logger.info(`[RelayCache] Force disconnecting Browser`);
  cur.browser.close().catch(() => {});
}

/**
 * Get cache status (for debugging)
 */
export function getCacheStatus(): { hasCached: boolean; cdpUrl?: string } {
  return {
    hasCached: cached !== null,
    cdpUrl: cached?.cdpUrl,
  };
}
