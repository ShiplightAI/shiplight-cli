import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import { findAvailablePort, isPortAvailable, probePort } from "./portUtils.js";

// Ask the kernel for a port, close the listener, return it. Small TOCTOU window — fine for unit tests.
function getEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => {
        if (typeof addr === "object" && addr) resolve(addr.port);
        else reject(new Error("could not determine ephemeral port"));
      });
    });
  });
}

function listenOn(port: number, host: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(port, host, () => resolve(s));
  });
}

function closeServer(s: net.Server): Promise<void> {
  return new Promise((resolve) => s.close(() => resolve()));
}

describe("portUtils", () => {
  describe("isPortAvailable", () => {
    it("returns true for an ephemeral free port", async () => {
      const port = await getEphemeralPort();
      assert.equal(await isPortAvailable(port), true);
    });

    it("returns false when IPv4 (127.0.0.1) is occupied", async () => {
      const port = await getEphemeralPort();
      const s = await listenOn(port, "127.0.0.1");
      try {
        assert.equal(await isPortAvailable(port), false);
      } finally {
        await closeServer(s);
      }
    });

    it("treats an unreachable interface (EADDRNOTAVAIL) as free, not occupied", async () => {
      // 240.0.0.0/4 is IANA-reserved → bind yields EADDRNOTAVAIL, same as ::1 on IPv6-disabled hosts.
      const port = await getEphemeralPort();
      assert.equal(await probePort(port, "240.0.0.1"), true);
    });

    it("returns false when only IPv6 (::1) is occupied", async (t) => {
      const port = await getEphemeralPort();
      let s: net.Server;
      try {
        s = await listenOn(port, "::1");
      } catch {
        t.skip("IPv6 loopback unavailable");
        return;
      }
      try {
        assert.equal(await isPortAvailable(port), false);
      } finally {
        await closeServer(s);
      }
    });
  });

  describe("findAvailablePort", () => {
    it("returns the base port when it is free", async () => {
      const port = await getEphemeralPort();
      const found = await findAvailablePort(port, 5);
      assert.equal(found, port);
    });

    it("skips a busy base port and returns a free one in range", async () => {
      const port = await getEphemeralPort();
      const s = await listenOn(port, "127.0.0.1");
      try {
        const found = await findAvailablePort(port, 100);
        assert.ok(found !== null, "expected to find a free port");
        assert.notEqual(found, port);
        assert.equal(await isPortAvailable(found!), true);
      } finally {
        await closeServer(s);
      }
    });

    it("returns null when every port in the range is busy", async () => {
      const port = await getEphemeralPort();
      const s = await listenOn(port, "127.0.0.1");
      try {
        const found = await findAvailablePort(port, 1);
        assert.equal(found, null);
      } finally {
        await closeServer(s);
      }
    });
  });
});
