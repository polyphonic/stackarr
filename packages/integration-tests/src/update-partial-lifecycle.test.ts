import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('partial image pull updates only successful services, preserves other containers, and exits failed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-partial-update-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'lib'));
    await mkdir(path.join(root, 'bin'));
    await writeFile(path.join(root, 'bin/docker'), '#!/bin/sh\nprintf "running|healthy|0|configured\\n"\n');
    await chmod(path.join(root, 'bin/docker'), 0o755);
    await writeFile(
      path.join(root, 'scripts/update-run.sh'),
      await readFile(path.join(repoRoot, 'stackarr/scripts/update-run.sh'), 'utf8')
    );
    for (const name of ['naming.sh', 'downloads.sh', 'requests.sh']) {
      await writeFile(path.join(root, 'scripts', name), '#!/bin/sh\nexit 0\n');
      await chmod(path.join(root, 'scripts', name), 0o755);
    }
    await writeFile(
      path.join(root, 'lib/common.sh'),
      `
print_header() { :; }
load_env() { :; }
maintenance_lock_enter() { :; }
database_mode_is_postgres() { return 1; }
write_compose_env_file() { :; }
wait_for_stackarr_storage() { :; }
ensure_docker_runtime() { :; }
compose_profile_args() { printf '%s\\n' --profile stackarr; }
stackarr_compose() {
  printf '%s\\n' "$*" >> "$STACKARR_TEST_ACTIONS"
  case "$*" in
    *'config --services') printf 'app\\nfirst\\nsecond\\n';;
    *'ps --all -q first') printf 'abcdef\\n';;
    *'pull --quiet first') return 0;;
    *'pull --quiet'*) return 1;;
  esac
  return 0
}
remove_database_init_sidecar() { :; }
remove_inactive_torrent_client_container() { :; }
warn() { :; }
ok() { :; }
fail() { printf '%s\\n' "$1" >&2; exit 1; }
`
    );
    const actions = path.join(root, 'actions');
    await assert.rejects(
      execFile('bash', [path.join(root, 'scripts/update-run.sh'), 'services'], {
        env: {
          ...process.env,
          PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
          STACKARR_TEST_ACTIONS: actions,
          STACKARR_UPDATE_PULL_ATTEMPTS: '1',
          STACKARR_UPDATE_HEALTHY_STABILITY_SECONDS: '0'
        }
      }),
      /Managed services partially updated: 1 of 2 images pulled/
    );
    const log = await readFile(actions, 'utf8');
    assert.match(log, /up -d --no-deps first/);
    assert.doesNotMatch(log, /up .*second|--remove-orphans/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
