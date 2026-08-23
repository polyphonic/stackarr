import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getMediaServerSetupProfileAction, setupMediaServerAction } from '../../core/src/actions/setup.ts';

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsxLoader = path.join(repoRoot, 'packages/integration-tests/node_modules/tsx/dist/loader.mjs');

test('setup profile keeps Pulsarr user routing out of vanilla setup', () => {
  const profile = getMediaServerSetupProfileAction();
  const questionIds = profile.questions.map((question) => question.id);

  assert.deepEqual(
    profile.onboardingModes.map((mode) => mode.id),
    ['fresh', 'restore', 'migrate']
  );
  assert.equal(profile.onboardingModes.find((mode) => mode.id === 'restore')?.runTool, 'stackarr_restore_backup');
  assert.equal(
    profile.onboardingModes.find((mode) => mode.id === 'migrate')?.runTool,
    'stackarr_migrate_current_stack'
  );
  assert.ok(questionIds.includes('globalUsername'));
  assert.ok(questionIds.includes('globalPassword'));
  assert.ok(questionIds.includes('globalEmail'));
  assert.ok(questionIds.includes('musicRoot'));
  assert.ok(questionIds.includes('enable4kServarr'));
  assert.ok(questionIds.includes('enableRequestManagement'));
  assert.ok(questionIds.includes('requestManagers'));
  assert.ok(questionIds.includes('configureSeerr'));
  assert.ok(questionIds.includes('enabledServices'));
  assert.ok(questionIds.includes('maintainerrCleanupPresets'));
  assert.ok(questionIds.includes('movieProfilePreset'));
  assert.ok(questionIds.includes('tvProfilePreset'));
  assert.ok(questionIds.includes('musicProfilePreset'));
  assert.ok(!questionIds.includes('agentPluginIntegrations'));
  assert.ok(!questionIds.includes('pulsarrHdLiteUsers'));
  const requestManagersQuestion = profile.questions.find((question) => question.id === 'requestManagers');
  const mediaTypesQuestion = profile.questions.find((question) => question.id === 'enabledMediaTypes');
  const enabledServicesQuestion = profile.questions.find((question) => question.id === 'enabledServices');
  assert.deepEqual(requestManagersQuestion?.choices, ['seerr', 'pulsarr']);
  assert.deepEqual(requestManagersQuestion?.default, ['pulsarr']);
  assert.equal((mediaTypesQuestion?.choices as string[]).includes('photos'), true);
  assert.equal((mediaTypesQuestion?.choices as string[]).includes('games'), true);
  assert.ok(enabledServicesQuestion?.choices);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('seerr'), false);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('pulsarr'), false);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('maintainerr'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('cleanuparr'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('tracearr'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('immich'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('romm'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('questarr'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('youtarr'), true);
  assert.equal(profile.defaults.globalUsername, 'admin');
  assert.equal(profile.defaults.globalEmail, '');
  assert.equal(profile.defaults.databaseMode, 'app-default');
  assert.equal(profile.defaults.plexInstallMode, 'docker');
  assert.equal(profile.defaults.enable4kServarr, false);
  assert.equal(profile.defaults.movieProfilePreset, 'lite');
  assert.equal(profile.defaults.tvProfilePreset, 'lite');
  assert.equal(profile.defaults.musicProfilePreset, 'lossless');
  assert.equal(profile.defaults.enableRequestManagement, true);
  assert.equal(profile.defaults.enableSeerr, false);
  assert.equal(profile.defaults.configureSeerr, false);
  assert.equal(profile.defaults.enablePulsarr, true);
  assert.equal(profile.defaults.enableMaintainerr, false);
  assert.equal(profile.defaults.enableCleanuparr, false);
  assert.equal(profile.defaults.enableTracearr, false);
  assert.equal(profile.defaults.enableImmich, false);
  assert.equal(profile.defaults.enableRomm, false);
  assert.equal(profile.defaults.enableQuestarr, false);
  assert.equal(profile.defaults.enableYoutarr, false);
  assert.deepEqual(profile.defaults.maintainerrCleanupPresets, []);
  assert.equal(profile.defaults.backupRetentionCount, 52);
  assert.equal('pulsarrHdLiteUsers' in profile.defaults, false);
});

test('dry-run setup config carries shared credentials without personal Pulsarr routing', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    globalUsername: 'stackarr-admin',
    globalPassword: 'super-secret-password',
    globalEmail: 'admin@example.com'
  });

  assert.equal(result.accepted, false);
  assert.equal(result.plan.config.USERNAME, 'stackarr-admin');
  assert.equal(result.plan.config.PASSWORD, '********');
  assert.notEqual(result.plan.config.PASSWORD, 'super-secret-password');
  assert.equal(result.plan.config.USER_EMAIL, 'admin@example.com');
  assert.equal(result.plan.config.STACKARR_IMAGE, 'polyphonic/stackarr:alpha');
  assert.equal(result.plan.config.MUSIC_ROOT, `${result.plan.config.MEDIA_ROOT}/Music`);
  assert.equal(result.plan.config.ENABLE_4K_SERVARR, 'false');
  assert.equal(result.plan.config.BACKUP_SCHEDULE, 'weekly');
  assert.equal(result.plan.config.BACKUP_WEEKDAY, 'Sun');
  assert.equal(result.plan.config.BACKUP_RETENTION_COUNT, '52');
  assert.equal(result.plan.config.ENABLE_SCHEDULED_UPDATES, 'false');
  assert.equal(result.plan.config.UPDATE_TIME, '04:30');
  assert.equal(result.plan.config.UPDATE_WEEKDAY, 'Sun');
  assert.equal(result.plan.config.STACKARR_MOVIE_PROFILE_PRESET, 'lite');
  assert.equal(result.plan.config.STACKARR_MOVIE_DEFAULT_PROFILE, 'HD Lite');
  assert.equal(result.plan.config.STACKARR_TV_PROFILE_PRESET, 'lite');
  assert.equal(result.plan.config.STACKARR_TV_DEFAULT_PROFILE, 'HD Lite');
  assert.equal(result.plan.config.STACKARR_MUSIC_PROFILE_PRESET, 'lossless');
  assert.equal(result.plan.config.STACKARR_MUSIC_DEFAULT_PROFILE, 'Lossless');
  assert.equal(result.plan.config.ENABLE_SEERR, 'false');
  assert.equal(result.plan.config.STACKARR_CONFIGURE_SEERR, 'false');
  assert.equal(result.plan.config.ENABLE_PULSARR, 'true');
  assert.equal(result.plan.config.ENABLE_MAINTAINERR, 'false');
  assert.equal(result.plan.config.ENABLE_CLEANUPARR, 'false');
  assert.equal(result.plan.config.CLEANUPARR_IMAGE, 'ghcr.io/cleanuparr/cleanuparr:latest');
  assert.equal(result.plan.config.CLEANUPARR_URL, 'http://127.0.0.1:11011');
  assert.equal(result.plan.config.AGREGARR_IMAGE, 'agregarr/agregarr:latest');
  assert.equal(result.plan.config.AGREGARR_PLACEHOLDER_FOLDER, '_Trailers');
  assert.equal(result.plan.config.ENABLE_TRACEARR, 'false');
  assert.equal(result.plan.config.ENABLE_IMMICH, 'false');
  assert.equal(result.plan.config.ENABLE_ROMM, 'false');
  assert.equal(result.plan.config.ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS, '30');
  assert.equal(result.plan.config.ROMM_TGDB_API_ENABLED, 'false');
  assert.equal(result.plan.config.ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA, 'false');
  assert.equal(result.plan.config.ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON, '0 4 * * *');
  assert.equal(result.plan.config.MAINTAINERR_CLEANUP_PRESETS, '');
  assert.equal(result.plan.config.TRACEARR_JWT_SECRET, '********');
  assert.equal(result.plan.config.TRACEARR_COOKIE_SECRET, '********');
  assert.equal(result.plan.config.PULSARR_HD_LITE_USERS, undefined);
  assert.match(result.plan.notes.join('\n'), /Pulsarr first-run admin/i);
  assert.match(result.plan.notes.join('\n'), /Maintainerr is wired to the selected media server/i);
  assert.match(result.plan.notes.join('\n'), /Cleanuparr blocks malware-like executable and script files/i);
  assert.match(result.plan.notes.join('\n'), /Tracearr uses the shared Postgres\/TimescaleDB/i);
  assert.match(result.plan.notes.join('\n'), /Immich is optional photo-library functionality/i);
  assert.match(result.plan.notes.join('\n'), /RomM is optional private game-library functionality/i);
});

