/**
 * Stub for next/dynamic in the standalone Vite SPA build.
 * Replaces Next.js dynamic imports with standard React.lazy.
 */

import React from "react";

type DynamicOptions = {
  ssr?: boolean;
  loading?: () => React.ReactNode;
};

export default function dynamic<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T } | T>,
  _options?: DynamicOptions,
): T {
  const LazyComponent = React.lazy(async () => {
    const mod = await importFn();
    // Handle both `export default` and bare component exports
    if ("default" in mod) return mod as { default: T };
    return { default: mod as T };
  });

  // Wrap in Suspense so callers don't need to
  // eslint-disable-next-line react/display-name
  const Wrapper = React.forwardRef((props: any, ref: any) =>
    React.createElement(
      React.Suspense,
      { fallback: _options?.loading ? React.createElement(_options.loading) : null },
      React.createElement(LazyComponent, { ...props, ref }),
    ),
  ) as unknown as T;

  return Wrapper;
}
