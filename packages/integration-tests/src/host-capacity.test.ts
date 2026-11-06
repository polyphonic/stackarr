import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readHostCapacity } from '../../core/src/hostCapacity';

const require = createRequire(import.meta.url);
const control = require('../../../stackarr/scripts/storage-control.cjs');
const script = path.resolve('stackarr/scripts/storage-control.cjs');

test('host bridge returns nonce-bound capacity for state and denies unregistered roots', async () => {
  const state = mkdtempSync(path.join(tmpdir(), 'stackarr-capacity-fixture-'));
  const file = path.join(state, 'storage-policy.json');
  writeFileSync(file, JSON.stringify({ version: 1, project: 'fixture', roots: [] }));
  mkdirSync(path.join(state, 'storage-bridge'));
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const control = require(process.argv[1]); const file = process.argv[2];
    setInterval(() => control.respond(file, () => {}), 15); process.stdout.write('ready\\n');`,
      script,
      file
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('responder start timeout')), 1000);
      child.stdout.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
      child.once('error', reject);
    });
    const result = readHostCapacity(state, file);
    assert.equal(result.status, 'available');
    assert.ok(result.usage?.totalKilobytes && result.usage.totalKilobytes > 0);
    assert.ok(result.usage?.mountPoint?.startsWith('/'));
    const existing = path.join(state, 'existing-child');
    mkdirSync(existing);
    assert.equal(readHostCapacity(existing, file).status, 'available');
    assert.equal(readHostCapacity(path.join(state, 'absent-child'), file).status, 'missing');
    assert.deepEqual(readHostCapacity('/Volumes/Unrelated-SD/media', file), { status: 'not-enrolled', usage: null });
  } finally {
    child.kill();
    rmSync(state, { recursive: true, force: true });
  }
});

test('reporting failure labels do not conflate permissions, unmounts, missing or changed identity', () => {
  const missing = '/Volumes/NotMountedStackarrFixture';
  assert.equal(control.capacityFailure({ code: 'EACCES', message: 'denied' }), 'permission-denied');
  assert.equal(control.capacityFailure({ code: 'ENOENT', message: 'gone' }, { mountPoint: missing }), 'unmounted');
  assert.equal(control.capacityFailure({ code: 'ENOENT', message: 'gone' }), 'missing');
  assert.equal(control.capacityFailure({ message: 'storage root volume identity changed' }), 'stale-identity');
  assert.equal(control.capacityFailure({ message: 'Unenrolled capacity path' }), 'not-enrolled');
});
