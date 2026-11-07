import assert from 'node:assert/strict';
import { execFile as callback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(callback);
const common = fileURLToPath(new URL('../../../stackarr/lib/common.sh', import.meta.url));

for (const [name, enabled, provider, reachable, logs, expected, dnsReady = 'true'] of [
  ['confirmed fatal startup', 'true', 'postgres', 'false', '57P03 database system is starting up', true],
  [
    'database DNS recovered',
    'true',
    'postgres',
    'false',
    'Unhandled exception. Npgsql.NpgsqlException: Name or service not known',
    true
  ],
  [
    'database DNS still unavailable',
    'true',
    'postgres',
    'false',
    'Unhandled exception. Npgsql.NpgsqlException: Name or service not known',
    false,
    'false'
  ],
  ['unrelated DNS failure', 'true', 'postgres', 'false', 'Name or service not known', false],
  ['handled DNS error', 'true', 'postgres', 'false', 'Npgsql.NpgsqlException: Name or service not known', false],
  [
    'invalid database credentials',
    'true',
    'postgres',
    'false',
    'Npgsql.PostgresException: 28P01 password authentication failed',
    false
  ],
  ['healthy endpoint', 'true', 'postgres', 'true', '57P03 database system is starting up', false],
  ['unrelated outage', 'true', 'postgres', 'false', 'connection refused', false],
  ['sqlite provider', 'true', 'sqlite', 'false', '57P03 database system is starting up', false],
  ['disabled service', 'false', 'postgres', 'false', '57P03 database system is starting up', false]
] as const) {
  test(`Cleanuparr recovery gates ${name}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'stackarr-cleanuparr-recovery-'));
    const restarts = path.join(root, 'restarts');
    try {
      await execFile(
        'bash',
        [
          '-c',
          `
source "$1"
stackarr_runtime_is_container() { return 0; }
database_required() { return 0; }
shared_database_is_ready() { return 0; }
service_container_started_at() { echo "2030-01-01T00:00:00Z"; }
database_mode_is_postgres() { return 0; }
database_backed_servarr_services() { :; }
http_url_is_reachable() { printf '%s' "$1" > "$TEST_URL"; [[ "$TEST_REACHABLE" == true ]]; }
recovery_compose() {
  case "$1" in
    ps) printf '%s\\n' cleanuparr ;;
    logs) printf '%s\\n' "$TEST_LOGS" ;;
    exec) [[ "$*" == 'exec -T cleanuparr getent hosts database' ]] && [[ "$TEST_DNS_READY" == true ]] ;;
    restart) printf '%s\\n' "$2" >> "$TEST_RESTARTS" ;;
  esac
}
ENABLE_CLEANUPARR="$TEST_ENABLED"
CLEANUPARR_DATABASE_PROVIDER="$TEST_PROVIDER"
CLEANUPARR_URL=http://127.0.0.1:42100/
CLEANUPARR_POSTGRES_HOST=database
recover_database_startup_failures
`,
          'bash',
          common
        ],
        {
          env: {
            ...process.env,
            TEST_ENABLED: enabled,
            TEST_PROVIDER: provider,
            TEST_REACHABLE: reachable,
            TEST_LOGS: logs,
            TEST_RESTARTS: restarts,
            TEST_DNS_READY: dnsReady,
            TEST_URL: path.join(root, 'probe-url'),
            STACKARR_RUNTIME: 'docker'
          }
        }
      );
      let actual = '';
      try {
        actual = await readFile(restarts, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      assert.equal(actual, expected ? 'cleanuparr\n' : '');
      if (enabled === 'true' && provider === 'postgres') {
        assert.equal(await readFile(path.join(root, 'probe-url'), 'utf8'), 'http://cleanuparr:11011/api/health');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
