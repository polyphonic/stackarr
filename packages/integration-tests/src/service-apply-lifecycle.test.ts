import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

test('single-app apply reconciles a running database and only reports success after health passes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-service-apply-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'lib'));
    await writeFile(
      path.join(root, 'scripts/service-apply.sh'),
      await readFile(new URL('../../../stackarr/scripts/service-apply.sh', import.meta.url), 'utf8')
    );
    await writeFile(
      path.join(root, 'lib/common.sh'),
      `
print_header() { :; }
load_env() { :; }
write_compose_env_file() { :; }
ensure_docker_runtime() { :; }
database_required() { return 0; }
docker() { printf 'true\\n'; }
reconcile_running_shared_database() { echo reconciled-running-database; }
ensure_database_if_required() { echo unexpected-database-recreation; exit 9; }
compose_profile_args() { printf '%s\\n' --profile maintainerr; }
optional_service_enabled() { return 0; }
stackarr_compose() { echo "compose $*"; return "\${APPLY_EXIT:-0}"; }
ok() { echo "$*"; }
fail() { echo "$*"; exit 1; }
`
    );
    const script = path.join(root, 'scripts/service-apply.sh');
    const result = await execFile('bash', [script, 'apply', 'maintainerr']);
    assert.match(result.stdout, /reconciled-running-database/);
    assert.doesNotMatch(result.stdout, /unexpected-database-recreation/);
    assert.match(result.stdout, /up -d --wait --wait-timeout 180 --force-recreate --no-deps maintainerr/);
    assert.match(result.stdout, /maintainerr container settings applied/);
    await assert.rejects(
      execFile('bash', [script, 'apply', 'maintainerr'], { env: { ...process.env, APPLY_EXIT: '7' } }),
      (error: unknown) => {
        const failure = error as { code: number; stdout: string };
        assert.equal(failure.code, 7);
        assert.doesNotMatch(failure.stdout, /container settings applied/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
