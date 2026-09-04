/**
 * The transpiler serves a cached action entity only while it still supersedes the YAML
 * that is actually there.
 *
 * Cache entries are written by self-healing, so each one means "the inline entity at this
 * statement failed, and this worked instead". The statement UID deliberately does not
 * depend on the inline entity — it is the identity used for debug artifacts and post-run
 * attribution — so the entry itself carries the fingerprint of what it superseded, and
 * `transpileAction` checks it before letting the entry win.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ActionEntity, ActionEntityStore } from 'shiplight-types';
import { fingerprintActionEntity } from 'shiplight-types';
import { parseYamlTestFile } from './yamlParser';
import { transpileYamlContent } from './pipeline';

const ORIGINAL_LOCATOR = "getByRole('button', { name: 'Login' })";
const EDITED_LOCATOR = "getByTestId('login-btn')";
const HEALED_LOCATOR = "getByTestId('healed-by-runner')";

const yamlWith = (locator: string) => `goal: Login test
statements:
  - intent: Click login
    action: click
    locator: "${locator}"
`;

/** The inline entity the YAML above parses to — what a heal would have superseded. */
function inlineEntityOf(yaml: string, filePath: string): ActionEntity | undefined {
  const parsed = parseYamlTestFile(yaml, filePath);
  const [stmt] = parsed.testFlow!.statements!;
  return (stmt as { action_entity?: ActionEntity }).action_entity;
}

function uidOf(yaml: string, filePath: string): string {
  return parseYamlTestFile(yaml, filePath).testFlow!.statements![0].uid;
}

const healed: ActionEntity = {
  action_description: 'Click login',
  action_data: { action_name: 'click', kwargs: {} },
  locator: HEALED_LOCATOR,
};

/** A store holding one healed entry for `uid`, stamped with `sourceFingerprint`. */
function storeWith(uid: string, sourceFingerprint: string | undefined): ActionEntityStore {
  return {
    version: '1.0',
    entries: {
      [uid]: {
        action_entity: healed,
        updated_at: '2026-01-01T00:00:00.000Z',
        updated_by: { source: 'runner', test_run_id: 1 },
        ...(sourceFingerprint !== undefined && { source_fingerprint: sourceFingerprint }),
      },
    },
  };
}

describe('cached entity applies only while it still supersedes the YAML', () => {
  let dir: string;

  // Owned by this suite alone, created and removed in hooks — no module-scope directory
  // shared with another suite, and no test body that has to create it.
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'fingerprint-gate-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Transpile `yaml` against `store` and return the generated spec's source. */
  function specFor(yaml: string, store: ActionEntityStore, name: string): string {
    const filePath = join(dir, name);
    writeFileSync(filePath, yaml);
    const result = transpileYamlContent(yaml, filePath, {
      version: '0.0.1-test',
      actionEntityStore: store,
      parsed: parseYamlTestFile(yaml, filePath),
    });
    assert.equal(result.valid, true, `transpile errors: ${result.errors?.join('; ')}`);
    return readFileSync(result.specFile!, 'utf-8');
  }

  it('serves the healed entity while the inline entity is unchanged', () => {
    const yaml = yamlWith(ORIGINAL_LOCATOR);
    const filePath = join(dir, 'match.test.yaml');
    const store = storeWith(uidOf(yaml, filePath), fingerprintActionEntity(inlineEntityOf(yaml, filePath)));

    assert.ok(specFor(yaml, store, 'match.test.yaml').includes(HEALED_LOCATOR));
  });

  it('refuses the healed entity once the locator is hand-edited', () => {
    // The entry was stamped against the ORIGINAL yaml; the file now holds the edit. The
    // UID is unchanged — that is the point — so only the fingerprint can catch this.
    const original = yamlWith(ORIGINAL_LOCATOR);
    const edited = yamlWith(EDITED_LOCATOR);
    const filePath = join(dir, 'edited.test.yaml');
    assert.equal(uidOf(original, filePath), uidOf(edited, filePath), 'UID must not move on an edit');

    const store = storeWith(
      uidOf(original, filePath),
      fingerprintActionEntity(inlineEntityOf(original, filePath)),
    );

    const spec = specFor(edited, store, 'edited.test.yaml');
    assert.ok(spec.includes(EDITED_LOCATOR), 'the hand-edited locator must be what runs');
    assert.ok(!spec.includes(HEALED_LOCATOR), 'the superseded entry must not shadow the edit');
  });

  it('refuses when only a kwarg changed', () => {
    const before_ = `goal: T
statements:
  - intent: Enter username
    action: input_text
    locator: "getByRole('textbox')"
    text: admin
`;
    const after_ = before_.replace('text: admin', 'text: bob');
    const filePath = join(dir, 'kwarg.test.yaml');
    const store = storeWith(
      uidOf(before_, filePath),
      fingerprintActionEntity(inlineEntityOf(before_, filePath)),
    );

    const spec = specFor(after_, store, 'kwarg.test.yaml');
    assert.ok(spec.includes('bob'), 'the edited text must be what is typed');
    assert.ok(!spec.includes(HEALED_LOCATOR), 'a stale entry must not reinstate the old kwargs');
  });

  it('grandfathers an entry written before fingerprinting existed', () => {
    // Upgrade path: entries with no stamp keep working, so nobody loses a populated cache
    // on the release that adds this. They get stamped the next time they heal.
    const yaml = yamlWith(ORIGINAL_LOCATOR);
    const filePath = join(dir, 'legacy.test.yaml');
    const store = storeWith(uidOf(yaml, filePath), undefined);

    assert.ok(specFor(yaml, store, 'legacy.test.yaml').includes(HEALED_LOCATOR));
  });

  it('reports a refused entry as original, not as a cache hit', () => {
    // Otherwise the run's cache summary counts a hit for an entry that never applied,
    // overstating the cache's contribution.
    const original = yamlWith(ORIGINAL_LOCATOR);
    const edited = yamlWith(EDITED_LOCATOR);
    const filePath = join(dir, 'summary.test.yaml');
    const store = storeWith(
      uidOf(original, filePath),
      fingerprintActionEntity(inlineEntityOf(original, filePath)),
    );

    const sources: string[] = [];
    writeFileSync(filePath, edited);
    transpileYamlContent(edited, filePath, {
      version: '0.0.1-test',
      actionEntityStore: store,
      parsed: parseYamlTestFile(edited, filePath),
      onActionEntitySource: (info) => sources.push(info.source),
    });

    assert.deepEqual(sources, ['original']);
  });
});
