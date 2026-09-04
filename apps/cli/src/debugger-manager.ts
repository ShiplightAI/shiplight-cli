/**
 * Public entry for the multi-session debugger manager.
 *
 * Consumed by:
 *   - `shiplight debug` CLI (N=1 session per invocation)
 *   - apps/testbox's OmniTerm server (N per container)
 *   - (future) VSCode extension (N per editor instance)
 *
 * The implementation lives in `./debugger/manager.ts` and is re-exported
 * here so downstream packages can `import { DebuggerManager } from
 * "shiplightai/debugger-manager"`.
 */

export { DebuggerManager } from "./debugger/manager.js";
export type {
  DebuggerSession,
  ManagerOptions,
  SessionStatus,
} from "./debugger/manager.js";
