import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const guard = path.join(repo, 'stackarr/lib/storage-guard.sh');
const backup = path.join(repo, 'stackarr/scripts/backup-run.sh');

function roots(base: string) {
  const app = path.join(base, 'app');
  return {
    APP_ROOT: app,
    CONFIG_ROOT: path.join(app, 'config'),
    STATE_ROOT: path.join(app, 'state'),
    LOG_ROOT: path.join(app, 'logs'),
    BACKUP_ROOT: path.join(app, 'backups'),
    BACKUP_STAGING_ROOT: path.join(base, 'staging'),
    DOWNLOADS_ROOT: path.join(base, 'media/Downloads')
  };
}

function check(env: Record<string, string>, candidate: string) {
  return spawnSync(
    'bash',
    [
      '-c',
      'fail(){ echo "$*" >&2; exit 1; }; require_command(){ command -v "$1" >/dev/null; }; source "$1"; stackarr_verify_torrent_archive_root',
      'fixture',
      guard
    ],
    {
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...env, TORRENT_ARCHIVE_ROOT: candidate },
      encoding: 'utf8'
    }
  );
}

test('archive root refuses managed overlaps, aliases and symlink ancestors but allows default and Downloads', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-archive-guard-'));
  try {
    const env = roots(base);
    fs.mkdirSync(env.DOWNLOADS_ROOT, { recursive: true });
    fs.mkdirSync(env.CONFIG_ROOT, { recursive: true });
    fs.mkdirSync(env.STATE_ROOT, { recursive: true });
    fs.mkdirSync(env.LOG_ROOT, { recursive: true });
    fs.mkdirSync(env.BACKUP_STAGING_ROOT, { recursive: true });
    fs.symlinkSync(env.CONFIG_ROOT, path.join(base, 'config-alias'));
    fs.symlinkSync(env.BACKUP_STAGING_ROOT, path.join(base, 'staging-alias'));
    const allowed = [path.join(env.STATE_ROOT, 'torrent-archive'), path.join(env.DOWNLOADS_ROOT, 'torrents')];
    for (const candidate of allowed) assert.equal(check(env, candidate).status, 0, candidate);
    const denied = [
      '/',
      env.STATE_ROOT,
      env.CONFIG_ROOT,
      env.APP_ROOT,
      base,
      env.BACKUP_ROOT,
      env.BACKUP_STAGING_ROOT,
      path.join(env.STATE_ROOT, 'other'),
      path.join(env.CONFIG_ROOT, 'archive'),
      path.join(env.LOG_ROOT, 'archive'),
      path.join(env.BACKUP_ROOT, 'archive'),
      path.join(env.BACKUP_STAGING_ROOT, 'archive'),
      path.join(base, 'config-alias/archive'),
      path.join(base, 'staging-alias/archive'),
      `${env.STATE_ROOT}/../config/archive`,
      '/Volumes/unregistered/Downloads/torrents',
      path.join(env.DOWNLOADS_ROOT, '.', 'torrents') + '/'
    ];
    for (const candidate of denied) assert.notEqual(check(env, candidate).status, 0, candidate);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('backup rejects unsafe archive root before creating backup staging or copying state', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-archive-backup-'));
  try {
    const env = roots(base);
    fs.mkdirSync(env.CONFIG_ROOT, { recursive: true });
    fs.mkdirSync(env.STATE_ROOT, { recursive: true });
    const result = spawnSync('bash', [backup], {
      cwd: repo,
      env: {
        ...process.env,
        ...env,
        TORRENT_ARCHIVE_ROOT: env.BACKUP_STAGING_ROOT,
        ENABLE_BACKUP: 'true',
        BACKUP_ENCRYPTION: 'none',
        STACKARR_DATABASE_FILE: path.join(base, 'unused.db')
      },
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsafe or unenrolled TORRENT_ARCHIVE_ROOT/);
    assert.equal(fs.existsSync(env.BACKUP_ROOT), false);
    assert.equal(fs.existsSync(env.BACKUP_STAGING_ROOT), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('approved symlinked config root does not relocate or disable the state archive', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-archive-config-link-'));
  try {
    const env = roots(base);
    const relocated = path.join(base, 'external/config');
    fs.mkdirSync(relocated, { recursive: true });
    fs.mkdirSync(env.STATE_ROOT, { recursive: true });
    fs.symlinkSync(relocated, env.CONFIG_ROOT);
    const result = check(env, path.join(env.STATE_ROOT, 'torrent-archive'));
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(check(env, path.join(relocated, 'archive')).status, 0);
    assert.notEqual(check(env, path.join(env.CONFIG_ROOT, 'archive')).status, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
