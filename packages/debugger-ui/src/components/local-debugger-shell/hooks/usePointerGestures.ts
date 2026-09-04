/**
 * usePointerGestures — single hook that translates pointer/click events into
 * the gesture vocabulary the file tree uses.
 *
 * Click behavior:
 *   - Single click → focus + open (file opens, directory toggles)
 *   - Long-press 500ms → context menu (touch)
 *   - Right-click → context menu (mouse)
 *
 * Touch behavior:
 *   - touch-action: manipulation in CSS kills the 300ms double-tap zoom
 *   - long-press is cancelled if the pointer moves >10px (a scroll, not a press)
 */

import { useCallback, useRef } from "react";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

interface GestureCallbacks {
  onFocus: () => void;
  onOpen: () => void;
  onContextMenu: (x: number, y: number) => void;
}

interface UsePointerGesturesArgs extends GestureCallbacks {
  isFocused: boolean;
}

interface GestureHandlers {
  onClick: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function usePointerGestures(args: UsePointerGesturesArgs): GestureHandlers {
  const { onFocus, onOpen, onContextMenu, isFocused } = args;

  const longPressedRef = useRef(false);

  const downRef = useRef<{
    x: number;
    y: number;
    longPressTimer: number | null;
  } | null>(null);

  const clearLongPress = useCallback(() => {
    const d = downRef.current;
    if (d && d.longPressTimer !== null) {
      window.clearTimeout(d.longPressTimer);
      d.longPressTimer = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      longPressedRef.current = false;
      downRef.current = {
        x: e.clientX,
        y: e.clientY,
        longPressTimer: null,
      };

      if (e.pointerType === "touch") {
        const x = e.clientX;
        const y = e.clientY;
        downRef.current.longPressTimer = window.setTimeout(() => {
          longPressedRef.current = true;
          onContextMenu(x, y);
        }, LONG_PRESS_MS);
      }
    },
    [onContextMenu],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = downRef.current;
      if (!d) return;
      const dx = Math.abs(e.clientX - d.x);
      const dy = Math.abs(e.clientY - d.y);
      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
        clearLongPress();
      }
    },
    [clearLongPress],
  );

  const onPointerUp = useCallback(() => {
    clearLongPress();
    downRef.current = null;
  }, [clearLongPress]);

  const onPointerCancel = useCallback(() => {
    clearLongPress();
    downRef.current = null;
  }, [clearLongPress]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (longPressedRef.current) {
        longPressedRef.current = false;
        return;
      }
      e.preventDefault();
      if (!isFocused) onFocus();
      onOpen();
    },
    [isFocused, onFocus, onOpen],
  );

  const onContextMenuHandler = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e.clientX, e.clientY);
    },
    [onContextMenu],
  );

  return {
    onClick: handleClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu: onContextMenuHandler,
  };
}
