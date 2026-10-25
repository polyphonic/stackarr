import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { diskUsages } from '../../core/src/metrics';

// A fake CLI exercises the actual synchronous Docker command boundary without touching Docker.
const dockerFixture = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PROBE_CALLS, JSON.stringify(args) + '\\n');
const name = process.env.PROBE_NAME || '';
if (args[0] === 'compose') { console.log('controller-id'); process.exit(0); }
if (args[0] === 'inspect' && args[3] === 'controller-id') {
  console.log(JSON.stringify({Image:'sha256:abc',Mounts:[{Type:'bind',Source:'/host/config',Destination:'/stackarr-config'}]}));
  process.exit(0);
}
if (args[0] === 'run') {
  fs.writeFileSync(process.env.PROBE_NAME_FILE, args[args.indexOf('--name') + 1]);
  if (process.env.PROBE_MODE === 'failure') process.exit(1);
  if (process.env.PROBE_MODE === 'timeout') { setTimeout(() => {}, 15000); return; }
  console.log('Filesystem Type 1024-blocks Used Available Capacity Mounted on\\n/dev/disk apfs 1000 200 800 20% /stackarr-storage-probe');
  process.exit(0);
}
if (args[0] === 'inspect') {
  const probe = fs.readFileSync(process.env.PROBE_NAME_FILE, 'utf8');
  const label = probe.replace('stackarr-storage-probe-', '');
  console.log(JSON.stringify({Id:'a'.repeat(64),Name:'/' + probe,Config:{Labels:{'io.stackarr.storage-probe':process.env.PROBE_MODE === 'foreign' ? 'foreign' : label}}}));
  process.exit(0);
}
if (args[0] === 'rm') process.exit(0);
process.exit(1);
`;

function probe(mode: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-metrics-probe-'));
  const originalPath = process.env.PATH;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const originalVariables = Object.fromEntries(
    ['PROBE_CALLS', 'PROBE_NAME_FILE', 'PROBE_MODE', 'STACKARR_STORAGE_POLICY'].map((key) => [key, process.env[key]])
  );
  const callsFile = path.join(dir, 'calls');
  const nameFile = path.join(dir, 'name');
  fs.writeFileSync(path.join(dir, 'docker'), dockerFixture, { mode: 0o755 });
  fs.writeFileSync(
    path.join(dir, 'df'),
    '#!/bin/sh\necho "Filesystem Type 1024-blocks Used Available Capacity Mounted on"\necho "overlay overlay 1000 200 800 20% /"\n',
    { mode: 0o755 }
  );
  process.env.PATH = `${dir}:${originalPath}`;
  process.env.PROBE_CALLS = callsFile;
  process.env.PROBE_NAME_FILE = nameFile;
  process.env.PROBE_MODE = mode;
  process.env.STACKARR_STORAGE_POLICY = ''; // Explicitly exercise legacy, unenrolled probe path.
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
  try {
    const disks = diskUsages([`/stackarr-config/${path.basename(dir)}`]);
    const calls = fs
      .readFileSync(callsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    return { disks, calls, name: fs.readFileSync(nameFile, 'utf8') };
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    for (const [key, value] of Object.entries(originalVariables)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('storage probe removes only its labeled container on success and failure', () => {
  for (const mode of ['success', 'failure']) {
    const { disks, calls, name } = probe(mode);
    const run = calls.find((args) => args[0] === 'run')!;
    assert.equal(run[run.indexOf('--name') + 1], name);
    assert.match(name, /^stackarr-storage-probe-[0-9a-f-]{36}$/);
    assert.equal(
      run[run.indexOf('--label') + 1],
      `io.stackarr.storage-probe=${name.slice('stackarr-storage-probe-'.length)}`
    );
    assert.deepEqual(
      calls.filter((args) => args[0] === 'rm'),
      [['rm', '-f', 'a'.repeat(64)]]
    );
    assert.equal(disks[0].totalSpace, mode === 'success' ? 1024000 : null);
  }
});

test('storage probe timed out during create is removed and reports no overlay capacity', () => {
  const { disks, calls } = probe('timeout');
  assert.deepEqual(
    calls.filter((args) => args[0] === 'rm'),
    [['rm', '-f', 'a'.repeat(64)]]
  );
  assert.equal(disks[0].totalSpace, null);
});

test('storage probe never removes a container without its ownership label', () => {
  const { calls } = probe('foreign');
  assert.equal(
    calls.some((args) => args[0] === 'rm'),
    false
  );
});
