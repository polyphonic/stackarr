import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getMediaServerSetupProfileAction, setupMediaServerAction } from '../../core/src/actions/setup.ts';

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
  assert.ok(questionIds.includes('agentPluginIntegrations'));
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
  assert.equal((enabledServicesQuestion.choices as string[]).includes('tracearr'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('immich'), true);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('romm'), true);
  assert.equal(profile.defaults.globalUsername, 'admin');
  assert.equal(profile.defaults.globalEmail, '');
  assert.equal(profile.defaults.databaseMode, 'app-default');
  assert.equal(profile.defaults.enable4kServarr, false);
  assert.equal(profile.defaults.movieProfilePreset, 'lite');
  assert.equal(profile.defaults.tvProfilePreset, 'lite');
  assert.equal(profile.defaults.musicProfilePreset, 'lossless');
  assert.equal(profile.defaults.enableRequestManagement, true);
  assert.equal(profile.defaults.enableSeerr, false);
  assert.equal(profile.defaults.configureSeerr, false);
  assert.equal(profile.defaults.enablePulsarr, true);
  assert.equal(profile.defaults.enableMaintainerr, false);
  assert.equal(profile.defaults.enableTracearr, false);
  assert.equal(profile.defaults.enableImmich, false);
  assert.equal(profile.defaults.enableRomm, false);
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
  assert.equal(result.plan.config.ENABLE_TRACEARR, 'false');
  assert.equal(result.plan.config.ENABLE_IMMICH, 'false');
  assert.equal(result.plan.config.ENABLE_ROMM, 'false');
  assert.equal(result.plan.config.MAINTAINERR_CLEANUP_PRESETS, '');
  assert.equal(result.plan.config.TRACEARR_JWT_SECRET, '********');
  assert.equal(result.plan.config.TRACEARR_COOKIE_SECRET, '********');
  assert.equal(result.plan.config.PULSARR_HD_LITE_USERS, undefined);
  assert.match(result.plan.notes.join('\n'), /Pulsarr first-run admin/i);
  assert.match(result.plan.notes.join('\n'), /Maintainerr is wired to the selected media server/i);
  assert.match(result.plan.notes.join('\n'), /Tracearr uses the shared Postgres\/TimescaleDB/i);
  assert.match(result.plan.notes.join('\n'), /Immich is optional photo-library functionality/i);
  assert.match(result.plan.notes.join('\n'), /RomM is optional private game-library functionality/i);
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
  assert.equal(result.plan.config.ROMM_DB_DRIVER, 'postgresql');
  assert.equal(result.plan.config.ROMM_DB_HOST, 'database');
  assert.equal(result.plan.config.ROMM_DB_PORT, '5432');
  assert.equal(result.plan.config.ROMM_DB_NAME, 'romm');
  assert.equal(result.plan.config.ROMM_DB_USER, 'romm');
  assert.equal(result.plan.config.ROMM_DB_PASSWORD, '********');
  assert.equal(result.plan.config.ROMM_AUTH_SECRET_KEY, '********');
  assert.equal(result.plan.config.ROMM_REDIS_HOST, 'redis');
  assert.equal(result.plan.config.ROMM_REDIS_PORT, '6379');
  assert.equal(result.plan.config.ROMM_AUTO_CONFIGURE, 'false');
  assert.equal(result.plan.config.ROMM_ADMIN_USERNAME, '');
  assert.equal(result.plan.config.ROMM_ADMIN_PASSWORD, '********');
  assert.equal(result.plan.config.ROMM_HASHEOUS_API_ENABLED, 'true');
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

test('dry-run setup rejects global passwords that need connection-string escaping', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    globalPassword: 'bad://pass:word'
  });

  assert.equal(result.accepted, false);
  assert.match(result.error ?? '', /may only use letters, numbers, dot, underscore, and hyphen/);
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

test('dry-run setup keeps Pulsarr off when Jellyfin is selected', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    jellyfinInstallMode: 'docker',
    requestManagers: ['pulsarr']
  });

  assert.equal(result.plan.config.ENABLE_SEERR, 'true');
  assert.equal(result.plan.config.STACKARR_CONFIGURE_SEERR, 'false');
  assert.equal(result.plan.config.ENABLE_PULSARR, 'false');
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

test('dry-run setup includes selected agent plugin install commands', async () => {
  const result = await setupMediaServerAction({
    dryRun: true,
    agentPluginIntegrations: ['hermes', 'openclaw']
  });

  const pluginCommands = result.plan.commands.filter((command) => command.name.startsWith('stackarr plugins install'));
  assert.deepEqual(
    pluginCommands.map((command) => command.args),
    [
      ['plugins', 'install', 'hermes'],
      ['plugins', 'install', 'openclaw']
    ]
  );
});

