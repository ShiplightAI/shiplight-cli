/**
 * File operation utilities for Agent
 * Provides functions for file uploads and file handling
 */

import { Page, Locator } from 'playwright';
import fs from 'fs';
import logger from '../utils/logger';
import { WebAgentContext } from './types';
import path from 'path';

/**
 * Options for uploadWithLocator
 */
export interface UploadWithLocatorOptions {
  /**
   * Whether to directly set files on a file input element (true)
   * or click and use file chooser dialog (false, default)
   */
  useFileInput?: boolean;

  /**
   * Timeout in milliseconds for upload operations
   */
  timeout: number;

  /**
   * Mock window.showOpenFilePicker for sites that use the File System Access API
   * instead of standard file inputs. Workaround for Playwright issue #8850.
   */
  mockShowOpenFilePicker?: boolean;
}

/**
 * File upload options
 */
export interface UploadFileOptions {
  /**
   * CSS selector, XPath, or Playwright locator for the file input element
   * If not provided, AI will be used to find the file input
   */
  selector?: string | Locator;

  /**
   * Natural language description of the upload target (used when selector is not provided)
   * Example: "profile picture upload", "document attachment area"
   */
  targetDescription?: string;

  /**
   * Whether to directly set files on a file input element (true)
   * or click and use file chooser dialog (false, default)
   */
  useFileInput?: boolean;

  /**
   * Timeout in milliseconds for upload operations (default: 20000)
   */
  timeout?: number;
}

/**
 * Upload one or more files to a file input element
 *
 * @param page - Playwright Page object
 * @param filePaths - File path(s) relative to test data directory, or absolute paths
 * @param options - Upload options (selector, target description, etc.)
 * @param context - Agent context for file path resolution
 * @param executeAiAction - Function to execute AI action when no selector is provided
 * @param stepId - Optional step ID for tracking
 */
export async function uploadFile(
  page: Page,
  filePaths: string | string[],
  options: UploadFileOptions,
  context: WebAgentContext,
  executeAiAction?: (page: Page, statement: string, stepId?: string) => Promise<any>,
  stepId?: string
): Promise<void> {
  // Normalize file paths to array
  const filePathsArray = Array.isArray(filePaths) ? filePaths : [filePaths];

  if (filePathsArray.length === 0) {
    throw new Error('No file paths provided for upload');
  }

  // Resolve file paths (relative to test data directory)
  const resolvedPaths = filePathsArray.map(filePath => {
    // If path is absolute, use as-is
    if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:\\/)) {
      return filePath;
    }
    // Otherwise, resolve relative to test data directory
    const testDataDir = context.testDataDir || process.cwd();
    return path.join(testDataDir, filePath);
  });

  logger.info(`Uploading files: ${resolvedPaths.join(', ')}`);

  const timeout = options.timeout || 20000;

  const uploadOptions: UploadWithLocatorOptions = {
    useFileInput: options.useFileInput || false,
    timeout,
  };

  // Case 1: Locator object provided directly
  if (options.selector && typeof options.selector !== 'string') {
    const locator = options.selector as Locator;
    await uploadWithLocator(page, locator, resolvedPaths, uploadOptions);
    return;
  }

  // Case 2: Selector string provided
  if (options.selector && typeof options.selector === 'string') {
    const selector = options.selector;
    const locator = selector.startsWith('xpath=')
      ? page.locator(selector)
      : page.locator(selector);

    await uploadWithLocator(page, locator, resolvedPaths, uploadOptions);
    return;
  }

  // Case 3: No selector provided, use AI to find and upload
  if (executeAiAction) {
    const filesDescription = filePathsArray.map(p => `"${p}"`).join(', ');
    let uploadStatement = '';

    if (options.targetDescription) {
      uploadStatement = `Upload ${filesDescription} to ${options.targetDescription}`;
    } else {
      uploadStatement = `Upload ${filesDescription}`;
    }

    logger.info(`Using AI to handle file upload: ${uploadStatement}`);
    await executeAiAction(page, uploadStatement, stepId);
  } else {
    throw new Error('No selector provided and AI action execution is not available');
  }
}

/**
 * Upload files using a Playwright locator
 *
 * This is the core upload implementation used by both the programmatic API
 * and the action-based upload_file action.
 *
 * @param page - Playwright page
 * @param locator - Element locator to click or set files on
 * @param filePaths - Absolute paths to files to upload
 * @param options - Upload options
 */
export async function uploadWithLocator(
  page: Page,
  locator: Locator,
  filePaths: string[],
  options: UploadWithLocatorOptions
): Promise<void> {
  const { useFileInput, timeout, mockShowOpenFilePicker } = options;

  // For websites that implement file upload using window.showOpenFilePicker,
  // there is a known issue where Playwright's filechooser event is not triggered.
  // Workaround: mock the showOpenFilePicker function.
  // Refer to https://github.com/microsoft/playwright/issues/8850 for more details
  if (mockShowOpenFilePicker) {
    logger.info('Using mockShowOpenFilePicker approach');
    const files = filePaths.map(p => ({
      path: p,
      buffer: new Uint8Array(fs.readFileSync(p)),
    }));

    await page.evaluate((files) => {
      (window as any).__pw_showOpenFilePicker_mock_files = files;
    }, files);
    await locator.click({ timeout });
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      delete (window as any).__pw_showOpenFilePicker_mock_files;
    });
  } else if (useFileInput) {
    // Direct file input approach - set files directly on input element
    logger.info('Using direct file input approach');
    await locator.setInputFiles(filePaths, { timeout });
    await page.waitForTimeout(3000); // Wait for upload to process
  } else {
    // File chooser approach - click element and wait for file chooser dialog
    logger.info('Using file chooser approach');
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout });
    // Prevent unhandled rejection if fileChooserPromise times out while click is still waiting.
    // This can happen when the locator doesn't exist - click waits for the element while
    // fileChooserPromise's timer runs out. The actual error will still be thrown when awaited.
    fileChooserPromise.catch(() => {});
    await locator.click({ timeout });
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePaths);
    await page.waitForTimeout(3000); // Wait for upload to process
  }

  logger.info(`Successfully uploaded ${filePaths.length} file(s)`);
}
