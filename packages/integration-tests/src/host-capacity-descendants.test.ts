import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { StackarrEnv } from '../../core/src/env';
import { readHostCapacity } from '../../core/src/hostCapacity';
import { configuredDiskUsages } from '../../core/src/metrics';
import { composeProjectName } from '../../core/src/paths';
import { discoverServiceStorage } from '../../core/src/serviceStorage';

const require = createRequire(import.meta.url);
const policy = require('../../../stackarr/scripts/storage-policy.cjs');
const script = path.resolve(import.meta.dirname, '../../../stackarr/scripts/storage-control.cjs');

test('real host bridge proves each enrolled descendant and rejects nested mount or symlink escapes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackarr-capacity-descendant-'));
  const state = path.join(dir, 'state');
  const root = path.join(dir, 'library');
  const outside = path.join(dir, 'outside');
  for (const folder of [
    state,
    root,
    outside,
    path.join(root, 'films'),
    path.join(root, 'nested-mount'),
    path.join(root, 'denied')
  ])
    mkdirSync(folder);
  mkdirSync(path.join(state, 'storage-bridge'));
  const link = path.join(root, 'alias');
  symlinkSync(path.join(root, 'films'), link);
  const mountPoint = execFileSync('df', ['-kP', dir], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .at(-1)!
    .match(/\d+%\s+(.+)$/)![1];
  const probe = () => ({ mountPoint, uuid: 'fixture-volume', filesystem: 'apfs', readOnly: false });
  const record = policy.captureRoot(root, { probe });
  const file = path.join(state, 'storage-policy.json');
  writeFileSync(file, JSON.stringify({ version: 1, roots: [], observations: [record] }));
  // Only kernel identity is simulated for portability and nested-mount injection.
  // Real files, symlinks, df, policy validation, responder and client are exercised.
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const path = require('node:path');
    const p = require(path.join(path.dirname(process.argv[1]), 'storage-policy.cjs'));
    const capture = p.captureRoot, verify = p.verifyRoot, inspect = p.inspectVolume;
    const probe = target => {
      if (target.endsWith('/denied')) throw Object.assign(new Error('denied'), {code:'EACCES'});
      return {mountPoint: target.endsWith('/nested-mount') ? target : process.argv[3],
        uuid: target.endsWith('/nested-mount') ? 'nested-volume' : 'fixture-volume', filesystem:'apfs',readOnly:false};
    };
    p.captureRoot = (target, options) => capture(target, {...options, probe});
    p.verifyRoot = (record, options) => verify(record, {...options, probe});
    p.inspectVolume = (target, options) => inspect(target, {...options, probe});
    const c = require(process.argv[1]);
    setInterval(() => c.respond(process.argv[2]), 15); process.stdout.write('ready');
  `,
      script,
      file,
      mountPoint
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
    const existing = readHostCapacity(path.join(root, 'films'), file);
    assert.equal(existing.status, 'available');
    assert.equal(existing.usage?.requestedPath, path.join(root, 'films'));
    assert.equal(existing.usage?.realPath, path.join(record.realPath, 'films'));
    assert.equal(readHostCapacity(path.join(root, 'absent'), file).status, 'missing');
    assert.equal(readHostCapacity(link, file).usage?.realPath, path.join(record.realPath, 'films'));
    unlinkSync(link);
    symlinkSync(outside, link);
    assert.equal(readHostCapacity(link, file).status, 'stale-identity');
    assert.equal(readHostCapacity(path.join(root, 'nested-mount'), file).status, 'stale-identity');
    assert.equal(readHostCapacity(path.join(root, 'denied'), file).status, 'permission-denied');
    const oldRuntime = process.env.STACKARR_RUNTIME;
    const oldPolicy = process.env.STACKARR_STORAGE_POLICY;
    process.env.STACKARR_RUNTIME = 'docker';
    process.env.STACKARR_STORAGE_POLICY = file;
    try {
      const env = {
        CONFIG_ROOT: '/stackarr-config',
        STATE_ROOT: '/stackarr-state',
        TDARR_MEDIA_ROOT: path.join(root, 'films')
      } as StackarrEnv;
      const disks = await configuredDiskUsages(env, undefined, (value) =>
        discoverServiceStorage(value, {
          services: () =>
            [
              { name: 'stackarr', mode: 'docker', dockerService: 'app' },
              { name: 'tdarr', mode: 'docker', dockerService: 'tdarr' }
            ] as ReturnType<typeof import('../../core/src/services').getServices>,
          libraries: async () => [],
          containers: async () => [
            {
              Config: {
                Labels: { 'com.docker.compose.project': composeProjectName, 'com.docker.compose.service': 'app' }
              },
              Mounts: [
                { Type: 'bind', Source: root, Destination: '/stackarr-config' },
                { Type: 'volume', Source: '/daemon/state', Destination: '/stackarr-state' },
                { Type: 'bind', Source: '/Volumes/Unrelated-SD', Destination: '/unrelated' },
                { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock' }
              ]
            }
          ]
        })
      );
      assert.equal(disks.length, 1);
      assert.equal(disks[0].status, 'available');
      assert.equal(disks[0].volumeId, 'fixture-volume');
      assert.deepEqual(disks[0].paths.sort(), [root, path.join(root, 'films')].sort());
      assert.ok(
        disks[0].associations?.some((a) => a.path === root && a.service === 'stackarr' && a.reason === 'CONFIG_ROOT')
      );
      assert.ok(disks[0].associations?.some((a) => a.service === 'tdarr' && a.status === 'available'));
    } finally {
      if (oldRuntime === undefined) delete process.env.STACKARR_RUNTIME;
      else process.env.STACKARR_RUNTIME = oldRuntime;
      if (oldPolicy === undefined) delete process.env.STACKARR_STORAGE_POLICY;
      else process.env.STACKARR_STORAGE_POLICY = oldPolicy;
    }
    // Explicitly observing the symlink pins it. Retargeting is not fresh proof.
    writeFileSync(
      file,
      JSON.stringify({ version: 1, roots: [], observations: [record, policy.captureRoot(link, { probe })] })
    );
    assert.equal(readHostCapacity(link, file).status, 'available');
    unlinkSync(link);
    symlinkSync(path.join(root, 'films'), link);
    assert.equal(readHostCapacity(link, file).status, 'stale-identity');
  } finally {
    child.kill();
    await new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', () => resolve())));
    rmSync(dir, { recursive: true, force: true });
  }
});
