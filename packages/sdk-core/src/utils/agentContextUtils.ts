/**
 * Agent context utilities
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import sdkConfig from '../config';

/**
 * Write JSON to file
 */
export async function writeJsonToFile(
  data: any,
  filePath: string
): Promise<void> {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to write JSON to ${filePath}:`, error);
    throw error;
  }
}

/**
 * Write results JSON if needed (based on SDK config)
 */
export async function writeResultJsonIfNeeded(
  stepResults: Record<string, any>
): Promise<void> {
  const resultsPath = sdkConfig.get('testResultsJsonPath');
  if (resultsPath && Object.keys(stepResults).length > 0) {
    await writeJsonToFile(stepResults, resultsPath);
  }
}

/**
 * Write console logs to file
 */
export async function writeConsoleLogsToFile(
  consoleLogs: Array<{message?: string, type: string, [key: string]: any}>
): Promise<void> {
  const logsPath = sdkConfig.get('consoleLogsPath');
  if (logsPath && consoleLogs.length > 0) {
    await writeJsonToFile(consoleLogs, logsPath);
  }
}