// Port discovery for `shiplight debug`. This was mirrored by the VS Code
// extension, which was deleted with the v1 workspaces in August 2026; this is
// now the only copy of the logic.

import * as net from "node:net";

// Returns true (free) unless EADDRINUSE. Other errors (e.g. EADDRNOTAVAIL on
// IPv6-disabled hosts) are treated as free so they don't break auto-pick.
export function probePort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolve(err.code !== "EADDRINUSE");
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

// True only if the port is free on both 127.0.0.1 and ::1, since
// listen(port, "localhost") may bind either family depending on DNS.
export async function isPortAvailable(port: number): Promise<boolean> {
  if (!(await probePort(port, "127.0.0.1"))) return false;
  return probePort(port, "::1");
}

// First free port in [base, base+count), or null if all are busy.
export async function findAvailablePort(
  base: number,
  count: number
): Promise<number | null> {
  for (let port = base; port < base + count; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return null;
}
