/**
 * ContextMenu — small floating menu, anchored at a screen-space point.
 *
 * Usage:
 *   <ContextMenu x={x} y={y} items={[{label, onSelect}]} onDismiss={...} />
 *
 * Auto-dismisses on outside-click, Escape, or any item invocation. Items
 * have a touch-friendly 32px minimum height.
 */

import React, { useEffect, useRef } from "react";
import { colors } from "./theme";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onDismiss: () => void;
}

export function ContextMenu({ x, y, items, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent | TouchEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onDismiss();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    // Defer the listener install one tick so the click that opened us doesn't
    // immediately dismiss it.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", handleDocClick);
      window.addEventListener("touchstart", handleDocClick);
      window.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", handleDocClick);
      window.removeEventListener("touchstart", handleDocClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onDismiss]);

  // Clamp to viewport so the menu doesn't render off-screen
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const left = Math.min(x, Math.max(0, vw - 200));
  const top = Math.min(y, Math.max(0, vh - items.length * 36 - 8));

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      style={{
        position: "fixed",
        left,
        top,
        minWidth: 180,
        background: colors.bgRaised,
        border: `1px solid ${colors.bgInputHint}`,
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        padding: 4,
        zIndex: 1000,
        userSelect: "none",
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onDismiss();
          }}
          style={{
            display: "block",
            width: "100%",
            minHeight: 32,
            padding: "6px 12px",
            background: "transparent",
            border: "none",
            color: item.disabled ? colors.textDim : colors.textPrimary,
            textAlign: "left",
            fontSize: 13,
            cursor: item.disabled ? "not-allowed" : "pointer",
            borderRadius: 4,
            touchAction: "manipulation",
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) e.currentTarget.style.background = colors.bgInputHint;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
