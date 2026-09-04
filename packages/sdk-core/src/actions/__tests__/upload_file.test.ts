/**
 * Unit tests for the upload_file action.
 *
 * Covers the `paths` contract: it accepts either a single path string or a list
 * of path strings (z.union), and execute() resolves every entry to an absolute
 * path before handing them to the shared upload helper.
 */

import assert from 'node:assert';
import { describe, it, mock, beforeEach } from 'node:test';
import type { Page } from 'playwright';
import type { AgentServices } from '../../agent/agentServices';
import type { ActionEntity } from '../types';

// Capture the absolute paths handed to the shared upload implementation.
let capturedPaths: string[] | null = null;
mock.module('../../agent/agentFile', {
  namedExports: {
    uploadWithLocator: async (_page: unknown, _locator: unknown, paths: string[]) => {
      capturedPaths = paths;
    },
  },
});

// --- Dynamic import after mocks ---
const { UploadFileAction, UploadFileToolSchema, UploadFileToFileInputToolSchema } = await import(
  '../impl/upload_file'
);

// A page whose getByLabel() resolves the actionEntity.locator expression to a dummy locator.
function createPage(): Page {
  return {
    getByLabel: () => ({ first: () => ({ tag: 'locator' }) }),
  } as unknown as Page;
}

// Minimal AgentServices: no real download, deterministic absolute-path resolution.
function createAgentServices(): AgentServices {
  return {
    downloadTestDataFiles: async () => {},
    getTestDataFilePath: (p: string) => `/abs/${p}`,
    getActionSettings: () => ({}),
  } as unknown as AgentServices;
}

function makeEntity(paths: string | string[]): ActionEntity {
  return {
    action_description: 'Upload',
    locator: "getByLabel('Upload')",
    action_data: { action_name: 'upload_file', kwargs: { paths } },
  };
}

describe('UploadFileToolSchema / UploadFileToFileInputToolSchema: paths accepts a string or a list', () => {
  for (const [name, schema] of [
    ['UploadFileToolSchema', UploadFileToolSchema],
    ['UploadFileToFileInputToolSchema', UploadFileToFileInputToolSchema],
  ] as const) {
    it(`${name} accepts a single path string (backward compatible)`, () => {
      assert.strictEqual(schema.safeParse({ element_index: 0, paths: '/tmp/a.png' }).success, true);
    });

    it(`${name} accepts an array of path strings`, () => {
      assert.strictEqual(schema.safeParse({ element_index: 0, paths: ['/tmp/a.png', '/tmp/b.png'] }).success, true);
    });

    it(`${name} rejects a non-string array element`, () => {
      assert.strictEqual(schema.safeParse({ element_index: 0, paths: ['/tmp/a.png', 5] }).success, false);
    });
  }
});

describe('UploadFileAction.execute: resolves paths to absolute before upload', () => {
  beforeEach(() => {
    capturedPaths = null;
  });

  it('forwards a single string path as a one-element absolute list', async () => {
    await new UploadFileAction().execute(createPage(), makeEntity('a.png'), createAgentServices());
    assert.deepStrictEqual(capturedPaths, ['/abs/a.png']);
  });

  it('forwards every entry of a list as absolute paths', async () => {
    await new UploadFileAction().execute(createPage(), makeEntity(['a.png', 'b.png']), createAgentServices());
    assert.deepStrictEqual(capturedPaths, ['/abs/a.png', '/abs/b.png']);
  });

  it('throws when no paths are provided', async () => {
    const entity: ActionEntity = {
      action_description: 'Upload',
      locator: "getByLabel('Upload')",
      action_data: { action_name: 'upload_file', kwargs: {} },
    };
    await assert.rejects(
      () => new UploadFileAction().execute(createPage(), entity, createAgentServices()),
      /No file paths provided/
    );
  });
});
