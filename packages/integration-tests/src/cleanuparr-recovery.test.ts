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

for (const [name, enabled, provider, reachable, logs, expected] of [
  ['confirmed fatal startup', 'true', 'postgres', 'false', '57P03 database system is starting up', true],
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
database_required() { return 0; }
database_backed_servarr_services() { :; }
http_url_is_reachable() { [[ "$TEST_REACHABLE" == true ]]; }
stackarr_compose() {
  case "$1" in
    ps) printf '%s\\n' cleanuparr ;;
    logs) printf '%s\\n' "$TEST_LOGS" ;;
    restart) printf '%s\\n' "$2" >> "$TEST_RESTARTS" ;;
  esac
}
ENABLE_CLEANUPARR="$TEST_ENABLED"
CLEANUPARR_DATABASE_PROVIDER="$TEST_PROVIDER"
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
            TEST_RESTARTS: restarts
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
