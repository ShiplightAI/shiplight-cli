/**
 * Agent Actions
 *
 * Control flow actions for test agents (wait, assert, done).
 */

import { z } from 'zod';
import type { Browser } from 'webdriverio';
import type { IAction, MobileActionEntity, ActionResult } from './types';
import { findElement, transpileLocator } from './types';
import type { MobileAgentServices } from '../mobileAgentServices';

// =============================================================================
// Wait Action
// =============================================================================

export class WaitAction implements IAction {
  async execute(
    _driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const seconds = action_data?.kwargs?.seconds ?? 1;

    try {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return { success: true, message: `Waited ${seconds} seconds` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const seconds = actionEntity.action_data?.kwargs?.seconds ?? 1;
    return [`await driver.pause(${seconds * 1000});`];
  }
}

export const WaitToolSchema = z.object({
  seconds: z.number().min(0).max(30).describe('Number of seconds to wait (max 30)'),
});

// =============================================================================
// Wait For Element Action
// =============================================================================

export class WaitForElementAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator, action_data } = actionEntity;
    const timeoutSeconds = action_data?.kwargs?.timeout_seconds ?? 10;

    if (!locator) {
      return { success: false, error: 'Locator is required for wait_for_element action' };
    }

    try {
      const timeoutMs = timeoutSeconds * 1000;
      const pollInterval = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        try {
          const element = await findElement(driver, locator);
          const displayed = await element.isDisplayed();
          if (displayed) {
            return {
              success: true,
              message: `Element ${locator} appeared after ${Date.now() - startTime}ms`,
            };
          }
        } catch {
          // Element not found, continue waiting
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      return {
        success: false,
        error: `Element ${locator} did not appear within ${timeoutSeconds}s`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator, action_data } = actionEntity;
    const timeoutSeconds = action_data?.kwargs?.timeout_seconds ?? 10;
    if (!locator) {
      return [`// wait_for_element: missing locator`];
    }
    return [`await ${transpileLocator(locator)}.waitForDisplayed({ timeout: ${timeoutSeconds * 1000} });`];
  }
}

export const WaitForElementToolSchema = z.object({
  locator: z.string().describe('Element locator to wait for'),
  timeout_seconds: z.number().optional().describe('Maximum wait time in seconds (default: 10)'),
});

// =============================================================================
// Wait For Element Gone Action
// =============================================================================

export class WaitForElementGoneAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator, action_data } = actionEntity;
    const timeoutSeconds = action_data?.kwargs?.timeout_seconds ?? 10;

    if (!locator) {
      return { success: false, error: 'Locator is required for wait_for_element_gone action' };
    }

    try {
      const timeoutMs = timeoutSeconds * 1000;
      const pollInterval = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        try {
          const element = await findElement(driver, locator);
          const displayed = await element.isDisplayed();
          if (!displayed) {
            return {
              success: true,
              message: `Element ${locator} disappeared after ${Date.now() - startTime}ms`,
            };
          }
        } catch {
          // Element not found means it's gone
          return {
            success: true,
            message: `Element ${locator} disappeared after ${Date.now() - startTime}ms`,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      return {
        success: false,
        error: `Element ${locator} did not disappear within ${timeoutSeconds}s`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator, action_data } = actionEntity;
    const timeoutSeconds = action_data?.kwargs?.timeout_seconds ?? 10;
    if (!locator) {
      return [`// wait_for_element_gone: missing locator`];
    }
    return [`await ${transpileLocator(locator)}.waitForDisplayed({ timeout: ${timeoutSeconds * 1000}, reverse: true });`];
  }
}

export const WaitForElementGoneToolSchema = z.object({
  locator: z.string().describe('Element locator to wait for disappearance'),
  timeout_seconds: z.number().optional().describe('Maximum wait time in seconds (default: 10)'),
});

// =============================================================================
// Assert Action
// =============================================================================

export class AssertAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { locator, action_data } = actionEntity;
    const condition = action_data?.kwargs?.condition;
    const expectedValue = action_data?.kwargs?.expected_value;

    if (!locator) {
      return { success: false, error: 'Locator is required for assert action' };
    }

    if (!condition) {
      return { success: false, error: 'Condition is required for assert action' };
    }

    try {
      const element = await findElement(driver, locator);

      let actualValue: any;
      let passed = false;

      switch (condition) {
        case 'exists':
          actualValue = await element.isExisting();
          passed = actualValue === true;
          break;
        case 'not_exists':
          try {
            actualValue = await element.isExisting();
            passed = actualValue === false;
          } catch {
            passed = true;
          }
          break;
        case 'displayed':
          actualValue = await element.isDisplayed();
          passed = actualValue === true;
          break;
        case 'not_displayed':
          actualValue = await element.isDisplayed();
          passed = actualValue === false;
          break;
        case 'enabled':
          actualValue = await element.isEnabled();
          passed = actualValue === true;
          break;
        case 'disabled':
          actualValue = await element.isEnabled();
          passed = actualValue === false;
          break;
        case 'text_equals':
          actualValue = await element.getText();
          passed = actualValue === expectedValue;
          break;
        case 'text_contains':
          actualValue = await element.getText();
          passed = actualValue.includes(expectedValue);
          break;
        case 'checked':
          actualValue = await element.getAttribute('checked');
          passed = actualValue === 'true';
          break;
        case 'unchecked':
          actualValue = await element.getAttribute('checked');
          passed = actualValue !== 'true';
          break;
        default:
          return { success: false, error: `Unknown condition: ${condition}` };
      }

      if (passed) {
        return {
          success: true,
          value: actualValue,
          message: `Assertion passed: ${locator} ${condition}`,
        };
      } else {
        return {
          success: false,
          value: actualValue,
          error: `Assertion failed: ${locator} ${condition}. Expected: ${expectedValue}, Actual: ${actualValue}`,
        };
      }
    } catch (error: any) {
      if (condition === 'not_exists') {
        return {
          success: true,
          message: `Assertion passed: ${locator} not_exists`,
        };
      }
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const { locator, action_data } = actionEntity;
    const condition = action_data?.kwargs?.condition;
    const expectedValue = action_data?.kwargs?.expected_value;
    if (!locator || !condition) {
      return [`// assert: missing locator or condition`];
    }
    const elem = transpileLocator(locator);
    switch (condition) {
      case 'exists':
        return [`expect(await ${elem}.isExisting()).toBe(true);`];
      case 'not_exists':
        return [`expect(await ${elem}.isExisting()).toBe(false);`];
      case 'displayed':
        return [`expect(await ${elem}.isDisplayed()).toBe(true);`];
      case 'not_displayed':
        return [`expect(await ${elem}.isDisplayed()).toBe(false);`];
      case 'enabled':
        return [`expect(await ${elem}.isEnabled()).toBe(true);`];
      case 'disabled':
        return [`expect(await ${elem}.isEnabled()).toBe(false);`];
      case 'text_equals':
        return [`expect(await ${elem}.getText()).toBe(${JSON.stringify(expectedValue)});`];
      case 'text_contains':
        return [`expect(await ${elem}.getText()).toContain(${JSON.stringify(expectedValue)});`];
      case 'checked':
        return [`expect(await ${elem}.getAttribute('checked')).toBe('true');`];
      case 'unchecked':
        return [`expect(await ${elem}.getAttribute('checked')).not.toBe('true');`];
      default:
        return [`// assert: unknown condition ${condition}`];
    }
  }
}

