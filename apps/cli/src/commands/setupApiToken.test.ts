import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import {
  sanitize,
  writeToEnvFile,
  isSafeUrl,
  resolveDeviceAuthBase,
  clampPollInterval,
  promptSelect,
  pollForApproval,
  completeSetupApiToken,
  runSetupApiToken,
  isBrowserLaunchDisabled,
  openBrowser,
  type SetupApiTokenDeps,
} from './setupApiToken.js';

function makeTmpDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-setup-api-token-test-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

class ExitCalled extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

describe('sanitize', () => {
  it('strips ANSI escape sequences', () => {
    assert.equal(sanitize('hello\x1b[31mRED\x1b[0m'), 'hello?[31mRED?[0m');
  });

  it('strips null bytes and control characters', () => {
    assert.equal(sanitize('a\x00b\x07c\x7fd'), 'a?b?c?d');
  });

  it('preserves normal text', () => {
    assert.equal(sanitize('user@example.com'), 'user@example.com');
  });
});

describe('isSafeUrl', () => {
  it('accepts https URLs', () => {
    assert.equal(isSafeUrl('https://app.shiplight.ai/device/authorize?session=abc'), true);
  });

  it('accepts http URLs', () => {
    assert.equal(isSafeUrl('http://localhost:3456/device/authorize'), true);
  });

  it('rejects javascript: URIs', () => {
    assert.equal(isSafeUrl('javascript:alert(1)'), false);
  });

  it('rejects data: URIs', () => {
    assert.equal(isSafeUrl('data:text/html,<script>alert(1)</script>'), false);
  });

  it('rejects file: URIs', () => {
    assert.equal(isSafeUrl('file:///etc/passwd'), false);
  });

  it('rejects empty string', () => {
    assert.equal(isSafeUrl(''), false);
  });

  it('rejects non-URL strings', () => {
    assert.equal(isSafeUrl('not a url'), false);
  });

  it('rejects ftp: scheme', () => {
    assert.equal(isSafeUrl('ftp://example.com'), false);
  });
});

describe('clampPollInterval', () => {
  it('returns 5000ms for default (undefined) interval', () => {
    assert.equal(clampPollInterval(undefined), 5000);
  });

  it('returns 5000ms for server interval of 5', () => {
    assert.equal(clampPollInterval(5), 5000);
  });

  it('clamps interval of 0 to 2000ms minimum', () => {
    assert.equal(clampPollInterval(0), 2000);
  });

  it('clamps interval of 1 to 2000ms minimum', () => {
    assert.equal(clampPollInterval(1), 2000);
  });

  it('accepts interval of 10 as 10000ms', () => {
    assert.equal(clampPollInterval(10), 10000);
  });
});

describe('promptSelect', () => {
  it('returns the single choice without prompting', async () => {
    const result = await promptSelect('Pick one:', [{ label: 'Only', value: 'only-val' }]);
    assert.equal(result, 'only-val');
  });

  it('returns the selected choice for valid input', async () => {
    const stdin = new Readable({ read() {} });
    const origStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });

    const origError = console.error;
    console.error = () => {};

    try {
      const promise = promptSelect('Pick one:', [
        { label: 'Alpha', value: 'a' },
        { label: 'Beta', value: 'b' },
      ]);
      stdin.push('2\n');
      const result = await promise;
      assert.equal(result, 'b');
    } finally {
      console.error = origError;
      if (origStdin) Object.defineProperty(process, 'stdin', origStdin);
    }
  });

  it('prints warning and defaults to first choice on invalid input', async () => {
    const stdin = new Readable({ read() {} });
    const origStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });

    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      const promise = promptSelect('Pick one:', [
        { label: 'Alpha', value: 'a' },
        { label: 'Beta', value: 'b' },
      ]);
      stdin.push('99\n');
      const result = await promise;
      assert.equal(result, 'a');
      assert.ok(messages.some((m) => m.includes('Invalid selection') && m.includes('Alpha')));
    } finally {
      console.error = origError;
      if (origStdin) Object.defineProperty(process, 'stdin', origStdin);
    }
  });

  it('prints warning and defaults on non-numeric input', async () => {
    const stdin = new Readable({ read() {} });
    const origStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });

    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      const promise = promptSelect('Pick one:', [
        { label: 'Alpha', value: 'a' },
        { label: 'Beta', value: 'b' },
      ]);
      stdin.push('abc\n');
      const result = await promise;
      assert.equal(result, 'a');
      assert.ok(messages.some((m) => m.includes('Invalid selection') && m.includes('Alpha')));
    } finally {
      console.error = origError;
      if (origStdin) Object.defineProperty(process, 'stdin', origStdin);
    }
  });
});

