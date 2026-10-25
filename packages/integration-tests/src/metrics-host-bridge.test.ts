import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { diskUsages } from '../../core/src/metrics';

const control = path.resolve(import.meta.dirname, '../../../stackarr/scripts/storage-control.cjs');

test('enrolled metrics use bounded host bridge, not a Docker probe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-bridge-metrics-'));
  const state = path.join(dir, 'state');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(state);
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(state, 'storage-bridge'));
  const policyFile = path.join(state, 'storage-policy.json');
  fs.writeFileSync(policyFile, JSON.stringify({ version: 1, roots: [] }));
  // Capture the real host filesystem before installing the guest-only df fake.
  // The responder child must retain the original host PATH on Linux too.
  const hostDf = execFileSync('df', ['-kP', state], { encoding: 'utf8' });
  const hostTotal = Number(hostDf.trim().split(/\r?\n/).at(-1)!.trim().split(/\s+/)[1]) * 1024;
  fs.writeFileSync(
    path.join(bin, 'df'),
    '#!/bin/sh\nprintf "Filesystem Type 1024-blocks Used Available Capacity Mounted on\\noverlay overlay 1000 200 800 20%% /\\n"\n',
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 41\n', { mode: 0o755 });
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const c=require(${JSON.stringify(control)});const f=${JSON.stringify(policyFile)};setInterval(()=>c.respond(f,()=>{}),20);console.log('ready')`
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } }
  );
  const oldPath = process.env.PATH;
  const oldPolicy = process.env.STACKARR_STORAGE_POLICY;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Host responder exited')));
    });
    process.env.PATH = `${bin}:${oldPath}`;
    process.env.STACKARR_STORAGE_POLICY = policyFile;
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    const disk = diskUsages([state])[0];
    assert.equal(disk.totalSpace, hostTotal);
    assert.ok(disk.freeSpace && disk.freeSpace > 0);
    assert.notEqual(disk.filesystem, 'overlay (overlay)');
  } finally {
    Object.defineProperty(process, 'platform', platform);
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldPolicy === undefined) delete process.env.STACKARR_STORAGE_POLICY;
    else process.env.STACKARR_STORAGE_POLICY = oldPolicy;
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