test('dry-run setup wires Cleanuparr as an optional download security service', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enabledServices: ['bazarr', 'tinymediamanager', 'lidarr', 'recyclarr', 'flaresolverr', 'tidarr', 'cleanuparr']
  });

  assert.equal(result.plan.config.ENABLE_CLEANUPARR, 'true');
  assert.equal(result.plan.config.CLEANUPARR_BIND_IP, '127.0.0.1');
  assert.equal(result.plan.config.CLEANUPARR_PORT, '11011');
  assert.equal(result.plan.config.CLEANUPARR_AUTO_CONFIGURE, 'true');
});

test('dry-run setup records Immich config for optional photo libraries', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    mediaRoot: '/srv/media',
    enabledMediaTypes: ['movies', 'tv', 'music', 'photos'],
    enabledServices: ['bazarr', 'tinymediamanager', 'lidarr', 'recyclarr', 'flaresolverr', 'tidarr', 'immich']
  });

  assert.equal(result.plan.config.ENABLE_IMMICH, 'true');
  assert.equal(result.plan.config.IMMICH_URL, 'http://127.0.0.1:2283');
  assert.equal(result.plan.config.IMMICH_UPLOAD_LOCATION, '/srv/media/Pictures');
  assert.equal(result.plan.config.IMMICH_EXTERNAL_LIBRARY_LOCATION, '');
  assert.equal(result.plan.config.IMMICH_DB_USERNAME, 'immich');
  assert.equal(result.plan.config.IMMICH_DB_DATABASE_NAME, 'immich');
  assert.equal(result.plan.config.IMMICH_DB_VECTOR_EXTENSION, 'pgvector');
  assert.equal(result.plan.config.IMMICH_DB_PASSWORD, '********');
});

