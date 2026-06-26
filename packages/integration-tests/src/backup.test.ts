import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const backupScript = path.join(repoRoot, 'stackarr/scripts/backup-run.sh');

async function commandExists(command: string) {
  try {
    await execFile('bash', ['-lc', `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function writeDatabaseFixture(filePath: string, fallbackContent: string) {
  if (await commandExists('sqlite3')) {
    await execFile('sqlite3', [
      filePath,
      "CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO fixture (value) VALUES ('backup fixture');"
    ]);
    return;
  }

  await writeFile(filePath, fallbackContent);
}

async function runFixtureBackup(mode: 'full' | 'lite', envOverrides: NodeJS.ProcessEnv = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-backup-test-'));
  const appRoot = path.join(root, 'app');
  const configRoot = path.join(appRoot, 'config');
  const stateRoot = path.join(appRoot, 'state');
  const logRoot = path.join(appRoot, 'logs');
  const backupRoot = path.join(appRoot, 'backups');
  const plexConfigPath = path.join(root, 'plex');
  const plexPrefsPath = path.join(root, 'plex.plist');

  await mkdir(path.join(configRoot, 'lidarr/MediaCover/Albums/123'), { recursive: true });
  await mkdir(path.join(configRoot, 'lidarr/Backups/scheduled'), { recursive: true });
  await mkdir(path.join(configRoot, 'lidarr/logs'), { recursive: true });
  await mkdir(path.join(configRoot, 'lidarr/Sentry'), { recursive: true });
  await mkdir(path.join(configRoot, 'tinymediamanager/data'), { recursive: true });
  await mkdir(path.join(configRoot, 'tinymediamanager/addons'), { recursive: true });
  await mkdir(path.join(configRoot, 'tinymediamanager/cache/image'), { recursive: true });
  await mkdir(path.join(configRoot, 'tinymediamanager/backup'), { recursive: true });
  await mkdir(path.join(configRoot, 'bookorbit/postgres/pg_wal'), { recursive: true });
  await mkdir(path.join(configRoot, 'transmission/blocklists'), { recursive: true });
  await mkdir(path.join(configRoot, 'recyclarr/resources/trash-guides'), { recursive: true });
  await mkdir(path.join(configRoot, 'prowlarr/repair-20260522-zeroed-live'), { recursive: true });
  await mkdir(path.join(configRoot, 'sonarr/repair-backups'), { recursive: true });
  await mkdir(path.join(configRoot, 'sonarr4k/restore-safety-20260513-024349'), { recursive: true });
  await mkdir(path.join(stateRoot, 'torrent-archive'), { recursive: true });
  await mkdir(path.join(plexConfigPath, 'Metadata/library'), { recursive: true });
  await mkdir(path.join(plexConfigPath, 'Metadata/Collections/a/collection.bundle/Contents/_combined/posters'), {
    recursive: true
  });
  await mkdir(path.join(plexConfigPath, 'Metadata/Collections/a/collection.bundle/Uploads/posters'), {
    recursive: true
  });
  await mkdir(path.join(plexConfigPath, 'Plug-in Support/Databases'), { recursive: true });

  await writeFile(path.join(configRoot, 'lidarr/config.xml'), '<Config />');
  await writeDatabaseFixture(path.join(configRoot, 'lidarr/lidarr.db'), 'fixture db');
  await writeFile(path.join(configRoot, 'lidarr/lidarr.db.bak.20260611123002'), 'redundant service backup');
  await writeFile(path.join(configRoot, 'lidarr/lidarr.db-wal'), 'fixture wal');
  await writeFile(path.join(configRoot, 'lidarr/lidarr.pid'), '123');
  await writeDatabaseFixture(path.join(configRoot, 'lidarr/logs.db'), 'fixture logs db');
  await writeFile(path.join(configRoot, 'lidarr/logs/lidarr.log'), 'log');
  await writeFile(path.join(configRoot, 'lidarr/Sentry/envelope'), 'crash telemetry');
  await writeFile(path.join(configRoot, 'lidarr/MediaCover/Albums/123/cover.jpg'), 'regenerated cover');
  await writeFile(path.join(configRoot, 'lidarr/Backups/scheduled/lidarr.db.zip'), 'redundant service backup');
  await writeFile(path.join(configRoot, 'tinymediamanager/data/movies.db'), 'H:2,block:11a,blockSize:1000');
  await writeFile(path.join(configRoot, 'tinymediamanager/addons/ffmpeg'), 'downloaded binary addon');
  await writeFile(path.join(configRoot, 'tinymediamanager/cache/imdb_ratings.db'), 'downloaded rating cache');
  await writeFile(path.join(configRoot, 'tinymediamanager/cache/image/poster.jpg'), 'cached image');
  await writeFile(path.join(configRoot, 'tinymediamanager/backup/tmm-backup.zip'), 'redundant service backup');
  await writeFile(
    path.join(configRoot, 'bookorbit/postgres/pg_wal/000000010000000000000001'),
    'old embedded postgres wal'
  );
  await writeFile(path.join(configRoot, 'transmission/blocklists/list.bin'), 'downloaded blocklist');
  await writeFile(path.join(configRoot, 'recyclarr/resources/trash-guides/cache.yml'), 'downloaded guide');
  await writeFile(path.join(configRoot, 'prowlarr/repair-20260522-zeroed-live/prowlarr.db'), 'stale repair copy');
  await writeDatabaseFixture(path.join(configRoot, 'sonarr/repair-backups/sonarr.db'), 'manual repair backup');
  await writeDatabaseFixture(
    path.join(configRoot, 'sonarr4k/restore-safety-20260513-024349/sonarr.db'),
    'restore safety backup'
  );
  await writeFile(path.join(stateRoot, 'torrent-archive/state.txt'), 'state');
  await writeFile(path.join(plexConfigPath, 'Metadata/library/item.bundle'), 'regenerated plex metadata');
  await writeFile(
    path.join(plexConfigPath, 'Metadata/Collections/a/collection.bundle/Contents/_combined/posters/poster-hash'),
    'collection poster'
  );
  await writeFile(
    path.join(plexConfigPath, 'Metadata/Collections/a/collection.bundle/Uploads/posters/custom-poster-hash'),
    'custom collection poster'
  );
  await writeDatabaseFixture(
    path.join(plexConfigPath, 'Plug-in Support/Databases/com.plexapp.plugins.library.db'),
    'plex db'
  );
  await writeFile(
    path.join(plexConfigPath, 'Plug-in Support/Databases/com.plexapp.plugins.library.db-2026-06-21'),
    'plex internal backup'
  );
  await mkdir(path.join(plexConfigPath, 'Scanners/Credits Detection'), { recursive: true });
  await writeFile(path.join(plexConfigPath, 'Scanners/Credits Detection/model_v1.pb'), 'downloaded plex model');
  await writeFile(plexPrefsPath, 'plist');

  const { stdout } = await execFile('bash', [backupScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      APP_ROOT: appRoot,
      CONFIG_ROOT: configRoot,
      STATE_ROOT: stateRoot,
      LOG_ROOT: logRoot,
      BACKUP_ROOT: backupRoot,
      MEDIA_ROOT: path.join(appRoot, 'media'),
      DOWNLOADS_ROOT: path.join(appRoot, 'downloads'),
      PLEX_CONFIG_PATH: plexConfigPath,
      PLEX_PREFS_PATH: plexPrefsPath,
      PLEX_BACKUP_MODE: mode,
      ENABLE_BACKUP: 'true',
      BACKUP_PROGRESS_INTERVAL: '1',
      BACKUP_RETENTION_COUNT: '5',
      STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db'),
      ...envOverrides
    }
  });

  const backups = (await readdir(backupRoot)).filter((name) => name.endsWith('.tar.gz'));
  assert.equal(backups.length, 1);

  const archivePath = path.join(backupRoot, backups[0]);
  const { stdout: listing } = await execFile('tar', ['-tzf', archivePath]);
  const manifestPath = listing.split('\n').find((line) => line.endsWith('/manifest.txt'));
  assert.ok(manifestPath);
  const { stdout: manifest } = await execFile('tar', ['-xOf', archivePath, manifestPath]);

  return { root, listing, manifest, stdout };
}

test('lite backups exclude rebuildable service assets', async (t) => {
  if (!(await commandExists('rsync'))) {
    t.skip('rsync is required for backup exclusions');
    return;
  }

  const fixture = await runFixtureBackup('lite');
  try {
    assert.match(fixture.listing, /\/config\/lidarr\/config\.xml\n/);
    assert.match(fixture.stdout, /PROGRESS 2 Preparing backup staging/);
    assert.match(fixture.stdout, /PROGRESS 100 Backup archive created:/);
    assert.match(fixture.listing, /\/config\/lidarr\/lidarr\.db\n/);
    assert.match(fixture.listing, /\/config\/tinymediamanager\/data\/movies\.db\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/MediaCover\//);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/Backups\//);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/lidarr\.db\.bak\.20260611123002\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/logs\//);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/logs\.db\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/Sentry\//);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/lidarr\.db-wal\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/lidarr\.pid\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/tinymediamanager\/addons\//);
    assert.doesNotMatch(fixture.listing, /\/config\/tinymediamanager\/cache\//);
    assert.doesNotMatch(fixture.listing, /\/config\/tinymediamanager\/backup\//);
    assert.doesNotMatch(fixture.listing, /\/config\/bookorbit\/postgres\//);
    assert.doesNotMatch(fixture.listing, /\/config\/transmission\/blocklists\//);
    assert.doesNotMatch(fixture.listing, /\/config\/recyclarr\/resources\//);
    assert.doesNotMatch(fixture.listing, /\/config\/prowlarr\/repair-20260522-zeroed-live\//);
    assert.doesNotMatch(fixture.listing, /\/config\/sonarr\/repair-backups\//);
    assert.doesNotMatch(fixture.listing, /\/config\/sonarr4k\/restore-safety-20260513-024349\//);
    assert.doesNotMatch(fixture.listing, /\/plex-native\/Metadata\/library\//);
    assert.doesNotMatch(
      fixture.listing,
      /\/plex-native\/Metadata\/Collections\/a\/collection\.bundle\/Contents\/_combined\/posters\/poster-hash\n/
    );
    assert.match(
      fixture.listing,
      /\/plex-native\/Metadata\/Collections\/a\/collection\.bundle\/Uploads\/posters\/custom-poster-hash\n/
    );
    assert.match(fixture.listing, /\/plex-native\/Plug-in Support\/Databases\/com\.plexapp\.plugins\.library\.db\n/);
    assert.doesNotMatch(
      fixture.listing,
      /\/plex-native\/Plug-in Support\/Databases\/com\.plexapp\.plugins\.library\.db-2026-06-21\n/
    );
    assert.doesNotMatch(fixture.listing, /\/plex-native\/Scanners\/Credits Detection\/model_v1\.pb\n/);
    assert.match(fixture.manifest, /^plex_backup_mode=lite$/m);
    assert.match(fixture.manifest, /^plex_lite_included_metadata_paths=Metadata\/Collections\/\*\/Uploads$/m);
    assert.match(fixture.manifest, /^config_excluded_rebuildable_paths=.*MediaCover/m);
    assert.match(fixture.manifest, /^config_excluded_rebuildable_paths=.*repair-\*/m);
    assert.match(fixture.manifest, /^config_excluded_rebuildable_paths=.*logs\.db\*/m);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('full backups keep durable state and skip rebuildable service artifacts', async () => {
  const fixture = await runFixtureBackup('full');
  try {
    assert.match(fixture.listing, /\/config\/lidarr\/config\.xml\n/);
    assert.match(fixture.stdout, /PROGRESS 2 Preparing backup staging/);
    assert.match(fixture.stdout, /PROGRESS 100 Backup archive created:/);
    assert.match(fixture.listing, /\/config\/lidarr\/lidarr\.db\n/);
    assert.match(fixture.listing, /\/config\/tinymediamanager\/data\/movies\.db\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/MediaCover\/Albums\/123\/cover\.jpg\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/lidarr\/Backups\/scheduled\/lidarr\.db\.zip\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/tinymediamanager\/cache\/imdb_ratings\.db\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/tinymediamanager\/cache\/image\/poster\.jpg\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/transmission\/blocklists\/list\.bin\n/);
    assert.doesNotMatch(fixture.listing, /\/config\/prowlarr\/repair-20260522-zeroed-live\/prowlarr\.db\n/);
    assert.match(fixture.listing, /\/plex-native\/Metadata\/library\/item\.bundle\n/);
    assert.doesNotMatch(
      fixture.listing,
      /\/plex-native\/Plug-in Support\/Databases\/com\.plexapp\.plugins\.library\.db-2026-06-21\n/
    );
    assert.match(fixture.manifest, /^plex_backup_mode=full$/m);
    assert.match(fixture.manifest, /^config_excluded_rebuildable_paths=.*MediaCover/m);
    assert.match(fixture.manifest, /^plex_excluded_rebuildable_paths=.*dated Plex database snapshots/m);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('backup fails instead of archiving an unreadable SQLite database', async (t) => {
  if (!(await commandExists('sqlite3'))) {
    t.skip('sqlite3 is required for SQLite snapshot validation');
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-backup-corrupt-test-'));
  const appRoot = path.join(root, 'app');
  const configRoot = path.join(appRoot, 'config');
  const stateRoot = path.join(appRoot, 'state');
  const logRoot = path.join(appRoot, 'logs');
  const backupRoot = path.join(appRoot, 'backups');

  await mkdir(path.join(configRoot, 'pulsarr/db'), { recursive: true });
  await writeFile(path.join(configRoot, 'pulsarr/db/pulsarr.db'), 'not a sqlite database');

  try {
    let error: { stderr?: string } | undefined;
    try {
      await execFile('bash', [backupScript], {
        cwd: repoRoot,
        env: {
          ...process.env,
          APP_ROOT: appRoot,
          CONFIG_ROOT: configRoot,
          STATE_ROOT: stateRoot,
          LOG_ROOT: logRoot,
          BACKUP_ROOT: backupRoot,
          MEDIA_ROOT: path.join(appRoot, 'media'),
          DOWNLOADS_ROOT: path.join(appRoot, 'downloads'),
          PLEX_CONFIG_PATH: path.join(root, 'missing-plex'),
          PLEX_PREFS_PATH: path.join(root, 'missing-plex.plist'),
          PLEX_BACKUP_MODE: 'lite',
          ENABLE_BACKUP: 'true',
          BACKUP_PROGRESS_INTERVAL: '1',
          BACKUP_RETENTION_COUNT: '5',
          STACKARR_DATABASE_FILE: path.join(root, 'missing-stackarr.db')
        }
      });
    } catch (caught) {
      error = caught as { stderr?: string };
    }

    assert.ok(error);
    assert.match(error.stderr ?? '', /Could not create a consistent SQLite backup/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
