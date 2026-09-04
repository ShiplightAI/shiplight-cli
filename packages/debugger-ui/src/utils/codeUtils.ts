import { transform } from '@babel/standalone';

/**
 * Transpile the code from TypeScript to JavaScript.
 * @param code the code to transpile
 * @param filename the filename of the code
 * @returns the transpiled code
 */
export function validateCode(code: string, filename: string): boolean {
  try {
    const result = transform(code, {
      filename,
      presets: ['react', 'env', 'typescript'],
    });

    if (!result || !result.code) {
      return false;
    }

    return true;
  } catch (error: any) {
    return false;
  }
}