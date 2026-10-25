import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('storage policy honors explicit policy, state and app roots in priority order', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const [settings, expected] of [
    [{}, '/fixture/default/state/storage-policy.json'],
    [{ APP_ROOT: '/fixture/app' }, '/fixture/app/state/storage-policy.json'],
    [{ APP_ROOT: '/fixture/app', STATE_ROOT: '/fixture/state' }, '/fixture/state/storage-policy.json'],
    [{ STATE_ROOT: '/fixture/state', STACKARR_STORAGE_POLICY: '/fixture/policy.json' }, '/fixture/policy.json']
  ] as [Record<string, string>, string][]) {
    const output = execFileSync(
      'bash',
      [
        '-c',
        'default_app_root() { printf /fixture/default; }; source "$1"; stackarr_storage_policy_file',
        'fixture',
        path.join(root, 'stackarr/lib/storage-guard.sh')
      ],
      { env: { ...env, ...settings }, encoding: 'utf8' }
    );
    assert.equal(output.trim(), expected);
  }
});

test('custom-root storage CLI fails closed on that installations missing policy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-custom-root-'));
  try {
    const state = path.join(dir, 'custom-state');
    fs.mkdirSync(state);
    fs.writeFileSync(
      path.join(state, 'storage-enrollment.json'),
      JSON.stringify({ version: 1, phase: 'ready', project: 'fixture' })
    );
    const env = {
      PATH: process.env.PATH,
      HOME: dir,
      APP_ROOT_DEFAULT_OVERRIDE: path.join(dir, 'default'),
      APP_ROOT: path.join(dir, 'custom-app'),
      STATE_ROOT: state
    };
    const result = spawnSync('bash', [path.join(root, 'stackarr/scripts/storage.sh'), 'status'], {
      env,
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /failed closed/);
    assert.ok(!result.stdout.includes('not enabled'));
    fs.rmSync(path.join(state, 'storage-enrollment.json'));
    fs.symlinkSync(path.join(state, 'missing-journal'), path.join(state, 'storage-migration.json'));
    const dangling = spawnSync('bash', [path.join(root, 'stackarr/scripts/storage.sh'), 'status'], {
      env,
      encoding: 'utf8'
    });
    assert.notEqual(dangling.status, 0, 'a dangling migration journal is not an unenrolled installation');
    assert.ok(!dangling.stdout.includes('not enabled'));
    const guard = spawnSync(
      'bash',
      ['-c', 'source "$1"; stackarr_storage_guard', 'fixture', path.join(root, 'stackarr/lib/common.sh')],
      { env, encoding: 'utf8' }
    );
    assert.notEqual(guard.status, 0);
    assert.match(guard.stderr, /refusing an unguarded operation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