describe('resolveDeviceAuthBase', () => {
  let originalApiUrl: string | undefined;
  let originalWebUrl: string | undefined;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalApiUrl = process.env.SHIPLIGHT_API_URL;
    originalWebUrl = process.env.SHIPLIGHT_WEB_URL;
    delete process.env.SHIPLIGHT_API_URL;
    delete process.env.SHIPLIGHT_WEB_URL;
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new ExitCalled(code ?? 1);
    }) as typeof process.exit;
  });

  afterEach(() => {
    if (originalApiUrl !== undefined) {
      process.env.SHIPLIGHT_API_URL = originalApiUrl;
    } else {
      delete process.env.SHIPLIGHT_API_URL;
    }
    if (originalWebUrl !== undefined) {
      process.env.SHIPLIGHT_WEB_URL = originalWebUrl;
    } else {
      delete process.env.SHIPLIGHT_WEB_URL;
    }
    process.exit = originalExit;
  });

  it('returns default when SHIPLIGHT_WEB_URL is not set', () => {
    delete process.env.SHIPLIGHT_API_URL;
    delete process.env.SHIPLIGHT_WEB_URL;
    assert.equal(resolveDeviceAuthBase(), 'https://app.shiplight.ai');
  });

  it('ignores SHIPLIGHT_API_URL because device auth is served by the web app', () => {
    process.env.SHIPLIGHT_API_URL = 'http://localhost:9999';
    assert.equal(resolveDeviceAuthBase(), 'https://app.shiplight.ai');
  });

  it('uses SHIPLIGHT_WEB_URL as the device-auth override', () => {
    process.env.SHIPLIGHT_API_URL = 'http://localhost:9999';
    process.env.SHIPLIGHT_WEB_URL = 'http://localhost:3456';
    assert.equal(resolveDeviceAuthBase(), 'http://localhost:3456');
  });

  it('strips trailing slash from override', () => {
    process.env.SHIPLIGHT_WEB_URL = 'https://staging.shiplight.ai/';
    assert.equal(resolveDeviceAuthBase(), 'https://staging.shiplight.ai');
  });

  it('exits with code 1 when override is not a safe URL', () => {
    process.env.SHIPLIGHT_WEB_URL = 'javascript:alert(1)';
    assert.throws(
      () => resolveDeviceAuthBase(),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('exits with code 1 for ftp: scheme override', () => {
    process.env.SHIPLIGHT_WEB_URL = 'ftp://bad.example.com';
    assert.throws(
      () => resolveDeviceAuthBase(),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('sanitizes ANSI escape sequences in error output', () => {
    process.env.SHIPLIGHT_WEB_URL = 'bad\x1b[31mRED\x1b[0m';
    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };
    try {
      resolveDeviceAuthBase();
    } catch {
      // ExitCalled expected
    } finally {
      console.error = origError;
    }
    const msg = messages.find((m) => m.includes('SHIPLIGHT_WEB_URL'));
    assert.ok(msg);
    assert.ok(!msg!.includes('\x1b'), 'escape sequences should be stripped');
    assert.ok(msg!.includes('bad?[31mRED?[0m'));
  });
});

describe('writeToEnvFile — token validation', () => {
  let tmp: ReturnType<typeof makeTmpDir>;
  let originalCwd: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmp.dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
  });

  it('rejects tokens containing newlines', () => {
    assert.throws(() => writeToEnvFile('shp_pat_abc\nSECRET=stolen'), /Invalid token/);
  });

  it('rejects tokens containing carriage returns', () => {
    assert.throws(() => writeToEnvFile('shp_pat_abc\rSECRET=stolen'), /Invalid token/);
  });

  it('rejects empty string tokens', () => {
    assert.throws(() => writeToEnvFile(''), /Invalid token/);
  });
});

describe('writeToEnvFile', () => {
  let tmp: ReturnType<typeof makeTmpDir>;
  let originalCwd: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmp.dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    tmp.cleanup();
  });

  it('creates .env with the token when file does not exist', () => {
    writeToEnvFile('shp_pat_abc123');

    const content = fs.readFileSync(path.join(tmp.dir, '.env'), 'utf8');
    assert.ok(content.includes('SHIPLIGHT_API_TOKEN=shp_pat_abc123'));
  });

  it('creates .env with restricted permissions (0o600)', () => {
    writeToEnvFile('shp_pat_abc123');

    const stat = fs.statSync(path.join(tmp.dir, '.env'));
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it('enforces 0o600 on pre-existing file with looser permissions', () => {
    const envPath = path.join(tmp.dir, '.env');
    fs.writeFileSync(envPath, 'OTHER=value\n', { mode: 0o644 });

    writeToEnvFile('shp_pat_abc123');

    const stat = fs.statSync(envPath);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it('updates existing SHIPLIGHT_API_TOKEN key', () => {
    const envPath = path.join(tmp.dir, '.env');
    fs.writeFileSync(envPath, 'OTHER=keep\nSHIPLIGHT_API_TOKEN=old_token\nANOTHER=also_keep\n');

    writeToEnvFile('shp_pat_new');

    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('SHIPLIGHT_API_TOKEN=shp_pat_new'));
    assert.ok(!content.includes('old_token'));
    assert.ok(content.includes('OTHER=keep'));
    assert.ok(content.includes('ANOTHER=also_keep'));
  });

  it('replaces commented-out # SHIPLIGHT_API_TOKEN= line', () => {
    const envPath = path.join(tmp.dir, '.env');
    fs.writeFileSync(envPath, '# SHIPLIGHT_API_TOKEN=commented\nOTHER=value\n');

    writeToEnvFile('shp_pat_new');

    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('SHIPLIGHT_API_TOKEN=shp_pat_new'));
    assert.ok(!content.includes('commented'));
    assert.ok(content.includes('OTHER=value'));
  });

  it('appends when key is not present in existing file', () => {
    const envPath = path.join(tmp.dir, '.env');
    fs.writeFileSync(envPath, 'OTHER=value\n');

    writeToEnvFile('shp_pat_new');

    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('OTHER=value'));
    assert.ok(content.includes('SHIPLIGHT_API_TOKEN=shp_pat_new'));
  });
});

function mockJsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const APPROVED_POLL = {
  status: 'approved' as const,
  access_token: 'eyJ.test.jwt',
  account: { id: 'acc-1', email: 'dev@example.com', displayName: 'Dev' },
  orgs: [{ id: 'org-1', slug: 'example-org', name: 'Example Org', role: 'owner' }],
};

describe('pollForApproval', () => {
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new ExitCalled(code ?? 1);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalExit;
    mock.restoreAll();
  });

  it('returns approved poll when server approves', async () => {
    const fetchFn = mock.fn(async () => mockJsonResponse(APPROVED_POLL));

    const result = await pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000);

    assert.equal(result.status, 'approved');
    assert.equal(result.account.email, 'dev@example.com');
    assert.equal(result.orgs.length, 1);
  });

  it('keeps polling on pending then returns on approved', async () => {
    let callCount = 0;
    const fetchFn = mock.fn(async () => {
      callCount++;
      if (callCount < 3) {
        return mockJsonResponse({ status: 'pending' });
      }
      return mockJsonResponse(APPROVED_POLL);
    });

    const result = await pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000);

    assert.equal(result.status, 'approved');
    assert.ok(callCount >= 3);
  });

  it('exits with code 1 on expired status', async () => {
    const fetchFn = mock.fn(async () => mockJsonResponse({ status: 'expired' }));

    await assert.rejects(
      () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('exits with code 1 on non-ok HTTP response', async () => {
    const fetchFn = mock.fn(async () => new Response('Server Error', { status: 500 }));

    await assert.rejects(
      () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('exits with code 1 when approved but missing required fields', async () => {
    const incomplete = { status: 'approved', account: null, orgs: [] };
    const fetchFn = mock.fn(async () => mockJsonResponse(incomplete));

    await assert.rejects(
      () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('exits with code 1 on unrecognized status value', async () => {
    const fetchFn = mock.fn(async () => mockJsonResponse({ status: 'denied' }));

    await assert.rejects(
      () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('sanitizes ANSI sequences in unrecognized status output', async () => {
    const malicious = 'evil\x1b[31mRED\x1b[0m';
    const fetchFn = mock.fn(async () => mockJsonResponse({ status: malicious }));

    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      await assert.rejects(
        () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000),
        (err: unknown) => err instanceof ExitCalled && err.code === 1,
      );
      const statusMsg = messages.find((m) => m.includes('unexpected status'));
      assert.ok(statusMsg);
      assert.ok(!statusMsg!.includes('\x1b'), 'should not contain raw escape sequences');
      assert.ok(statusMsg!.includes('evil?[31mRED?[0m'));
    } finally {
      console.error = origError;
    }
  });

  it('retries on network error then succeeds', async () => {
    let callCount = 0;
    const fetchFn = mock.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('ECONNRESET');
      return mockJsonResponse(APPROVED_POLL);
    });

    const result = await pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000);

    assert.equal(result.status, 'approved');
    assert.ok(callCount >= 2);
  });

  it('retries on transient HTTP errors (503, 429) then succeeds', async () => {
    let callCount = 0;
    const fetchFn = mock.fn(async () => {
      callCount++;
      if (callCount === 1) return new Response('Service Unavailable', { status: 503 });
      if (callCount === 2) return new Response('Too Many Requests', { status: 429 });
      return mockJsonResponse(APPROVED_POLL);
    });

    const result = await pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000);

    assert.equal(result.status, 'approved');
    assert.ok(callCount >= 3);
  });

  it('exits immediately on non-transient HTTP errors (4xx)', async () => {
    const fetchFn = mock.fn(async () => new Response('Forbidden', { status: 403 }));

    await assert.rejects(
      () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('exits immediately on 401 Unauthorized', async () => {
    const fetchFn = mock.fn(async () => new Response('Unauthorized', { status: 401 }));

    await assert.rejects(
      () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 10, 5000),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
    assert.equal(fetchFn.mock.callCount(), 1);
  });

  it('exits with code 1 when timeout is reached', async () => {
    const fetchFn = mock.fn(async () => mockJsonResponse({ status: 'pending' }));

    await assert.rejects(
      () => pollForApproval(fetchFn as typeof fetch, 'https://test.example.com', 'dvc_abc', 1, 50),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });
});

describe('completeSetupApiToken', () => {
  let tmp: ReturnType<typeof makeTmpDir>;
  let originalCwd: string;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    tmp = makeTmpDir();
    originalCwd = process.cwd();
    originalExit = process.exit;
    process.chdir(tmp.dir);
    process.exit = ((code?: number) => {
      throw new ExitCalled(code ?? 1);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exit = originalExit;
    tmp.cleanup();
    mock.restoreAll();
  });

  function makeDeps(overrides?: Partial<SetupApiTokenDeps>): SetupApiTokenDeps {
    return {
      fetchFn: mock.fn(async () =>
        mockJsonResponse({
          id: 'tok-1',
          raw_token: 'shp_pat_newtoken',
          prefix: 'shp_pat_newt',
          name: 'CLI (test-host)',
          organization_id: 'org-1',
          organization_slug: 'example-org',
          reused: false,
        }),
      ) as typeof fetch,
      deviceAuthBase: 'https://test.example.com',
      accessToken: 'eyJ.test.jwt',
      account: { id: 'acc-1', email: 'dev@example.com', displayName: 'Dev' },
      orgs: [{ id: 'org-1', slug: 'example-org', name: 'Example Org', role: 'owner' }],
      selectOrgId: async (orgs) => orgs[0]!.id,
      ...overrides,
    };
  }

  it('writes token to .env on success', async () => {
    await completeSetupApiToken(makeDeps());

    const envContent = fs.readFileSync(path.join(tmp.dir, '.env'), 'utf8');
    assert.ok(envContent.includes('SHIPLIGHT_API_TOKEN=shp_pat_newtoken'));
  });

  it('calls selectOrgId when multiple orgs are provided', async () => {
    const selectFn = mock.fn(async () => 'org-2');
    const fetchFn = mock.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      return mockJsonResponse({
        id: 'tok-2',
        raw_token: 'shp_pat_org2token',
        prefix: 'shp_pat_org2',
        name: 'CLI (test-host)',
        organization_id: body.organization_id,
        organization_slug: body.organization_id === 'org-2' ? 'acme' : 'example-org',
        reused: false,
      });
    });

    await completeSetupApiToken(
      makeDeps({
        fetchFn: fetchFn as typeof fetch,
        orgs: [
          { id: 'org-1', slug: 'example-org', name: 'Example Org', role: 'owner' },
          { id: 'org-2', slug: 'acme', name: 'Acme Corp', role: 'member' },
        ],
        selectOrgId: selectFn as SetupApiTokenDeps['selectOrgId'],
      }),
    );

    assert.equal(selectFn.mock.callCount(), 1);
    const envContent = fs.readFileSync(path.join(tmp.dir, '.env'), 'utf8');
    assert.ok(envContent.includes('SHIPLIGHT_API_TOKEN=shp_pat_org2token'));
  });

  it('exits with code 1 when create-api-token returns non-ok', async () => {
    const fetchFn = mock.fn(
      async () =>
        new Response(JSON.stringify({ title: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await assert.rejects(
      () => completeSetupApiToken(makeDeps({ fetchFn: fetchFn as typeof fetch })),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('shows "restored" message when token is reused', async () => {
    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      await completeSetupApiToken(
        makeDeps({
          fetchFn: mock.fn(async () =>
            mockJsonResponse({
              id: 'tok-1',
              raw_token: 'shp_pat_existing',
              prefix: 'shp_pat_exis',
              name: 'CLI (test-host)',
              organization_id: 'org-1',
              organization_slug: 'example-org',
              reused: true,
            }),
          ) as typeof fetch,
        }),
      );
    } finally {
      console.error = origError;
    }

    assert.ok(messages.some((m) => m.includes('Existing API token restored')));
  });

  it('shows "created" message for new tokens', async () => {
    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      await completeSetupApiToken(makeDeps());
    } finally {
      console.error = origError;
    }

    assert.ok(messages.some((m) => m.includes('API token created and saved')));
  });

  it('sanitizes account.email in terminal output', async () => {
    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      await completeSetupApiToken(
        makeDeps({
          account: { id: 'acc-1', email: 'evil\x1b[31m@example.com', displayName: null },
        }),
      );
    } finally {
      console.error = origError;
    }

    const authMsg = messages.find((m) => m.includes('Authenticated as'));
    assert.ok(authMsg);
    assert.ok(!authMsg!.includes('\x1b'), 'should not contain raw escape sequences');
    assert.ok(authMsg!.includes('evil?[31m@example.com'));
  });

  it('sanitizes error title from server in terminal output', async () => {
    const fetchFn = mock.fn(
      async () =>
        new Response(JSON.stringify({ title: 'Bad\x1b[31mRequest' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      await assert.rejects(
        () => completeSetupApiToken(makeDeps({ fetchFn: fetchFn as typeof fetch })),
        (err: unknown) => err instanceof ExitCalled && err.code === 1,
      );
    } finally {
      console.error = origError;
    }

    const errMsg = messages.find((m) => m.includes('Failed to create API token'));
    assert.ok(errMsg);
    assert.ok(!errMsg!.includes('\x1b'), 'should not contain raw escape sequences');
    assert.ok(errMsg!.includes('Bad?[31mRequest'));
  });
});

describe('isBrowserLaunchDisabled', () => {
  it('is disabled when SHIPLIGHT_NO_BROWSER is set to a truthy value', () => {
    assert.equal(isBrowserLaunchDisabled({ SHIPLIGHT_NO_BROWSER: '1' }), true);
    assert.equal(isBrowserLaunchDisabled({ SHIPLIGHT_NO_BROWSER: 'true' }), true);
    assert.equal(isBrowserLaunchDisabled({ SHIPLIGHT_NO_BROWSER: 'yes' }), true);
  });

  it('is disabled under CI', () => {
    assert.equal(isBrowserLaunchDisabled({ CI: 'true' }), true);
    assert.equal(isBrowserLaunchDisabled({ CI: '1' }), true);
  });

  it('stays enabled when the flags are absent, empty, or explicitly off', () => {
    assert.equal(isBrowserLaunchDisabled({}), false);
    assert.equal(isBrowserLaunchDisabled({ SHIPLIGHT_NO_BROWSER: '' }), false);
    assert.equal(isBrowserLaunchDisabled({ SHIPLIGHT_NO_BROWSER: '0' }), false);
    assert.equal(isBrowserLaunchDisabled({ SHIPLIGHT_NO_BROWSER: 'false' }), false);
    assert.equal(isBrowserLaunchDisabled({ CI: 'false' }), false);
  });
});

describe('openBrowser', () => {
  it('reports no launch and spawns nothing when disabled', () => {
    // A real launch would surface as a browser tab; the false return is what
    // makes runSetupApiToken fall back to printing the URL.
    assert.equal(
      openBrowser('https://app.shiplight.ai/device/authorize?session=abc', { SHIPLIGHT_NO_BROWSER: '1' }),
      false,
    );
  });

  it('refuses unsafe URLs even when launching is enabled', () => {
    // The empty env matters: with the disable flag set this assertion would
    // pass no matter what isSafeUrl did, so it must run on the launching path
    // for the scheme check to be the thing rejecting the URL.
    assert.equal(openBrowser('javascript:alert(1)', {}), false);
  });
});

describe('runSetupApiToken', () => {
  let tmp: ReturnType<typeof makeTmpDir>;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let originalFetch: typeof globalThis.fetch;
  let originalApiUrl: string | undefined;
  let originalUrl: string | undefined;
  let originalNoBrowser: string | undefined;

  beforeEach(() => {
    tmp = makeTmpDir();
    originalCwd = process.cwd();
    originalExit = process.exit;
    originalFetch = globalThis.fetch;
    originalApiUrl = process.env.SHIPLIGHT_API_URL;
    originalUrl = process.env.SHIPLIGHT_WEB_URL;
    originalNoBrowser = process.env.SHIPLIGHT_NO_BROWSER;
    process.chdir(tmp.dir);
    process.exit = ((code?: number) => {
      throw new ExitCalled(code ?? 1);
    }) as typeof process.exit;
    delete process.env.SHIPLIGHT_API_URL;
    delete process.env.SHIPLIGHT_WEB_URL;
    // runSetupApiToken shells out to `open`/`xdg-open`; without this the suite hijacks
    // the developer's default browser with a tab per test.
    process.env.SHIPLIGHT_NO_BROWSER = '1';
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalNoBrowser !== undefined) {
      process.env.SHIPLIGHT_NO_BROWSER = originalNoBrowser;
    } else {
      delete process.env.SHIPLIGHT_NO_BROWSER;
    }
    if (originalApiUrl !== undefined) {
      process.env.SHIPLIGHT_API_URL = originalApiUrl;
    } else {
      delete process.env.SHIPLIGHT_API_URL;
    }
    if (originalUrl !== undefined) {
      process.env.SHIPLIGHT_WEB_URL = originalUrl;
    } else {
      delete process.env.SHIPLIGHT_WEB_URL;
    }
    process.exit = originalExit;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  });

  function mockFullFlow(requestUrls?: string[]): void {
    let callIndex = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      requestUrls?.push(u);
      if (u.includes('/api/device-auth/codes')) {
        return mockJsonResponse({
          device_code: 'dvc_test123',
          verification_url: 'https://app.shiplight.ai/device/authorize?session=dvc_test123',
          expires_at: new Date(Date.now() + 900_000).toISOString(),
          interval: 1,
        });
      }
      if (u.includes('/api/device-auth/token')) {
        callIndex++;
        if (callIndex === 1) return mockJsonResponse({ status: 'pending' });
        return mockJsonResponse(APPROVED_POLL);
      }
      if (u.includes('/api/device-auth/create-api-token')) {
        return mockJsonResponse({
          id: 'tok-1',
          raw_token: 'shp_pat_e2etoken',
          prefix: 'shp_pat_e2et',
          name: 'CLI (test-host)',
          organization_id: 'org-1',
          organization_slug: 'example-org',
          reused: false,
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;
  }

  it('exits with code 1 when POST /codes returns non-ok', async () => {
    globalThis.fetch = (async () => new Response('Service Unavailable', { status: 503 })) as typeof fetch;

    await assert.rejects(
      () => runSetupApiToken([]),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('exits with code 1 when codes response is missing required fields', async () => {
    globalThis.fetch = (async () => mockJsonResponse({ interval: 5 })) as typeof fetch;

    await assert.rejects(
      () => runSetupApiToken([]),
      (err: unknown) => err instanceof ExitCalled && err.code === 1,
    );
  });

  it('completes full flow: codes → poll (pending then approved) → create token → .env', async () => {
    const requestUrls: string[] = [];
    mockFullFlow(requestUrls);

    await runSetupApiToken([]);

    const envContent = fs.readFileSync(path.join(tmp.dir, '.env'), 'utf8');
    assert.ok(envContent.includes('SHIPLIGHT_API_TOKEN=shp_pat_e2etoken'));

    assert.ok(requestUrls.length >= 3);
    assert.ok(
      requestUrls.every((url) => url.startsWith('https://app.shiplight.ai/api/device-auth/')),
      `all device-auth requests must use app.shiplight.ai, got: ${requestUrls.join(', ')}`,
    );
  });

  it('sends a non-empty cliVersion in the /codes POST body', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let callIndex = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (u.includes('/api/device-auth/codes')) {
        capturedBody = JSON.parse((init?.body as string) ?? '{}');
        return mockJsonResponse({
          device_code: 'dvc_ver',
          verification_url: 'https://app.shiplight.ai/device/authorize?session=dvc_ver',
          expires_at: new Date(Date.now() + 900_000).toISOString(),
          interval: 1,
        });
      }
      if (u.includes('/api/device-auth/token')) {
        callIndex++;
        if (callIndex === 1) return mockJsonResponse({ status: 'pending' });
        return mockJsonResponse(APPROVED_POLL);
      }
      if (u.includes('/api/device-auth/create-api-token')) {
        return mockJsonResponse({
          id: 'tok-1',
          raw_token: 'shp_pat_ver',
          prefix: 'shp_pat_ver',
          name: 'CLI (test)',
          organization_id: 'org-1',
          organization_slug: 'example-org',
          reused: false,
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    await runSetupApiToken([]);

    assert.ok(capturedBody, 'should have captured the /codes request body');
    assert.equal(typeof capturedBody!.cliVersion, 'string');
    assert.ok((capturedBody!.cliVersion as string).length > 0, 'cliVersion must be non-empty');
  });

  it('prints the verification URL and skips browser launch when it is disabled', async () => {
    mockFullFlow();

    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      await runSetupApiToken([]);
    } finally {
      console.error = origError;
    }

    assert.ok(messages.some((m) => m.includes("If the browser doesn't open")));
    assert.ok(messages.some((m) => m.includes('app.shiplight.ai/device/authorize')));
    assert.ok(
      !messages.some((m) => m.includes('Opening browser')),
      'must not report opening a browser while SHIPLIGHT_NO_BROWSER is set',
    );
  });

  it('sanitizes ANSI escape sequences in verification_url output', async () => {
    let callIndex = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (u.includes('/api/device-auth/codes')) {
        return mockJsonResponse({
          device_code: 'dvc_ansi',
          verification_url: 'https://evil.example.com/\x1b[31mRED\x1b[0m?session=dvc_ansi',
          expires_at: new Date(Date.now() + 900_000).toISOString(),
          interval: 1,
        });
      }
      if (u.includes('/api/device-auth/token')) {
        callIndex++;
        if (callIndex === 1) return mockJsonResponse({ status: 'pending' });
        return mockJsonResponse(APPROVED_POLL);
      }
      if (u.includes('/api/device-auth/create-api-token')) {
        return mockJsonResponse({
          id: 'tok-1',
          raw_token: 'shp_pat_ansi',
          prefix: 'shp_pat_ansi',
          name: 'CLI (test)',
          organization_id: 'org-1',
          organization_slug: 'example-org',
          reused: false,
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const messages: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      messages.push(args.join(' '));
    };

    try {
      await runSetupApiToken([]);
    } finally {
      console.error = origError;
    }

    const urlMsg = messages.find((m) => m.includes('evil.example.com'));
    assert.ok(urlMsg);
    assert.ok(!urlMsg!.includes('\x1b'), 'escape sequences should be stripped from verification_url');
    assert.ok(urlMsg!.includes('?[31mRED?[0m'));
  });
});
