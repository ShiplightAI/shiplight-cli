#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const frontendRoot = path.resolve(__dirname, '..');
const srcDir = path.join(frontendRoot, 'src');
const messagesPath = path.join(frontendRoot, 'messages/en.json');

const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));

function flatten(obj, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, next, out);
    } else {
      out.add(next);
    }
  }
  return out;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'public' || entry.name === '.next') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const validKeys = flatten(messages);
const files = walk(srcDir);
const issues = [];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');

  const translatorVars = new Map();
  const translatorDecl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\(\s*(?:(['"`])([^'"`]+)\2)?\s*\)/g;
  let m;
  while ((m = translatorDecl.exec(text)) !== null) {
    translatorVars.set(m[1], m[3] || '');
  }

  if (translatorVars.size === 0) {
    continue;
  }

  for (const [varName, namespace] of translatorVars.entries()) {
    const escapedVarName = escapeRegExp(varName);
    const startPattern = new RegExp(
      '\\b' + escapedVarName + '\\s*(?:\\.\\s*(?:rich|markup|raw|has)\\s*)?\\(\\s*([\"\\\'`])',
      'g'
    );
    let callMatch;

    while ((callMatch = startPattern.exec(text)) !== null) {
      const quote = callMatch[1];
      let i = startPattern.lastIndex;
      let key = '';
      let escaped = false;
      let closed = false;

      while (i < text.length) {
        const ch = text[i];
        if (escaped) {
          key += ch;
          escaped = false;
          i += 1;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          i += 1;
          continue;
        }
        if (ch === quote) {
          closed = true;
          break;
        }
        key += ch;
        i += 1;
      }

      if (!closed) {
        continue;
      }

      // Skip dynamic template literals like t(`${foo}.bar`).
      if (quote === '`' && key.includes('${')) {
        continue;
      }

      const fullKey = namespace ? `${namespace}.${key}` : key;
      if (!validKeys.has(fullKey)) {
        const line = text.slice(0, callMatch.index).split('\n').length;
        issues.push({ file, line, fullKey });
      }

      startPattern.lastIndex = i + 1;
    }
  }
}

if (issues.length === 0) {
  console.log('OK: no invalid literal translation keys found.');
  process.exit(0);
}

console.error(`Found ${issues.length} invalid literal translation key usages:`);
for (const issue of issues) {
  console.error(`${path.relative(frontendRoot, issue.file)}:${issue.line} -> ${issue.fullKey}`);
}
process.exit(1);
