import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newSessionArgsSchema } from '../sessionTools.js';

describe('new_session schema', () => {
  it('should accept empty args', () => {
    const result = newSessionArgsSchema.parse({});
    assert.equal(result.starting_url, undefined);
    assert.equal(result.browser_options, undefined);
  });

  it('should accept custom viewport', () => {
    const result = newSessionArgsSchema.parse({
      starting_url: 'https://example.com',
      browser_options: { viewport: { width: 1024, height: 768 } },
    });
    assert.deepEqual(result.browser_options?.viewport, { width: 1024, height: 768 });
  });

  it('should accept mobile emulation params', () => {
    const result = newSessionArgsSchema.parse({
      browser_options: {
        viewport: { width: 390, height: 844 },
        is_mobile: true,
        has_touch: true,
      },
    });
    assert.equal(result.browser_options?.is_mobile, true);
    assert.equal(result.browser_options?.has_touch, true);
    assert.deepEqual(result.browser_options?.viewport, { width: 390, height: 844 });
  });

  it('should accept color_scheme', () => {
    const result = newSessionArgsSchema.parse({
      browser_options: { color_scheme: 'dark' },
    });
    assert.equal(result.browser_options?.color_scheme, 'dark');
  });

  it('should reject invalid color_scheme', () => {
    assert.throws(() => {
      newSessionArgsSchema.parse({
        browser_options: { color_scheme: 'invalid' },
      });
    });
  });

  it('should accept geolocation', () => {
    const result = newSessionArgsSchema.parse({
      browser_options: {
        geolocation: { latitude: 40.7128, longitude: -74.006 },
      },
    });
    assert.deepEqual(result.browser_options?.geolocation, {
      latitude: 40.7128,
      longitude: -74.006,
    });
  });

  it('should accept timezone_id and locale', () => {
    const result = newSessionArgsSchema.parse({
      browser_options: {
        timezone_id: 'Europe/London',
        locale: 'ja-JP',
      },
    });
    assert.equal(result.browser_options?.timezone_id, 'Europe/London');
    assert.equal(result.browser_options?.locale, 'ja-JP');
  });

  it('should accept user_agent', () => {
    const result = newSessionArgsSchema.parse({
      browser_options: {
        user_agent: 'CustomBot/1.0',
      },
    });
    assert.equal(result.browser_options?.user_agent, 'CustomBot/1.0');
  });

  it('should strip old device_name field', () => {
    const result = newSessionArgsSchema.parse({
      browser_options: { device_name: 'iPhone 14 Pro' },
    });
    assert.equal((result.browser_options as any)?.device_name, undefined);
  });

  it('should strip old test_account_id field', () => {
    const result = newSessionArgsSchema.parse({
      test_account_id: 123,
    });
    assert.equal((result as any).test_account_id, undefined);
  });

  it('should accept all emulation params together', () => {
    const result = newSessionArgsSchema.parse({
      starting_url: 'https://example.com',
      storage_state_path: '/path/to/state.json',
      browser_options: {
        viewport: { width: 375, height: 812 },
        is_mobile: true,
        has_touch: true,
        user_agent: 'Mobile Safari',
        color_scheme: 'dark',
        timezone_id: 'Asia/Tokyo',
        geolocation: { latitude: 35.6762, longitude: 139.6503, accuracy: 10 },
        locale: 'ja-JP',
        headless: true,
        record_evidence: true,
      },
    });
    assert.equal(result.browser_options?.is_mobile, true);
    assert.equal(result.browser_options?.color_scheme, 'dark');
    assert.equal(result.browser_options?.geolocation?.accuracy, 10);
    assert.equal(result.browser_options?.headless, true);
    assert.equal(result.browser_options?.record_evidence, true);
  });
});
