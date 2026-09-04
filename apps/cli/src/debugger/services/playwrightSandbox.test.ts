import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VariableStore } from "shiplight-types";
import { PlaywrightSandboxService, getMaskedContext, resolveCallReferencePath } from "./playwrightSandbox.js";
import { createTestContext } from "../../fixture.js";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";

// `generateAction` calls `this.agent.agentServices.validatePage(this.page)`
// (added in 85ab442ca for tab-switch tracking) before delegating to
// `agent.generate`. In single-tab tests the page passes through unchanged,
// so a pass-through stub is enough to keep the unit test focused on the
// response-normalisation logic under test.
const passThroughAgentServices = { validatePage: (p: unknown) => p };

describe("PlaywrightSandboxService.generateAction", () => {
  it("normalizes a successful agent response into the debugger API shape", async () => {
    const action = {
      action_description: "Click submit",
      action_data: {
        action_name: "click",
        kwargs: {},
      },
    };

    const agent = {
      generate: async () => ({
        success: true,
        details: "Generated action successfully",
        actions: [action],
        debugInfo: { provider: "test" },
      }),
      agentServices: passThroughAgentServices,
    };

    const sandbox = new PlaywrightSandboxService({} as any, agent as any);

    const result = await sandbox.generateAction("session", "Click submit", "main.0");

    assert.deepEqual(result, {
      status: "success",
      action,
      explanation: "Generated action successfully",
      debugInfo: { provider: "test" },
      completes_instruction: true,
    });
  });

  it("returns an error payload when the agent generates no action", async () => {
    const agent = {
      generate: async () => ({
        success: false,
        details: "Need multiple steps",
        actions: [],
        debugInfo: { provider: "test" },
      }),
      agentServices: passThroughAgentServices,
    };

    const sandbox = new PlaywrightSandboxService({} as any, agent as any);

    const result = await sandbox.generateAction("session", "Do two things", "main.0");

    assert.deepEqual(result, {
      status: "error",
      explanation: "Need multiple steps",
      debugInfo: { provider: "test" },
    });
  });
});

describe("PlaywrightSandboxService.executeCode", () => {
  it("makes Playwright expect available to debugger code evaluation", async () => {
    const agent = {
      agentServices: passThroughAgentServices,
    };

    const sandbox = new PlaywrightSandboxService({} as any, agent as any);

    const result = await sandbox.executeCode("session", "expect('123').toBe('123')");

    assert.equal(result.status, "success");
  });
});

