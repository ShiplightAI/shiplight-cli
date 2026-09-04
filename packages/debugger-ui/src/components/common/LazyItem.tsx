import React from "react";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";

interface LazyItemProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  rootMargin?: string;
  minHeight?: string | number;
}

/**
 * Component that only renders its children when they enter the viewport
 */
export function LazyItem({ children, fallback, rootMargin = "100px", minHeight }: LazyItemProps) {
  const [ref, isIntersecting] = useIntersectionObserver({
    rootMargin,
    triggerOnce: true,
  });

  return (
    <div ref={ref} style={{ minHeight: minHeight || "auto" }}>
      {isIntersecting ? children : fallback || null}
    </div>
  );
}

