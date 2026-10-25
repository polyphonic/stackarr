import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const move = require('../../../stackarr/scripts/storage-move.cjs');
const id = '123e4567-e89b-42d3-a456-426614174000';
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'stackarr-move-'));
  const policy = path.join(root, 'storage-policy.json');
  writeFileSync(policy, '{}');
  const dir = move.directory(policy);
  mkdirSync(dir);
  const request = {
    version: 1,
    id,
    destination: path.join(root, 'destination'),
    requestedAt: new Date().toISOString()
  };
  return { root, policy, dir, request };
}
test('host consumes one fresh enrolled request and preserves safe status across monitor restart', () => {
  const { root, policy, dir, request } = fixture();
  const calls: unknown[][] = [];
  try {
    writeFileSync(path.join(root, 'storage-enrollment.json'), '{}');
    writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
    assert.equal(
      move.consume(policy, {
        guard: () => calls.push(['guard']),
        spawn: (...args: unknown[]) => {
          calls.push(args);
          return { on() {}, unref() {} };
        }
      }),
      true
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'active.json'), 'utf8')), request);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8'))).sort(), [
      'destination',
      'id',
      'phase',
      'updatedAt'
    ]);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')).phase, 'queued');
    writeFileSync(
      path.join(dir, 'request.json'),
      JSON.stringify({ ...request, id: '123e4567-e89b-42d3-a456-426614174001' })
    );
    assert.equal(
      move.consume(policy, { guard: () => assert.fail('replayed'), spawn: () => assert.fail('spawned') }),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('rejects malformed, stale, and unguarded requests without invoking worker', () => {
  const { root, policy, dir, request } = fixture();
  try {
    assert.throws(() => move.validRequest({ ...request, destination: 'relative' }), /Invalid/);
    assert.throws(() => move.validRequest({ ...request, requestedAt: new Date(0).toISOString() }), /Invalid/);
    assert.throws(() => move.validRequest({ ...request, extra: 'unexpected' }), /Invalid/);
    writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
    assert.equal(
      move.consume(policy, { guard: () => assert.fail('unguarded'), spawn: () => assert.fail('spawned') }),
      false
    );
    writeFileSync(path.join(root, 'storage-enrollment.json'), '{}');
    writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
    assert.equal(
      move.consume(policy, {
        guard: () => {
          throw Error('missing volume');
        },
        spawn: () => assert.fail('spawned')
      }),
      false
    );
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')).phase, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('worker plans while authoritative runtime exists and does not stop on unsafe preflight', () => {
  const { root, policy, dir, request } = fixture();
  try {
    writeFileSync(path.join(dir, 'active.json'), JSON.stringify(request));
    const calls: string[] = [];
    const result = move.work(policy, {
      guard: () => calls.push('guard'),
      run: (_file: string, _args: string[], env: Record<string, string>) => {
        calls.push('load');
        return JSON.stringify({
          ...env,
          CONFIG_ROOT: path.join(root, 'config'),
          STATE_ROOT: root,
          STACKARR_STORAGE_POLICY: policy
        });
      },
      engine: {
        plan: () => {
          calls.push('plan');
          throw Error('unsafe destination');
        },
        run: () => assert.fail('copy')
      },
      writers: () => assert.fail('writer check before plan')
    });
    assert.equal(result, false);
    assert.deepEqual(calls, ['guard', 'load', 'plan']);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')).phase, 'failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('worker runs scoped down, migration and generated guarded Compose restart in order', () => {
  const { root, policy, dir, request } = fixture();
  try {
    writeFileSync(path.join(dir, 'active.json'), JSON.stringify(request));
    const calls: string[] = [];
    const result = move.work(policy, {
      guard: () => calls.push('guard'),
      run: (_file: string, args: string[], env: Record<string, string>) => {
        if (args[0] === '-c' && args[1].includes('load_env')) {
          calls.push('load');
          return JSON.stringify({
            ...env,
            CONFIG_ROOT: path.join(root, 'config'),
            STATE_ROOT: root,
            STACKARR_STORAGE_POLICY: policy
          });
        }
        if (args.includes('down')) {
          assert.equal(args[2], policy);
          calls.push('down');
        } else if (args[1]?.includes('docker compose')) {
          assert.match(args[1], /storage-override\.json/);
          assert.doesNotMatch(args[1], /configure|stackarr_compose "\$\{args/);
          calls.push('start');
        } else assert.fail(`Unexpected command: ${args.join(' ')}`);
        return '';
      },
      engine: {
        plan: () => {
          calls.push('plan');
        },
        preflight: () => {
          calls.push('consumers');
        },
        run: () => {
          calls.push('migrate');
        }
      },
      writers: (_source: string, _run: unknown, phase: string) => {
        calls.push(`writers:${phase}`);
      }
    });
    assert.equal(result, true);
    assert.deepEqual(calls, [
      'guard',
      'load',
      'plan',
      'consumers',
      'writers:preflight',
      'down',
      'writers:stopped',
      'migrate',
      'start'
    ]);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')).phase, 'completed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