test('dry-run setup records RomM config for optional private game libraries', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    mediaRoot: '/srv/media',
    enabledMediaTypes: ['movies', 'tv', 'music', 'games'],
    enabledServices: ['bazarr', 'tinymediamanager', 'lidarr', 'recyclarr', 'flaresolverr', 'tidarr', 'romm']
  });

  assert.equal(result.plan.config.ENABLE_ROMM, 'true');
  assert.equal(result.plan.config.ROMM_URL, 'http://127.0.0.1:7583');
  assert.equal(result.plan.config.ROMM_BIND_IP, '127.0.0.1');
  assert.equal(result.plan.config.GAMES_ROOT, '/srv/media/Games');
  assert.equal(result.plan.config.ROMM_LIBRARY_ROOT, '/srv/media/Games');
  assert.equal(result.plan.config.ROMM_STEAM_LIBRARY_ENABLED, 'false');
  assert.equal(result.plan.config.ROMM_STEAM_MAC_LIBRARY_ROOT, '');
  assert.equal(result.plan.config.ROMM_STEAM_WINDOWS_LIBRARY_ROOT, '');
  assert.equal(result.plan.config.ROMM_STEAM_LINUX_LIBRARY_ROOT, '');
  assert.equal(result.plan.config.ROMM_DB_DRIVER, 'postgresql');
  assert.equal(result.plan.config.ROMM_DB_HOST, 'database');
  assert.equal(result.plan.config.ROMM_DB_PORT, '5432');
  assert.equal(result.plan.config.ROMM_DB_NAME, 'romm');
  assert.equal(result.plan.config.ROMM_DB_USER, 'romm');
  assert.equal(result.plan.config.ROMM_DB_PASSWORD, '********');
  assert.equal(result.plan.config.ROMM_AUTH_SECRET_KEY, '********');
  assert.equal(result.plan.config.ROMM_REDIS_HOST, 'redis');
  assert.equal(result.plan.config.ROMM_REDIS_PORT, '6379');
  assert.equal(result.plan.config.ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE, 'false');
  assert.equal(result.plan.config.ROMM_RESCAN_ON_FILESYSTEM_CHANGE_DELAY, '5');
  assert.equal(result.plan.config.ROMM_AUTO_CONFIGURE, 'false');
  assert.equal(result.plan.config.ROMM_ADMIN_USERNAME, '');
  assert.equal(result.plan.config.ROMM_ADMIN_PASSWORD, '********');
  assert.equal(result.plan.config.ROMM_HASHEOUS_API_ENABLED, 'true');
});

test('dry-run setup shares RomM IGDB config with SQLite-backed Questarr', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    databaseMode: 'postgres',
    mediaRoot: '/srv/media',
    enabledMediaTypes: ['games'],
    enabledServices: ['romm', 'questarr'],
    rommIgdbClientId: 'igdb-client',
    rommIgdbClientSecret: 'igdb-secret'
  });

  assert.equal(result.plan.config.STACKARR_DATABASE_MODE, 'postgres');
  assert.equal(result.plan.config.ENABLE_QUESTARR, 'true');
  assert.equal(result.plan.config.QUESTARR_URL, 'http://127.0.0.1:7584');
  assert.equal(result.plan.config.QUESTARR_LIBRARY_ROOT, '/srv/media/Games');
  assert.equal(result.plan.config.QUESTARR_SQLITE_DB_PATH, '/app/data/sqlite.db');
  assert.equal(result.plan.config.QUESTARR_IGDB_CLIENT_ID, 'igdb-client');
  assert.equal(result.plan.config.QUESTARR_IGDB_CLIENT_SECRET, '********');
  assert.equal(result.plan.config.QUESTARR_JWT_SECRET, '********');
  assert.equal(result.plan.config.QUESTARR_IMAGE, 'ghcr.io/doezer/questarr:latest');
  assert.equal(Object.hasOwn(result.plan.config, 'QUESTARR_POSTGRES_DATABASE'), false);
});

test('dry-run setup keeps IGDB available when Questarr is enabled without RomM', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enabledServices: ['questarr'],
    rommMetadataPreset: 'quick',
    rommIgdbClientId: 'questarr-client',
    rommIgdbClientSecret: 'questarr-secret'
  });

  assert.equal(result.plan.config.ENABLE_ROMM, 'false');
  assert.equal(result.plan.config.ENABLE_QUESTARR, 'true');
  assert.equal(result.plan.config.ROMM_IGDB_CLIENT_ID, '');
  assert.equal(result.plan.config.ROMM_IGDB_CLIENT_SECRET, '********');
  assert.equal(result.plan.config.QUESTARR_IGDB_CLIENT_ID, 'questarr-client');
  assert.equal(result.plan.config.QUESTARR_IGDB_CLIENT_SECRET, '********');
});

test('dry-run setup provisions private authenticated Youtarr with a dedicated MariaDB service', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    mediaRoot: '/srv/media',
    plexInstallMode: 'docker',
    globalUsername: 'stackarr-admin',
    globalPassword: 'PortableYoutarrPassword',
    enabledServices: ['youtarr']
  });

  assert.equal(result.plan.config.ENABLE_YOUTARR, 'true');
  assert.equal(result.plan.config.YOUTARR_URL, 'http://127.0.0.1:3087');
  assert.equal(result.plan.config.YOUTARR_OUTPUT_ROOT, '/srv/media/Videos/YouTube');
  assert.equal(result.plan.config.YOUTARR_DB_HOST, 'youtarr-db');
  assert.equal(result.plan.config.YOUTARR_DB_PORT, '3306');
  assert.equal(result.plan.config.YOUTARR_DB_PASSWORD, '********');
  assert.equal(result.plan.config.YOUTARR_DB_ROOT_PASSWORD, '********');
  assert.equal(result.plan.config.YOUTARR_LOGIN_ENABLED, 'true');
  assert.equal(result.plan.config.YOUTARR_ADMIN_USERNAME, 'stackarr-admin');
  assert.equal(result.plan.config.YOUTARR_ADMIN_PASSWORD, '********');
  assert.equal(result.plan.config.YOUTARR_PLEX_URL, 'http://plex:32400');
  assert.equal(result.plan.config.YOUTARR_IMAGE, 'dialmaster/youtarr:latest');
  assert.equal(result.plan.config.YOUTARR_DB_IMAGE, 'mariadb:10.11');
});

