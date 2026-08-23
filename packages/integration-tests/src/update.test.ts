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
  assert.match(compose, /docker image prune -a -f >\/dev\/null/);
  assert.match(compose, /RECYCLARR_IMAGE:-ghcr\.io\/recyclarr\/recyclarr:8/);
  assert.doesNotMatch(compose, /RECYCLARR_IMAGE:-ghcr\.io\/recyclarr\/recyclarr:latest/);
});

test('managed app updates prune dangling and unused images after old containers are removed', async () => {
  const update = await source('stackarr/scripts/update-run.sh');
  const compose = await source('stackarr/docker-compose.yml');

  const recreation = update.indexOf('up -d --no-deps --remove-orphans');
  const cleanup = update.indexOf('run --rm image-cleanup');
  const reconciliation = update.indexOf('"$ROOT_DIR/scripts/naming.sh" apply');

  assert.ok(recreation >= 0, 'managed services should be recreated with old containers removed');
  assert.ok(cleanup > recreation, 'image cleanup should run only after service recreation');
  assert.ok(cleanup < reconciliation, 'image cleanup should run before post-update reconciliation');
  assert.match(compose, /docker image prune -a -f >\/dev\/null/);
});

test('image-declared service volumes have stable Compose names', async () => {
  const compose = await source('stackarr/docker-compose.yml');

  assert.match(compose, /\n  flaresolverr:\n[\s\S]*?\n    volumes:\n      - flaresolverr-config:\/config\n/);
  assert.match(compose, /\n  romm:\n[\s\S]*?\n    volumes:\n[\s\S]*?      - romm-root:\/romm\n/);
  assert.match(compose, /flaresolverr-config:\n\s+name: \$\{COMPOSE_PROJECT_NAME:-stackarr\}_flaresolverr-config/);
  assert.match(compose, /romm-root:\n\s+name: \$\{COMPOSE_PROJECT_NAME:-stackarr\}_romm-root/);

  const common = await source('stackarr/lib/common.sh');
  assert.match(common, /migrate_legacy_image_volumes\(\)/);
  assert.match(common, /Original volume \$source_volume was retained for review/);
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
  assert.match(runner, /commandStartedTaskHandoff\(command\.name, exitCode, output\)/);
  assert.match(runner, /createBufferedTaskUpdater<StackarrTask>\(persistTaskUpdate/);
  assert.match(runner, /bufferedTaskUpdater\.update\(id, patch\)/);
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
