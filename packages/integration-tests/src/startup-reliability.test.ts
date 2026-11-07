import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const storage = require('../../../stackarr/scripts/storage-control.cjs');

test('scheduler failure retries without taking the controller worker down', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackarr-scheduler-retry-'));
  try {
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'lib'));
    writeFileSync(
      path.join(dir, 'scripts/scheduler.sh'),
      readFileSync(path.join(root, 'stackarr/scripts/scheduler.sh'))
    );
    writeFileSync(
      path.join(dir, 'lib/common.sh'),
      `
load_env() {
  n=0; [[ ! -f "$TEST_ATTEMPTS" ]] || n=$(cat "$TEST_ATTEMPTS")
  n=$((n + 1)); echo "$n" > "$TEST_ATTEMPTS"
  [[ "$n" -gt 1 ]] || exit 1
  TIMEZONE=Etc/UTC
  STATE_ROOT="$TEST_STATE"
  ENABLE_BACKUP=false
  ENABLE_SCHEDULED_UPDATES=false
}
flag_enabled() { return 1; }
ensure_dir() { mkdir -p "$1"; }
`
    );
    const child = spawn(
      'bash',
      [
        path.join(root, 'stackarr/scripts/retry-worker.sh'),
        'scheduler',
        'bash',
        path.join(dir, 'scripts/scheduler.sh'),
        '--run-once'
      ],
      {
        env: {
          ...process.env,
          TEST_ATTEMPTS: path.join(dir, 'attempts'),
          TEST_STATE: dir,
          STACKARR_WORKER_RETRY_SECONDS: '0.02'
        },
        stdio: 'ignore'
      }
    );
    try {
      const deadline = Date.now() + 1500;
      while (
        Date.now() < deadline &&
        (!existsSync(path.join(dir, 'attempts')) || Number(readFileSync(path.join(dir, 'attempts'), 'utf8')) < 2)
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(existsSync(path.join(dir, 'attempts')));
      assert.ok(Number(readFileSync(path.join(dir, 'attempts'), 'utf8')) >= 2);
      assert.equal(child.exitCode, null);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('entrypoint keeps web alive while scheduler and MCP fail', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackarr-controller-retry-'));
  try {
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(
      path.join(dir, 'scripts/container-entrypoint.sh'),
      readFileSync(path.join(root, 'stackarr/scripts/container-entrypoint.sh'), 'utf8').replace(
        '/tmp/stackarr-controller-started-at',
        path.join(dir, 'marker')
      )
    );
    writeFileSync(
      path.join(dir, 'scripts/retry-worker.sh'),
      readFileSync(path.join(root, 'stackarr/scripts/retry-worker.sh'))
    );
    writeFileSync(path.join(dir, 'scripts/startup-recovery.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(path.join(dir, 'scripts/scheduler.sh'), '#!/bin/sh\necho retry >> "$TEST_RETRIES"\nexit 1\n', {
      mode: 0o755
    });
    writeFileSync(
      path.join(dir, 'bin/node'),
      '#!/bin/sh\nif [ "$1" = "packages/mcp/dist/index.js" ]; then exit 1; fi\necho up > "$TEST_WEB"\nexec sleep 10\n',
      { mode: 0o755 }
    );
    const child = spawn('bash', [path.join(dir, 'scripts/container-entrypoint.sh')], {
      env: {
        ...process.env,
        PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
        TEST_RETRIES: path.join(dir, 'retries'),
        TEST_WEB: path.join(dir, 'web'),
        STACKARR_ARCHIVE_WORKER_ENABLED: 'false',
        STACKARR_WORKER_RETRY_SECONDS: '0.05'
      },
      cwd: dir,
      stdio: 'ignore'
    });
    try {
      const deadline = Date.now() + 1500;
      while (
        Date.now() < deadline &&
        (!existsSync(path.join(dir, 'web')) ||
          !existsSync(path.join(dir, 'retries')) ||
          readFileSync(path.join(dir, 'retries'), 'utf8').split('\n').length < 3)
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(existsSync(path.join(dir, 'web')));
      assert.ok(readFileSync(path.join(dir, 'retries'), 'utf8').split('\n').length >= 3);
      assert.equal(child.exitCode, null);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a delayed storage proof retries with a fresh nonce and still rejects denial', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackarr-storage-retry-'));
  const file = path.join(dir, 'policy.json');
  try {
    writeFileSync(file, JSON.stringify({ version: 1, project: 'fixture', roots: [] }));
    mkdirSync(storage.bridgeDir(file));
    let calls = 0;
    const timer = setInterval(() => {
      if (++calls > 22) storage.respond(file, () => {});
    }, 20);
    try {
      await storage.checkGuest(file, { timeout: 400, attempts: 2 });
    } finally {
      clearInterval(timer);
    }
    const denied = setInterval(
      () =>
        storage.respond(file, () => {
          throw new Error('mount missing');
        }),
      20
    );
    try {
      await assert.rejects(storage.checkGuest(file, { timeout: 400, attempts: 2 }), /blocked/);
    } finally {
      clearInterval(denied);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
