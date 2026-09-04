// This is an example auth fixture. Copy and adapt it for your actual login flow.
import path from 'path';
import fs from 'fs/promises';
import { chromium } from '@playwright/test';

const AUTH_DIR = path.resolve(process.cwd(), '.auth');

export async function login(args: Record<string, unknown> = {}): Promise<string> {
  const username = args.username as string;
  const rawPassword = args.password as string;
  const password = process.env[rawPassword] ?? rawPassword;
  const baseUrl = (args.baseUrl as string | undefined) ?? 'https://staging.example.com';
  const sessionPath = args.sessionPath
    ? path.resolve(process.cwd(), args.sessionPath as string)
    : path.join(AUTH_DIR, `staging-${username.replace(/[^a-z0-9]/gi, '-')}.json`);

  if (!username || !password) {
    throw new Error('login() requires args.username and args.password');
  }

  const sessionExists = await fs.stat(sessionPath).then(() => true).catch(() => false);
  const browser = await chromium.launch();
  const context = await browser.newContext(sessionExists ? { storageState: sessionPath } : {});
  const page = await context.newPage();

  await page.goto(baseUrl);

  if (!page.url().includes('/login')) {
    await context.storageState({ path: sessionPath });
    await browser.close();
    return sessionPath;
  }

  await page.getByRole('textbox', { name: 'Email' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(`${baseUrl}/**`);

  await page.context().storageState({ path: sessionPath });
  await browser.close();

  return sessionPath;
}
