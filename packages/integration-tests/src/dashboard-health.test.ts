import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('dashboard app health route stays protected and renders grouped issues after paint', async () => {
  const route = await readFile(path.join(repoRoot, 'apps/frontend/src/app/api/v1/services/health/route.ts'), 'utf8');
  const summary = await readFile(path.join(repoRoot, 'apps/frontend/src/components/AppHealthSummary.tsx'), 'utf8');
  const dashboard = await readFile(path.join(repoRoot, 'apps/frontend/src/components/DashboardClient.tsx'), 'utf8');

  assert.match(route, /requireApiKey/);
  assert.match(route, /getAppHealthSummaryAction/);
  assert.match(summary, /stackarrFetch\('\/api\/v1\/services\/health'/);
  assert.match(summary, /ServiceLogo/);
  assert.match(summary, /check\.issues/);
  assert.match(dashboard, /<AppHealthSummary/);
});
