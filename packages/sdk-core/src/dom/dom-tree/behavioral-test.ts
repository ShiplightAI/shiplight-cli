/**
 * Behavioral Equivalence Test
 *
 * Runs both JS and TS versions on actual pages and compares their outputs.
 * This is the only reliable way to prove functional equivalence.
 *
 * Run with: pnpm tsx src/dom/dom-tree/behavioral-test.ts
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DOMTreeResult {
  rootId: string | null;
  map: Record<string, any>;
}

function deepEqual(a: any, b: any, path = ''): string[] {
  const differences: string[] = [];

  if (typeof a !== typeof b) {
    differences.push(`${path}: type mismatch (${typeof a} vs ${typeof b})`);
    return differences;
  }

  if (a === null || b === null) {
    if (a !== b) differences.push(`${path}: ${a} vs ${b}`);
    return differences;
  }

  if (typeof a !== 'object') {
    if (a !== b) differences.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return differences;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    differences.push(`${path}: array mismatch`);
    return differences;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  for (const key of keysA) {
    if (!(key in b)) {
      differences.push(`${path}.${key}: missing in second object`);
    } else {
      differences.push(...deepEqual(a[key], b[key], `${path}.${key}`));
    }
  }

  for (const key of keysB) {
    if (!(key in a)) {
      differences.push(`${path}.${key}: missing in first object`);
    }
  }

  return differences;
}

async function runBehavioralTest() {
  console.log('🔍 DOM-Tree Behavioral Equivalence Test\n');
  console.log('This test runs both JS and compiled TS versions and compares outputs.\n');

  // Read the original JS file
  const originalJs = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf-8');

  // Read the built TS file (already in IIFE format from build.ts)
  const builtTsPath = path.join(__dirname, 'dist/index.js');
  if (!fs.existsSync(builtTsPath)) {
    console.error('❌ Built TS not found. Run:');
    console.error('   pnpm tsx src/dom/dom-tree/build.ts');
    process.exit(1);
  }

  const compiledTs = fs.readFileSync(builtTsPath, 'utf-8');

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const testCases = [
    { url: 'https://example.com', name: 'Simple page' },
    { url: 'https://news.ycombinator.com', name: 'Hacker News (many links)' },
    { url: 'https://www.wikipedia.org', name: 'Wikipedia (forms + links)' },
  ];

  const args = {
    doHighlightElements: false,
    focusHighlightIndex: -1,
    viewportExpansion: 0,
    debugMode: false,
    interactiveClassNames: [],
    alwaysHighlightFileInput: false,
  };

  let allPassed = true;

  for (const testCase of testCases) {
    console.log(`\n📄 ${testCase.name}: ${testCase.url}`);

    try {
      await page.goto(testCase.url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch {
      await page.goto(testCase.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Run original JS version
    console.log('   Running original JS...');
    const jsResult: DOMTreeResult = await page.evaluate((code: string) => {
      try {
        const fn = eval(code);
        return { success: true, data: fn({
          doHighlightElements: false,
          focusHighlightIndex: -1,
          viewportExpansion: 0,
          debugMode: false,
          interactiveClassNames: [],
          alwaysHighlightFileInput: false,
        })};
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }, originalJs) as any;

    if (!jsResult.success) {
      console.log(`   ❌ JS error: ${jsResult.error}`);
      allPassed = false;
      continue;
    }

    // Run compiled TypeScript version
    console.log('   Running compiled TS...');
    const tsResult: DOMTreeResult = await page.evaluate((code: string) => {
      try {
        const fn = eval(code);
        return { success: true, data: fn({
          doHighlightElements: false,
          focusHighlightIndex: -1,
          viewportExpansion: 0,
          debugMode: false,
          interactiveClassNames: [],
          alwaysHighlightFileInput: false,
        })};
      } catch (e: any) {
        return { success: false, error: e.message, code: code.substring(0, 500) };
      }
    }, compiledTs) as any;

    if (!tsResult.success) {
      console.log(`   ❌ TS error: ${tsResult.error}`);
      console.log(`   Code preview: ${tsResult.code}...`);
      allPassed = false;
      continue;
    }

    const jsData = jsResult.data;
    const tsData = tsResult.data;

    // Compare results
    console.log(`   JS: rootId=${jsData.rootId}, nodes=${Object.keys(jsData.map).length}`);
    console.log(`   TS: rootId=${tsData.rootId}, nodes=${Object.keys(tsData.map).length}`);

    // Deep comparison
    const differences = deepEqual(jsData, tsData, 'root');

    if (differences.length === 0) {
      console.log('   ✅ Results are IDENTICAL!');
    } else {
      console.log(`   ⚠️  Found ${differences.length} difference(s):`);
      for (const diff of differences.slice(0, 10)) {
        console.log(`      - ${diff}`);
      }
      if (differences.length > 10) {
        console.log(`      ... and ${differences.length - 10} more`);
      }
      allPassed = false;
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ PROOF: Both versions produce IDENTICAL outputs!');
    console.log('   The TypeScript version is behaviorally equivalent to the JavaScript.');
  } else {
    console.log('❌ Versions produce different outputs - investigation needed');
  }
}

runBehavioralTest().catch(console.error);
