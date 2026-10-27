import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const scripts = new URL('../scripts/', import.meta.url);

function run(name: string, timeout: number, optimized = false) {
  const real = name === 'test-postgres-backup-real.py';
  const command = real ? 'uv' : 'python3';
  const args = [
    ...(real ? ['run', '--with', 'psycopg2-binary', 'python'] : []),
    ...(optimized ? ['-O'] : []),
    new URL(name, scripts).pathname
  ];
  const result = spawnSync(command, args, {
    cwd: new URL('../../../', import.meta.url),
    encoding: 'utf8',
    timeout,
    env: process.env
  });
  assert.equal(result.status, 0, `${name}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}

test('PostgreSQL backup policy and scheduling contracts', () => run('test-postgres-backup.py', 120_000));
test('recovery manifest validation survives Python optimization', () => run('test-postgres-backup.py', 120_000, true));

if (process.env.STACKARR_TEST_POSTGRES_REAL === 'true') {
  test('isolated PostgreSQL/Timescale archive and failure safety', { timeout: 300_000 }, () =>
    run('test-postgres-backup-real.py', 300_000)
  );
}
