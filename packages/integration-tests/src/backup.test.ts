import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const backupScript = path.join(repoRoot, 'stackarr/scripts/backup-run.sh');
const backupCrypto = path.join(repoRoot, 'stackarr/scripts/backup-crypto.cjs');
const runtimeSnapshotScript = path.join(repoRoot, 'stackarr/scripts/runtime-config-snapshot.cjs');
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

function writeRuntimeConfigDatabase(filePath: string, config: Record<string, string>) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      create table app_settings (
        key text primary key,
        value text not null,
        updated_at text not null default (datetime('now'))
      );
    `);
    db.prepare('insert into app_settings (key, value) values (?, ?)').run(
      'stackarr.runtimeConfig',
      JSON.stringify(config)
    );
  } finally {
    db.close();
  }
}

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
  const jellyfinConfigPath = path.join(root, 'jellyfin');

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
  await mkdir(path.join(stateRoot, 'compose'), { recursive: true });
  await mkdir(path.join(plexConfigPath, 'Metadata/library'), { recursive: true });
  await mkdir(path.join(plexConfigPath, 'Metadata/Collections/a/collection.bundle/Contents/_combined/posters'), {
    recursive: true
  });
  await mkdir(path.join(plexConfigPath, 'Metadata/Collections/a/collection.bundle/Uploads/posters'), {
    recursive: true
  });
  await mkdir(path.join(plexConfigPath, 'Plug-in Support/Databases'), { recursive: true });
  await mkdir(path.join(jellyfinConfigPath, 'config'), { recursive: true });
  await mkdir(path.join(jellyfinConfigPath, 'data'), { recursive: true });
  await mkdir(path.join(jellyfinConfigPath, 'cache'), { recursive: true });

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
  await writeFile(
    path.join(stateRoot, 'compose/.env'),
    'ROMM_STEAMGRIDDB_API_KEY="compose-only-test-key"\nSTACKARR_VERSION="transient-version"\n'
  );
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
  await writeFile(path.join(jellyfinConfigPath, 'config/system.xml'), '<ApiKey>jellyfin-fixture</ApiKey>');
  await writeDatabaseFixture(path.join(jellyfinConfigPath, 'data/jellyfin.db'), 'jellyfin db');
  await writeFile(path.join(jellyfinConfigPath, 'cache/poster.jpg'), 'regenerated jellyfin cache');
  const stackarrDatabaseFile = path.join(configRoot, 'stackarr.db');
  writeRuntimeConfigDatabase(stackarrDatabaseFile, {
    ROMM_STEAMGRIDDB_API_KEY: '',
    STACKARR_SESSION_SECRET: 'session-secret-fixture'
  });

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
      JELLYFIN_INSTALL_MODE: 'native',
      JELLYFIN_CONFIG_PATH: jellyfinConfigPath,
      PLEX_BACKUP_MODE: mode,
      ENABLE_BACKUP: 'true',
      BACKUP_PROGRESS_INTERVAL: '1',
      BACKUP_RETENTION_COUNT: '5',
      BACKUP_ENCRYPTION: 'none',
      STACKARR_DATABASE_FILE: stackarrDatabaseFile,
      ...envOverrides
    }
  });

  const backups = (await readdir(backupRoot)).filter(
    (name) => name.endsWith('.tar.gz') || name.endsWith('.tar.gz.enc')
  );
  assert.equal(backups.length, 1);

  const archivePath = path.join(backupRoot, backups[0]);
  const encrypted = archivePath.endsWith('.enc');
  const { stdout: listing } = encrypted
    ? await execFile('bash', [
        '-c',
        'node "$1" decrypt --key-file "$2" --input "$3" | tar -tzf -',
        'bash',
        backupCrypto,
        path.join(stateRoot, 'backup-encryption.key'),
        archivePath
      ])
    : await execFile('tar', ['-tzf', archivePath]);
  const manifestPath = listing.split('\n').find((line) => line.endsWith('/manifest.txt'));
  assert.ok(manifestPath);
  const { stdout: manifest } = encrypted
    ? await execFile('bash', [
        '-c',
        'node "$1" decrypt --key-file "$2" --input "$3" | tar -xOf - "$4"',
        'bash',
        backupCrypto,
        path.join(stateRoot, 'backup-encryption.key'),
        archivePath,
        manifestPath
      ])
    : await execFile('tar', ['-xOf', archivePath, manifestPath]);

  async function readArchiveEntry(suffix: string) {
    const entry = listing.split('\n').find((line) => line.endsWith(suffix));
    assert.ok(entry, `Expected backup entry ending with ${suffix}`);
    const result = encrypted
      ? await execFile('bash', [
          '-c',
          'node "$1" decrypt --key-file "$2" --input "$3" | tar -xOf - "$4"',
          'bash',
          backupCrypto,
          path.join(stateRoot, 'backup-encryption.key'),
          archivePath,
          entry
        ])
      : await execFile('tar', ['-xOf', archivePath, entry]);
    return result.stdout;
  }

  return { root, listing, manifest, stdout, archivePath, stateRoot, readArchiveEntry };
}

test('lite backups exclude rebuildable service assets', async (t) => {
  if (!(await commandExists('rsync'))) {
    t.skip('rsync is required for backup exclusions');
    return;
  }

  const fixture = await runFixtureBackup('lite');
  try {
    assert.match(fixture.listing, /\/config\/lidarr\/config\.xml\n/);
    assert.match(fixture.listing, /\/stackarr\/runtime-config\.json\n/);
    assert.match(fixture.listing, /\/stackarr\/credential-audit\.json\n/);
    assert.doesNotMatch(fixture.listing, /\/state\/compose\/\.env\n/);
    assert.match(fixture.listing, /\/jellyfin-native\/config\/system\.xml\n/);
    assert.match(fixture.listing, /\/jellyfin-native\/data\/jellyfin\.db\n/);
    assert.doesNotMatch(fixture.listing, /\/jellyfin-native\/cache\//);
    const runtimeSnapshot = JSON.parse(await fixture.readArchiveEntry('/stackarr/runtime-config.json')) as {
      runtimeConfig: Record<string, string>;
    };
    const credentialAudit = JSON.parse(await fixture.readArchiveEntry('/stackarr/credential-audit.json')) as {
      reconciledFromCompose: string[];
      credentials: Array<{ key: string; configured: boolean }>;
    };
    assert.equal(runtimeSnapshot.runtimeConfig.ROMM_STEAMGRIDDB_API_KEY, 'compose-only-test-key');
    assert.equal(runtimeSnapshot.runtimeConfig.STACKARR_VERSION, undefined);
    assert.deepEqual(credentialAudit.reconciledFromCompose, ['ROMM_STEAMGRIDDB_API_KEY']);
    assert.deepEqual(
      credentialAudit.credentials.find(({ key }) => key === 'ROMM_STEAMGRIDDB_API_KEY'),
      { key: 'ROMM_STEAMGRIDDB_API_KEY', configured: true }
    );
    assert.deepEqual(
      credentialAudit.credentials.find(({ key }) => key === 'ROMM_IGDB_CLIENT_SECRET'),
      { key: 'ROMM_IGDB_CLIENT_SECRET', configured: false }
    );
    assert.doesNotMatch(JSON.stringify(credentialAudit), /compose-only-test-key/);
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

test('encrypted backups are authenticated, private, and keep the recovery key outside the archive', async () => {
  const fixture = await runFixtureBackup('lite', { BACKUP_ENCRYPTION: 'keyfile' });
  try {
    assert.match(fixture.archivePath, /\.tar\.gz\.enc$/);
    assert.equal((await stat(fixture.archivePath)).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(fixture.stateRoot, 'backup-encryption.key'))).mode & 0o777, 0o600);
    assert.doesNotMatch(fixture.listing, /backup-encryption\.key/);
    assert.match(fixture.manifest, /^archive_encryption=keyfile$/m);
    assert.match(fixture.manifest, /^portable_runtime_config=stackarr\/runtime-config\.json$/m);
    assert.match(fixture.stdout, /Store a separate copy in a password manager/);

    const encryptedBytes = await readFile(fixture.archivePath);
    encryptedBytes[Math.floor(encryptedBytes.length / 2)] ^= 0x01;
    const damagedArchivePath = `${fixture.archivePath}.damaged`;
    await writeFile(damagedArchivePath, encryptedBytes, { mode: 0o600 });
    await assert.rejects(
      execFile(process.execPath, [
        backupCrypto,
        'decrypt',
        '--key-file',
        path.join(fixture.stateRoot, 'backup-encryption.key'),
        '--input',
        damagedArchivePath
      ]),
      /archive authentication failed/
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('recovery key export is tracked by key id and resets after key rotation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-recovery-key-test-'));
  const stateRoot = path.join(root, 'state');
  const databaseFile = path.join(root, 'stackarr.db');
  const keyPath = path.join(stateRoot, 'backup-encryption.key');

  try {
    await mkdir(stateRoot, { recursive: true });
    await writeFile(keyPath, `${Buffer.alloc(32, 7).toString('base64')}\n`, { mode: 0o644 });
    writeRuntimeConfigDatabase(databaseFile, {
      APP_ROOT: root,
      STATE_ROOT: stateRoot,
      BACKUP_ROOT: path.join(root, 'backups'),
      BACKUP_ENCRYPTION: 'keyfile'
    });

    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const fs = await import('node:fs/promises');
          const crypto = await import('node:crypto');
          const {
            exportBackupRecoveryKeyAction,
            getBackupRecoveryKeyStatusAction
          } = await import('./packages/core/src/actions/backups.ts');

          const before = getBackupRecoveryKeyStatusAction();
          const exported = await exportBackupRecoveryKeyAction();
          const after = getBackupRecoveryKeyStatusAction();
          const mode = (await fs.stat(process.env.RECOVERY_KEY_PATH)).mode & 0o777;
          await fs.writeFile(
            process.env.RECOVERY_KEY_PATH,
            crypto.randomBytes(32).toString('base64') + '\\n',
            { mode: 0o600 }
          );
          const rotated = getBackupRecoveryKeyStatusAction();
          console.log(JSON.stringify({
            before,
            after,
            rotated,
            mode,
            exportedFileName: exported.fileName,
            exportedMatchesKey: exported.contents.trim().length > 0 && exported.keyId === after.keyId
          }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: databaseFile,
          RECOVERY_KEY_PATH: keyPath
        }
      }
    );
    const result = JSON.parse(stdout);

    assert.equal(result.before.exported, false);
    assert.equal(result.before.keyAvailable, true);
    assert.equal(result.before.keyValid, true);
    assert.equal(result.after.exported, true);
    assert.ok(result.after.exportedAt);
    assert.equal(result.rotated.exported, false);
    assert.notEqual(result.rotated.keyId, result.after.keyId);
    assert.equal(result.mode, 0o600);
    assert.equal(result.exportedMatchesKey, true);
    assert.match(result.exportedFileName, /^stackarr-backup-recovery-key-[a-f0-9]{16}\.txt$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recovery key download requires dashboard reauthentication and disables caching', async () => {
  const route = await readFile(
    path.join(repoRoot, 'apps/frontend/src/app/api/v1/backup/recovery-key/route.ts'),
    'utf8'
  );
  const component = await readFile(path.join(repoRoot, 'apps/frontend/src/components/BackupRecoveryKey.tsx'), 'utf8');

  assert.match(route, /hasValidStackarrSession/);
  assert.match(route, /validateStackarrLogin/);
  assert.match(route, /'cache-control': 'no-store, max-age=0'/);
  assert.match(route, /'content-disposition': `attachment;/);
  assert.match(component, /Without it, encrypted archives cannot be fully restored/);
  assert.match(component, /currentPassword/);
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
  const stackarrDatabaseFile = path.join(configRoot, 'stackarr.db');
  writeRuntimeConfigDatabase(stackarrDatabaseFile, { ENABLE_BACKUP: 'true' });

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
          BACKUP_ENCRYPTION: 'none',
          STACKARR_DATABASE_FILE: stackarrDatabaseFile
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

