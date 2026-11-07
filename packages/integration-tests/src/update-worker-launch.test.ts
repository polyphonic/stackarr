import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('controller updater launch preserves Compose compatibility and failed-pull safety', () => {
  const script = fileURLToPath(new URL('../scripts/test-update-worker-launch.py', import.meta.url));
  const result = spawnSync('python3', [script], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
