import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

for (const script of ['up.sh', 'start-stack.sh']) {
  test(`${script} refuses to reconcile installed services when PostgreSQL settings cannot be read`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'stackarr-startup-guard-'));
    try {
      await mkdir(path.join(root, 'scripts'));
      await mkdir(path.join(root, 'lib'));
      await writeFile(
        path.join(root, 'scripts', script),
        await readFile(path.join(repoRoot, 'stackarr/scripts', script), 'utf8')
      );
      await writeFile(
        path.join(root, 'lib/common.sh'),
        `
load_env() { :; }
print_header() { :; }
wait_for_stackarr_storage() { :; }
write_compose_env_file() { :; }
wait_for_docker_runtime() { :; }
ensure_docker_runtime() { :; }
start_existing_database_for_runtime_config() { return 1; }
database_mode_is_postgres() { return 0; }
docker() { [[ "$1" == inspect && "$2" == database ]]; }
load_postgres_runtime_config() { return 1; }
ensure_database_if_required() { printf 'UNSAFE_DATABASE_RECONCILIATION\\n' >> "$STACKARR_TEST_ACTIONS"; }
stackarr_compose() { printf 'UNSAFE_COMPOSE\\n' >> "$STACKARR_TEST_ACTIONS"; }
remove_disabled_optional_containers() { printf 'UNSAFE_REMOVAL\\n' >> "$STACKARR_TEST_ACTIONS"; }
ensure_dir() { mkdir -p "$1"; }
lowercase() { printf '%s\\n' "$1"; }
fail() { printf '%s\\n' "$1" >&2; exit 1; }
`
      );
      const actions = path.join(root, 'actions');
      await assert.rejects(
        execFile('bash', [path.join(root, 'scripts', script)], {
          env: { ...process.env, LOG_ROOT: root, STACKARR_TEST_ACTIONS: actions, STACKARR_DATABASE_MODE: 'postgres' }
        })
      );
      if (script === 'start-stack.sh') {
        assert.match(
          await readFile(path.join(root, 'launchd/start-stack.log'), 'utf8'),
          /Unable to load authoritative PostgreSQL runtime settings; startup cancelled/
        );
      }
      await assert.rejects(readFile(actions, 'utf8'), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