test('dry-run setup enforces Youtarr credential limits before first run', async () => {
  const usernameResult = await setupMediaServerAction({
    dryRun: true,
    enabledServices: ['youtarr'],
    globalUsername: 'a'.repeat(33),
    globalPassword: 'PortablePassword'
  });
  const passwordResult = await setupMediaServerAction({
    dryRun: true,
    enabledServices: ['youtarr'],
    globalUsername: 'stackarr-admin',
    globalPassword: 'a'.repeat(65)
  });

  assert.match(usernameResult.error ?? '', /at most 32 characters when Youtarr is enabled/);
  assert.match(passwordResult.error ?? '', /at most 64 characters when Youtarr is enabled/);
});

test('dry-run setup records Maintainerr cleanup preset ideas for the wired service', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enabledServices: ['bazarr', 'tinymediamanager', 'lidarr', 'recyclarr', 'flaresolverr', 'tidarr', 'maintainerr'],
    maintainerrCleanupPresets: ['watched-movies', 'stale-requests']
  });

  assert.equal(result.plan.config.ENABLE_MAINTAINERR, 'true');
  assert.equal(result.plan.config.MAINTAINERR_CLEANUP_PRESETS, 'watched-movies,stale-requests');
  assert.equal(result.plan.config.MAINTAINERR_URL, 'http://127.0.0.1:6246');
});

test('dry-run setup records Tracearr config for the monitoring service', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enabledServices: ['bazarr', 'tinymediamanager', 'lidarr', 'recyclarr', 'flaresolverr', 'tidarr', 'tracearr']
  });

  assert.equal(result.plan.config.ENABLE_TRACEARR, 'true');
  assert.equal(result.plan.config.TRACEARR_URL, 'http://127.0.0.1:3000');
  assert.equal(result.plan.config.TRACEARR_AUTO_CONFIGURE, 'true');
  assert.equal(result.plan.config.TRACEARR_ADMIN_PASSWORD, '********');
  assert.equal(result.plan.config.TRACEARR_CLAIM_CODE, '********');
  assert.equal(result.plan.config.TRACEARR_JWT_SECRET, '********');
  assert.equal(result.plan.config.TRACEARR_COOKIE_SECRET, '********');
  assert.equal(result.plan.config.TRACEARR_DB_PASSWORD, result.plan.config.DATABASE_SUPERUSER_PASSWORD);
  assert.equal(result.plan.config.TRACEARR_POSTGRES_DATABASE, 'tracearr');
  assert.equal(result.plan.config.TRACEARR_POSTGRES_USER, 'tracearr');
  assert.equal(result.plan.config.TRACEARR_POSTGRES_PASSWORD, '********');
  assert.equal(result.plan.config.DATABASE_IMAGE, 'timescale/timescaledb-ha:pg18.1-ts2.25.0');
  assert.equal(result.plan.config.DATABASE_PGDATA, '/var/lib/postgresql/data');
  assert.equal(result.plan.config.REDIS_IMAGE, 'redis:8.8.0-alpine');
});

test('dry-run setup lets music root differ from media root', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    mediaRoot: '/srv/media',
    musicRoot: '/srv/music-library'
  });

  assert.equal(result.accepted, false);
  assert.equal(result.plan.config.MEDIA_ROOT, '/srv/media');
  assert.equal(result.plan.config.MUSIC_ROOT, '/srv/music-library');
});

test('dry-run setup safely accepts global passwords that need connection-string escaping', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    globalPassword: `valid://pass:word $with 'quotes'`
  });

  assert.equal(result.accepted, false);
  assert.equal(result.error, undefined);
  assert.equal(result.plan.config.PASSWORD, '********');
  assert.match(result.plan.config.TRACEARR_DATABASE_URL ?? '', /postgres:\/\/tracearr:\*{8}@database:5432\/tracearr/);
});

test('dry-run setup rejects invalid and oversized global usernames', async () => {
  const invalid = await setupMediaServerAction({ dryRun: true, globalUsername: 'not valid' });
  const oversized = await setupMediaServerAction({ dryRun: true, globalUsername: 'a'.repeat(65) });

  assert.match(invalid.error ?? '', /may only use letters, numbers, dot, underscore, and hyphen/);
  assert.match(oversized.error ?? '', /64 characters or fewer/);
});

test('confirmed setup does not mark onboarding complete when a setup command fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stackarr-setup-failure-test-'));
  const fakeRepoRoot = path.join(root, 'repo');
  const fakeBinDir = path.join(fakeRepoRoot, 'bin');
  const fakeStackarr = path.join(fakeBinDir, 'stackarr');

  try {
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(fakeStackarr, '#!/bin/sh\nexit 42\n');
    await chmod(fakeStackarr, 0o755);

    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        tsxLoader,
        '--input-type=module',
        '-e',
        `
          const { setupMediaServerAction } = await import('./packages/core/src/actions/setup.ts');
          const { readSettings } = await import('./packages/core/src/settings.ts');

          const result = await setupMediaServerAction({
            dryRun: false,
            confirmSetup: true,
            startStack: true,
            configureServices: false,
            applyPresets: false,
            installBackup: false,
            installUpdates: false,
            openBrowser: false,
            globalPassword: 'Portable435'
          });

          console.log(JSON.stringify({ result, setup: readSettings().setup }));
        `
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          STACKARR_DATABASE_FILE: path.join(root, 'stackarr.db'),
          STACKARR_REPO_ROOT: fakeRepoRoot
        }
      }
    );

    const { result, setup } = JSON.parse(stdout);
    assert.equal(result.accepted, true);
    assert.equal(result.completed, false);
    assert.equal(setup.installMode, 'fresh');
    assert.equal(setup.onboardingComplete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dry-run setup can place supported apps in shared Postgres mode', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    databaseMode: 'postgres',
    globalPassword: 'Portable435'
  });

  assert.equal(result.accepted, false);
  assert.equal(result.plan.config.STACKARR_DATABASE_MODE, 'postgres');
  assert.equal(result.plan.config.DATABASE_HOST_PORT, '5433');
  assert.equal(result.plan.config.BAZARR_POSTGRES_ENABLED, 'true');
  assert.equal(result.plan.config.PULSARR_DB_TYPE, 'postgres');
  assert.equal(result.plan.config.PROWLARR_POSTGRES_HOST, 'database');
  assert.equal(result.plan.config.SONARR_POSTGRES_HOST, 'database');
  assert.equal(result.plan.config.RADARR_POSTGRES_HOST, 'database');
  assert.equal(result.plan.config.LIDARR_POSTGRES_HOST, 'database');
  assert.match(
    result.plan.config.STACKARR_DATABASE_URL ?? '',
    /postgres:\/\/stackarr:\*{8}@database:5432\/stackarr-main/
  );
  assert.match(
    result.plan.config.STACKARR_LOG_DATABASE_URL ?? '',
    /postgres:\/\/stackarr:\*{8}@database:5432\/stackarr-log/
  );
});

