import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { StackarrEnv } from '../../core/src/env';
import { readHostCapacity } from '../../core/src/hostCapacity';
import { configuredDiskUsages, diskUsageKey } from '../../core/src/metrics';
import type { StorageAssociation } from '../../core/src/serviceStorage';

const require = createRequire(import.meta.url);
const policy = require('../../../stackarr/scripts/storage-policy.cjs');
for (const mode of ['portable', 'native macOS'] as const) {
  // Native mode uses real diskutil identity and df. Portable mode substitutes
  // only kernel UUID discovery, retaining real df, paths and host validation.
  test(`state and observed library share one capacity via ${mode} host bridge`, {
    skip: mode === 'native macOS' && process.platform !== 'darwin'
  }, async (t) => {
    const state = realpathSync(mkdtempSync(path.join(tmpdir(), 'stackarr-state-identity-')));
    const library = path.join(state, 'library');
    const plainChild = path.join(state, 'plain-child');
    for (const folder of [library, plainChild, path.join(state, 'storage-bridge')]) mkdirSync(folder);
    const mountPoint = execFileSync('df', ['-kP', state], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .at(-1)!
      .match(/\d+%\s+(.+)$/)![1];
    const probe = () => ({ mountPoint, uuid: 'fixture-volume', filesystem: 'apfs', readOnly: false });
    const file = path.join(state, 'storage-policy.json');
    let child: ReturnType<typeof spawn> | undefined;
    const oldRuntime = process.env.STACKARR_RUNTIME;
    const oldPolicy = process.env.STACKARR_STORAGE_POLICY;
    try {
      const record = policy.captureRoot(library, mode === 'portable' ? { probe } : { allowReadOnly: true });
      writeFileSync(file, JSON.stringify({ version: 1, roots: [], observations: [record] }));
      const responder = spawn(
        process.execPath,
        [
          '-e',
          `
        const path = require('node:path');
        if (process.argv[4] === 'portable') {
          const p = require(path.join(path.dirname(process.argv[1]), 'storage-policy.cjs'));
          const capture = p.captureRoot, verify = p.verifyRoot;
          const probe = () => ({mountPoint:process.argv[3],uuid:'fixture-volume',filesystem:'apfs',readOnly:false});
          p.captureRoot = (target, options) => capture(target, {...options,probe});
          p.verifyRoot = (record, options) => verify(record, {...options,probe});
        }
        const c = require(process.argv[1]);
        setInterval(() => c.respond(process.argv[2]), 15); process.stdout.write('ready');
      `,
          path.resolve(import.meta.dirname, '../../../stackarr/scripts/storage-control.cjs'),
          file,
          mountPoint,
          mode
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
      child = responder;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('responder start timeout')), 2000);
        responder.stdout.once('data', () => {
          clearTimeout(timer);
          resolve();
        });
        responder.once('error', reject);
      });
      const [stateProof, libraryProof, plainProof] = [state, library, plainChild].map((target) =>
        readHostCapacity(target, file)
      );
      assert.ok([stateProof, libraryProof, plainProof].every((proof) => proof.status === 'available'));
      assert.equal(statSync(state).dev, statSync(library).dev);
      assert.equal(stateProof.usage!.volumeId, undefined);
      assert.equal(libraryProof.usage!.volumeId, record.uuid);
      assert.equal(plainProof.usage!.volumeId, undefined);
      assert.equal(stateProof.usage!.filesystem, libraryProof.usage!.filesystem);
      assert.equal(stateProof.usage!.mountPoint, libraryProof.usage!.mountPoint);
      assert.equal(stateProof.usage!.totalKilobytes, libraryProof.usage!.totalKilobytes);
      process.env.STACKARR_RUNTIME = 'docker';
      process.env.STACKARR_STORAGE_POLICY = file;
      const root = (target: string): StorageAssociation => ({
        path: target,
        service: target === library ? 'plex' : 'stackarr',
        source: target === library ? 'native-library' : 'configuration',
        reason: target === library ? 'Library location' : 'State Root'
      });
      const report = (paths: string[]) =>
        configuredDiskUsages({} as StackarrEnv, undefined, async () => ({ roots: paths.map(root), issues: [] }));
      assert.equal((await report([state, plainChild])).length, 1, 'UUID-less control shares one mount');
      let key: string | undefined;
      for (const paths of [
        [state, library],
        [library, state]
      ]) {
        await t.test(
          `mixed identity metadata in order ${paths[0] === state ? 'state first' : 'library first'}`,
          async () => {
            const disks = await report(paths);
            assert.equal(disks.length, 1, 'missing optional UUID must not double-count one proven mount');
            assert.equal(disks[0].totalSpace, stateProof.usage!.totalKilobytes * 1024);
            assert.equal(disks[0].volumeId, record.uuid, 'retain the compatible known identity');
            assert.deepEqual([...disks[0].paths].sort(), [...paths].sort());
            assert.deepEqual(
              disks[0].associations,
              paths.map((target) => ({
                ...root(target),
                displayName: target === library ? 'Plex' : 'Stackarr',
                status: 'available'
              }))
            );
            if (key) assert.equal(diskUsageKey(disks[0]), key);
            key = diskUsageKey(disks[0]);
          }
        );
      }
    } finally {
      if (oldRuntime === undefined) delete process.env.STACKARR_RUNTIME;
      else process.env.STACKARR_RUNTIME = oldRuntime;
      if (oldPolicy === undefined) delete process.env.STACKARR_STORAGE_POLICY;
      else process.env.STACKARR_STORAGE_POLICY = oldPolicy;
      if (child) {
        child.kill();
        await new Promise<void>((resolve) =>
          child!.exitCode !== null ? resolve() : child!.once('exit', () => resolve())
        );
      }
      rmSync(state, { recursive: true, force: true });
    }
  });
}
