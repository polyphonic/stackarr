import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const restore = path.join(repo, 'stackarr/scripts/restore.sh');

test('custom archive restore uses current destination, retains old state and rejects unsafe destination before DB writes', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stackarr-archive-restore-'));
  try {
    const app = path.join(base, 'app');
    const env = {
      APP_ROOT: app,
      CONFIG_ROOT: path.join(app, 'config'),
      STATE_ROOT: path.join(app, 'state'),
      LOG_ROOT: path.join(app, 'logs'),
      BACKUP_ROOT: path.join(app, 'backups'),
      DOWNLOADS_ROOT: path.join(base, 'media/Downloads')
    };
    const destination = path.join(env.DOWNLOADS_ROOT, 'torrents');
    const dbFile = path.join(base, 'runtime.db');
    const source = path.join(base, 'fixture', 'backup');
    const archive = path.join(base, 'backup.tar.gz');
    fs.mkdirSync(path.join(source, 'torrent-archive'), { recursive: true });
    fs.mkdirSync(path.join(source, 'state/torrent-archive'), { recursive: true });
    fs.mkdirSync(path.join(env.STATE_ROOT, 'torrent-archive'), { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(
      path.join(source, 'manifest.txt'),
      'torrent_archive_root=/old-host/archive\nplex_backup_mode=lite\n'
    );
    fs.writeFileSync(path.join(source, 'torrent-archive/movie.torrent'), 'custom');
    fs.writeFileSync(path.join(source, 'state/torrent-archive/old.torrent'), 'old');
    fs.writeFileSync(path.join(env.STATE_ROOT, 'torrent-archive/existing.torrent'), 'keep');
    const db = new DatabaseSync(dbFile);
    db.exec(
      "create table app_settings (key text primary key, value text not null, updated_at text not null default (datetime('now')))"
    );
    db.prepare('insert into app_settings(key,value) values (?,?)').run(
      'stackarr.runtimeConfig',
      JSON.stringify({ ...env, TORRENT_ARCHIVE_ROOT: destination })
    );
    db.close();
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', path.join(base, 'fixture'), 'backup']).status, 0);
    const runtimeEnv = {
      ...process.env,
      ...env,
      TORRENT_ARCHIVE_ROOT: destination,
      STACKARR_DATABASE_FILE: dbFile,
      STACKARR_COMPOSE_ENV_FILE: path.join(base, 'compose.env'),
      HOME: path.join(base, 'home')
    };
    const run = (extra: string[]) =>
      spawnSync(
        'bash',
        [
          '-c',
          'docker(){ return 1; }; export -f docker; "$@"',
          'fixture',
          restore,
          archive,
          '--yes',
          '--skip-postgres',
          '--skip-youtarr',
          '--skip-native-plex',
          '--skip-plex-preferences',
          '--skip-native-jellyfin',
          ...extra
        ],
        { cwd: repo, env: runtimeEnv, encoding: 'utf8' }
      );
    const unsafe = run(['--torrent-archive-root', env.CONFIG_ROOT]);
    assert.notEqual(unsafe.status, 0, unsafe.stdout);
    assert.match(unsafe.stderr, /Unsafe or unenrolled TORRENT_ARCHIVE_ROOT/);
    assert.equal(fs.existsSync(path.join(env.CONFIG_ROOT, 'movie.torrent')), false);
    assert.equal(fs.existsSync(path.join(env.STATE_ROOT, 'torrent-archive/old.torrent')), false);
    const valid = run([]);
    assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
    assert.match(valid.stdout, /backup source \/old-host\/archive -> current destination/);
    assert.equal(fs.readFileSync(path.join(destination, 'movie.torrent'), 'utf8'), 'custom');
    assert.equal(fs.readFileSync(path.join(env.STATE_ROOT, 'torrent-archive/old.torrent'), 'utf8'), 'old');
    assert.equal(fs.readFileSync(path.join(env.STATE_ROOT, 'torrent-archive/existing.torrent'), 'utf8'), 'keep');
    const persisted = new DatabaseSync(dbFile);
    const row = persisted.prepare('select value from app_settings where key = ?').get('stackarr.runtimeConfig') as {
      value: string;
    };
    persisted.close();
    assert.equal(JSON.parse(row.value).TORRENT_ARCHIVE_ROOT, destination);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
