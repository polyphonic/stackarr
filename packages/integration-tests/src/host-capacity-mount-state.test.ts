import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readHostCapacity } from '../../core/src/hostCapacity';

const script = path.resolve('stackarr/scripts/storage-control.cjs');

test('host responder distinguishes absent portable mounts, parent fallback, missing leaves and replaced identities', async () => {
  const state = realpathSync(mkdtempSync(path.join(tmpdir(), 'stackarr-mount-state-')));
  const file = path.join(state, 'storage-policy.json');
  mkdirSync(path.join(state, 'storage-bridge'));
  const cases = [
    { mountPoint: `/mnt/stackarr-absent-${path.basename(state)}`, status: 'unmounted' },
    { mountPoint: `/media/stackarr-absent-${path.basename(state)}`, status: 'unmounted' },
    { mountPoint: `/Volumes/stackarr-absent-${path.basename(state)}`, status: 'unmounted' },
    { mountPoint: path.join(state, 'absent-custom-mount'), status: 'unmounted' },
    { mountPoint: path.join(state, 'parent-fallback'), status: 'unmounted', exists: true },
    { mountPoint: path.join(state, 'parent-fallback-existing-leaf'), status: 'unmounted', exists: true, leaf: true },
    { mountPoint: path.join(state, 'fallback-unsupported'), status: 'unmounted', exists: true },
    { mountPoint: path.join(state, 'fallback-no-uuid'), status: 'unmounted', exists: true },
    { mountPoint: path.join(state, 'mounted-missing-leaf'), status: 'missing', exists: true },
    { mountPoint: path.join(state, 'replacement'), status: 'stale-identity', exists: true, leaf: true },
    { mountPoint: path.join(state, 'replacement-missing-leaf'), status: 'stale-identity', exists: true },
    { mountPoint: path.join(state, 'denied'), status: 'permission-denied', exists: true, leaf: true },
    { mountPoint: path.join(state, 'denied-missing-leaf'), status: 'permission-denied', exists: true },
    { mountPoint: path.join(state, 'probe-failed'), status: 'probe-unavailable', exists: true },
    { mountPoint: path.join(state, 'probe-enoent'), status: 'probe-unavailable', exists: true }
  ];
  for (const item of cases) {
    if (item.exists) mkdirSync(item.mountPoint);
    if (item.leaf) mkdirSync(path.join(item.mountPoint, 'library'));
  }
  const records = cases.map(({ mountPoint }) => ({
    path: path.join(mountPoint, 'library'),
    realPath: path.join(mountPoint, 'library'),
    mountPoint,
    uuid: 'enrolled-volume',
    filesystem: 'ext4'
  }));
  writeFileSync(file, JSON.stringify({ version: 1, roots: [], observations: records }));
  // Simulate only kernel volume identity, never the responder's classification.
  // Real path existence, policy validation, bridge proof and client are exercised.
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
      const path = require('node:path');
      const p = require(path.join(path.dirname(process.argv[1]), 'storage-policy.cjs'));
      const capture = p.captureRoot, verify = p.verifyRoot, inspect = p.inspectVolume;
      const probe = target => {
        const name = path.relative(process.argv[3], target).split(path.sep)[0];
        if (name.startsWith('denied')) throw Object.assign(new Error('denied'), {code:'EACCES'});
        if (name === 'probe-failed') throw new Error('OS mount probe failed');
        if (name === 'probe-enoent') throw Object.assign(new Error('probe binary missing'), {code:'ENOENT'});
        if (name === 'fallback-no-uuid') throw new Error('findmnt did not return a mounted volume UUID');
        if (name === 'fallback-unsupported') return {mountPoint: process.argv[3], uuid:'parent', filesystem:'tmpfs', readOnly:false};
        return {mountPoint: name.startsWith('parent-fallback') ? process.argv[3] : path.join(process.argv[3], name),
          uuid: name.startsWith('replacement') ? 'replacement-volume' : 'enrolled-volume',
          filesystem:'ext4', readOnly:false};
      };
      p.captureRoot = (target, options) => capture(target, {...options, probe});
      p.verifyRoot = (record, options) => verify(record, {...options, probe});
      p.inspectVolume = (target, options) => inspect(target, {...options, probe});
      const cp = require('node:child_process'), run = cp.execFileSync;
      cp.execFileSync = (command, args, options) => {
        if (path.basename(command) !== 'df' || !args[1]?.startsWith(process.argv[3])) return run(command, args, options);
        const name = path.relative(process.argv[3], args[1]).split(path.sep)[0];
        if (name.startsWith('denied')) throw Object.assign(new Error('denied'), {code:'EACCES'});
        if (name === 'probe-enoent') throw Object.assign(new Error('df binary missing'), {code:'ENOENT'});
        const mount = name.startsWith('parent-fallback') || name.startsWith('fallback-')
          ? process.argv[3] : path.join(process.argv[3], name);
        return 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/fixture 1000 500 500 50% ' + mount + '\\n';
      };
      const c = require(process.argv[1]);
      setInterval(() => c.respond(process.argv[2]), 15); process.stdout.write('ready');
      `,
      script,
      file,
      state
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('responder start timeout')), 2000);
      child.stdout.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      child.once('error', reject);
    });
    const results = records.map((record) => readHostCapacity(record.path, file));
    assert.deepEqual(
      results.map((result, index) => ({ mountPoint: cases[index].mountPoint, status: result.status })),
      cases.map(({ mountPoint, status }) => ({ mountPoint, status }))
    );
    assert.ok(
      results.every((result) => result.usage === null),
      'no failure may return parent or replacement capacity'
    );
  } finally {
    child.kill();
    await new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', () => resolve())));
    rmSync(state, { recursive: true, force: true });
  }
});
