import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { diskUsages } from '../../core/src/metrics';

// Disk reporting no longer creates helper containers at all. Keep a command trap
// at that boundary so failures cannot quietly reintroduce run/rm fallback.
function probe(runtime: string, enrolled: boolean, guestType = 'overlay') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-metrics-probe-'));
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const originalVariables = Object.fromEntries(
    ['PATH', 'STACKARR_STORAGE_POLICY', 'STACKARR_RUNTIME'].map((key) => [key, process.env[key]])
  );
  const callsFile = path.join(dir, 'docker-calls');
  const state = path.join(dir, 'state');
  fs.mkdirSync(state);
  fs.writeFileSync(
    path.join(dir, 'docker'),
    `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(process.argv.slice(2))+'\\n'); process.exit(41);\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(dir, 'df'),
    `#!/bin/sh\nprintf 'Filesystem Type 1024-blocks Used Available Capacity Mounted on\\n${guestType} ${guestType} 1000 200 800 20%% /\\n'\n`,
    { mode: 0o755 }
  );
  const policyFile = path.join(state, 'storage-policy.json');
  fs.writeFileSync(policyFile, JSON.stringify({ version: 1, roots: [] }));
  process.env.PATH = `${dir}:${originalVariables.PATH}`;
  process.env.STACKARR_RUNTIME = runtime;
  process.env.STACKARR_STORAGE_POLICY = enrolled ? policyFile : '';
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'linux' });
  try {
    const disks = diskUsages([enrolled ? state : dir]);
    assert.equal(fs.existsSync(callsFile), false, 'disk metrics must never create, inspect or remove Docker probes');
    return disks;
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    for (const [key, value] of Object.entries(originalVariables)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('unenrolled containers report no guest capacity and never start or remove Docker probes', () => {
  for (const runtime of ['docker', 'docker-updater']) {
    const disks = probe(runtime, false);
    assert.equal(disks[0].totalSpace, null);
    assert.equal(disks[0].status, 'probe-unavailable');
  }
});

test('unavailable enrolled host bridge does not fall back to Docker or overlay', () => {
  const disks = probe('docker', true);
  assert.equal(disks[0].totalSpace, null);
  assert.equal(disks[0].status, 'probe-unavailable');
});

test('native metrics also reject overlay and virtiofs rather than invoking Docker', () => {
  for (const filesystem of ['overlay', 'virtiofs']) {
    const disks = probe('native', false, filesystem);
    assert.equal(disks[0].totalSpace, null);
  }
});
