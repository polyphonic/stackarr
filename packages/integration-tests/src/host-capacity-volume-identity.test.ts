import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { StackarrEnv } from '../../core/src/env';
import { readHostCapacity } from '../../core/src/hostCapacity';
import { configuredDiskUsages } from '../../core/src/metrics';
import type { StorageAssociation } from '../../core/src/serviceStorage';

// Only the kernel identity and df boundary is simulated. Real paths, symlinks,
// policy validation, the nonce-bound responder/client and configured report run.
test('configured report separates cloned UUID devices while deduping same-device paths and symlinks', async (t) => {
  const state = realpathSync(mkdtempSync(path.join(tmpdir(), 'stackarr-volume-identity-')));
  const file = path.join(state, 'storage-policy.json');
  const a = path.join(state, 'mount-a');
  const b = path.join(state, 'mount-b');
  const c = path.join(state, 'mount-c');
  for (const folder of [
    a,
    b,
    c,
    path.join(c, 'library'),
    path.join(a, 'library'),
    path.join(a, 'backup'),
    path.join(b, 'library'),
    path.join(state, 'storage-bridge')
  ]) {
    mkdirSync(folder);
  }
  const alias = path.join(state, 'library-alias');
  symlinkSync(path.join(a, 'library'), alias);
  const records = [
    { path: path.join(a, 'library'), mountPoint: a },
    { path: path.join(a, 'backup'), mountPoint: a },
    { path: path.join(b, 'library'), mountPoint: b },
    { path: alias, mountPoint: a },
    { path: path.join(c, 'library'), mountPoint: c }
  ].map((record) => ({
    ...record,
    realPath: realpathSync(record.path),
    uuid: 'cloned-filesystem-uuid',
    filesystem: 'ext4'
  }));
  writeFileSync(file, JSON.stringify({ version: 1, roots: [], observations: records }));
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const path = require('node:path');
    const p = require(path.join(path.dirname(process.argv[1]), 'storage-policy.cjs'));
    const capture = p.captureRoot, verify = p.verifyRoot, inspect = p.inspectVolume;
    const mountFor = target => [process.argv[3], process.argv[4], process.argv[5]].find(mount => target.startsWith(mount));
    const probe = target => ({mountPoint: mountFor(target), uuid:'cloned-filesystem-uuid',filesystem:'ext4',readOnly:false});
    p.captureRoot = (target, options) => capture(target, {...options,probe});
    p.verifyRoot = (record, options) => verify(record, {...options,probe});
    p.inspectVolume = (target, options) => inspect(target, {...options,probe});
    const cp = require('node:child_process'), run = cp.execFileSync;
    cp.execFileSync = (command,args,options) => {
      if(path.basename(command)!=='df') return run(command,args,options);
      const first = args[1].startsWith(process.argv[3]);
      const mount = mountFor(args[1]);
      const device = mount === process.argv[4] ? '/dev/fixture-b' : '/dev/fixture-a';
      return 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n' + device + (first ? ' 1000 500 500' : ' 2000 1000 1000') + ' 50% ' + mount + '\\n';
    };
    const c=require(process.argv[1]);
    setInterval(()=>c.respond(process.argv[2]),15);process.stdout.write('ready');
  `,
      path.resolve('stackarr/scripts/storage-control.cjs'),
      file,
      a,
      b,
      c
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const oldRuntime = process.env.STACKARR_RUNTIME;
  const oldPolicy = process.env.STACKARR_STORAGE_POLICY;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('responder start timeout')), 2000);
      child.stdout.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      child.once('error', reject);
    });
    const proofs = records.map((record) => readHostCapacity(record.path, file));
    assert.ok(proofs.every((proof) => proof.status === 'available'));
    assert.equal(proofs[0].usage!.filesystem, '/dev/fixture-a');
    assert.equal(proofs[2].usage!.filesystem, '/dev/fixture-b');
    assert.equal(proofs[4].usage!.filesystem, '/dev/fixture-a');
    process.env.STACKARR_RUNTIME = 'docker';
    process.env.STACKARR_STORAGE_POLICY = file;
    const root = (index: number): StorageAssociation => ({
      path: records[index].path,
      service: index === 1 ? 'backup' : 'plex',
      source: index === 1 ? 'configuration' : 'native-library',
      reason: 'Fixture location'
    });
    const report = (indices: number[]) =>
      configuredDiskUsages({} as StackarrEnv, undefined, async () => ({ roots: indices.map(root), issues: [] }));
    for (const indices of [
      [0, 2],
      [2, 0]
    ]) {
      await t.test(`distinct devices with equal UUIDs retain both capacities in order ${indices}`, async () => {
        const disks = await report(indices);
        assert.equal(disks.length, 2);
        assert.deepEqual(
          disks.map((disk) => disk.totalSpace).sort((x, y) => x! - y!),
          [1024000, 2048000]
        );
        assert.equal(
          disks.reduce((sum, disk) => sum + disk.totalSpace!, 0),
          3072000
        );
        assert.deepEqual(disks.map((disk) => disk.filesystem).sort(), ['/dev/fixture-a', '/dev/fixture-b']);
        assert.ok(
          disks.every((disk) => disk.associations?.length === 1 && disk.associations[0].status === 'available')
        );
      });
    }
    for (const indices of [
      [0, 4],
      [4, 0]
    ]) {
      await t.test(
        `ambiguous device labels across different proven mounts stay separate in order ${indices}`,
        async () => {
          const disks = await report(indices);
          assert.equal(disks.length, 2);
          assert.equal(
            disks.reduce((sum, disk) => sum + disk.totalSpace!, 0),
            3072000
          );
        }
      );
    }
    for (const indices of [
      [0, 1, 3],
      [3, 1, 0]
    ]) {
      await t.test(`same-device paths and a symlink count capacity once in order ${indices}`, async () => {
        const disks = await report(indices);
        assert.equal(disks.length, 1);
        assert.equal(disks[0].totalSpace, 1024000);
        assert.equal(disks[0].associations?.length, 3);
        assert.deepEqual([...disks[0].paths].sort(), indices.map((index) => records[index].path).sort());
      });
    }
  } finally {
    if (oldRuntime === undefined) delete process.env.STACKARR_RUNTIME;
    else process.env.STACKARR_RUNTIME = oldRuntime;
    if (oldPolicy === undefined) delete process.env.STACKARR_STORAGE_POLICY;
    else process.env.STACKARR_STORAGE_POLICY = oldPolicy;
    child.kill();
    await new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', () => resolve())));
    rmSync(state, { recursive: true, force: true });
  }
});
