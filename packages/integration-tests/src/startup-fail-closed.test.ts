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

for (const [script, mode] of ['up.sh', 'start-stack.sh'].flatMap((script) =>
  ['postgres', 'app-default'].map((mode) => [script, mode])
)) {
  test(`${script} refuses to reconcile installed services with ${mode} bootstrap when PostgreSQL settings cannot be read`, async () => {
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
write_compose_env_file() { printf 'UNSAFE_ENV_WRITE\\n' >> "$STACKARR_TEST_ACTIONS"; }
wait_for_docker_runtime() { :; }
ensure_docker_runtime() { :; }
start_existing_database_for_runtime_config() { return 1; }
database_mode_is_postgres() { [[ "$STACKARR_DATABASE_MODE" == postgres ]]; }
docker() { [[ "$1" == inspect ]] || return 1; if [[ "$3" == *Mounts* ]]; then printf '%s/config/database\\n' "$APP_ROOT"; else printf 'stackarr\\n'; fi; }
${(await readFile(path.join(repoRoot, 'stackarr/lib/common.sh'), 'utf8')).split('installed_managed_database() {')[1].split('start_existing_database_for_runtime_config() {')[0].replace(/^/, 'installed_managed_database() {')}
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
          env: {
            ...process.env,
            APP_ROOT: root,
            LOG_ROOT: root,
            STACKARR_TEST_ACTIONS: actions,
            STACKARR_DATABASE_MODE: mode
          }
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
