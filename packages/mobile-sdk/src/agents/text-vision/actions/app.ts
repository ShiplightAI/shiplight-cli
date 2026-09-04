/**
 * App Management Actions
 *
 * Launch, close, install, and manage apps.
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Open App Action
// =============================================================================

export class OpenAppAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const packageName = action_data?.kwargs?.package;

    if (!packageName) {
      return { success: false, error: 'Package name is required for open_app action' };
    }

    try {
      await driver.activateApp(packageName);
      return { success: true, message: `Opened app ${packageName}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const packageName = actionEntity.action_data?.kwargs?.package;
    if (!packageName) return [`// open_app: missing package`];
    return [`await driver.activateApp(${JSON.stringify(packageName)});`];
  }
}

export const OpenAppToolSchema = z.object({
  package: z.string().describe('App package name (e.g., "com.android.settings")'),
});

// =============================================================================
// Close App Action
// =============================================================================

export class CloseAppAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const packageName = action_data?.kwargs?.package;

    if (!packageName) {
      return { success: false, error: 'Package name is required for close_app action' };
    }

    try {
      await driver.terminateApp(packageName);
      return { success: true, message: `Closed app ${packageName}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const packageName = actionEntity.action_data?.kwargs?.package;
    if (!packageName) return [`// close_app: missing package`];
    return [`await driver.terminateApp(${JSON.stringify(packageName)});`];
  }
}

export const CloseAppToolSchema = z.object({
  package: z.string().describe('App package name to close'),
});

// =============================================================================
// Install App Action
// =============================================================================

export class InstallAppAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const appPath = action_data?.kwargs?.path;

    if (!appPath) {
      return { success: false, error: 'App path is required for install_app action' };
    }

    try {
      await driver.installApp(appPath);
      return { success: true, message: `Installed app from ${appPath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const appPath = actionEntity.action_data?.kwargs?.path;
    if (!appPath) return [`// install_app: missing path`];
    return [`await driver.installApp(${JSON.stringify(appPath)});`];
  }
}

export const InstallAppToolSchema = z.object({
  path: z.string().describe('Path to APK file'),
});

// =============================================================================
// Uninstall App Action
// =============================================================================

export class UninstallAppAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const packageName = action_data?.kwargs?.package;

    if (!packageName) {
      return { success: false, error: 'Package name is required for uninstall_app action' };
    }

    try {
      await driver.removeApp(packageName);
      return { success: true, message: `Uninstalled app ${packageName}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const packageName = actionEntity.action_data?.kwargs?.package;
    if (!packageName) return [`// uninstall_app: missing package`];
    return [`await driver.removeApp(${JSON.stringify(packageName)});`];
  }
}

export const UninstallAppToolSchema = z.object({
  package: z.string().describe('App package name to uninstall'),
});

// =============================================================================
// Is App Installed Action
// =============================================================================

export class IsAppInstalledAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const packageName = action_data?.kwargs?.package;

    if (!packageName) {
      return { success: false, error: 'Package name is required for is_app_installed action' };
    }

    try {
      const installed = await driver.isAppInstalled(packageName);
      return {
        success: true,
        value: installed,
        message: `App ${packageName} installed: ${installed}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const packageName = actionEntity.action_data?.kwargs?.package;
    if (!packageName) return [`// is_app_installed: missing package`];
    return [`const installed = await driver.isAppInstalled(${JSON.stringify(packageName)});`];
  }
}

export const IsAppInstalledToolSchema = z.object({
  package: z.string().describe('App package name to check'),
});
