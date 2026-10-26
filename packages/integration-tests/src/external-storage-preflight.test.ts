import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createEngine } = require('../../../stackarr/scripts/storage-migrate.cjs');
const move = require('../../../stackarr/scripts/storage-move.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-preflight-'));
  const source = path.join(root, 'config');
  fs.mkdirSync(source);
  const policy = path.join(root, 'storage-policy.json');
  fs.mkdirSync(path.join(root, 'compose'));
  fs.writeFileSync(path.join(root, 'compose/.env'), `APP_ROOT=${root}\nSTATE_ROOT=${root}\nCONFIG_ROOT=${source}\n`);
  fs.writeFileSync(policy, '{}');
  const dir = move.directory(policy);
  fs.mkdirSync(dir);
  const request = {
    version: 1,
    id: '123e4567-e89b-42d3-a456-426614174000',
    destination: path.join(root, 'destination'),
    requestedAt: new Date().toISOString()
  };
  return { root, source, policy, dir, request };
}

test('online preflight permits managed containers but rejects even stopped unmanaged bind consumers', () => {
  const { root, source, request } = fixture();
  try {
    const container = {
      Config: { Labels: { 'com.docker.compose.project': 'custom-project' } },
      State: { Running: true },
      HostConfig: { RestartPolicy: { Name: 'no' } },
      Mounts: [{ Type: 'bind', Source: source, RW: false }]
    };
    const engine = createEngine({ docker: () => [container] });
    assert.doesNotThrow(() => engine.preflight(source, request.destination, 'custom-project'));
    container.State.Running = false;
    assert.throws(() => engine.preflight(source, request.destination, 'another-project'), /Remove existing container/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unmanaged-consumer preflight failure does not stop services', () => {
  const { root, source, policy, dir, request } = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'active.json'), JSON.stringify(request));
    let commands = 0;
    const result = move.work(policy, {
      guard: () => {},
      run: (_file: string, args: string[], env: Record<string, string>) => {
        commands++;
        assert.ok(args[1].includes('load_env'));
        return JSON.stringify({
          ...env,
          APP_ROOT: root,
          CONFIG_ROOT: source,
          STATE_ROOT: root,
          STACKARR_STORAGE_POLICY: policy
        });
      },
      engine: {
        plan: () => {},
        preflight: () => {
          throw new Error('Unmanaged bind consumer');
        },
        run: () => assert.fail('copy started')
      },
      writers: () => assert.fail('passed failed preflight')
    });
    assert.equal(result, false);
    assert.equal(commands, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an overlapping monitor cannot replace the owning consumer status', () => {
  const { root, policy, dir, request } = fixture();
  try {
    fs.writeFileSync(path.join(root, 'storage-enrollment.json'), '{}');
    fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
    const result = move.consume(policy, {
      guard: () => {
        assert.equal(
          move.consume(policy, {
            guard: () => assert.fail('second consumer entered'),
            spawn: () => assert.fail('second worker spawned')
          }),
          false
        );
      },
      spawn: () => ({ on() {}, unref() {} })
    });
    assert.equal(result, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8')).phase, 'queued');
    assert.equal(fs.existsSync(path.join(dir, 'consume.lock')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