export const AssertToolSchema = z.object({
  locator: z.string().describe('Element locator to assert on'),
  condition: z.enum([
    'exists',
    'not_exists',
    'displayed',
    'not_displayed',
    'enabled',
    'disabled',
    'text_equals',
    'text_contains',
    'checked',
    'unchecked',
  ]).describe('Condition to assert'),
  expected_value: z.string().optional().describe('Expected value (for text_equals, text_contains)'),
});

// =============================================================================
// Done Action
// =============================================================================

export class DoneAction implements IAction {
  async execute(
    _driver: Browser,
    actionEntity: MobileActionEntity,
    _agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const success = action_data?.kwargs?.success ?? true;
    const message = action_data?.kwargs?.message ?? 'Task completed';

    return {
      success,
      message,
    };
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const success = actionEntity.action_data?.kwargs?.success ?? true;
    const message = actionEntity.action_data?.kwargs?.message ?? 'Task completed';
    return [`// Done: ${message} (success: ${success})`];
  }
}

export const DoneToolSchema = z.object({
  success: z.boolean().describe('Whether the task was completed successfully'),
  message: z.string().describe('Summary of what was accomplished'),
});

// =============================================================================
// Store Value Action
// =============================================================================

export class StoreValueAction implements IAction {
  async execute(
    _driver: Browser,
    actionEntity: MobileActionEntity,
    agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const variableName = action_data?.kwargs?.variable_name;
    const value = action_data?.kwargs?.value;

    if (!variableName) {
      return { success: false, error: 'variable_name is required for store_value action' };
    }

    try {
      agentServices.setVariable(variableName, value);
      return {
        success: true,
        message: `Stored "${value}" as $${variableName}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  transpile(actionEntity: MobileActionEntity): string[] {
    const variableName = actionEntity.action_data?.kwargs?.variable_name;
    const value = actionEntity.action_data?.kwargs?.value;
    if (!variableName) {
      return [`// store_value: missing variable_name`];
    }
    return [`testContext.${variableName} = ${JSON.stringify(value)};`];
  }
}

export const StoreValueToolSchema = z.object({
  variable_name: z.string().describe('Variable name (without $ prefix)'),
  value: z.string().describe('Value to store'),
});

// =============================================================================
// AI Assert Action (AI-powered assertion)
//
// Supports two modes:
// - AI mode (kwargs.statement): Uses AI to evaluate natural language assertions
// - JS mode (kwargs.code): Executes JavaScript assertions directly
// =============================================================================

export class AiAssertAction implements IAction {
  async execute(
    driver: Browser,
    actionEntity: MobileActionEntity,
    agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    const { action_data } = actionEntity;
    const kwargs = action_data?.kwargs;

    // Check if this is JS mode (code in kwargs)
    if (kwargs?.code) {
      return await this.executeJSAssertion(kwargs.code, driver, agentServices);
    }

    // AI mode: use statement
    const statement = kwargs?.statement || actionEntity.action_description;
    if (!statement) {
      throw new Error('Missing statement or code for verify action');
    }

    // Evaluate the statement using services (like web-sdk's assert, throws on failure)
    const result = await agentServices.evaluate(statement);

    if (!result.success) {
      // Throw exception on assertion failure (same as web-sdk assert behavior)
      throw new Error(result.error || `Assertion failed: ${result.explanation}`);
    }

    return {
      success: true,
      message: `Verified: ${result.explanation}`,
    };
  }

