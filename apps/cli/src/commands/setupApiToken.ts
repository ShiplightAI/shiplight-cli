import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

declare const __SHIPLIGHTAI_VERSION__: string | undefined;
const cliVersion = typeof __SHIPLIGHTAI_VERSION__ !== 'undefined' ? __SHIPLIGHTAI_VERSION__ : 'dev';

const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const ENV_KEY = 'SHIPLIGHT_API_TOKEN';

interface DeviceCodeResponse {
  device_code: string;
  verification_url: string;
  expires_at: string;
  interval: number;
}

interface PollResponse {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  access_token?: string;
  account?: { id: string; email: string; displayName: string | null };
  orgs?: Array<{ id: string; slug: string; name: string; role: string }>;
}

export interface ApprovedPollResponse {
  status: 'approved';
  access_token: string;
  account: { id: string; email: string; displayName: string | null };
  orgs: Array<{ id: string; slug: string; name: string; role: string }>;
}

interface CreateApiTokenResponse {
  id: string;
  raw_token: string;
  prefix: string;
  name: string;
  organization_id: string;
  organization_slug: string;
  reused: boolean;
}

export function sanitize(str: string): string {
  return str.replace(/[\x00-\x1f\x7f]/g, '?');
}

export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function envFlagEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

/**
 * Browser launch is suppressed when there is no human at a desktop to receive
 * the tab: CI runners, and any caller that opts out via SHIPLIGHT_NO_BROWSER.
 * The verification URL is always printed, so the flow still completes.
 */
export function isBrowserLaunchDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagEnabled(env.SHIPLIGHT_NO_BROWSER) || envFlagEnabled(env.CI);
}

export function openBrowser(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (isBrowserLaunchDisabled(env)) return false;
  if (!isSafeUrl(url)) return false;
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      execFileSync('open', [url], { stdio: 'ignore' });
    } else if (platform === 'linux') {
      execFileSync('xdg-open', [url], { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execFileSync('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function promptSelect(
  question: string,
  choices: Array<{ label: string; value: string }>,
): Promise<string> {
  if (choices.length === 1) return choices[0]!.value;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  console.error(`\n  ${question}`);
  for (let i = 0; i < choices.length; i++) {
    console.error(`    ${i + 1}. ${sanitize(choices[i]!.label)}`);
  }

  return new Promise((resolve) => {
    rl.question('  Enter number: ', (answer) => {
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx]!.value);
      } else {
        console.error(`  Invalid selection — defaulting to "${sanitize(choices[0]!.label)}"\n`);
        resolve(choices[0]!.value);
      }
    });
  });
}

function isValidToken(token: string): boolean {
  return typeof token === 'string' && token.length > 0 && !/[\n\r]/.test(token);
}

export function clampPollInterval(serverInterval: number | undefined): number {
  return Math.max(2, serverInterval ?? 5) * 1000;
}

