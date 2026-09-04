/**
 * Utility for loading user-defined test functions
 */

import * as fs from 'fs/promises';
import * as vm from 'vm';
import logger from './logger';

/**
 * Wrap a dynamically imported module as a vm.SyntheticModule so it can be
 * returned from importModuleDynamically callbacks on vm.Script/vm.Module.
 * Node.js 22+ requires a proper vm.Module instance rather than a plain object.
 */
async function createSyntheticModule(specifier: string, context: vm.Context): Promise<vm.SyntheticModule> {
  const imported = await import(specifier);
  const exportNames = Object.keys(imported);

  const syntheticModule = new vm.SyntheticModule(
    exportNames,
    function (this: vm.SyntheticModule) {
      for (const name of exportNames) {
        this.setExport(name, (imported as any)[name]);
      }
    },
    { context }
  );

  await syntheticModule.link(() => { throw new Error(`Nested imports not supported in VM context`); });
  await syntheticModule.evaluate();
  return syntheticModule;
}

/**
 * Inject a user function into a function scope (e.g., global or VM context)
 * @param functionScope The scope to inject the function into
 * @param name The name of the function
 * @param jsCode The JavaScript code of the function
 * @param forceOverride Whether to override existing functions
 */
export function injectUserFunction(
  functionScope: any,
  name: string,
  jsCode: string,
  forceOverride: boolean = false
): void {
  // Check for existing function
  if (functionScope[name]) {
    if (forceOverride) {
      logger.info(`Overriding existing function: ${name}`);
      delete functionScope[name]; // Clean up the old function
    } else {
      logger.error(`The name ${name} is already defined in the global scope`);
      return;
    }
  }

  try {
    let fn: any;

    // Check if functionScope is a VM context (has vm.isContext)
    // If so, run the code in that context to capture the correct console
    if (vm.isContext(functionScope)) {
      // Run in VM context so the function captures the context's console
      const script = new vm.Script(jsCode, {
        importModuleDynamically: async (specifier) => {
          return createSyntheticModule(specifier, functionScope);
        }
      });
      fn = script.runInContext(functionScope);
    } else {
      // Fallback to eval for non-VM contexts (e.g., global scope)
      fn = (0, eval)(jsCode);
    }

    if (typeof fn !== 'function') {
      throw new Error('The injected code must be a function');
    }
    functionScope[name] = fn;
  } catch (error: any) {
    logger.error(`Error injecting user function ${name}: ${error.message}`);
    // Don't throw the error, just log it
  }
}

/**
 * Load user functions from a JSON file and inject them into the function scope
 * @param functionScope The scope to inject functions into (typically global)
 * @param path The path to the JSON file containing function definitions
 * @param forceOverride Whether to override existing functions
 */
export async function loadUserFunctions(
  functionScope: any,
  path: string,
  forceOverride: boolean = false
): Promise<void> {
  try {
    const fileContent = await fs.readFile(path, 'utf8');
    const functionMap = JSON.parse(fileContent);
    logger.info(`Loading ${Object.keys(functionMap).length} user functions...`);

    for (const [name, code] of Object.entries(functionMap)) {
      injectUserFunction(functionScope, name, code as string, forceOverride);
    }
  } catch (error: any) {
    logger.error('Failed to load user functions:', error);
    throw error;
  }
}