  private async executeJSAssertion(
    code: string,
    driver: Browser,
    agentServices: MobileAgentServices,
  ): Promise<ActionResult> {
    try {
      // Dynamic import expect-webdriverio for WebDriverIO assertions
      const { expect } = await import('expect-webdriverio');

      const asyncFunction = new Function('driver', 'expect', 'agentServices', `
        return (async () => {
          ${code}
        })();
      `);

      await asyncFunction(driver, expect, agentServices);

      return {
        success: true,
        message: `JS assertion passed`,
      };
    } catch (error: any) {
      throw new Error(`Assertion failed: ${error.message}`);
    }
  }

  transpile(actionEntity: MobileActionEntity, stepId?: string): string[] {
    const kwargs = actionEntity.action_data?.kwargs;

    // JS mode: output the code directly
    if (kwargs?.code) {
      return kwargs.code.split('\n');
    }

    // AI mode: use agent.assert
    const statement = kwargs?.statement || actionEntity.action_description;
    if (!statement) {
      return [`// verify: missing statement or code`];
    }
    const escapedStatement = JSON.stringify(statement);
    return [`await agent.assert(${escapedStatement}, '${stepId || ''}');`];
  }
}

export const AiAssertToolSchema = z.object({
  statement: z.string().describe('The assertion statement to verify (e.g., "The login button is visible", "User is on the home screen")'),
});
