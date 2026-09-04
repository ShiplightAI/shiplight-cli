import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";

export interface SplitPanelProps {
  /** Left panel content (e.g. a ScrollArea) */
  left: ReactNode;
  /** Right panel content (e.g. a ScrollArea) */
  right: ReactNode;
  /** Initial left panel width as percentage (default: 35) */
  defaultLeftSize?: number;
  /** Minimum left panel width percentage (default: 20) */
  minLeftSize?: number;
  /** Maximum left panel width percentage (default: 60) */
  maxLeftSize?: number;
  /** Optional class name for the root container */
  className?: string;
  /** Optional inline style for the root container */
  style?: React.CSSProperties;
}

const RESIZE_HANDLE_WIDTH = 8;

export function SplitPanel({
  left,
  right,
  defaultLeftSize = 35,
  minLeftSize = 20,
  maxLeftSize = 60,
  className = "",
  style,
}: SplitPanelProps) {
  const [leftSize, setLeftSize] = useState(defaultLeftSize);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startLeftSizeRef = useRef(defaultLeftSize);
  const leftSizeRef = useRef(leftSize);
  const minLeftRef = useRef(minLeftSize);
  const maxLeftRef = useRef(maxLeftSize);
  leftSizeRef.current = leftSize;
  minLeftRef.current = minLeftSize;
  maxLeftRef.current = maxLeftSize;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    startLeftSizeRef.current = leftSizeRef.current;
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const containerWidth = el.offsetWidth;
      if (containerWidth <= 0) return;
      const deltaX = e.clientX - startXRef.current;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const minL = minLeftRef.current;
      const maxL = maxLeftRef.current;
      const newLeftSize = Math.min(maxL, Math.max(minL, startLeftSizeRef.current + deltaPercent));
      setLeftSize(newLeftSize);
      startXRef.current = e.clientX;
      startLeftSizeRef.current = newLeftSize;
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className={`flex w-full h-full ${className}`}
      style={style}
    >
      <div
        className="flex flex-col shrink-0 overflow-hidden h-full"
        style={{ width: `calc(${leftSize}% - ${RESIZE_HANDLE_WIDTH / 2}px)` }}
      >
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={leftSize}
        onMouseDown={handleMouseDown}
        className="shrink-0 flex flex-col items-center justify-center cursor-col-resize hover:bg-primary/10 active:bg-primary/20 transition-colors group select-none"
        style={{ width: RESIZE_HANDLE_WIDTH, minWidth: RESIZE_HANDLE_WIDTH }}
      >
        <div className="w-0.5 h-10 rounded-full bg-secondary opacity-50 group-hover:opacity-100 group-active:opacity-100 pointer-events-none" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden h-full">
        {right}
      </div>
    </div>
  );
}
