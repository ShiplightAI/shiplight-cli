/**
 * Unit tests for agentContextUtils
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { replaceVariables } from 'shiplight-types';

describe('replaceVariables', () => {
  describe('{{ varName }} format', () => {
    it('should replace simple variable names', () => {
      const result = replaceVariables('Hello {{ name }}!', { name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });

    it('should replace variable names with hyphens', () => {
      const result = replaceVariables('Visit {{ invite_link-enterprise }}', {
        'invite_link-enterprise': 'https://example.com/invite',
      });
      assert.strictEqual(result, 'Visit https://example.com/invite');
    });

    it('should replace variable names with underscores', () => {
      const result = replaceVariables('User: {{ user_name }}', { user_name: 'John' });
      assert.strictEqual(result, 'User: John');
    });

    it('should replace variable names with dots', () => {
      const result = replaceVariables('Value: {{ config.value }}', { 'config.value': '123' });
      assert.strictEqual(result, 'Value: 123');
    });

    it('should handle $ prefix in variable reference', () => {
      const result = replaceVariables('Hello {{ $name }}!', { name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });

    it('should handle $ prefix in variable storage', () => {
      const result = replaceVariables('Hello {{ name }}!', { $name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });

    it('should preserve unmatched variables', () => {
      const result = replaceVariables('Hello {{ unknown }}!', { name: 'World' });
      assert.strictEqual(result, 'Hello {{ unknown }}!');
    });

    it('should handle multiple variables', () => {
      const result = replaceVariables('{{ greeting }} {{ name }}!', {
        greeting: 'Hello',
        name: 'World',
      });
      assert.strictEqual(result, 'Hello World!');
    });

    it('should handle no spaces inside braces', () => {
      const result = replaceVariables('Hello {{name}}!', { name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });

    it('should handle extra spaces inside braces', () => {
      const result = replaceVariables('Hello {{   name   }}!', { name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });
  });

  describe('${varName} format', () => {
    it('should replace template literal style variables', () => {
      const result = replaceVariables('Hello ${name}!', { name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });

    it('should handle spaces in variable name', () => {
      const result = replaceVariables('Hello ${ name }!', { name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });
  });

  describe('$varName format', () => {
    it('should replace simple $ prefix variables', () => {
      const result = replaceVariables('Hello $name!', { name: 'World' });
      assert.strictEqual(result, 'Hello World!');
    });

    it('should not replace mid-word matches', () => {
      const result = replaceVariables('email@domain.com', { email: 'test' });
      assert.strictEqual(result, 'email@domain.com');
    });
  });

  describe('<secret> format', () => {
    it('should replace legacy secret format', () => {
      const result = replaceVariables('Password: <secret>password</secret>', {
        password: 'secret123',
      });
      assert.strictEqual(result, 'Password: secret123');
    });

    it('should handle $ prefix in secret format', () => {
      const result = replaceVariables('Password: <secret>$password</secret>', {
        password: 'secret123',
      });
      assert.strictEqual(result, 'Password: secret123');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      const result = replaceVariables('', { name: 'World' });
      assert.strictEqual(result, '');
    });

    it('should return input unchanged for non-string input', () => {
      const result = replaceVariables(null as any, { name: 'World' });
      assert.strictEqual(result, null);
    });

    it('should handle numeric values', () => {
      const result = replaceVariables('Count: {{ count }}', { count: 42 });
      assert.strictEqual(result, 'Count: 42');
    });

    it('should handle boolean values', () => {
      const result = replaceVariables('Active: {{ active }}', { active: true });
      assert.strictEqual(result, 'Active: true');
    });

    it('should not replace null values', () => {
      const result = replaceVariables('Value: {{ value }}', { value: null });
      assert.strictEqual(result, 'Value: {{ value }}');
    });

    it('should not replace undefined values', () => {
      const result = replaceVariables('Value: {{ value }}', { value: undefined });
      assert.strictEqual(result, 'Value: {{ value }}');
    });
  });
});
