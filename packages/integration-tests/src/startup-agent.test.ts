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
const commonScript = path.join(repoRoot, 'stackarr/lib/common.sh');
const startupInstaller = path.join(repoRoot, 'stackarr/scripts/startup-install.sh');

async function writeExecutable(file: string, content: string) {
  await writeFile(file, content);
  await chmod(file, 0o755);
}

test('Docker startup wait succeeds when the runtime becomes ready', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-docker-wait-test-'));
  const binDir = path.join(root, 'bin');
  const attemptsFile = path.join(root, 'attempts');

  try {
    await mkdir(binDir, { recursive: true });
    await writeExecutable(
      path.join(binDir, 'docker'),
      `#!/bin/sh
attempts=0
[ ! -f "$STACKARR_TEST_ATTEMPTS" ] || attempts=$(cat "$STACKARR_TEST_ATTEMPTS")
attempts=$((attempts + 1))
printf '%s' "$attempts" > "$STACKARR_TEST_ATTEMPTS"
[ "$attempts" -ge 3 ]
`
    );

    const { stdout } = await execFile(
      'bash',
      ['-c', 'source "$1"; wait_for_docker_runtime 3 0.01', 'bash', commonScript],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          STACKARR_TEST_ATTEMPTS: attemptsFile,
          DOCKER_CONTEXT: ''
        }
      }
    );

    assert.match(stdout, /waiting up to 3 seconds/);
    assert.match(stdout, /Docker runtime is ready/);
    assert.equal(await readFile(attemptsFile, 'utf8'), '3');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startup installer enables, loads, verifies, and retries a source agent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-startup-agent-test-'));
  const home = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  const appRoot = path.join(root, 'app');
  const stackarrBin = path.join(binDir, 'stackarr');
  const launchctlLog = path.join(root, 'launchctl.log');

  try {
    await mkdir(home, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeExecutable(stackarrBin, '#!/bin/sh\nexit 0\n');
    await writeExecutable(
      path.join(binDir, 'launchctl'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$STACKARR_TEST_LAUNCHCTL_LOG"
exit 0
`
    );

    await execFile('bash', [startupInstaller, 'install', '--quiet'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: home,
        APP_ROOT: appRoot,
        CONFIG_ROOT: path.join(appRoot, 'config'),
        STATE_ROOT: path.join(appRoot, 'state'),
        LOG_ROOT: path.join(appRoot, 'logs'),
        STACKARR_CLI_BIN: stackarrBin,
        STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
        STACKARR_RUNTIME: 'native',
        STACKARR_TEST_LAUNCHCTL_LOG: launchctlLog,
        DOCKER_CONTEXT: ''
      }
    });

    const plist = await readFile(path.join(home, 'Library/LaunchAgents/com.stackarr.stack.plist'), 'utf8');
    const launchctlCalls = await readFile(launchctlLog, 'utf8');

    assert.match(plist, /<key>STACKARR_RUN_SOURCE<\/key>\s*<string>startup<\/string>/);
    assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
    assert.doesNotMatch(plist, /AssociatedBundleIdentifiers/);
    assert.ok(
      launchctlCalls.indexOf('enable gui/') < launchctlCalls.indexOf('bootstrap gui/'),
      'the disabled override must be cleared before bootstrap'
    );
    assert.match(launchctlCalls, /print gui\/\d+\/com\.stackarr\.stack/);
    assert.match(launchctlCalls, /kickstart -k gui\/\d+\/com\.stackarr\.stack/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startup recovery restarts an unreachable Servarr process stuck on database startup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-database-recovery-test-'));
  const restartLog = path.join(root, 'restarts');

  try {
    const { stdout } = await execFile(
      'bash',
      [
        '-c',
        `source "$1"
database_required() { return 0; }
http_url_is_reachable() { return 1; }
stackarr_compose() {
  case "$1" in
    ps) printf '%s\\n' radarr ;;
    logs) printf '%s\\n' 'FATAL: database system is starting up' 'Non-recoverable failure, waiting for user intervention' ;;
    restart) printf '%s\\n' "$2" >> "$STACKARR_TEST_RESTART_LOG" ;;
  esac
}
ENABLE_MOVIES=true
ENABLE_TV_SHOWS=false
ENABLE_4K_SERVARR=false
ENABLE_LIDARR=false
recover_database_startup_failures`,
        'bash',
        commonScript
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_TEST_RESTART_LOG: restartLog
        }
      }
    );

    assert.match(stdout, /radarr is stuck after starting before the database was ready/);
    assert.equal(await readFile(restartLog, 'utf8'), 'radarr\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
