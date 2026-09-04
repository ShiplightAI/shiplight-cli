import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { fetchEmailsViaMailgun, sanitizeVerificationCode } from '../mailgun.js';

function mailgunEvent(storageUrl: string) {
  return {
    event: 'accepted',
    timestamp: Date.now() / 1000,
    storage: { url: storageUrl },
  };
}

function mockFetchSequence(responses: Array<{ ok: boolean; json?: unknown; text?: string }>) {
  let callIndex = 0;
  return async () => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: response.ok,
      status: response.ok ? 200 : 500,
      json: async () => response.json,
      text: async () => response.text ?? JSON.stringify(response.json),
    } as Response;
  };
}

describe('fetchEmailsViaMailgun', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('excludes an email whose recipient does not match filters.to_email (Messages API path)', async () => {
    globalThis.fetch = mockFetchSequence([
      { ok: true, json: { items: [mailgunEvent('https://api.mailgun.net/v3/domains/example.com/messages/key1')] } },
      {
        ok: true,
        json: {
          Subject: 'Your code',
          From: 'noreply@example.com',
          To: 'someone-else@example.com',
          Date: new Date().toUTCString(),
          'body-plain': 'Your verification code is 123456',
        },
      },
    ]) as unknown as typeof fetch;

    const emails = await fetchEmailsViaMailgun(
      { apiKey: 'test-key', domain: 'example.com' },
      'inbox@example.com',
      { to_email: 'expected@example.com' }
    );

    assert.strictEqual(emails.length, 0);
  });

  it('excludes an email whose sender does not match filters.from_email (Messages API path)', async () => {
    globalThis.fetch = mockFetchSequence([
      { ok: true, json: { items: [mailgunEvent('https://api.mailgun.net/v3/domains/example.com/messages/key1')] } },
      {
        ok: true,
        json: {
          Subject: 'Your code',
          From: 'unexpected-sender@other.com',
          To: 'inbox@example.com',
          Date: new Date().toUTCString(),
          'body-plain': 'Your verification code is 123456',
        },
      },
    ]) as unknown as typeof fetch;

    const emails = await fetchEmailsViaMailgun(
      { apiKey: 'test-key', domain: 'example.com' },
      'inbox@example.com',
      { from_email: 'noreply@example.com' }
    );

    assert.strictEqual(emails.length, 0);
  });

  it('includes an email when from_email and to_email both match (Messages API path)', async () => {
    globalThis.fetch = mockFetchSequence([
      { ok: true, json: { items: [mailgunEvent('https://api.mailgun.net/v3/domains/example.com/messages/key1')] } },
      {
        ok: true,
        json: {
          Subject: 'Your code',
          From: 'noreply@example.com',
          To: 'expected@example.com',
          Date: new Date().toUTCString(),
          'body-plain': 'Your verification code is 123456',
        },
      },
    ]) as unknown as typeof fetch;

    const emails = await fetchEmailsViaMailgun(
      { apiKey: 'test-key', domain: 'example.com' },
      'inbox@example.com',
      { from_email: 'noreply@example.com', to_email: 'expected@example.com' }
    );

    assert.strictEqual(emails.length, 1);
    assert.strictEqual(emails[0].to, 'expected@example.com');
  });

  it('excludes an email whose recipient does not match filters.to_email (raw-MIME fallback path)', async () => {
    globalThis.fetch = mockFetchSequence([
      { ok: true, json: { items: [mailgunEvent('https://api.mailgun.net/v3/domains/example.com/messages/key1')] } },
      { ok: false, text: 'Messages API unavailable' },
      {
        ok: true,
        text: [
          'Subject: Your code',
          'From: noreply@example.com',
          'To: someone-else@example.com',
          'Date: ' + new Date().toUTCString(),
          '',
          'Your verification code is 123456',
        ].join('\n'),
      },
    ]) as unknown as typeof fetch;

    const emails = await fetchEmailsViaMailgun(
      { apiKey: 'test-key', domain: 'example.com' },
      'inbox@example.com',
      { to_email: 'expected@example.com' }
    );

    assert.strictEqual(emails.length, 0);
  });

  it('excludes an email whose sender does not match filters.from_email (raw-MIME fallback path)', async () => {
    globalThis.fetch = mockFetchSequence([
      { ok: true, json: { items: [mailgunEvent('https://api.mailgun.net/v3/domains/example.com/messages/key1')] } },
      { ok: false, text: 'Messages API unavailable' },
      {
        ok: true,
        text: [
          'Subject: Your code',
          'From: unexpected-sender@other.com',
          'To: inbox@example.com',
          'Date: ' + new Date().toUTCString(),
          '',
          'Your verification code is 123456',
        ].join('\n'),
      },
    ]) as unknown as typeof fetch;

    const emails = await fetchEmailsViaMailgun(
      { apiKey: 'test-key', domain: 'example.com' },
      'inbox@example.com',
      { from_email: 'noreply@example.com' }
    );

    assert.strictEqual(emails.length, 0);
  });

  it('includes an email when from_email and to_email both match (raw-MIME fallback path)', async () => {
    globalThis.fetch = mockFetchSequence([
      { ok: true, json: { items: [mailgunEvent('https://api.mailgun.net/v3/domains/example.com/messages/key1')] } },
      { ok: false, text: 'Messages API unavailable' },
      {
        ok: true,
        text: [
          'Subject: Your code',
          'From: noreply@example.com',
          'To: expected@example.com',
          'Date: ' + new Date().toUTCString(),
          '',
          'Your verification code is 123456',
        ].join('\n'),
      },
    ]) as unknown as typeof fetch;

    const emails = await fetchEmailsViaMailgun(
      { apiKey: 'test-key', domain: 'example.com' },
      'inbox@example.com',
      { from_email: 'noreply@example.com', to_email: 'expected@example.com' }
    );

    assert.strictEqual(emails.length, 1);
    assert.strictEqual(emails[0].to, 'expected@example.com');
  });
});

describe('sanitizeVerificationCode', () => {
  it('strips a trailing underscore artifact left by the LLM extraction (regression for reported customer issue)', () => {
    assert.strictEqual(sanitizeVerificationCode('227731_'), '227731');
  });

  it('strips a leading underscore artifact', () => {
    assert.strictEqual(sanitizeVerificationCode('_227731'), '227731');
  });

  it('strips surrounding markdown/quote wrappers', () => {
    assert.strictEqual(sanitizeVerificationCode('`123456`'), '123456');
    assert.strictEqual(sanitizeVerificationCode('"123456"'), '123456');
    assert.strictEqual(sanitizeVerificationCode('*123456*'), '123456');
  });

  it('preserves internal hyphens used to segment a code', () => {
    assert.strictEqual(sanitizeVerificationCode('AB12-CD34-EF56'), 'AB12-CD34-EF56');
  });

  it('leaves a clean alphanumeric code unchanged', () => {
    assert.strictEqual(sanitizeVerificationCode('ABC123XYZ'), 'ABC123XYZ');
  });

  it('falls back to the unwrapped string when sanitizing would empty it out', () => {
    assert.strictEqual(sanitizeVerificationCode('___'), '___');
  });
});
