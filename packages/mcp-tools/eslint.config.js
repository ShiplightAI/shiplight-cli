/**
 * ESLint config for mcp-tools
 *
 * The package already had `"lint": "eslint src/"`, but no config — so ESLint 9
 * failed with the flat-config migration notice rather than linting anything.
 */
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'chrome-extension/**'] },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.base],
  },
);
