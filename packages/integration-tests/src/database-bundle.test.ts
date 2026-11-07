import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/test-database-bundle.py', import.meta.url));

for (const optimized of [false, true]) {
  test(`database-only bundle safety${optimized ? ' with Python optimization' : ''}`, { timeout: 120_000 }, () => {
    const result = spawnSync('python3', [...(optimized ? ['-O'] : []), script], {
      cwd: new URL('../../../', import.meta.url),
      encoding: 'utf8',
      timeout: 110_000,
      env: process.env
    });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  });
}
