import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createTestFlowRouter } from "./testFlow.js";

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a test port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
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
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("createTestFlowRouter", () => {
  it("loads and saves current call syntax without rewriting it as action: function", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-test-flow-router-"));
    const yamlPath = path.join(tmpDir, "function.test.yaml");
    fs.writeFileSync(yamlPath, [
      "goal: Function call",
      "statements:",
      "  - intent: Go directly to the target page",
      "    call: helpers/navigation.func.ts#navigate",
      '    args: [page, "/target-path", 45000]',
      "",
    ].join("\n"), "utf-8");

    const app = express();
    app.use(express.json());
    app.use(createTestFlowRouter({ initialDir: tmpDir, projectRoot: tmpDir }));

    const port = await getAvailablePort();
    const server = http.createServer(app);
    await listen(server, port);

    try {
      const endpoint = `http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`;
      const loadResponse = await fetch(endpoint);
      assert.equal(loadResponse.status, 200);
      const loaded = await loadResponse.json() as {
        testFlow: {
          statements: Array<{
            action_entity?: {
              action_data?: { kwargs?: Record<string, unknown> };
            };
          }>;
        };
        metadata: unknown;
      };
      assert.deepEqual(
        loaded.testFlow.statements[0]?.action_entity?.action_data?.kwargs?.args,
        ["page", "/target-path", 45000],
      );

      const saveResponse = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loaded),
      });
      assert.equal(saveResponse.status, 200);

      const savedYaml = fs.readFileSync(yamlPath, "utf-8");
      assert.match(savedYaml, /call: helpers\/navigation\.func\.ts#navigate/);
      assert.doesNotMatch(savedYaml, /action: function/);
      assert.doesNotMatch(savedYaml, /functionName:/);
    } finally {
      await close(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves settings when saving a loaded test flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-test-flow-router-"));
    const yamlPath = path.join(tmpDir, "example.test.yaml");
    fs.writeFileSync(yamlPath, [
      "goal: Example",
      "settings:",
      "  auto_dismiss_modal: true",
      "  browser_timezone: America/Los_Angeles",
      "  extra_http_headers:",
      "    x-test: enabled",
      "statements:",
      "  - intent: Click the Basic Form link.",
      "",
    ].join("\n"), "utf-8");

    const app = express();
    app.use(express.json());
    app.use(createTestFlowRouter({ initialDir: tmpDir, projectRoot: tmpDir }));

    const port = await getAvailablePort();
    const server = http.createServer(app);
    await listen(server, port);

    try {
      const loadResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`);
      assert.equal(loadResponse.status, 200);
      const loaded = await loadResponse.json() as { testFlow: unknown; metadata: unknown };

      const saveResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loaded),
      });
      assert.equal(saveResponse.status, 200);

      const savedYaml = fs.readFileSync(yamlPath, "utf-8");
      assert.match(savedYaml, /settings:/);
      assert.match(savedYaml, /auto_dismiss_modal: true/);
      assert.match(savedYaml, /browser_timezone: America\/Los_Angeles/);
      assert.match(savedYaml, /x-test: enabled/);
    } finally {
      await close(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves skip, fail, only, slow, beforeEach, afterEach, and parameters when saving a loaded test flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-test-flow-router-"));
    const yamlPath = path.join(tmpDir, "example.test.yaml");
    fs.writeFileSync(yamlPath, [
      "skip: known flake",
      "fail: expected failure",
      "only: true",
      "slow: true",
      "beforeEach:",
      "  - intent: Log in.",
      "afterEach:",
      "  - intent: Log out.",
      "parameters:",
      "  - name: admin",
      "    values:",
      "      username: admin@example.com",
      "goal: Example",
      "statements:",
      "  - intent: Click the button.",
      "",
    ].join("\n"), "utf-8");

    const app = express();
    app.use(express.json());
    app.use(createTestFlowRouter({ initialDir: tmpDir, projectRoot: tmpDir }));

    const port = await getAvailablePort();
    const server = http.createServer(app);
    await listen(server, port);

    try {
      const loadResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`);
      assert.equal(loadResponse.status, 200);
      const loaded = await loadResponse.json() as { testFlow: unknown; metadata: unknown };

      const saveResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loaded),
      });
      assert.equal(saveResponse.status, 200);

      const savedYaml = fs.readFileSync(yamlPath, "utf-8");
      assert.match(savedYaml, /skip: known flake/);
      assert.match(savedYaml, /fail: expected failure/);
      assert.match(savedYaml, /only: true/);
      assert.match(savedYaml, /slow: true/);
      assert.match(savedYaml, /beforeEach:/);
      assert.match(savedYaml, /Log in\./);
      assert.match(savedYaml, /afterEach:/);
      assert.match(savedYaml, /Log out\./);
      assert.match(savedYaml, /parameters:/);
      assert.match(savedYaml, /admin@example\.com/);
    } finally {
      await close(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves tags when saving a loaded test flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-test-flow-router-"));
    const yamlPath = path.join(tmpDir, "example.test.yaml");
    fs.writeFileSync(yamlPath, [
      "tags:",
      "  - smoke",
      "  - regression",
      "goal: Example",
      "statements:",
      "  - intent: Click the button.",
      "",
    ].join("\n"), "utf-8");

    const app = express();
    app.use(express.json());
    app.use(createTestFlowRouter({ initialDir: tmpDir, projectRoot: tmpDir }));

    const port = await getAvailablePort();
    const server = http.createServer(app);
    await listen(server, port);

    try {
      const loadResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`);
      assert.equal(loadResponse.status, 200);
      const loaded = await loadResponse.json() as { testFlow: unknown; metadata: unknown };

      const saveResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loaded),
      });
      assert.equal(saveResponse.status, 200);

      const savedYaml = fs.readFileSync(yamlPath, "utf-8");
      assert.match(savedYaml, /tags:/);
      assert.match(savedYaml, /smoke/);
      assert.match(savedYaml, /regression/);
    } finally {
      await close(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves per-test tags in a suite when saving a loaded test flow", async () => {
    // Regression: TestGroupEntry had no `tags` field, so the suite mapping in
    // this router dropped a test's tags on load and the save wrote the file
    // back without them. The types-level round trip cannot catch this — the
    // router builds TestGroupEntry by hand instead of calling yamlToTestFlow.
    // Losing a tag silently changes which tests a `--grep` CI job runs.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-test-flow-router-"));
    const yamlPath = path.join(tmpDir, "suite.test.yaml");
    fs.writeFileSync(yamlPath, [
      "name: Inventory Suite",
      "tags:",
      "  - smoke",
      "suite:",
      "  tests:",
      "    - name: Sort products",
      "      tags:",
      "        - auth",
      "        - slow-path",
      "      statements:",
      "        - intent: Sort by price",
      "    - name: Untagged",
      "      statements:",
      "        - intent: Do something",
      "",
    ].join("\n"), "utf-8");

    const app = express();
    app.use(express.json());
    app.use(createTestFlowRouter({ initialDir: tmpDir, projectRoot: tmpDir }));

    const port = await getAvailablePort();
    const server = http.createServer(app);
    await listen(server, port);

    try {
      const loadResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`);
      assert.equal(loadResponse.status, 200);
      const loaded = await loadResponse.json() as {
        testFlow: { testGroup?: { tests: { name: string; tags?: string[] }[] } };
        metadata: unknown;
      };

      // Tags must survive the load, not just the save.
      assert.deepEqual(loaded.testFlow.testGroup?.tests[0].tags, ["auth", "slow-path"]);
      assert.equal(loaded.testFlow.testGroup?.tests[1].tags, undefined);

      const saveResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loaded),
      });
      assert.equal(saveResponse.status, 200);

      const savedYaml = fs.readFileSync(yamlPath, "utf-8");
      assert.match(savedYaml, /auth/);
      assert.match(savedYaml, /slow-path/);
      // The suite's own file-level tags travel a separate path (metadata).
      assert.match(savedYaml, /smoke/);
    } finally {
      await close(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves use field when saving a loaded test flow", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-test-flow-router-"));
    const yamlPath = path.join(tmpDir, "example.test.yaml");
    fs.writeFileSync(yamlPath, [
      "goal: Example",
      "use:",
      "  storageState: auth.json",
      "statements:",
      "  - intent: Click the button.",
      "",
    ].join("\n"), "utf-8");

    const app = express();
    app.use(express.json());
    app.use(createTestFlowRouter({ initialDir: tmpDir, projectRoot: tmpDir }));

    const port = await getAvailablePort();
    const server = http.createServer(app);
    await listen(server, port);

    try {
      const loadResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`);
      assert.equal(loadResponse.status, 200);
      const loaded = await loadResponse.json() as { testFlow: unknown; metadata: unknown };

      const saveResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loaded),
      });
      assert.equal(saveResponse.status, 200);

      const savedYaml = fs.readFileSync(yamlPath, "utf-8");
      assert.match(savedYaml, /use:/);
      assert.match(savedYaml, /storageState: auth\.json/);
    } finally {
      await close(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("serializes local reusable step references as template YAML statements", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shiplight-test-flow-router-"));
    const yamlPath = path.join(tmpDir, "example.test.yaml");
    fs.writeFileSync(yamlPath, "goal: Example\nstatements: []\n", "utf-8");

    const app = express();
    app.use(express.json());
    app.use(createTestFlowRouter({ initialDir: tmpDir, projectRoot: tmpDir }));

    const port = await getAvailablePort();
    const server = http.createServer(app);
    await listen(server, port);
    const templateStatements = [
      {
        uid: "action-1",
        type: "ACTION",
        description: "Click the Basic Form link.",
        action_entity: {
          locator: "getByRole('link', { name: 'Basic Form' })",
          frame_path: [],
          action_description: "Click the Basic Form link.",
          action_data: {
            action_name: "click",
            kwargs: { element_index: 0 },
          },
        },
      },
    ];

    try {
      const createResponse = await fetch(`http://127.0.0.1:${port}/api/reusable-steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reusableStep: {
            name: "Login flow",
            description: "Reusable login steps",
            statements: templateStatements,
          },
        }),
      });
      assert.equal(createResponse.status, 200);
      const created = await createResponse.json() as { id: number };

      const savedTemplateYaml = fs.readFileSync(path.join(tmpDir, "templates", "Login flow.yaml"), "utf-8");
      assert.match(savedTemplateYaml, /- intent: Click the Basic Form link\./);
      assert.match(savedTemplateYaml, /action: click/);
      assert.match(savedTemplateYaml, /locator: "?getByRole\('link', \{ name: 'Basic Form' \}\)"?/);
      assert.doesNotMatch(savedTemplateYaml, /uid:/);
      assert.doesNotMatch(savedTemplateYaml, /type: ACTION/);
      assert.doesNotMatch(savedTemplateYaml, /action_entity:/);

      const saveResponse = await fetch(`http://127.0.0.1:${port}/api/test-flow?file=${encodeURIComponent(yamlPath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testFlow: {
            version: "1.3.0",
            goal: "Example",
            statements: [
              {
                uid: "step-1",
                type: "STEP",
                description: "Login flow",
                reference_id: created.id,
                statements: templateStatements,
              },
            ],
          },
        }),
      });
      assert.equal(saveResponse.status, 200);

      const savedYaml = fs.readFileSync(yamlPath, "utf-8");
      assert.match(savedYaml, /- template: templates\/Login flow\.yaml/);
      assert.doesNotMatch(savedYaml, /reference_id:/);
    } finally {
      await close(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
