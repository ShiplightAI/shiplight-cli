# debugger-ui — Shiplight debugger UI

This package holds the **debugger UI** used by `shiplight debug`. It was
extracted from a larger web app in August 2026, when the hosted product around
it was retired; that app is not part of this repository. The extraction is why
`next` is still a dependency — a few kept components use `next-intl`, and one
uses `next/link`.

## What builds

Two vite bundles, both compiled from source (never `next build`):

- `vite.debugger.config.ts` — the embedded debugger SPA, served by the CLI's
  debug server under `/debugger/:sessionId/`. Root:
  `src/components/local-debugger`.
- `vite.debugger-shell.config.ts` — the outer multi-session shell served at `/`.
  Root: `src/components/local-debugger-shell`.

Both write into `apps/cli/dist/`, which is why `apps/cli`'s tsup `onSuccess`
runs `apps/cli/scripts/build-debugger-ui.mts` to invoke them. Building the CLI
builds this; you rarely need to build it directly.

```bash
pnpm build:debugger-ui   # both vite bundles (apps/cli's build already does this)
pnpm dev            # vite dev server for the debugger SPA
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint (legacy .eslintrc config)
pnpm test:unit      # node:test
```

## Notes

- `next` is still a dependency, but only because the kept components use
  `next-intl` and one uses `next/link`. There is no Next.js app here.
- The vite configs stub the modules that assumed a Next.js or Electron host —
  see `src/components/local-debugger/stubs/`.
- `shiplight-types` is aliased to its **source** directory, so this build does
  not depend on that package's `dist/` output.
- `src/common/` holds the ~33 modules vendored from the deleted internal shared package
  package. Frozen support code — don't build new features on it.
