import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { serializeReportData, writeReportDataFile, writeHtmlReport } from './reportFiles.js';
import type { ReportData, ReportTest } from './template.js';

function makeTest(overrides: Partial<ReportTest> = {}): ReportTest {
  return {
    title: 'logs in',
    file: 'tests/login.test.yaml',
    status: 'passed',
    duration: 1234,
    steps: [
      {
        stepId: 'step-1',
        description: 'click "Sign in"',
        status: 'success',
        duration: 42,
        contextBefore: { user: 'a@example.com' },
        contextAfter: { user: 'a@example.com', token: 'abc' },
      },
    ],
    ...overrides,
  };
}

function makeData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    tests: [makeTest(), makeTest({ title: 'logs out', status: 'failed', error: 'boom\n  at x' })],
    totalDuration: 2468,
    timestamp: '2026-08-27T00:00:00.000Z',
    shiplightVersion: '0.1.101',
    cacheSummary: { total_statements: 10, original: 4, cache_hits: 5, healed: 1, failed: 0 },
    ...overrides,
  };
}

describe('serializeReportData', () => {
  it('produces byte-identical output to JSON.stringify(data, null, 2)', () => {
    const data = makeData();
    assert.equal([...serializeReportData(data)].join(''), JSON.stringify(data, null, 2));
  });

  it('matches JSON.stringify for an empty tests array', () => {
    const data = makeData({ tests: [] });
    assert.equal([...serializeReportData(data)].join(''), JSON.stringify(data, null, 2));
  });

  it('matches JSON.stringify with a single test and no trailing keys', () => {
    const data: ReportData = { tests: [makeTest()], totalDuration: 1, timestamp: 'now' };
    assert.equal([...serializeReportData(data)].join(''), JSON.stringify(data, null, 2));
  });

  it('drops undefined values and preserves key order, like JSON.stringify', () => {
    const data = makeData({ shiplightVersion: undefined, cacheSummary: undefined });
    assert.equal([...serializeReportData(data)].join(''), JSON.stringify(data, null, 2));
  });

  it('matches JSON.stringify for unicode and embedded quotes', () => {
    const data = makeData({
      tests: [makeTest({ title: '登录 "quoted" \\ back\\slash', error: 'line1\nline2\ttab' })],
    });
    assert.equal([...serializeReportData(data)].join(''), JSON.stringify(data, null, 2));
  });

  it('emits the document one test at a time, never as a single string', () => {
    // The regression this module exists for: `JSON.stringify` over a whole
    // merged run throws `RangeError: Invalid string length`. A serializer that
    // built the document in one string would show up here as a single chunk
    // carrying most of the bytes.
    const tests = Array.from({ length: 40 }, (_, i) => makeTest({ title: `test ${i}` }));
    const data = makeData({ tests });
    const chunks = [...serializeReportData(data)];
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const largest = Math.max(...chunks.map((c) => c.length));

    assert.ok(chunks.length >= tests.length, `expected >= ${tests.length} chunks, got ${chunks.length}`);
    assert.ok(largest < total / 10, `largest chunk ${largest} should be far below the ${total}-char document`);
    assert.equal(chunks.join(''), JSON.stringify(data, null, 2));
  });
});

describe('writeReportDataFile', () => {
  it('writes a file that parses back to the same report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-report-files-'));
    const file = path.join(dir, 'report-data.json');
    const data = makeData();

    writeReportDataFile(file, data);

    const raw = fs.readFileSync(file, 'utf-8');
    assert.equal(raw, JSON.stringify(data, null, 2));
    assert.deepEqual(JSON.parse(raw), JSON.parse(JSON.stringify(data)));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('leaves the previous file intact when serialization fails part-way', () => {
    // The one-shot JSON.stringify this replaced threw before writing anything.
    // Opening the real path with 'w' would truncate a previous run's report and
    // leave it unparseable.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-report-files-'));
    const file = path.join(dir, 'report-data.json');
    const previous = makeData({ tests: [makeTest({ title: 'previous run' })] });
    writeReportDataFile(file, previous);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const doomed = makeData({ tests: [makeTest({ steps: [{ stepId: 's', description: 'd', status: 'success', contextBefore: circular }] })] });

    assert.throws(() => writeReportDataFile(file, doomed));
    assert.equal(fs.readFileSync(file, 'utf-8'), JSON.stringify(previous, null, 2), 'the previous report survives');
    assert.deepEqual(fs.readdirSync(dir), ['report-data.json'], 'no temp file left behind');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('truncates an existing file instead of appending to it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-report-files-'));
    const file = path.join(dir, 'report-data.json');
    fs.writeFileSync(file, 'x'.repeat(10_000), 'utf-8');

    const data = makeData({ tests: [makeTest()] });
    writeReportDataFile(file, data);

    assert.equal(fs.readFileSync(file, 'utf-8'), JSON.stringify(data, null, 2));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('writeHtmlReport', () => {
  it('writes the rendered HTML and reports success', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-report-files-'));
    const file = path.join(dir, 'index.html');

    const written = writeHtmlReport(file, makeData(), () => '<html>ok</html>');

    assert.equal(written, true);
    assert.equal(fs.readFileSync(file, 'utf-8'), '<html>ok</html>');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes a previous run\'s HTML when the render fails', () => {
    // A stale report that looks current is worse than a missing one: CI would
    // upload it as this run's result.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-report-files-'));
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, '<html>an earlier run</html>', 'utf-8');
    const originalError = console.error;
    console.error = () => {};

    let written: boolean;
    try {
      written = writeHtmlReport(file, makeData(), () => { throw new RangeError('Invalid string length'); });
    } finally {
      console.error = originalError;
    }

    assert.equal(written, false);
    assert.equal(fs.existsSync(file), false, 'the stale report must not survive');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports failure without throwing when the report is too large to render', () => {
    // Losing index.html must not take the cloud upload that runs after it down
    // with it — that is what made an oversized run lose its results entirely.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiplight-report-files-'));
    const file = path.join(dir, 'index.html');
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg?: unknown) => { errors.push(String(msg)); };

    let written: boolean;
    try {
      written = writeHtmlReport(file, makeData(), () => {
        throw new RangeError('Invalid string length');
      });
    } finally {
      console.error = originalError;
    }

    assert.equal(written, false);
    assert.equal(fs.existsSync(file), false);
    assert.ok(errors.some((e) => e.includes('Invalid string length')), errors.join('\n'));
    assert.ok(errors.some((e) => e.includes('report-data.json was still written')), errors.join('\n'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
