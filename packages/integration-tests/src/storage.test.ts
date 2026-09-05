import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const commonScript = path.join(repoRoot, 'stackarr/lib/common.sh');

function waitForStorage(env: NodeJS.ProcessEnv) {
  return execFile('bash', ['-c', 'source "$1"; wait_for_stackarr_storage', 'bash', commonScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      STACKARR_STORAGE_WAIT_SECONDS: '0',
      MEDIA_ROOT: '',
      DOWNLOADS_ROOT: '',
      ...env
    }
  });
}

test('storage wait includes backup root when backups are enabled', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-storage-test-'));
  const backupRoot = path.join(root, 'missing-backup');

  try {
    await assert.rejects(
      waitForStorage({
        ENABLE_BACKUP: 'true',
        BACKUP_ROOT: backupRoot
      }),
      (error: unknown) => {
        const output = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`;

        assert.match(output, /Timed out waiting for Stackarr storage/);
        assert.match(output, /missing-backup/);

        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('storage wait ignores backup root when backups are disabled', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-storage-test-'));
  const backupRoot = path.join(root, 'missing-backup');

  try {
    await waitForStorage({
      ENABLE_BACKUP: 'false',
      BACKUP_ROOT: backupRoot
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startup waits for external storage before rewriting state and refreshes Postgres before reconciliation', async () => {
  for (const relativePath of ['stackarr/scripts/up.sh', 'stackarr/scripts/start-stack.sh']) {
    const source = await readFile(path.join(repoRoot, relativePath), 'utf8');
    const storage = source.indexOf('wait_for_stackarr_storage');
    const firstWrite = source.indexOf('write_compose_env_file');
    const database = source.indexOf('ensure_database_if_required');
    const refresh = source.indexOf('load_postgres_runtime_config', database);
    const composeUp = source.indexOf('up -d --remove-orphans');

    assert.ok(storage >= 0, `${relativePath} must wait for storage`);
    assert.ok(firstWrite > storage, `${relativePath} must not rewrite generated state before storage is ready`);
    assert.ok(database > firstWrite, `${relativePath} must initialize PostgreSQL after preserving generated state`);
    assert.ok(refresh > database, `${relativePath} must reload authoritative PostgreSQL state after database startup`);
    assert.ok(composeUp > refresh, `${relativePath} must reconcile services only after authoritative reload`);
  }

  const common = await readFile(commonScript, 'utf8');
  const init = await readFile(path.join(repoRoot, 'stackarr/scripts/init.sh'), 'utf8');
  assert.match(common, /RECYCLARR_IMAGE:=ghcr\.io\/recyclarr\/recyclarr:8/);
  assert.match(init, /RECYCLARR_IMAGE="ghcr\.io\/recyclarr\/recyclarr:8"/);
});
