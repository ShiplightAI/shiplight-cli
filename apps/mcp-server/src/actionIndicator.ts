/**
 * Action Indicator
 *
 * Injects brief visual overlays into the browser page so that agent actions
 * (clicks, keypresses) are clearly visible in recorded videos.
 */

import type { Page } from "playwright";
import type { DOMState } from "sdk-core";
import { logger } from "sdk-core";

const CLICK_ACTIONS = new Set(['click', 'double_click', 'right_click', 'hover']);
const KEY_ACTIONS = new Set(['press', 'send_keys_on_element']);

const INDICATOR_CSS = `
  @keyframes _sl_ripple {
    0%   { transform: translate(-50%,-50%) scale(1.0); opacity: 1; }
    60%  { transform: translate(-50%,-50%) scale(1.8); opacity: 0.9; }
    100% { transform: translate(-50%,-50%) scale(4.0); opacity: 0; }
  }
  @keyframes _sl_dot {
    0%   { transform: translate(-50%,-50%) scale(1.0); opacity: 1; }
    40%  { transform: translate(-50%,-50%) scale(1.0); opacity: 1; }
    100% { transform: translate(-50%,-50%) scale(0.0); opacity: 0; }
  }
  @keyframes _sl_key_pop {
    0%   { opacity: 0; transform: scale(0.6); }
    15%  { opacity: 1; transform: scale(1.15); }
    25%  { transform: scale(1.0); }
    75%  { opacity: 1; transform: scale(1.0); }
    100% { opacity: 0; transform: scale(0.9); }
  }
`;

/**
 * Injects a brief visual indicator into the page so that agent actions
 * (clicks, keypresses) are visible in recorded videos.
 *
 * Waits 300ms after injecting so the browser render cycle paints the
 * indicator before the action executes (guarantees video frames capture it).
 *
 * This is best-effort — failures are silently swallowed so they never
 * interfere with the action being executed.
 *
 * Callers gate this behind SHIPLIGHT_ACTION_INDICATORS=1 (checked in server.ts).
 */