test('dry-run setup can enable the separate 4K Arr instances', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enable4kServarr: true
  });

  assert.equal(result.plan.config.ENABLE_4K_SERVARR, 'true');
});

test('dry-run setup can disable the separate 4K Arr instances', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enable4kServarr: false
  });

  assert.equal(result.plan.config.ENABLE_4K_SERVARR, 'false');
});

test('dry-run setup maps profile presets and clears inactive 4K defaults', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    movieProfilePreset: 'balanced',
    movie4kProfilePreset: 'balanced',
    tvProfilePreset: 'balanced',
    tv4kProfilePreset: 'balanced',
    musicProfilePreset: 'lossy'
  });

  assert.equal(result.plan.config.STACKARR_MOVIE_DEFAULT_PROFILE, 'HD');
  assert.equal(result.plan.config.STACKARR_MOVIE_4K_DEFAULT_PROFILE, '');
  assert.equal(result.plan.config.STACKARR_TV_DEFAULT_PROFILE, 'HD');
  assert.equal(result.plan.config.STACKARR_TV_4K_DEFAULT_PROFILE, '');
  assert.equal(result.plan.config.STACKARR_MUSIC_DEFAULT_PROFILE, 'Lossy 256+');
});

test('dry-run setup maps 4K profile presets when separate 4K Arrs are enabled', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enable4kServarr: true,
    movie4kProfilePreset: 'balanced',
    tv4kProfilePreset: 'balanced'
  });

  assert.equal(result.plan.config.STACKARR_MOVIE_4K_DEFAULT_PROFILE, '4K');
  assert.equal(result.plan.config.STACKARR_TV_4K_DEFAULT_PROFILE, '4K');
});

test('dry-run setup disables request managers when request management is off', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    enableRequestManagement: false
  });

  assert.equal(result.plan.config.ENABLE_SEERR, 'false');
  assert.equal(result.plan.config.STACKARR_CONFIGURE_SEERR, 'false');
  assert.equal(result.plan.config.ENABLE_PULSARR, 'false');
});

test('dry-run setup keeps Pulsarr off when Jellyfin is selected without Plex', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    plexInstallMode: 'disabled',
    jellyfinInstallMode: 'docker',
    requestManagers: ['pulsarr']
  });

  assert.equal(result.plan.config.ENABLE_SEERR, 'true');
  assert.equal(result.plan.config.STACKARR_CONFIGURE_SEERR, 'false');
  assert.equal(result.plan.config.ENABLE_PULSARR, 'false');
});

test('dry-run setup supports an Immich-only homelab without media-stack dependencies', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    plexInstallMode: 'disabled',
    jellyfinInstallMode: 'disabled',
    enabledMediaTypes: ['photos'],
    enabledServices: ['immich', 'bazarr', 'tinymediamanager', 'recyclarr', 'flaresolverr', 'maintainerr', 'tracearr'],
    requestManagers: ['seerr', 'pulsarr']
  });

  assert.equal(result.plan.config.ENABLE_IMMICH, 'true');
  assert.equal(result.plan.config.ENABLE_MOVIES, 'false');
  assert.equal(result.plan.config.ENABLE_TV_SHOWS, 'false');
  assert.equal(result.plan.config.ENABLE_SEERR, 'false');
  assert.equal(result.plan.config.ENABLE_PULSARR, 'false');
  assert.equal(result.plan.config.ENABLE_BAZARR, 'false');
  assert.equal(result.plan.config.ENABLE_TINYMEDIAMANAGER, 'false');
  assert.equal(result.plan.config.ENABLE_RECYCLARR, 'false');
  assert.equal(result.plan.config.ENABLE_FLARESOLVERR, 'false');
  assert.equal(result.plan.config.ENABLE_MAINTAINERR, 'false');
  assert.equal(result.plan.config.ENABLE_TRACEARR, 'false');
});

test('dry-run setup wires Seerr only when explicitly requested', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    requestManagers: ['seerr'],
    configureSeerr: true
  });

  assert.equal(result.plan.config.ENABLE_SEERR, 'true');
  assert.equal(result.plan.config.STACKARR_CONFIGURE_SEERR, 'true');
  assert.ok(result.plan.commands.some((command) => command.name === 'stackarr requests apply'));
});

