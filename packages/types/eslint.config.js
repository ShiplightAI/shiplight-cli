/**
 * ESLint config for shiplight-types
 *
 * This package is intended to be published publicly.
 * It must not depend on internal monorepo packages.
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
            message: 'Public packages cannot import from the internal shared package (internal).',
          },
          {
            group: ['@monots/*'],
            message: 'Public packages cannot import from @monots/* internal apps.',
          },
        ],
      }],
    },
  },
);