export function writeToEnvFile(token: string): void {
  if (!isValidToken(token)) {
    throw new Error('Invalid token: contains newlines or is empty');
  }
  const envPath = path.resolve(process.cwd(), '.env');

  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    // File doesn't exist yet
  }

  const lines = content.split('\n');
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${ENV_KEY}=`) || line.startsWith(`# ${ENV_KEY}=`)) {
      found = true;
      return `${ENV_KEY}=${token}`;
    }
    return line;
  });

  if (!found) {
    updated.push(`${ENV_KEY}=${token}`);
  }

  fs.writeFileSync(envPath, updated.join('\n'), { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

const SHIPLIGHT_WEB_BASE = 'https://app.shiplight.ai';

export function resolveDeviceAuthBase(): string {
  const override = process.env.SHIPLIGHT_WEB_URL?.trim();
  if (override) {
    const normalized = override.endsWith('/') ? override.slice(0, -1) : override;
    if (!isSafeUrl(normalized)) {
      const safe = sanitize(override);
      console.error(`  SHIPLIGHT_WEB_URL must be an http(s) URL, got: ${safe}`);
      process.exit(1);
    }
    return normalized;
  }
  return SHIPLIGHT_WEB_BASE;
}

export interface SetupApiTokenDeps {
  fetchFn: typeof fetch;
  deviceAuthBase: string;
  accessToken: string;
  account: NonNullable<PollResponse['account']>;
  orgs: NonNullable<PollResponse['orgs']>;
  selectOrgId: (orgs: NonNullable<PollResponse['orgs']>) => Promise<string>;
}

export async function completeSetupApiToken(deps: SetupApiTokenDeps): Promise<void> {
  const { fetchFn, deviceAuthBase, accessToken, account, orgs, selectOrgId } = deps;

  console.error(`\n  ✓ Authenticated as ${sanitize(account.email)}\n`);

  // Select org
  const orgId = await selectOrgId(orgs);

  // Create API token
  const tokenRes = await fetchFn(`${deviceAuthBase}/api/device-auth/create-api-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Device-Hostname': os.hostname(),
    },
    body: JSON.stringify({ organization_id: orgId }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    console.error(`  Failed to create API token: ${sanitize((err as { title?: string }).title ?? 'unknown error')}`);
    process.exit(1);
  }

  const tokenData: CreateApiTokenResponse = await tokenRes.json();

  // Write to .env
  writeToEnvFile(tokenData.raw_token);
  if (tokenData.reused) {
    console.error(`  ✓ Existing API token restored to .env\n`);
  } else {
    console.error(`  ✓ API token created and saved to .env\n`);
  }

  console.error('  You can now run: shiplight test\n');
}

export async function pollForApproval(
  fetchFn: typeof fetch,
  deviceAuthBase: string,
  deviceCode: string,
  pollInterval: number,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<ApprovedPollResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval));

    let pollRes: Response;
    try {
      pollRes = await fetchFn(`${deviceAuthBase}/api/device-auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode }),
      });
    } catch {
      process.stderr.write('  Network error while polling. Retrying...\r');
      continue;
    }

    if (!pollRes.ok) {
      if (pollRes.status === 429 || pollRes.status >= 500) {
        process.stderr.write(`  Server error (${pollRes.status}) while polling. Retrying...\r`);
        continue;
      }
      console.error('  API-token setup failed. Please try again.');
      process.exit(1);
    }

    const poll: PollResponse = await pollRes.json();

    if (poll.status === 'pending') {
      process.stderr.write('  Waiting for authorization...\r');
      continue;
    }

    if (poll.status === 'denied') {
      console.error('\n  Authorization was denied. Run "shiplight setup-api-token" to try again.');
      process.exit(1);
    }

    if (poll.status === 'expired') {
      console.error('\n  API-token setup request expired. Run "shiplight setup-api-token" again.');
      process.exit(1);
    }

    if (poll.status === 'approved') {
      if (!poll.account || !poll.orgs?.length || !poll.access_token) {
        console.error('  API-token setup failed: unexpected server response.');
        process.exit(1);
      }
      return poll as ApprovedPollResponse;
    }

    const safeStatus = sanitize(String(poll.status));
    console.error(
      `\n  API-token setup failed (unexpected status: ${safeStatus}). Run "shiplight setup-api-token" again.`,
    );
    process.exit(1);
  }

  console.error('\n  API-token setup timed out. Run "shiplight setup-api-token" again.');
  process.exit(1);
}

export async function runSetupApiToken(_args: string[]): Promise<void> {
  const deviceAuthBase = resolveDeviceAuthBase();

  // Step 1: Request device code
  console.error('\n  Requesting Shiplight API-token setup...\n');

  const codesRes = await fetch(`${deviceAuthBase}/api/device-auth/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostname: os.hostname(),
      os: `${process.platform} ${os.release()}`,
      cliVersion,
    }),
  });

  if (!codesRes.ok) {
    console.error('  Failed to start API-token setup. Please try again.');
    process.exit(1);
  }

  const codes: DeviceCodeResponse = await codesRes.json();

  if (!codes.device_code || !codes.verification_url) {
    console.error('  Unexpected server response. Please try again.');
    process.exit(1);
  }

  // Step 2: Open browser
  const opened = openBrowser(codes.verification_url);
  if (opened) {
    console.error('  Opening browser to authenticate...\n');
  }
  const safeUrl = sanitize(codes.verification_url);
  console.error(`  If the browser doesn't open, visit:`);
  console.error(`    ${safeUrl}\n`);

  // Step 3: Poll for approval
  const pollInterval = clampPollInterval(codes.interval);
  const poll = await pollForApproval(fetch, deviceAuthBase, codes.device_code, pollInterval);

  // Select an org, create a token, and write it to .env.
  await completeSetupApiToken({
    fetchFn: fetch,
    deviceAuthBase,
    accessToken: poll.access_token,
    account: poll.account,
    orgs: poll.orgs,
    selectOrgId: async (orgs) => {
      if (orgs.length === 1) {
        console.error(`  Organization: ${sanitize(orgs[0]!.name)}\n`);
        return orgs[0]!.id;
      }
      return promptSelect(
        'Select organization:',
        orgs.map((o) => ({ label: `${o.name} (${o.slug})`, value: o.id })),
      );
    },
  });
}
