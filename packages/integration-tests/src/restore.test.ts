import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const restoreScript = path.join(repoRoot, 'stackarr/scripts/restore.sh');
const backupCrypto = path.join(repoRoot, 'stackarr/scripts/backup-crypto.cjs');

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

function readRuntimeConfig(filePath: string) {
  return readJsonSetting<Record<string, string>>(filePath, 'stackarr.runtimeConfig');
}

function readJsonSetting<T = Record<string, unknown>>(filePath: string, key: string): T {
  const db = new DatabaseSync(filePath);

  try {
    const row = db.prepare('select value from app_settings where key = ?').get(key) as { value?: string } | undefined;

    return row?.value ? (JSON.parse(row.value) as T) : ({} as T);
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

async function createZipArchive(sourceRoot: string, archivePath: string) {
  await execFile('python3', [
    '-c',
    `
import pathlib
import sys
import zipfile

source = pathlib.Path(sys.argv[1])
archive = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as backup:
    for path in source.rglob("*"):
        backup.write(path, path.relative_to(source.parent).as_posix())
`,
    sourceRoot,
    archivePath
  ]);
}

test('restore brings back runtime config, service config, and state from a backup archive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-restore-test-'));
  const appRoot = path.join(root, 'app');
  const configRoot = path.join(appRoot, 'config');
  const stateRoot = path.join(appRoot, 'state');
  const logRoot = path.join(appRoot, 'logs');
  const mediaRoot = path.join(root, 'media');
  const downloadsRoot = path.join(root, 'downloads');
  const backupRoot = path.join(root, 'backups');
  const composeEnvFile = path.join(root, 'compose.env');
  const databaseFile = path.join(root, 'stackarr.db');
  const backupName = 'stackarr-backup-20260624-120000';
  const backupRootFixture = path.join(root, 'fixture', backupName);
  const archivePath = path.join(root, `${backupName}.tar.gz`);

  try {
    await mkdir(path.join(backupRootFixture, 'config/lidarr'), { recursive: true });
    await mkdir(path.join(backupRootFixture, 'state/torrent-archive'), { recursive: true });
    await mkdir(path.join(backupRootFixture, 'stackarr'), { recursive: true });
    await writeFile(path.join(backupRootFixture, 'manifest.txt'), 'plex_backup_mode=lite\n');
    await writeFile(path.join(backupRootFixture, 'config/lidarr/config.xml'), '<Config />');
    await writeFile(path.join(backupRootFixture, 'state/torrent-archive/state.txt'), 'restored state');
    writeRuntimeConfigDatabase(path.join(backupRootFixture, 'stackarr/stackarr.db'), {
      APP_ROOT: appRoot,
      CONFIG_ROOT: configRoot,
      STATE_ROOT: stateRoot,
      LOG_ROOT: logRoot,
      MEDIA_ROOT: mediaRoot,
      MUSIC_ROOT: path.join(mediaRoot, 'Music'),
      DOWNLOADS_ROOT: downloadsRoot,
      BACKUP_ROOT: backupRoot,
      STACKARR_IMAGE: 'polyphonic/stackarr:alpha',
      STACKARR_WEB_ENABLED: 'true'
    });
    await writeFile(
      path.join(backupRootFixture, 'stackarr/runtime-config.json'),
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        runtimeConfig: {
          ROMM_STEAMGRIDDB_API_KEY: 'portable-snapshot-wins'
        }
      })
    );

    await execFile('tar', ['-czf', archivePath, '-C', path.join(root, 'fixture'), backupName]);
    await execFile(
      'bash',
      [
        '-c',
        'docker(){ return 1; }; export -f docker; printf "y\\n" | "$1" "$2" --force-config',
        'bash',
        restoreScript,
        archivePath
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
          STACKARR_DATABASE_FILE: databaseFile,
          HOME: path.join(root, 'home')
        }
      }
    );

    assert.equal(await readFile(path.join(configRoot, 'lidarr/config.xml'), 'utf8'), '<Config />');
    assert.equal(await readFile(path.join(stateRoot, 'torrent-archive/state.txt'), 'utf8'), 'restored state');
    assert.deepEqual(readRuntimeConfig(databaseFile).MEDIA_ROOT, mediaRoot);
    assert.equal(readRuntimeConfig(databaseFile).ROMM_STEAMGRIDDB_API_KEY, 'portable-snapshot-wins');
    assert.match(await readFile(composeEnvFile, 'utf8'), /^STACKARR_IMAGE="polyphonic\/stackarr:alpha"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('restore accepts zip archives and can run non-interactively from onboarding', async (t) => {
  if (!(await commandExists('python3'))) {
    t.skip('python3 is required for zip archive restore');
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-restore-zip-test-'));
  const appRoot = path.join(root, 'app');
  const configRoot = path.join(appRoot, 'config');
  const stateRoot = path.join(appRoot, 'state');
  const logRoot = path.join(appRoot, 'logs');
  const backupName = 'stackarr-backup-20260624-130000';
  const backupRootFixture = path.join(root, 'fixture', backupName);
  const archivePath = path.join(root, `${backupName}.zip`);
  const composeEnvFile = path.join(root, 'compose.env');
  const databaseFile = path.join(root, 'stackarr.db');

  try {
    await mkdir(path.join(backupRootFixture, 'config/prowlarr'), { recursive: true });
    await mkdir(path.join(backupRootFixture, 'stackarr'), { recursive: true });
    await writeFile(path.join(backupRootFixture, 'manifest.txt'), 'plex_backup_mode=lite\n');
    await writeFile(path.join(backupRootFixture, 'config/prowlarr/config.xml'), '<Config />');
    writeRuntimeConfigDatabase(path.join(backupRootFixture, 'stackarr/stackarr.db'), {
      APP_ROOT: appRoot,
      CONFIG_ROOT: configRoot,
      STATE_ROOT: stateRoot,
      LOG_ROOT: logRoot,
      MEDIA_ROOT: path.join(appRoot, 'media'),
      MUSIC_ROOT: path.join(appRoot, 'media/Music'),
      DOWNLOADS_ROOT: path.join(appRoot, 'downloads'),
      BACKUP_ROOT: path.join(appRoot, 'backups'),
      STACKARR_WEB_ENABLED: 'true'
    });
    await createZipArchive(backupRootFixture, archivePath);

    await execFile(
      'bash',
      [
        '-c',
        'docker(){ return 1; }; export -f docker; "$1" "$2" --yes --force-config --skip-postgres --skip-native-plex --skip-plex-preferences --mark-onboarding-complete',
        'bash',
        restoreScript,
        archivePath
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
          STACKARR_DATABASE_FILE: databaseFile,
          HOME: path.join(root, 'home')
        }
      }
    );

    assert.equal(await readFile(path.join(configRoot, 'prowlarr/config.xml'), 'utf8'), '<Config />');
    assert.equal(readRuntimeConfig(databaseFile).CONFIG_ROOT, configRoot);
    assert.equal(
      readJsonSetting<{ setup: { onboardingComplete: boolean } }>(databaseFile, 'stackarr.settings').setup
        .onboardingComplete,
      true
    );
    assert.match(await readFile(composeEnvFile, 'utf8'), /^STACKARR_WEB_ENABLED="true"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('constrained restore ignores archive-controlled host roots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-restore-constrained-test-'));
  const appRoot = path.join(root, 'app');
  const safeConfigRoot = path.join(appRoot, 'config');
  const safeStateRoot = path.join(appRoot, 'state');
  const maliciousRoot = path.join(root, 'attacker-root');
  const backupName = 'stackarr-backup-20260624-140000';
  const backupRootFixture = path.join(root, 'fixture', backupName);
  const archivePath = path.join(root, `${backupName}.tar.gz`);
  const composeEnvFile = path.join(root, 'compose.env');
  const databaseFile = path.join(root, 'stackarr.db');

  try {
    await mkdir(path.join(backupRootFixture, 'config/radarr'), { recursive: true });
    await mkdir(path.join(backupRootFixture, 'state/tasks'), { recursive: true });
    await mkdir(path.join(backupRootFixture, 'stackarr'), { recursive: true });
    await writeFile(path.join(backupRootFixture, 'manifest.txt'), 'plex_backup_mode=lite\n');
    await writeFile(path.join(backupRootFixture, 'config/radarr/config.xml'), '<Config />');
    await writeFile(path.join(backupRootFixture, 'state/tasks/task.json'), '{}');
    writeRuntimeConfigDatabase(path.join(backupRootFixture, 'stackarr/stackarr.db'), {
      APP_ROOT: path.join(maliciousRoot, 'app'),
      CONFIG_ROOT: path.join(maliciousRoot, 'config'),
      STATE_ROOT: path.join(maliciousRoot, 'state'),
      LOG_ROOT: path.join(maliciousRoot, 'logs'),
      MEDIA_ROOT: path.join(maliciousRoot, 'media'),
      MUSIC_ROOT: path.join(maliciousRoot, 'media/Music'),
      DOWNLOADS_ROOT: path.join(maliciousRoot, 'downloads'),
      BACKUP_ROOT: path.join(maliciousRoot, 'backups'),
      PLEX_CONFIG_PATH: path.join(maliciousRoot, 'plex'),
      PLEX_PREFS_PATH: path.join(maliciousRoot, 'prefs.plist'),
      STACKARR_WEB_ENABLED: 'true'
    });

    await execFile('tar', ['-czf', archivePath, '-C', path.join(root, 'fixture'), backupName]);
    await execFile(
      'bash',
      [
        '-c',
        'docker(){ return 1; }; export -f docker; "$1" "$2" --yes --force-config --constrain-runtime-roots --restore-app-root "$3" --skip-postgres --skip-native-plex --skip-plex-preferences',
        'bash',
        restoreScript,
        archivePath,
        appRoot
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
          STACKARR_DATABASE_FILE: databaseFile,
          HOME: path.join(root, 'home')
        }
      }
    );

    assert.equal(await readFile(path.join(safeConfigRoot, 'radarr/config.xml'), 'utf8'), '<Config />');
    assert.equal(await readFile(path.join(safeStateRoot, 'tasks/task.json'), 'utf8'), '{}');
    await assert.rejects(readFile(path.join(maliciousRoot, 'config/radarr/config.xml'), 'utf8'));
    await assert.rejects(readFile(path.join(maliciousRoot, 'state/tasks/task.json'), 'utf8'));
    assert.equal(readRuntimeConfig(databaseFile).CONFIG_ROOT, safeConfigRoot);
    assert.equal(readRuntimeConfig(databaseFile).STATE_ROOT, safeStateRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('encrypted restore bootstraps portable credentials and native Jellyfin data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-restore-encrypted-test-'));
  const appRoot = path.join(root, 'app');
  const configRoot = path.join(appRoot, 'config');
  const stateRoot = path.join(appRoot, 'state');
  const logRoot = path.join(appRoot, 'logs');
  const jellyfinConfigPath = path.join(root, 'jellyfin-native');
  const backupName = 'stackarr-backup-20260728-120000';
  const backupRootFixture = path.join(root, 'fixture', backupName);
  const plainArchivePath = path.join(root, `${backupName}.tar.gz`);
  const encryptedArchivePath = `${plainArchivePath}.enc`;
  const backupKeyPath = path.join(root, 'recovery.key');
  const composeEnvFile = path.join(root, 'compose.env');
  const databaseFile = path.join(root, 'stackarr.db');

  try {
    await mkdir(path.join(backupRootFixture, 'stackarr'), { recursive: true });
    await mkdir(path.join(backupRootFixture, 'jellyfin-native/config'), { recursive: true });
    await writeFile(
      path.join(backupRootFixture, 'manifest.txt'),
      'plex_backup_mode=lite\narchive_encryption=keyfile\n'
    );
    await writeFile(
      path.join(backupRootFixture, 'stackarr/runtime-config.json'),
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        runtimeConfig: {
          APP_ROOT: appRoot,
          CONFIG_ROOT: configRoot,
          STATE_ROOT: stateRoot,
          LOG_ROOT: logRoot,
          MEDIA_ROOT: path.join(appRoot, 'media'),
          MUSIC_ROOT: path.join(appRoot, 'media/Music'),
          DOWNLOADS_ROOT: path.join(appRoot, 'downloads'),
          BACKUP_ROOT: path.join(appRoot, 'backups'),
          JELLYFIN_INSTALL_MODE: 'native',
          JELLYFIN_CONFIG_PATH: jellyfinConfigPath,
          ROMM_STEAMGRIDDB_API_KEY: 'restored-romm-provider-key',
          STACKARR_WEB_ENABLED: 'true'
        }
      })
    );
    await writeFile(
      path.join(backupRootFixture, 'jellyfin-native/config/system.xml'),
      '<ApiKey>restored-jellyfin-key</ApiKey>'
    );
    await execFile('tar', ['-czf', plainArchivePath, '-C', path.join(root, 'fixture'), backupName]);
    await execFile(process.execPath, [backupCrypto, 'generate-key', '--key-file', backupKeyPath]);
    await execFile(
      'bash',
      [
        '-c',
        'node "$1" encrypt --key-file "$2" --output "$3" < "$4"',
        'bash',
        backupCrypto,
        backupKeyPath,
        encryptedArchivePath,
        plainArchivePath
      ],
      { cwd: repoRoot }
    );

    await execFile(
      'bash',
      [
        '-c',
        'docker(){ return 1; }; export -f docker; "$1" "$2" --yes --force-config --skip-postgres --skip-native-plex --skip-plex-preferences --restore-native-jellyfin --backup-key-file "$3" --adopt-backup-key',
        'bash',
        restoreScript,
        encryptedArchivePath,
        backupKeyPath
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
          STACKARR_DATABASE_FILE: databaseFile,
          STACKARR_DATABASE_URL: '',
          STACKARR_LOG_DATABASE_URL: '',
          HOME: path.join(root, 'home')
        }
      }
    );

    assert.equal(readRuntimeConfig(databaseFile).ROMM_STEAMGRIDDB_API_KEY, 'restored-romm-provider-key');
    assert.equal(
      await readFile(path.join(jellyfinConfigPath, 'config/system.xml'), 'utf8'),
      '<ApiKey>restored-jellyfin-key</ApiKey>'
    );
    assert.equal(
      await readFile(path.join(stateRoot, 'backup-encryption.key'), 'utf8'),
      await readFile(backupKeyPath, 'utf8')
    );
    assert.match(await readFile(composeEnvFile, 'utf8'), /^ROMM_STEAMGRIDDB_API_KEY="restored-romm-provider-key"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
