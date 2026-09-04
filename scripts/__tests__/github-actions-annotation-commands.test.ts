import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const releaseWorkflows = [
  '.github/workflows/publish-cli.yml',
  '.github/workflows/publish-mcp.yml',
  '.github/workflows/publish-sdk.yml',
];

for (const workflowPath of releaseWorkflows) {
  test(`${workflowPath} does not contain literal GitHub annotation commands`, () => {
    const absolutePath = path.join(repoRoot, workflowPath);
    const source = readFileSync(absolutePath, 'utf8');

    assert.equal(
      /::(?:error|warning|notice)::/.test(source),
      false,
      `${workflowPath} contains a literal GitHub annotation command in workflow source; build the command dynamically instead`,
    );
  });
}
