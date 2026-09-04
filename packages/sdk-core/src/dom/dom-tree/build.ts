#!/usr/bin/env npx tsx
/**
 * Build script for dom-tree module
 *
 * Compiles index.ts → index.js in IIFE format suitable for page.evaluate()
 *
 * Usage: pnpm tsx src/dom/dom-tree/build.ts
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputFile = path.join(__dirname, 'index.ts');
const distDir = path.join(__dirname, 'dist');
const outputFile = path.join(distDir, 'index.js');
const tempDir = '/tmp/dom-tree-build';

console.log('🔨 Building dom-tree module...\n');

// Step 1: Compile TypeScript to JavaScript
console.log('1. Compiling TypeScript...');
fs.mkdirSync(tempDir, { recursive: true });

execSync(`npx tsc "${inputFile}" \
  --outDir "${tempDir}" \
  --target ES2020 \
  --module ESNext \
  --moduleResolution bundler \
  --lib ES2022,DOM,DOM.Iterable \
  --skipLibCheck \
  --declaration false \
  --removeComments false`, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '../../..'),
});

const compiledFile = path.join(tempDir, 'index.js');
let code = fs.readFileSync(compiledFile, 'utf-8');

// Step 2: Transform to IIFE format
console.log('2. Transforming to IIFE format...');

// Remove the header comments (module-level docs)
code = code.replace(/^\/\*\*[\s\S]*?\*\/\s*/m, '');

// Remove section separator comments
code = code.replace(/^\/\/ =+\n\/\/ .+\n\/\/ =+\n/gm, '');

// Remove export statements and transform to IIFE
// "export const buildDOMTree = (args = {...}) => {" → "(args = {...}) => {"
code = code.replace(/^export const buildDOMTree = /, '');

// Remove the default export at the end
code = code.replace(/;\s*\/\/ Export as default[\s\S]*$/, '');
code = code.replace(/\nexport default buildDOMTree;\s*$/, '');

// Remove any trailing export statements
code = code.replace(/^export \{[^}]*\};\s*$/gm, '');

// Trim and clean up
code = code.trim();

// Remove trailing semicolon if present
if (code.endsWith(';')) {
  code = code.slice(0, -1);
}

// The function should now be: (args = {...}) => { ... }
// Wrap in outer parentheses for IIFE compatibility: ((args = {...}) => { ... })
code = '(' + code + ')';

// Step 3: Write output
console.log('3. Writing output...');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outputFile, code, 'utf-8');

// Step 4: Verify the output is valid JavaScript
console.log('4. Verifying output...');
try {
  new Function('return ' + code);
  console.log('   ✅ Output is valid JavaScript');
} catch (e: any) {
  console.error('   ❌ Output is invalid JavaScript:', e.message);
  process.exit(1);
}

// Step 5: Show stats
const inputSize = fs.statSync(inputFile).size;
const outputSize = fs.statSync(outputFile).size;
console.log(`\n📊 Stats:`);
console.log(`   Input (TS):  ${(inputSize / 1024).toFixed(1)} KB`);
console.log(`   Output (JS): ${(outputSize / 1024).toFixed(1)} KB`);

console.log(`\n✅ Build complete: ${outputFile}`);