test('configure script bootstraps Pulsarr but does not create personal router rules for new users', async () => {
  const configure = await readFile(new URL('../../../stackarr/scripts/configure.sh', import.meta.url), 'utf8');
  const common = await readFile(new URL('../../../stackarr/lib/common.sh', import.meta.url), 'utf8');
  const compose = await readFile(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');
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
  assert.match(configure, /Radarr HD Lite profile configured[\s\S]*WEB 1080p,Bluray-1080p/);
  assert.match(configure, /Sonarr HD Lite profile configured[\s\S]*WEB 1080p,Bluray-1080p/);
  assert.match(configure, /quality_definition_block/);
  assert.match(configure, /WEBDL-1080p", 8, 95, 72/);
  assert.match(configure, /configure_recyclarr_template "\$sonarr_hd_file"[\s\S]*"\$STACKARR_TV_PROFILE_PRESET"/);
  assert.match(configure, /RADARR_DEFAULT_PROFILE/);
  assert.match(configure, /LIDARR_DEFAULT_PROFILE/);
  assert.ok(configure.includes('Season[ ._-]?\\\\d{1,2}'));
  assert.match(configure, /configure_pulsarr_stack \|\| true/);
  assert.match(configure, /configure_maintainerr_stack \|\| true/);
  assert.match(configure, /Maintainerr first-run setup is complete/);
  assert.match(configure, /Maintainerr cleanup preset ideas recorded/);
  assert.match(configure, /optional_service_enabled tracearr/);
  assert.match(configure, /configure_tracearr_stack \|\| true/);
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
    /DATABASE_URL: postgres:\/\/\$\{TRACEARR_POSTGRES_USER:-tracearr\}:\$\{TRACEARR_POSTGRES_PASSWORD:-\$\{TRACEARR_DB_PASSWORD:-stackarr\}\}@database:5432\/\$\{TRACEARR_POSTGRES_DATABASE:-tracearr\}/
  );
  assert.match(compose, /REDIS_URL: redis:\/\/redis:6379/);
  assert.match(compose, /container_name: redis/);
  assert.match(compose, /image: \$\{REDIS_IMAGE:-redis:8\.8\.0-alpine\}/);
  assert.doesNotMatch(compose, /container_name: database-init/);
  assert.match(common, /stackarr_compose --profile database exec -T/);
  assert.match(compose, /container_name: immich/);
  assert.match(compose, /container_name: immich-ml/);
  assert.match(compose, /IMMICH_MACHINE_LEARNING_URL: http:\/\/immich-ml:3003/);
  assert.match(compose, /\$\{IMMICH_UPLOAD_LOCATION:-\.\/\.stackarr\/media\/Pictures\}:\/data/);
  assert.match(compose, /DB_HOSTNAME: database/);
  assert.match(compose, /REDIS_HOSTNAME: redis/);
  assert.doesNotMatch(compose, /container_name: immich-postgres/);
  assert.doesNotMatch(compose, /container_name: immich-redis/);
  assert.match(compose, /ROMM_DB_DRIVER: \$\{ROMM_DB_DRIVER:-postgresql\}/);
  assert.match(compose, /DB_HOST: \$\{ROMM_DB_HOST:-database\}/);
  assert.match(compose, /REDIS_HOST: \$\{ROMM_REDIS_HOST:-redis\}/);
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
});

test('Lidarr is configured as download-only for manually curated music libraries', async () => {
  const compose = await readFile(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');
  const configure = await readFile(new URL('../../../stackarr/scripts/configure.sh', import.meta.url), 'utf8');
  const downloads = await readFile(new URL('../../../stackarr/scripts/downloads.sh', import.meta.url), 'utf8');

  assert.match(compose, /\$\{MUSIC_ROOT:-\.\/\.stackarr\/media\/Music\}:\/music:ro/);
  assert.match(configure, /Lidarr completed download handling disabled[\s\S]*"\$LIDARR_KEY" false/);
  assert.match(downloads, /Lidarr completed download handling disabled[\s\S]*"\$wait_for_ready" false/);
  assert.doesNotMatch(configure, /Lidarr completed download handling enabled/);
});

test('Stackarr dashboard uses mounted runtime config inside Docker', async () => {
  const compose = await readFile(new URL('../../../stackarr/docker-compose.yml', import.meta.url), 'utf8');

  assert.match(compose, /STACKARR_REPO_ROOT: \/app/);
  assert.match(compose, /STACKARR_DATABASE_FILE: \/stackarr-config\/stackarr\.db/);
  assert.match(compose, /\$\{STACKARR_DATABASE_DIR:-\.\/\.stackarr\/config\}:\/stackarr-config/);
  assert.match(compose, /^  app:$/m);
  assert.match(compose, /container_name: app/);
  assert.doesNotMatch(compose, /STACKARR_DATABASE_FILE: \$\{STACKARR_DATABASE_FILE/);
  assert.doesNotMatch(compose, /\.\.:\/stackarr-workspace/);
});
