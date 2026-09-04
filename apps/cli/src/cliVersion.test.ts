import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { findOwnPackageJson, resolveCliVersion, CLI_PACKAGE_NAME } from "./cliVersion.js";

function withTree(
  files: Record<string, unknown>,
  fn: (root: string) => void,
): void {
  const root = mkdtempSync(path.join(tmpdir(), "cli-version-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body));
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("findOwnPackageJson", () => {
  it("finds the package.json in the published-bundle layout (dist/cli.js)", () => {
    withTree(
      { "package.json": { name: CLI_PACKAGE_NAME, version: "0.1.93" } },
      (root) => {
        assert.deepEqual(findOwnPackageJson(path.join(root, "dist")), {
          path: path.join(root, "package.json"),
          version: "0.1.93",
        });
      },
    );
  });

  it("finds it from the deeper source layout (src/commands)", () => {
    // The whole reason this walks instead of using a fixed depth: the bundle
    // sits one level down, the source two.
    withTree(
      { "package.json": { name: CLI_PACKAGE_NAME, version: "0.1.93" } },
      (root) => {
        assert.deepEqual(findOwnPackageJson(path.join(root, "src", "commands")), {
          path: path.join(root, "package.json"),
          version: "0.1.93",
        });
      },
    );
  });

  it("skips a package.json belonging to someone else", () => {
    // A scaffolded project's own package.json sits between us and ours when
    // running inside a target directory. Matching on `name` stops us handing
    // back the user's version as if it were the CLI's.
    withTree(
      {
        "package.json": { name: CLI_PACKAGE_NAME, version: "0.1.93" },
        "target/package.json": { name: "user-project", version: "42.0.0" },
      },
      (root) => {
        assert.deepEqual(findOwnPackageJson(path.join(root, "target")), {
          path: path.join(root, "package.json"),
          version: "0.1.93",
        });
      },
    );
  });

  it("keeps walking past a malformed package.json instead of giving up", () => {
    withTree(
      {
        "package.json": { name: CLI_PACKAGE_NAME, version: "0.1.93" },
        "broken/package.json": "{ not json",
      },
      (root) => {
        assert.deepEqual(findOwnPackageJson(path.join(root, "broken")), {
          path: path.join(root, "package.json"),
          version: "0.1.93",
        });
      },
    );
  });

  it("ignores our package.json if it has no version", () => {
    withTree({ "package.json": { name: CLI_PACKAGE_NAME } }, (root) => {
      assert.equal(findOwnPackageJson(path.join(root, "dist")), null);
    });
  });

  it("returns null when there is no matching package.json", () => {
    withTree({ "package.json": { name: "something-else", version: "1.0.0" } }, (root) => {
      assert.equal(findOwnPackageJson(path.join(root, "dist")), null);
    });
  });
});

describe("resolveCliVersion", () => {
  it("returns a real semver for the running package, never the 'dev' placeholder", () => {
    const version = resolveCliVersion();
    // This is what gets caret-pinned into every scaffolded package.json. If it
    // were TRANSPILER_VERSION it would be the string 'dev' outside a build,
    // and `"shiplightai": "^dev"` is uninstallable.
    assert.match(version, /^\d+\.\d+\.\d+/);
    assert.notEqual(version, "dev");
  });

  it("throws with an actionable message rather than returning a placeholder", () => {
    withTree({}, (root) => {
      assert.throws(
        () => resolveCliVersion(root),
        /Could not determine the running shiplightai version/,
      );
    });
  });
});
