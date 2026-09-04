/**
 * Stub for next/router in the standalone Vite SPA build.
 * Some bundled components import useRouter but never use it.
 */

export function useRouter() {
  return {
    pathname: "/",
    query: {},
    asPath: "/",
    push: async () => true,
    replace: async () => true,
    reload: () => {},
    back: () => {},
    events: { on: () => {}, off: () => {}, emit: () => {} },
    isReady: true,
  };
}

// eslint-disable-next-line import/no-anonymous-default-export
export default { useRouter };
