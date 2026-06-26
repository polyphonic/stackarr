import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const migrateScript = path.join(repoRoot, 'stackarr/scripts/migrate.sh');
const dockerInspectHelper = path.join(repoRoot, 'stackarr/scripts/migrate-docker-inspect.cjs');

function readJsonSetting(filePath: string, key: string) {
  const db = new DatabaseSync(filePath);

  try {
    const row = db.prepare('select value from app_settings where key = ?').get(key) as { value?: string } | undefined;

    return row?.value ? JSON.parse(row.value) : {};
  } finally {
    db.close();
  }
}

test('migration Docker inspect helper maps supported containers and skips Stackarr-owned services', async () => {
  const radarrInspect = [
    {
      Name: '/movie-radarr-uhd',
      Config: {
        Image: 'lscr.io/linuxserver/radarr:latest',
        Labels: {}
      },
      Mounts: [{ Destination: '/config' }]
    }
  ];
  const result = spawnSync('node', [dockerInspectHelper], {
    input: JSON.stringify(radarrInspect),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'radarr4k|/config');

  const skipped = spawnSync('node', [dockerInspectHelper], {
    input: JSON.stringify([
      {
        Name: '/radarr',
        Config: {
          Image: 'lscr.io/linuxserver/radarr:latest',
          Labels: { 'com.docker.compose.project': 'stackarr' }
        },
        Mounts: [{ Destination: '/config' }]
      }
    ]),
    encoding: 'utf8'
  });

  assert.notEqual(skipped.status, 0);
});

test('migration plans and copies supported service config from a conventional source root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-migrate-test-'));
  const sourceRoot = path.join(root, 'source');
  const appRoot = path.join(root, 'app');
  const configRoot = path.join(appRoot, 'config');
  const stateRoot = path.join(appRoot, 'state');
  const logRoot = path.join(appRoot, 'logs');
  const databaseFile = path.join(root, 'stackarr.db');
  const composeEnvFile = path.join(root, 'compose.env');

  try {
    await mkdir(path.join(sourceRoot, 'config/radarr'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'config/sonarr-uhd'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'config/qbittorrent/qBittorrent'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'config/radarr/config.xml'), '<Config><ApiKey>radarr-key</ApiKey></Config>');
    await writeFile(
      path.join(sourceRoot, 'config/sonarr-uhd/config.xml'),
      '<Config><ApiKey>sonarr4k-key</ApiKey></Config>'
    );
    await writeFile(path.join(sourceRoot, 'config/qbittorrent/qBittorrent/qBittorrent.conf'), '[Preferences]\n');

    const env = {
      ...process.env,
      APP_ROOT: appRoot,
      CONFIG_ROOT: configRoot,
      STATE_ROOT: stateRoot,
      LOG_ROOT: logRoot,
      BACKUP_ROOT: path.join(appRoot, 'backups'),
      MEDIA_ROOT: path.join(appRoot, 'media'),
      DOWNLOADS_ROOT: path.join(appRoot, 'downloads'),
      STACKARR_DATABASE_FILE: databaseFile,
      STACKARR_COMPOSE_ENV_FILE: composeEnvFile,
      HOME: path.join(root, 'home')
    };

    const { stdout: plan } = await execFile(
      'bash',
      [
        '-c',
        'docker(){ return 1; }; export -f docker; "$1" plan --source-root "$2"',
        'bash',
        migrateScript,
        sourceRoot
      ],
      { cwd: repoRoot, env }
    );

    assert.match(plan, /MIGRATE radarr/);
    assert.match(plan, /MIGRATE sonarr4k/);
    assert.match(plan, /MIGRATE qbittorrent/);

    await execFile(
      'bash',
      [
        '-c',
        'docker(){ return 1; }; export -f docker; "$1" run --source-root "$2" --yes',
        'bash',
        migrateScript,
        sourceRoot
      ],
      { cwd: repoRoot, env }
    );

    assert.equal(
      await readFile(path.join(configRoot, 'radarr/config.xml'), 'utf8'),
      '<Config><ApiKey>radarr-key</ApiKey></Config>'
    );
    assert.equal(
      await readFile(path.join(configRoot, 'sonarr4k/config.xml'), 'utf8'),
      '<Config><ApiKey>sonarr4k-key</ApiKey></Config>'
    );
    assert.equal(
      await readFile(path.join(configRoot, 'qbittorrent/qBittorrent/qBittorrent.conf'), 'utf8'),
      '[Preferences]\n'
    );

    const runtimeConfig = readJsonSetting(databaseFile, 'stackarr.runtimeConfig');
    assert.equal(runtimeConfig.ENABLE_MOVIES, 'true');
    assert.equal(runtimeConfig.ENABLE_TV_SHOWS, 'true');
    assert.equal(runtimeConfig.ENABLE_4K_SERVARR, 'true');
    assert.equal(runtimeConfig.PREFERRED_TORRENT_CLIENT, 'qbittorrent');
    assert.equal(runtimeConfig.RADARR_API_KEY, 'radarr-key');
    assert.equal(runtimeConfig.SONARR4K_API_KEY, 'sonarr4k-key');
    assert.equal(readJsonSetting(databaseFile, 'stackarr.settings').setup.onboardingComplete, true);
    assert.match(await readFile(composeEnvFile, 'utf8'), /^ENABLE_4K_SERVARR="true"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
