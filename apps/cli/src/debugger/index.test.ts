import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { startDebuggerServer } from "./index.js";

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a test port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

describe("startDebuggerServer", () => {
  it("allows Cache-Control and Idempotency-Key in CORS preflight headers", async () => {
    const initialDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-debugger-"));
    const port = await getAvailablePort();

    const server = await startDebuggerServer({
      initialDir,
      port,
    });

    try {
      // Any path will do — the CORS middleware sits in front of everything
      // and returns 204 for OPTIONS before route matching. We use a live
      // endpoint to keep the test realistic post-shell migration.
      const response = await fetch(`http://localhost:${port}/api/debugger/sessions`, {
        method: "OPTIONS",
      });

      assert.equal(response.status, 204);
      const allowHeaders = response.headers.get("access-control-allow-headers") ?? "";
      assert.match(allowHeaders, /Cache-Control/);
      assert.match(allowHeaders, /Idempotency-Key/);
      assert.match(allowHeaders, /Content-Type/);
    } finally {
      await server.close();
      fs.rmSync(initialDir, { recursive: true, force: true });
    }
  });
});
