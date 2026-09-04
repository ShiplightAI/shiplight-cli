#!/usr/bin/env node
/**
 * Saves MCP resource content to the local resources/ folder for review.
 * Run from the repo root: node apps/mcp-server/scripts/save-resources.mjs
 */

import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getTestFlowJsonSchemaResource,
  getActionEntitySchemaResource,
} from "../../../packages/mcp-tools/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "../resources");

mkdirSync(outDir, { recursive: true });

writeFileSync(resolve(outDir, "testflow-json.md"), getTestFlowJsonSchemaResource());
writeFileSync(resolve(outDir, "action-entity.md"), await getActionEntitySchemaResource());

console.log(`Resources saved to apps/mcp-server/resources/`);
