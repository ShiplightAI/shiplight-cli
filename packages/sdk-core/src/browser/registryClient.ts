/**
 * Browser Registry Client
 *
 * Minimal, no-op-when-disabled helper for registering a browser's CDP
 * endpoint with a testbox tab's local registry.
 *
 * Ownership is encoded in the URL, not the payload: `OMNITERM_BROWSER_REGISTRY_URL`
 * points at `http://<host>/t/<tabId>/registry` (set by the testbox tmux
 * spawn), and the client just POSTs to `${URL}/browsers`. No `ownerId`
 * field, no env-var tagging — the tab that owns the URL owns the
 * registration.
 *
 * Shiplight debugger opts out by setting `OMNITERM_BROWSER_REGISTRY_URL=""` in
 * its subprocess env; this module becomes a no-op for the whole debugger
 * subtree.
 */

import { getSdkConfig } from '../config';

export interface RegisterArgs {
  cdpUrl: string;
  label?: string;
  pid?: number;
}

function baseUrl(): string | null {
  // Read from the injected SDK config, never process.env (FR-010).
  const raw = getSdkConfig().env?.OMNITERM_BROWSER_REGISTRY_URL;
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export async function registerBrowser(args: RegisterArgs): Promise<string | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/browsers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

export async function unregisterBrowser(id: string | null): Promise<void> {
  if (!id) return;
  const base = baseUrl();
  if (!base) return;
  try {
    await fetch(`${base}/browsers/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    // Ignore — registry best-effort.
  }
}
