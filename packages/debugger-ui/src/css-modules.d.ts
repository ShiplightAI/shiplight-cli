/**
 * Ambient declarations for CSS module imports.
 *
 * Next.js used to supply these through the generated `next-env.d.ts`, which is
 * gitignored and stopped being generated when this package left the Next app in
 * August 2026. Without them `tsc` cannot resolve `./X.module.css`, so the
 * package's typecheck fails on a clean checkout even though vite builds fine.
 */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
