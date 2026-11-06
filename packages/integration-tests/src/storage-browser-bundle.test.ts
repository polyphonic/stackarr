import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('storage overview bundles for browsers without importing the server core barrel', () => {
  const bundle = execFileSync(
    path.join(root, 'packages/mcp/node_modules/.bin/esbuild'),
    [
      path.join(root, 'apps/frontend/src/components/DashboardOverview.tsx'),
      '--bundle',
      '--platform=browser',
      '--format=esm',
      '--external:*.css',
      '--external:react',
      '--external:react/*',
      '--log-level=error'
    ],
    { encoding: 'utf8', timeout: 30_000 }
  );
  assert.match(bundle, /unverified:/);
  assert.doesNotMatch(bundle, /node:child_process|node:fs|STACKARR_DATABASE_FILE/);
});
