// index.html inlines a FOUC-prevention rule that hard-codes the bgBase
// + textBody values from theme.ts. The two must stay in sync — this test
// is the safety net the comment in theme.ts promises.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { colors } from "./theme";

const here = dirname(fileURLToPath(import.meta.url));

describe("theme.ts ↔ index.html FOUC sync", () => {
  const indexHtml = readFileSync(join(here, "index.html"), "utf-8");

  it("index.html's inline `background` matches theme.colors.bgBase", () => {
    assert.ok(
      indexHtml.includes(`background: ${colors.bgBase}`),
      `index.html must contain "background: ${colors.bgBase}" to prevent FOUC drift; current theme.bgBase is ${colors.bgBase}.`,
    );
  });

  it("index.html's inline `color` matches theme.colors.textBody", () => {
    assert.ok(
      indexHtml.includes(`color: ${colors.textBody}`),
      `index.html must contain "color: ${colors.textBody}" to prevent FOUC drift; current theme.textBody is ${colors.textBody}.`,
    );
  });
});
