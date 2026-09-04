import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findFunctionDefinition,
  mapFunctionArgumentsForDisplay,
  updateFunctionActionData,
} from "./functionActionUtils";

describe("mapFunctionArgumentsForDisplay", () => {
  it("maps new positional call args to exported function parameter names", () => {
    assert.deepEqual(
      mapFunctionArgumentsForDisplay(
        ["page", "/target-path", 45000],
        "async function navigate(page, targetPath, timeout) {}",
      ),
      {
        page: "page",
        targetPath: "/target-path",
        timeout: "45000",
      },
    );
  });

  it("keeps legacy named parameter display data unchanged", () => {
    assert.deepEqual(
      mapFunctionArgumentsForDisplay(
        ["page", "/legacy-path"],
        undefined,
        ["page", "targetPath"],
      ),
      {
        page: "page",
        targetPath: "/legacy-path",
      },
    );
  });
});

describe("findFunctionDefinition", () => {
  it("finds a local call: function by reference when functionId is absent", () => {
    const functions = [{
      id: 1,
      name: "helpers/navigation.func.ts#navigate",
    }];

    assert.equal(
      findFunctionDefinition(
        functions,
        "helpers/navigation.func.ts#navigate",
        undefined,
      ),
      functions[0],
    );
  });
});

describe("updateFunctionActionData", () => {
  it("updates positional call args without leaving stale legacy values", () => {
    const updated = updateFunctionActionData(
      {
        action_name: "function",
        kwargs: {
          functionName: "helpers/navigation.func.ts#navigate",
          args: ["page", "/target-path", 45000],
        },
      },
      { id: 1, name: "helpers/navigation.func.ts#navigate" },
      {
        page: "page",
        targetPath: "/target-path",
        timeout: "50000",
      },
    );

    assert.deepEqual(updated.kwargs?.args, ["page", "/target-path", 50000]);
    assert.equal(updated.kwargs?.parameterNames, undefined);
    assert.equal(updated.kwargs?.parameterValues, undefined);
  });

  it("continues to update legacy named parameters", () => {
    const updated = updateFunctionActionData(
      {
        action_name: "function",
        kwargs: {
          functionName: "navigate",
          parameterNames: ["page", "targetPath", "timeout"],
          parameterValues: ["page", "/old-path", "30000"],
        },
      },
      { id: 7, name: "navigate" },
      {
        page: "page",
        targetPath: "/new-path",
        timeout: "50000",
      },
    );

    assert.deepEqual(updated.kwargs?.parameterNames, ["page", "targetPath", "timeout"]);
    assert.deepEqual(updated.kwargs?.parameterValues, ["page", "/new-path", "50000"]);
  });
});
