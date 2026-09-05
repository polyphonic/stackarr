import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('managed app pulls use bounded concurrency and retry transient registry failures', async () => {
  const update = await readFile(path.join(repoRoot, 'stackarr/scripts/update-run.sh'), 'utf8');

  assert.match(update, /pull_managed_services\(\)/);
  assert.match(update, /STACKARR_UPDATE_PULL_PARALLELISM:-4/);
  assert.match(update, /STACKARR_UPDATE_PULL_ATTEMPTS:-4/);
  assert.match(update, /COMPOSE_PARALLEL_LIMIT="\$parallelism"/);
  assert.match(update, /retrying each service independently/);
  assert.match(update, /its running container will be left unchanged/);
  assert.match(update, /PULLED_MANAGED_SERVICES/);
  assert.doesNotMatch(update, /Could not pull all managed service images/);
  assert.match(update, /service_delay=\$\(\(service_delay \* 2\)\)/);
  assert.match(update, /pull_managed_services "\$\{services\[@\]\}"/);
});
