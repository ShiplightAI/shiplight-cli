/**
 * Preflight verdict for the registry signing key, split out of
 * publish-mcp-registry.ts so it can be tested without running the release.
 *
 * The key signs registry ownership for the whole shiplight.ai domain, and it is
 * needed for exactly one thing: `mcp-publisher login dns`. Everything before
 * that — version consistency, the registry duplicate check, `mcp-publisher
 * validate` — is unauthenticated and works fine without it.
 *
 * Requiring it regardless made the script's advertised safe mode unusable: the
 * dry-run path in publish-mcp.yml runs the script without --publish and is not
 * given the secret, so it failed at preflight and never reached the validate it
 * exists to run. The same block hit anyone running the preflight locally to
 * check a manifest.
 */

export type SigningKeyVerdict =
  /** Key is available and usable. */
  | { kind: 'env' | 'file'; detail: string }
  /** No key, but none is needed because we are not publishing. */
  | { kind: 'not-needed'; detail: string }
  /** Cannot proceed: publishing without a key, or the key on disk is exposed. */
  | { kind: 'blocked'; detail: string };

export interface SigningKeyInputs {
  /** MCP_REGISTRY_PRIVATE_KEY — raw hex, used by CI so no PEM lands on disk. */
  keyHex?: string;
  /** Path a PEM would live at, whether or not one is there. */
  keyPath: string;
  /** Whether a file exists at keyPath. */
  keyFileExists: boolean;
  /** Permission bits of that file (mode & 0o777); ignored when it is absent. */
  keyFileMode?: number;
  /** True when the run will actually publish (--publish). */
  shouldPublish: boolean;
}

export function resolveSigningKey({
  keyHex,
  keyPath,
  keyFileExists,
  keyFileMode,
  shouldPublish,
}: SigningKeyInputs): SigningKeyVerdict {
  if (keyHex) {
    return { kind: 'env', detail: 'from MCP_REGISTRY_PRIVATE_KEY (env)' };
  }

  if (keyFileExists) {
    // A world- or group-readable private key is a real exposure, and this one
    // signs registry ownership for the whole domain. Checked even when we are
    // not publishing: the exposure exists either way, and a preflight is the
    // natural place to be told about it.
    const mode = keyFileMode ?? 0;
    if (mode & 0o077) {
      return {
        kind: 'blocked',
        detail:
          `${keyPath} has permissions ${mode.toString(8)}; it must not be readable by group or ` +
          `others. Run: chmod 600 "${keyPath}"`,
      };
    }
    return { kind: 'file', detail: `${keyPath} (${mode.toString(8)})` };
  }

  if (!shouldPublish) {
    return {
      kind: 'not-needed',
      detail: 'none found — not needed, this run stops before login (re-run with --publish to sign)',
    };
  }

  return {
    kind: 'blocked',
    detail:
      `No signing key. Set MCP_REGISTRY_PRIVATE_KEY (hex), or MCP_REGISTRY_KEY to a PEM path, ` +
      `or place one at ${keyPath}.`,
  };
}