test('portable runtime snapshot falls back to generated Compose state when PostgreSQL is host-inaccessible', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-runtime-snapshot-fallback-test-'));
  const composeEnvFile = path.join(root, 'compose.env');
  const snapshotFile = path.join(root, 'runtime-config.json');
  const auditFile = path.join(root, 'credential-audit.json');

  try {
    await writeFile(
      composeEnvFile,
      [
        'ENABLE_ROMM="true"',
        'ROMM_STEAMGRIDDB_API_KEY="compose-fallback-key"',
        'STACKARR_VERSION="transient-version"',
        ''
      ].join('\n')
    );

    const { stdout } = await execFile(
      process.execPath,
      [
        runtimeSnapshotScript,
        'create',
        '--output',
        snapshotFile,
        '--audit-output',
        auditFile,
        '--compose-env',
        composeEnvFile
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: '/usr/bin:/bin',
          STACKARR_DATABASE_FILE: path.join(root, 'missing.db'),
          STACKARR_DATABASE_URL: 'postgresql://unavailable:unavailable@127.0.0.1:1/unavailable'
        }
      }
    );

    const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8')) as {
      runtimeConfig: Record<string, string>;
    };
    const audit = JSON.parse(await readFile(auditFile, 'utf8')) as { source: string };
    assert.equal(snapshot.runtimeConfig.ROMM_STEAMGRIDDB_API_KEY, 'compose-fallback-key');
    assert.equal(snapshot.runtimeConfig.STACKARR_VERSION, undefined);
    assert.equal(audit.source, 'compose-fallback');
    assert.match(stdout, /from compose-fallback/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
