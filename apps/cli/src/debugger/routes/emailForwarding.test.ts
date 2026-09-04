import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as http from "node:http";
import * as net from "node:net";
import { createEmailForwardingRouter } from "./emailForwarding.js";

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a test port"));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
    server.on("error", reject);
  });
}

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", resolve);
    server.on("error", reject);
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("createEmailForwardingRouter", () => {
  let server: http.Server;
  let port: number;
  let savedToken: string | undefined;
  let savedApiUrl: string | undefined;

  beforeEach(async () => {
    savedToken = process.env.SHIPLIGHT_API_TOKEN;
    savedApiUrl = process.env.SHIPLIGHT_API_URL;

    const app = express();
    app.use(createEmailForwardingRouter());
    port = await getAvailablePort();
    server = http.createServer(app);
    await listen(server, port);
  });

  afterEach(async () => {
    process.env.SHIPLIGHT_API_TOKEN = savedToken;
    process.env.SHIPLIGHT_API_URL = savedApiUrl;
    mock.restoreAll();
    await close(server);
  });

  function url(path: string) {
    return `http://127.0.0.1:${port}${path}`;
  }

  it("returns empty list with configured=false when token is missing", async () => {
    delete process.env.SHIPLIGHT_API_TOKEN;

    const res = await fetch(url("/api/email-forwarding/addresses"));
    assert.equal(res.status, 200);
    const body = await res.json() as { addresses: unknown[]; configured: boolean };
    assert.deepEqual(body.addresses, []);
    assert.equal(body.configured, false);
  });

  it("proxies upstream success with configured=true", async () => {
    const upstreamPayload = {
      addresses: [{ id: "1", address: "test@fwd.shiplight.ai", label: "CI", createdAt: "2026-01-01T00:00:00Z" }],
    };

    // Start a fake upstream server
    const upstreamPort = await getAvailablePort();
    const upstreamApp = express();
    upstreamApp.get("/email-forwarding/addresses", (_req, res) => {
      res.json(upstreamPayload);
    });
    const upstreamServer = http.createServer(upstreamApp);
    await listen(upstreamServer, upstreamPort);

    process.env.SHIPLIGHT_API_TOKEN = "shp_pat_test123";
    process.env.SHIPLIGHT_API_URL = `http://127.0.0.1:${upstreamPort}`;

    try {
      const res = await fetch(url("/api/email-forwarding/addresses"));
      assert.equal(res.status, 200);
      const body = await res.json() as { addresses: unknown[]; configured: boolean };
      assert.equal(body.configured, true);
      assert.equal(body.addresses.length, 1);
    } finally {
      await close(upstreamServer);
    }
  });

  it("returns upstream error status and message", async () => {
    const upstreamPort = await getAvailablePort();
    const upstreamApp = express();
    upstreamApp.get("/email-forwarding/addresses", (_req, res) => {
      res.status(401).json({ error: "Invalid or expired token" });
    });
    const upstreamServer = http.createServer(upstreamApp);
    await listen(upstreamServer, upstreamPort);

    process.env.SHIPLIGHT_API_TOKEN = "shp_pat_test123";
    process.env.SHIPLIGHT_API_URL = `http://127.0.0.1:${upstreamPort}`;

    try {
      const res = await fetch(url("/api/email-forwarding/addresses"));
      assert.equal(res.status, 401);
      const body = await res.json() as { error: string };
      assert.equal(body.error, "Invalid or expired token");
    } finally {
      await close(upstreamServer);
    }
  });

  it("returns 502 when upstream is unreachable", async () => {
    const deadPort = await getAvailablePort();
    process.env.SHIPLIGHT_API_TOKEN = "shp_pat_test123";
    process.env.SHIPLIGHT_API_URL = `http://127.0.0.1:${deadPort}`;

    const res = await fetch(url("/api/email-forwarding/addresses"));
    assert.equal(res.status, 502);
    const body = await res.json() as { error: string };
    assert.ok(body.error.includes("Failed to reach Shiplight API"));
  });
});