test('dry-run setup stays Docker-native and leaves chat clients on the host', async () => {
  const result = await setupMediaServerAction({ dryRun: true });
  const commandNames = result.plan.commands.map((command) => command.name);

  assert.ok(!commandNames.includes('stackarr startup install'));
  assert.ok(!commandNames.some((name) => name.startsWith('stackarr plugins install')));
  assert.equal(result.plan.config.PLEX_INSTALL_MODE, 'docker');
});

test('configure script bootstraps Pulsarr but does not create personal router rules for new users', async () => {
  const configure = await readFile(new URL('../../../stackarr/scripts/configure.sh', import.meta.url), 'utf8');
  const agregarrConfigure = await readFile(
    new URL('../../../stackarr/scripts/agregarr-configure.py', import.meta.url),
    'utf8'
  );
  const cleanuparrConfigure = await readFile(
    new URL('../../../stackarr/scripts/cleanuparr-configure.py', import.meta.url),
    'utf8'
  );
  const common = await readFile(new URL('../../../stackarr/lib/common.sh', import.meta.url), 'utf8');
  const compose = await readFile(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');
  const downloadClientDocs = await readFile(
    new URL('../../../apps/docs/content/docs/settings/download-clients.mdx', import.meta.url),
    'utf8'
  );
  const databaseInit = await readFile(new URL('../../../stackarr/scripts/database-init.sh', import.meta.url), 'utf8');

  assert.match(configure, /configure_pulsarr_stack\(\)/);
  assert.match(configure, /PlexOnlineMail/);
  assert.match(configure, /PlexOnlineToken/);
  assert.match(configure, /\/v1\/users\/create-admin/);
  assert.match(configure, /\/v1\/config/);
  assert.match(configure, /migrate_pulsarr_user_router_rules/);
  assert.match(configure, /\/v1\/content-router\/rules/);
  const requests = await readFile(new URL('../../../stackarr/scripts/requests.sh', import.meta.url), 'utf8');
  assert.match(requests, /optional_service_enabled seerr/);
  assert.match(configure, /Radarr HD profile configured[\s\S]*WEB 720p/);
  assert.match(configure, /Sonarr HD profile configured[\s\S]*DVD/);
  assert.match(configure, /Radarr HD Lite profile configured[\s\S]*HDTV-1080p,WEB 1080p,Bluray-1080p/);
  assert.match(configure, /Sonarr HD Lite profile configured[\s\S]*WEB 1080p,Bluray-1080p/);
  assert.match(configure, /RADARR_DCP_REGEX=/);
  assert.match(configure, /RADARR_NON_DCP_HDTV_SCORE="-100000"/);
  assert.match(configure, /Radarr DCP custom format configured/);
  assert.match(configure, /'minimumAvailability': 'inCinemas'/);
  assert.match(configure, /Radarr HD Lite profile safeguards configured[\s\S]*DCP Rip:\$\{RADARR_DCP_SCORE\}/);
  assert.match(configure, /Radarr 4K Lite profile safeguards configured[\s\S]*DCP Rip:\$\{RADARR_DCP_SCORE\}/);
  assert.match(downloadClientDocs, /Early DCP Movie Releases/);
  assert.match(downloadClientDocs, /Non-DCP HDTV/);
  assert.match(configure, /quality_definition_block/);
  assert.match(configure, /WEBDL-1080p", 8, 95, 72/);
  assert.match(configure, /configure_recyclarr_template "\$sonarr_hd_file"[\s\S]*"\$STACKARR_TV_PROFILE_PRESET"/);
  assert.match(configure, /rm -f[\s\S]*hd-bluray-web\.yml[\s\S]*web-2160p\.yml/);
  assert.match(configure, /PULSARR_DISCOVERED_API_KEY_FILE/);
  assert.match(configure, /\/v1\/api-keys\/api-keys/);
  assert.match(configure, /SAVED_API_KEY = os\.environ\.get\('PULSARR_API_KEY'/);
  assert.match(configure, /Pulsarr authenticated with its saved Stackarr agent key/);
  assert.match(configure, /neither the saved agent key nor admin login was accepted/);
  assert.equal(configure.match(/'searchOnAdd': True/g)?.length, 2);
  assert.doesNotMatch(configure, /'searchOnAdd': False/);
  assert.match(configure, /'createSeasonFolders': SEASON_FOLDERS_ENABLED/);
  assert.doesNotMatch(configure, /'createSeasonFolders': False/);
  assert.match(configure, /"enableSeasonFolders":\$\{season_folders\}/);
  assert.doesNotMatch(configure, /"enableSeasonFolders":true/);
  assert.match(agregarrConfigure, /"enableSeasonFolders": season_folders_enabled/);
  assert.match(agregarrConfigure, /placeholderMovieRootFolders/);
  assert.match(agregarrConfigure, /AGREGARR_PLACEHOLDER_FOLDER/);
  assert.match(agregarrConfigure, /_Trailers/);
  assert.match(agregarrConfigure, /FILTERED_HUB_SUBTYPES/);
  assert.match(agregarrConfigure, /NEW_RELEASES_HUB_IDENTIFIERS/);
  assert.match(agregarrConfigure, /"movie": "New Movies"/);
  assert.match(agregarrConfigure, /"show": "New Episodes"/);
  assert.match(agregarrConfigure, /configure_new_releases/);
  assert.match(agregarrConfigure, /place_new_releases_first/);
  assert.match(agregarrConfigure, /update_plex_collection_title/);
  assert.match(agregarrConfigure, /title\.value/);
  assert.match(agregarrConfigure, /"subtype": "recently_released"/);
  assert.match(agregarrConfigure, /episode\.originallyAvailableAt:desc/);
  assert.match(agregarrConfigure, /"\/reorder"/);
  assert.match(agregarrConfigure, /\/discovery\/hubs\/scan/);
  assert.match(agregarrConfigure, /\/defaulthubs\/\{hub\['id'\]\}\/settings/);
  assert.match(agregarrConfigure, /\/settings\/jobs\/plex-collections-sync\/run/);
  assert.doesNotMatch(agregarrConfigure, /for collection_id in \[\*collection_ids, \*filtered_hub_ids\]/);
  assert.match(configure, /media_config\['skipFolder'\]/);
  assert.match(configure, /AGREGARR_PLACEHOLDER_FOLDER="\$\{AGREGARR_PLACEHOLDER_FOLDER:-_Trailers\}"/);
  assert.match(configure, /RADARR_DEFAULT_PROFILE/);
  assert.match(configure, /LIDARR_DEFAULT_PROFILE/);
  assert.ok(configure.includes('Season[ ._-]?\\\\d{1,2}'));
  assert.match(configure, /configure_pulsarr_stack \|\| true/);
  assert.match(configure, /configure_maintainerr_stack \|\| true/);
  assert.match(configure, /configure_cleanuparr_stack \|\| true/);
  assert.match(configure, /persist_runtime_api_key "PROWLARR_API_KEY" "\$PROWLARR_KEY"/);
  assert.match(configure, /persist_runtime_api_key "RADARR_API_KEY" "\$RADARR_KEY"/);
  assert.match(configure, /persist_runtime_api_key "SONARR_API_KEY" "\$SONARR_KEY"/);
  assert.match(configure, /persist_runtime_api_key "LIDARR_API_KEY" "\$LIDARR_KEY"/);
  assert.match(configure, /persist_runtime_api_key "BAZARR_API_KEY" "\$BAZARR_KEY"/);
  assert.match(configure, /persist_runtime_api_key "TIDARR_API_KEY" "\$TIDARR_KEY"/);
  assert.match(configure, /persist_runtime_api_key "PLEX_TOKEN" "\$PLEX_OWNER_TOKEN"/);
  assert.match(configure, /persist_runtime_api_key "SEERR_API_KEY" "\$SEERR_KEY"/);
  assert.match(configure, /field\.get\("value"\) != 3/);
  assert.match(configure, /Prowlarr 1337x indexer configured/);
  assert.doesNotMatch(configure, /disable_prowlarr_indexer/);
  assert.doesNotMatch(configure, /Prowlarr The Pirate Bay indexer configured/);
  assert.match(configure, /secure_runtime_secret_modes/);
  assert.match(configure, /chmod 600/);
  assert.match(cleanuparrConfigure, /\/api\/configuration\/malware_blocker/);
  assert.match(cleanuparrConfigure, /\*\.exe/);
  assert.match(cleanuparrConfigure, /\/config\/stackarr-malware-blocklist\.txt/);
  assert.match(cleanuparrConfigure, /deleteIfAnyFileBlocked/);
  assert.match(configure, /Maintainerr first-run setup is complete/);
  assert.match(configure, /Maintainerr cleanup preset ideas recorded/);
  assert.match(configure, /optional_service_enabled tracearr/);
  assert.match(configure, /configure_tracearr_stack \|\| true/);
  assert.match(configure, /TRACEARR_DISCOVERED_API_KEY_FILE/);
  assert.match(configure, /\/settings\/api-key\/regenerate/);
  assert.match(configure, /configure_tinymediamanager_api \|\| true/);
  assert.match(configure, /config\['enableHttpServer'\] = True/);
  assert.match(configure, /configure_romm_stack \|\| true/);
  assert.match(configure, /RomM setup is manual/);
  assert.doesNotMatch(configure, /\/api\/users/);
  assert.doesNotMatch(configure, /romm_csrftoken/);
  assert.doesNotMatch(configure, /x-csrftoken/);
  assert.match(common, /optional_service_enabled.*immich/s);
  assert.match(configure, /API = '\/api\/v1'/);
  assert.match(configure, /request\('GET', '\/setup\/status'/);
  assert.match(configure, /request\('POST', '\/servers', payload, token=token/);
  assert.match(configure, /'type': 'plex'[\s\S]*'token': token/);
  assert.match(configure, /Tracearr auto-configuration disabled/);
  assert.match(
    compose,
    /DATABASE_URL: \$\{TRACEARR_DATABASE_URL:-postgres:\/\/tracearr:stackarr@database:5432\/tracearr\}/
  );
  assert.match(compose, /REDIS_URL: redis:\/\/redis:6379/);
  assert.match(compose, /container_name: redis/);
  assert.match(compose, /image: \$\{REDIS_IMAGE:-redis:8\.8\.0-alpine\}/);
  assert.doesNotMatch(compose, /container_name: database-init/);
  assert.match(common, /stackarr_compose --profile database up -d --wait database/);
  assert.match(common, /stackarr_compose --profile database exec -T/);
  assert.match(compose, /\$\{PROWLARR_BIND_IP:-127\.0\.0\.1\}:9696:9696/);
  assert.match(compose, /\$\{RADARR_BIND_IP:-127\.0\.0\.1\}:7878:7878/);
  assert.match(compose, /\$\{SONARR_BIND_IP:-127\.0\.0\.1\}:8989:8989/);
  assert.match(compose, /\$\{BAZARR_BIND_IP:-127\.0\.0\.1\}:6767:6767/);
  assert.match(compose, /\$\{LIDARR_BIND_IP:-127\.0\.0\.1\}:8686:8686/);
  assert.match(compose, /\$\{TIDARR_BIND_IP:-127\.0\.0\.1\}:8484:8484/);
  assert.match(compose, /container_name: immich/);
  assert.match(compose, /container_name: cleanuparr/);
  assert.match(compose, /image: \$\{CLEANUPARR_IMAGE:-ghcr\.io\/cleanuparr\/cleanuparr:latest\}/);
  assert.match(compose, /\$\{CLEANUPARR_BIND_IP:-127\.0\.0\.1\}:\$\{CLEANUPARR_PORT:-11011\}:11011/);
  assert.match(compose, /\$\{APP_ROOT:-\.\/\.stackarr\}\/config\/cleanuparr:\/config/);
  assert.match(compose, /container_name: immich-ml/);
  assert.match(compose, /IMMICH_MACHINE_LEARNING_URL: http:\/\/immich-ml:3003/);
  assert.match(compose, /\$\{IMMICH_UPLOAD_LOCATION:-\.\/\.stackarr\/media\/Pictures\}:\/data/);
  assert.match(compose, /\$\{IMMICH_EXTERNAL_LIBRARY_LOCATION:-immich-external\}:\/external:ro/);
  assert.match(compose, /^  immich-external:$/m);
  assert.match(compose, /DB_HOSTNAME: database/);
  assert.match(compose, /REDIS_HOSTNAME: redis/);
  assert.doesNotMatch(compose, /container_name: immich-postgres/);
  assert.doesNotMatch(compose, /container_name: immich-redis/);
  assert.match(compose, /ROMM_DB_DRIVER: \$\{ROMM_DB_DRIVER:-postgresql\}/);
  assert.match(compose, /DB_HOST: \$\{ROMM_DB_HOST:-database\}/);
  assert.match(compose, /REDIS_HOST: \$\{ROMM_REDIS_HOST:-redis\}/);
  assert.match(compose, /REDIS_PORT: \$\{ROMM_REDIS_PORT:-6379\}/);
  assert.match(compose, /ENABLE_RESCAN_ON_FILESYSTEM_CHANGE: \$\{ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE:-false\}/);
  assert.match(compose, /ENABLE_SCHEDULED_RESCAN: "true"/);
  assert.doesNotMatch(compose, /\n  romm-scheduler:/);
  assert.doesNotMatch(compose, /container_name: mariadb/);
  assert.doesNotMatch(compose, /container_name: romm-db/);
  assert.match(databaseInit, /ensure_app_database "\$\{TRACEARR_POSTGRES_DATABASE:-tracearr\}"/);
  assert.match(databaseInit, /ensure_app_database "\$\{IMMICH_DB_DATABASE_NAME:-immich\}"/);
  assert.match(databaseInit, /ensure_app_database "\$\{ROMM_DB_NAME:-romm\}"/);
  assert.doesNotMatch(compose, /tracearr-timescale/);
  assert.doesNotMatch(compose, /tracearr-redis/);
  assert.doesNotMatch(configure, /HD Lite watchlist users/);
  assert.doesNotMatch(configure, /PULSARR_HD_LITE_USERS/);
  assert.doesNotMatch(common, /PULSARR_HD_LITE_USERS/);
  assert.match(configure, /Monitoring state is intentionally owned by Sonarr\/Radarr/);
  assert.doesNotMatch(configure, /apply_movie_monitoring_policy "Radarr/);
  assert.doesNotMatch(configure, /apply_series_monitoring_policy "Sonarr/);
});

test('Lidarr keeps automatic completed-download handling off while allowing managed library rescans', async () => {
  const compose = await readFile(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');
  const configure = await readFile(new URL('../../../stackarr/scripts/configure.sh', import.meta.url), 'utf8');
  const downloads = await readFile(new URL('../../../stackarr/scripts/downloads.sh', import.meta.url), 'utf8');

  assert.match(compose, /\$\{MUSIC_ROOT:-\.\/\.stackarr\/media\/Music\}:\/music"/);
  assert.match(configure, /Lidarr completed download handling disabled[\s\S]*"\$LIDARR_KEY" false/);
  assert.match(downloads, /Lidarr completed download handling disabled[\s\S]*"\$wait_for_ready" false/);
  assert.doesNotMatch(configure, /Lidarr completed download handling enabled/);
});

test('Stackarr dashboard uses mounted runtime config inside Docker', async () => {
  const compose = await readFile(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');

  assert.match(compose, /^name: \$\{STACKARR_COMPOSE_PROJECT_NAME:-stackarr\}$/m);
  assert.match(compose, /STACKARR_REPO_ROOT: \/app/);
  assert.match(compose, /STACKARR_DATABASE_FILE: \/stackarr-config\/stackarr\.db/);
  assert.match(compose, /\$\{STACKARR_DATABASE_DIR:-\.\/\.stackarr\/config\}:\/stackarr-config/);
  assert.match(compose, /^  app:$/m);
  assert.match(compose, /container_name: app/);
  assert.doesNotMatch(compose, /STACKARR_DATABASE_FILE: \$\{STACKARR_DATABASE_FILE/);
  assert.doesNotMatch(compose, /\.\.:\/stackarr-workspace/);
});

test('docs development services use one stable project and are removed when the server exits', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../../../apps/docs/package.json', import.meta.url), 'utf8')
  ) as { scripts: Record<string, string> };
  const devScript = await readFile(new URL('../../../apps/docs/scripts/dev.sh', import.meta.url), 'utf8');

  assert.equal(packageJson.scripts.dev, 'bash scripts/dev.sh');
  assert.match(packageJson.scripts['services:up'], /--project-name stackarr-dev/);
  assert.match(packageJson.scripts['services:down'], /down --remove-orphans/);
  assert.match(devScript, /--project-name stackarr-dev/);
  assert.match(devScript, /trap cleanup EXIT/);
  assert.match(devScript, /docs_compose down --remove-orphans/);
});