export async function showActionIndicator(
  page: Page,
  actionName: string,
  actionParams: Record<string, any>,
  domState?: DOMState | null,
  isRecording?: boolean,
): Promise<void> {
  // Inject animation styles once per page (sentinel guards against re-injection after
  // repeated calls and survives correctly after navigation). Best-effort.
  await page.evaluate((css) => {
    if (document.getElementById('_sl_styles')) return;
    const style = document.createElement('style');
    style.id = '_sl_styles';
    style.textContent = css;
    document.head.appendChild(style);
  }, INDICATOR_CSS).catch(() => {});

  if (CLICK_ACTIONS.has(actionName)) {
    const elementIndex = actionParams.element_index;
    if (typeof elementIndex === 'number') {
      let coords: { x: number; y: number } | null = null;

      // Primary: use viewport coordinates from cached DOM state
      if (domState) {
        const element = domState.selectorMap.get(elementIndex);
        const vc = element?.viewportCoordinates?.center;
        if (vc) {
          coords = vc;
        } else if (element?.xpath) {
          // Fallback: ask Playwright for the live bounding box
          try {
            const xpathExpr = element.xpath.startsWith('//') ? element.xpath : `//${element.xpath}`;
            const bbox = await page
              .locator(`xpath=${xpathExpr}`)
              .first()
              .boundingBox({ timeout: 2000 });
            if (bbox) {
              coords = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
            }
          } catch {
            // ignore - indicator is best-effort
          }
        }
      }
      if (coords) {
        const { x, y } = coords;
        const isDouble = actionName === 'double_click';
        logger.debug(`[indicator] ${actionName} at (${Math.round(x)}, ${Math.round(y)})`);
        await page.evaluate(
          ({ x, y, isDouble }: { x: number; y: number; isDouble: boolean }) => {
            // Cancel any in-progress indicators from a previous action
            const win = window as typeof window & { _sl_timers?: ReturnType<typeof setTimeout>[] };
            if (win._sl_timers) {
              win._sl_timers.forEach((id) => clearTimeout(id));
              document.querySelectorAll('._sl_indicator').forEach((el) => el.remove());
            }
            win._sl_timers = [];
            // Outer expanding ring
            function makeRipple(delayMs: number) {
              const el = document.createElement('div');
              el.className = '_sl_indicator';
              el.style.cssText = [
                'position:fixed',
                `left:${x}px`,
                `top:${y}px`,
                'width:80px',
                'height:80px',
                'border-radius:50%',
                'background:rgba(255,30,30,0.25)',
                'border:5px solid rgba(255,30,30,0.9)',
                'pointer-events:none',
                // Maximum z-index is intentional: indicator must appear above any app-level
                // overlays (modals, tooltips, drawers) in the page under test.
                'z-index:2147483647',
                `animation:_sl_ripple 0.9s ${delayMs}ms ease-out forwards`,
              ].join(';');
              document.body.appendChild(el);
              win._sl_timers!.push(setTimeout(() => el.remove(), 1000 + delayMs));
            }
            // Solid center dot that stays visible then shrinks
            function makeDot() {
              const el = document.createElement('div');
              el.className = '_sl_indicator';
              el.style.cssText = [
                'position:fixed',
                `left:${x}px`,
                `top:${y}px`,
                'width:28px',
                'height:28px',
                'border-radius:50%',
                'background:rgba(255,30,30,0.95)',
                'pointer-events:none',
                'z-index:2147483647',
                'animation:_sl_dot 0.8s ease-in forwards',
              ].join(';');
              document.body.appendChild(el);
              win._sl_timers!.push(setTimeout(() => el.remove(), 850));
            }
            makeRipple(0);
            makeRipple(200);
            makeDot();
            if (isDouble) {
              makeRipple(400);
              makeRipple(600);
            }
          },
          { x, y, isDouble },
        );
        // Wait for the browser paint cycle so the indicator is captured in video frames.
        // Skip the delay when not recording — it would only slow down non-recorded runs.
        if (isRecording) {
          await page.waitForTimeout(300);
        }
      } else {
        logger.debug(`[indicator] ${actionName}: no coords for element_index ${elementIndex}`);
      }
    }
  } else if (KEY_ACTIONS.has(actionName)) {
    const keys = actionParams.keys;
    if (typeof keys === 'string') {
      logger.debug(`[indicator] ${actionName}: keys="${keys}"`);
      await page.evaluate(
        ({ keysText }: { keysText: string }) => {
          const win = window as typeof window & { _sl_timers?: ReturnType<typeof setTimeout>[] };
          if (win._sl_timers) {
            win._sl_timers.forEach((id) => clearTimeout(id));
            document.querySelectorAll('._sl_indicator').forEach((el) => el.remove());
          }
          win._sl_timers = [];
          const el = document.createElement('div');
          el.className = '_sl_indicator';
          el.style.cssText = [
            'position:fixed',
            'bottom:32px',
            'left:0',
            'right:0',
            'width:fit-content',
            'margin:0 auto',
            'background:#1a1a1a',
            'color:#fff',
            'padding:14px 28px',
            'border-radius:12px',
            'font-size:28px',
            'font-family:ui-monospace,monospace',
            'font-weight:800',
            'letter-spacing:0.04em',
            'pointer-events:none',
            // Maximum z-index is intentional: see click indicator comment above.
            'z-index:2147483647',
            'border:3px solid rgba(255,255,255,0.25)',
            'box-shadow:0 4px 32px rgba(0,0,0,0.5)',
            'animation:_sl_key_pop 1.4s ease-out forwards',
          ].join(';');
          el.textContent = '\u2328\ufe0f ' + keysText;
          document.body.appendChild(el);
          win._sl_timers.push(setTimeout(() => el.remove(), 1500));
        },
        { keysText: keys },
      );
      // Wait for the browser paint cycle so the indicator is captured in video frames.
      // Skip the delay when not recording — it would only slow down non-recorded runs.
      if (isRecording) {
        await page.waitForTimeout(300);
      }
    }
  }
}
