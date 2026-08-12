import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function source(file: string) {
  return readFile(path.join(repoRoot, file), 'utf8');
}

test('managed app updates cannot pull or recreate the Stackarr controller', async () => {
  const update = await source('stackarr/scripts/update-run.sh');

  assert.match(update, /app\|app-updater\|database\|database-init\|image-cleanup/);
  assert.match(update, /pull --quiet "\$\{services\[@\]\}"/);
  assert.match(update, /up -d --no-deps --remove-orphans "\$\{services\[@\]\}"/);
  assert.match(update, /Managed services updated; the Stackarr controller was left running/);
  assert.doesNotMatch(update, /ensure_docker_runtime\nensure_database_if_required/);

  const compose = await source('stackarr/docker-compose.yml');
  assert.match(compose, /docker image prune -f --filter dangling=true >\/dev\/null/);
  assert.match(compose, /RECYCLARR_IMAGE:-ghcr\.io\/recyclarr\/recyclarr:8/);
  assert.doesNotMatch(compose, /RECYCLARR_IMAGE:-ghcr\.io\/recyclarr\/recyclarr:latest/);
});

test('local Stackarr images are preserved while published images use an independent worker', async () => {
  const update = await source('stackarr/scripts/update-run.sh');
  const compose = await source('stackarr/docker-compose.yml');
  const common = await source('stackarr/lib/common.sh');
  const runner = await source('apps/frontend/src/lib/runner.ts');

  assert.match(update, /"\$\{STACKARR_IMAGE:-\}" == \*:local/);
  assert.match(update, /STACKARR_UPDATE_HANDOFF_STARTED/);
  assert.match(update, /run --pull always --quiet-pull -d --rm/);
  assert.match(update, /case "\$action" in\n\s+run\|services\)\n\s+wait_for_stackarr_storage/);
  assert.match(update, /STACKARR_RUNTIME:-}" != "docker-updater"/);
  assert.match(update, /update_stackarr_app\(\)[\s\S]*?start_app_update_worker\n}/);
  assert.match(update, /pull --quiet app/);
  assert.match(update, /up -d --force-recreate --no-deps app/);
  assert.match(update, /reconcile_running_shared_database/);
  assert.doesNotMatch(update, /ensure_shared_database/);
  const reconciliation = common.match(/reconcile_running_shared_database\(\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(reconciliation);
  assert.match(reconciliation, /ps --services --status running/);
  assert.match(reconciliation, /run_shared_database_init/);
  assert.doesNotMatch(reconciliation, /\bup\b/);
  assert.match(compose, /\n  app-updater:\n[\s\S]*?command:\n\s+- update\n\s+- app-worker/);
  assert.match(runner, /command\.name === 'UpdateStackarr'/);
  assert.match(runner, /persistTaskUpdate\(id, patch\)/);
  assert.doesNotMatch(runner, /writeTasks\(next\)/);
});

test('dashboard exposes separate managed app and controller update commands', async () => {
  const commands = await source('packages/core/src/commands.ts');
  const page = await source('apps/frontend/src/app/system/[section]/page.tsx');
  const scheduler = await source('stackarr/scripts/scheduler.sh');

  assert.match(commands, /label: 'Update apps',[\s\S]*?args: \['update', 'services'\]/);
  assert.match(commands, /label: 'Update Stackarr',[\s\S]*?args: \['update', 'app'\]/);
  assert.match(page, /name="UpdateStackarr"/);
  assert.match(scheduler, /update services/);
});
