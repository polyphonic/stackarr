#!/usr/bin/env node
const fs = require('node:fs');
const { readSetting, writeRawSetting } = require('./stackarr-db.cjs');

const key = process.argv[2];
const input = process.argv[3];

if (!key || !input) {
  process.stderr.write('Usage: json-setting-patch.cjs <setting-key> <json-or-json-file>\n');
  process.exit(2);
}

function readJsonInput(value) {
  if (fs.existsSync(value)) {
    return JSON.parse(fs.readFileSync(value, 'utf8'));
  }

  return JSON.parse(value);
}

function mergeJson(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }

  const next = { ...base };

  for (const [patchKey, patchValue] of Object.entries(patch)) {
    next[patchKey] = isPlainObject(patchValue) ? mergeJson(next[patchKey], patchValue) : patchValue;
  }

  return next;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

let current = {};
const raw = readSetting(key);
if (raw) {
  try {
    current = JSON.parse(raw);
  } catch {
    current = {};
  }
}

const patch = readJsonInput(input);
writeRawSetting(key, JSON.stringify(mergeJson(current, patch)));
