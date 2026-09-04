/**
 * ESLint config for sdk-core
 *
 * This is the internal SDK core package.
 */
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.base],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['the internal shared package', 'the internal shared package/*'],
            message: 'sdk-core should not import from the internal shared package (keep sdk-core standalone).',
          },
          {
            group: ['@monots/*'],
            message: 'sdk-core should not import from @monots/* apps (keep sdk-core standalone).',
          },
        ],
      }],
      // FR-010 guard: the engine must consume configuration only from the
      // SdkConfig its host injects. Reading ambient environment here would
      // make the CLI and MCP server env allowlists unenforceable — a variable
      // could reach the agent without passing either one. Three such reads had
      // accumulated before this rule existed.
      'no-restricted-properties': ['error', {
        object: 'process',
        property: 'env',
        message:
          'sdk-core must not read process.env (001 FR-010). Read from getSdkConfig().env, ' +
          'or accept an env map as a parameter, so the host allowlist stays enforceable.',
      }],
    },
  },
);
