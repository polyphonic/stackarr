import assert from 'node:assert/strict';
import { execFile as callback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(callback);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const common = path.join(repo, 'stackarr/lib/common.sh');

for (const [name, ready, running, reachable, logDate, message, expected] of [
  [
    'current fatal file log with Docker logging disabled',
    true,
    true,
    false,
    '2030-01-01 02:00:10',
    '57P03: the database system is starting up',
    true
  ],
  [
    'database still recovering',
    false,
    true,
    false,
    '2030-01-01 02:00:10',
    '57P03: the database system is starting up',
    false
  ],
  [
    'previous container start only',
    true,
    true,
    false,
    '2030-01-01 01:59:00',
    '57P03: the database system is starting up',
    false
  ],
  ['healthy app', true, true, true, '2030-01-01 02:00:10', '57P03: the database system is starting up', false],
  [
    'deliberately stopped app',
    true,
    false,
    false,
    '2030-01-01 02:00:10',
    '57P03: the database system is starting up',
    false
  ],
  ['unrelated fatal error', true, true, false, '2030-01-01 02:00:10', 'database disk image is malformed', false]
] as const) {
  test(`engine recovery handles ${name}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'stackarr-engine-recovery-'));
    try {
      await mkdir(path.join(root, 'sonarr/logs'), { recursive: true });
      await writeFile(
        path.join(root, 'sonarr/logs/sonarr.txt'),
        `${logDate}.0|Fatal|ConsoleApp|EPIC FAIL!\n[v1] Npgsql.PostgresException: ${message}\n`
      );
      const { stdout } = await execFile(
        'bash',
        [
          '-c',
          `
source "$1"
database_required() { return 0; }
database_mode_is_postgres() { return 0; }
shared_database_is_ready() { [[ "$TEST_READY" == true ]]; }
database_backed_servarr_services() { echo sonarr; }
http_url_is_reachable() { [[ "$TEST_REACHABLE" == true ]]; }
service_container_started_at() { echo '2030-01-01T00:00:00.000000000Z'; }
recovery_compose() {
  case "$1" in
    ps) [[ "$TEST_RUNNING" == true ]] && echo sonarr ;;
    logs) return 1 ;;
    restart) echo "RESTART $2" ;;
  esac
}
recover_database_startup_failures
`,
          'test',
          common
        ],
        {
          env: {
            ...process.env,
            CONFIG_ROOT: root,
            TIMEZONE: 'Etc/GMT-2',
            TEST_READY: String(ready),
            TEST_RUNNING: String(running),
            TEST_REACHABLE: String(reachable),
            ENABLE_CLEANUPARR: 'false'
          }
        }
      );
      assert.equal(stdout.includes('RESTART sonarr'), expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('controller starts recovery with the maintenance scheduler disabled', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-entrypoint-recovery-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'bin'));
    await writeFile(
      path.join(root, 'scripts/container-entrypoint.sh'),
      (await readFile(path.join(repo, 'stackarr/scripts/container-entrypoint.sh'), 'utf8')).replace(
        '/tmp/stackarr-controller-started-at',
        path.join(root, 'controller-started-at')
      )
    );
    await writeFile(path.join(root, 'scripts/startup-recovery.sh'), '#!/bin/sh\necho recovery >> "$TEST_EVENTS"\n', {
      mode: 0o755
    });
    await writeFile(
      path.join(root, 'bin/node'),
      '#!/bin/sh\nfor attempt in $(seq 1 200); do [ ! -f "$TEST_EVENTS" ] || exit 0; sleep 0.01; done\nexit 1\n',
      { mode: 0o755 }
    );
    // The production container has Bash 5; macOS still ships Bash 3.
    await execFile(
      'bash',
      [
        '-c',
        'if (( BASH_VERSINFO[0] < 4 )); then wait() { [[ "${1:-}" != -n ]] || shift; builtin wait "$1"; }; fi; source "$0"',
        path.join(root, 'scripts/container-entrypoint.sh')
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}/bin:${process.env.PATH}`,
          STACKARR_SCHEDULER_ENABLED: 'false',
          TEST_EVENTS: path.join(root, 'events')
        }
      }
    );
    assert.equal(await readFile(path.join(root, 'events'), 'utf8'), 'recovery\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startup worker retries unavailable config and database, then limits recovery attempts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-recovery-worker-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'lib'));
    await writeFile(
      path.join(root, 'scripts/startup-recovery.sh'),
      await readFile(path.join(repo, 'stackarr/scripts/startup-recovery.sh'))
    );
    await writeFile(
      path.join(root, 'lib/common.sh'),
      `
source "${common}"
load_env() {
  n=0; [[ ! -f "$TEST_COUNTER" ]] || n=$(cat "$TEST_COUNTER")
  n=$((n + 1)); echo "$n" > "$TEST_COUNTER"
  [[ "$n" -gt 1 ]] || exit 1
}
database_required() { return 0; }
database_mode_is_postgres() { return 0; }
shared_database_is_ready() { [[ "$(cat "$TEST_COUNTER")" -ge 3 ]]; }
database_backed_servarr_services() { echo radarr; }
service_container_started_at() { echo '2030-01-01T00:00:00Z'; }
http_url_is_reachable() { return 1; }
recovery_compose() {
  case "$1" in
    ps) echo radarr ;;
    logs) [[ "$2" == --since=2030-01-01T00:00:00Z ]] || exit 9
      echo 'database system is starting up; Non-recoverable failure' ;;
    restart) echo "$2" >> "$TEST_RESTARTS"; return 1 ;;
  esac
}
`
    );
    await execFile('bash', [path.join(root, 'scripts/startup-recovery.sh')], {
      env: {
        ...process.env,
        TMPDIR: root,
        TEST_COUNTER: path.join(root, 'counter'),
        TEST_RESTARTS: path.join(root, 'restarts'),
        STACKARR_STARTUP_RECOVERY_ATTEMPTS: '6',
        STACKARR_STARTUP_RECOVERY_INTERVAL_SECONDS: '0.01',
        ENABLE_CLEANUPARR: 'false'
      }
    });
    assert.equal((await readFile(path.join(root, 'counter'), 'utf8')).trim(), '6');
    assert.equal(await readFile(path.join(root, 'restarts'), 'utf8'), 'radarr\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('additional RomM storage persists without switching the active game library', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-romm-staging-'));
  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        path.join(repo, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs'),
        '--input-type=module',
        '-e',
        `
      const { writeEnvConfig, readEnv } = await import('./packages/core/src/env.ts');
      const { getServiceConfigAction } = await import('./packages/core/src/serviceCatalog.ts');
      writeEnvConfig({ ROMM_LIBRARY_ROOT: '/games/current', ROMM_ADDITIONAL_GAMES_ROOT: '/games/incoming', ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE: 'false' });
      const config = getServiceConfigAction({ service: 'romm' });
      const field = config.groups.flatMap(g => g.fields).find(f => f.id === 'rommAdditionalGamesRoot');
      const env = readEnv();
      console.log(JSON.stringify({ primary: env.ROMM_LIBRARY_ROOT, additional: env.ROMM_ADDITIONAL_GAMES_ROOT, watcher: env.ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE, field }));
    `
      ],
      {
        cwd: repo,
        env: { ...process.env, STACKARR_DATABASE_URL: '', STACKARR_DATABASE_FILE: path.join(root, 'settings.db') }
      }
    );
    const result = JSON.parse(stdout);
    assert.equal(result.primary, '/games/current');
    assert.equal(result.additional, '/games/incoming');
    assert.equal(result.watcher, 'false');
    assert.equal(result.field.value, '/games/incoming');
    const { stdout: exported } = await execFile(
      process.execPath,
      [path.join(repo, 'stackarr/scripts/runtime-config-export.cjs')],
      { env: { ...process.env, STACKARR_DATABASE_URL: '', STACKARR_DATABASE_FILE: path.join(root, 'settings.db') } }
    );
    assert.match(exported, /ROMM_ADDITIONAL_GAMES_ROOT=.*\/games\/incoming/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
