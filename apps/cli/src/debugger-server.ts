/**
 * Public entry for the multi-session debugger HTTP + WebSocket routes.
 *
 * Consumed by hosts that mount the debugger inside their own Express app —
 * notably the testbox image (one set of routes per container, shared
 * `DebuggerManager`), and any future host like a VSCode extension.
 *
 * The implementation lives in `./debugger/serverRoutes.ts` and is re-exported
 * here so downstream packages can `import { createDebuggerHttpRoutes,
 * handleDebuggerUpgrade } from "shiplightai/debugger-server"` instead of
 * reaching into the apps/cli source tree.
 *
 * Pair with `shiplightai/debugger-manager` (the shared `DebuggerManager`)
 * and the debugger SPA bundle that ships inside this package at
 * `<shiplightai>/dist/static/`.
 */

export {
  createDebuggerHttpRoutes,
  handleDebuggerUpgrade,
} from "./debugger/serverRoutes.js";
export type { ServerRoutesOptions } from "./debugger/serverRoutes.js";
