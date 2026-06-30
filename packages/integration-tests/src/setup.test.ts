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
  assert.ok(questionIds.includes('movieProfilePreset'));
  assert.ok(questionIds.includes('tvProfilePreset'));
  assert.ok(questionIds.includes('musicProfilePreset'));
  assert.ok(questionIds.includes('agentPluginIntegrations'));
  assert.ok(!questionIds.includes('pulsarrHdLiteUsers'));
  const requestManagersQuestion = profile.questions.find((question) => question.id === 'requestManagers');
  const enabledServicesQuestion = profile.questions.find((question) => question.id === 'enabledServices');
  assert.deepEqual(requestManagersQuestion?.choices, ['seerr', 'pulsarr']);
  assert.deepEqual(requestManagersQuestion?.default, ['pulsarr']);
  assert.ok(enabledServicesQuestion?.choices);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('seerr'), false);
  assert.equal((enabledServicesQuestion.choices as string[]).includes('pulsarr'), false);
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
  assert.equal(result.plan.config.PULSARR_HD_LITE_USERS, undefined);
  assert.match(result.plan.notes.join('\n'), /Pulsarr first-run admin/i);
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
