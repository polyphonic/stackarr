import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const common = readFileSync(new URL('../../../stackarr/lib/common.sh', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');

test('maintenance worker mounts downloads for credential reconciliation', () => {
  const worker = compose.slice(compose.indexOf('  app-updater:'), compose.indexOf('  database:'));
  assert.ok(worker.includes('"${DOWNLOADS_ROOT:-./.stackarr/downloads}:${DOWNLOADS_ROOT:-/stackarr-downloads}"'));
});

const predicate = common.slice(
  common.indexOf('stackarr_runtime_is_container() {'),
  common.indexOf('service_default_port() {')
);

for (const runtime of ['docker', 'docker-updater', 'native']) {
  test(`container address resolution recognizes runtime ${runtime}`, () => {
    // Substitute only the filesystem marker with /dev/null, which exists on CI hosts.
    // The production runtime-discrimination predicate executes unchanged in Bash.
    const result = spawnSync(
      'bash',
      [
        '-c',
        `${predicate.replace('"/.dockerenv"', '"/dev/null"').replace('-f ', '-e ')}\nstackarr_runtime_is_container`
      ],
      {
        env: { ...process.env, STACKARR_RUNTIME: runtime },
        encoding: 'utf8'
      }
    );
    assert.equal(result.status, runtime === 'native' ? 1 : 0, result.stderr);
  });
}