describe("PlaywrightSandboxService.executeAction — function references", () => {
  it("rejects an absolute path in a call: reference without touching the filesystem", async () => {
    const agent = {
      agentServices: passThroughAgentServices,
    };

    const sandbox = new PlaywrightSandboxService({} as any, agent as any);

    const actionEntity = {
      action_data: {
        action_name: "function",
        kwargs: {
          functionName: "/project/helpers/auth.ts#loginUser",
          args: ["page"],
        },
      },
    };

    const result = await sandbox.executeAction("session", actionEntity as any, "main.0");

    assert.equal(result.status, "error");
    assert.match(result.details, /Absolute paths are not supported in call: references/);
  });

  it("passes new call: args positionally while preserving Page, string, and number values", async () => {
    const activePage = { marker: "playwright-page", context: () => ({ request: {} }) };
    const agent = {
      agentServices: {
        validatePage: () => activePage,
        readVariable: () => undefined,
      },
    };

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-function-args-"));
    const helperDir = path.join(tmpDir, "helpers");
    await fs.mkdir(helperDir);
    await fs.writeFile(
      path.join(helperDir, "navigation.func.mjs"),
      `export async function navigate(page, targetPath, timeout) {
        if (page?.marker !== "playwright-page") throw new Error("wrong page");
        if (targetPath !== "/target-path") throw new Error("wrong path: " + JSON.stringify(targetPath));
        if (timeout !== 45000) throw new Error("wrong timeout: " + JSON.stringify(timeout));
      }`,
    );

    try {
      const sandbox = new PlaywrightSandboxService(activePage as any, agent as any, undefined, tmpDir);
      const result = await sandbox.executeAction("session", {
        action_data: {
          action_name: "function",
          kwargs: {
            functionName: "helpers/navigation.func.mjs#navigate",
            args: ["page", "/target-path", 45000],
          },
        },
      } as any, "main.0");

      assert.equal(result.status, "success", result.details);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("continues to execute legacy named function parameters", async () => {
    const activePage = { marker: "playwright-page", context: () => ({ request: {} }) };
    const agent = {
      agentServices: {
        validatePage: () => activePage,
        readVariable: () => undefined,
      },
    };

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-legacy-function-"));
    await fs.writeFile(
      path.join(tmpDir, "navigation.mjs"),
      `export async function navigate(page, targetPath, timeout) {
        if (page?.marker !== "playwright-page") throw new Error("wrong page");
        if (targetPath !== "/legacy-path") throw new Error("wrong path");
        if (timeout !== "30000") throw new Error("wrong timeout");
      }`,
    );

    try {
      const sandbox = new PlaywrightSandboxService(activePage as any, agent as any, undefined, tmpDir);
      const result = await sandbox.executeAction("session", {
        action_data: {
          action_name: "function",
          kwargs: {
            functionName: "navigation.mjs#navigate",
            parameterNames: ["page", "targetPath", "timeout"],
            parameterValues: ["page", "/legacy-path", "30000"],
          },
        },
      } as any, "main.0");

      assert.equal(result.status, "success", result.details);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("PlaywrightSandboxService.executeAction — self-healing classification", () => {
  it("does not self-heal go_to_url even when the debugger requests self-healing", async () => {
    let receivedCanSelfHeal: boolean | undefined;
    const activePage = {};
    const agent = {
      agentServices: { validatePage: () => activePage },
      step: async (
        _page: unknown,
        _fn: () => Promise<void>,
        _description: string,
        _stepId: string,
        _stmtUid: string | undefined,
        canSelfHeal: boolean,
      ) => {
        receivedCanSelfHeal = canSelfHeal;
        return {};
      },
      getAgentNote: () => "",
      _getContext: () => undefined,
    };

    const sandbox = new PlaywrightSandboxService(activePage as never, agent as never);
    const result = await sandbox.executeAction(
      "session",
      {
        action_description: "Navigate to an invalid URL",
        action_data: { action_name: "go_to_url", kwargs: { url: "http://[::1" } },
      },
      "main.0",
      { withSelfHealing: true },
    );

    assert.equal(result.status, "success");
    assert.equal(receivedCanSelfHeal, false);
  });
});

describe("PlaywrightSandboxService.executeAction — testContext threading", () => {
  it("persists a mutation a called function makes on testContext back into the shared VariableStore", async () => {
    const agent = {
      agentServices: passThroughAgentServices,
    };

    const variableStore = new VariableStore();
    const testContext = createTestContext(variableStore);
    const page = { context: () => ({ request: {} }) };

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-testcontext-"));
    const helperPath = path.join(tmpDir, "helper.mjs");
    await fs.writeFile(
      helperPath,
      `export async function generate_random_email(page, testContext, request) {
        testContext.email = "test+1234@shiplight.ai";
      }`,
    );

    try {
      const sandbox = new PlaywrightSandboxService(page as any, agent as any, undefined, tmpDir, testContext as any);

      const actionEntity = {
        action_data: {
          action_name: "function",
          kwargs: {
            functionName: "helper.mjs#generate_random_email",
            args: [],
          },
        },
      };

      const result = await sandbox.executeAction("session", actionEntity as any, "main.0");

      assert.equal(result.status, "success");
      assert.equal(variableStore.get("email"), "test+1234@shiplight.ai");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("resolveCallReferencePath", () => {
  const projectRoot = "/project";
  const yamlDir = "/project/demo";

  it("resolves a bare path relative to the project root", () => {
    assert.equal(
      resolveCallReferencePath("helpers/cart.ts", yamlDir, projectRoot),
      path.resolve("/project", "helpers/cart.ts"),
    );
  });

  it("resolves a ../-relative path relative to the yaml file, not the project root", () => {
    // Regression: `../helpers/cart.ts` from a YAML in demo/ must land in
    // /project/helpers (sibling of demo/), NOT escape above the project root.
    assert.equal(
      resolveCallReferencePath("../helpers/cart.ts", yamlDir, projectRoot),
      "/project/helpers/cart.ts",
    );
  });

  it("resolves a ./-relative path relative to the yaml file", () => {
    assert.equal(
      resolveCallReferencePath("./cart.ts", yamlDir, projectRoot),
      "/project/demo/cart.ts",
    );
  });

  it("falls back to cwd for a bare path when projectRoot is undefined", () => {
    assert.equal(
      resolveCallReferencePath("helpers/cart.ts", yamlDir, undefined),
      path.resolve(process.cwd(), "helpers/cart.ts"),
    );
  });
});

describe("getMaskedContext", () => {
  it("returns undefined when variableStore is undefined", () => {
    assert.equal(getMaskedContext(undefined), undefined);
  });

  it("returns all values unmodified when no keys are sensitive", () => {
    const store = new VariableStore();
    store.set("username", "alice");
    store.set("host", "example.com");

    assert.deepEqual(getMaskedContext(store), {
      username: "alice",
      host: "example.com",
    });
  });

  it("masks sensitive keys and passes non-sensitive keys through", () => {
    const store = new VariableStore();
    store.set("username", "alice");
    store.set("password", "s3cret!", true);
    store.set("api_token", "tok_abc123", true);

    assert.deepEqual(getMaskedContext(store), {
      username: "alice",
      password: "••••••••",
      api_token: "••••••••",
    });
  });
});
