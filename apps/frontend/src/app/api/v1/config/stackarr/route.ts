import * as nodeCrypto from 'node:crypto';
import {
  portablePasswordValidationError,
  readEnv,
  readJsonPreset,
  readSettings,
  redactEnv,
  type StackarrEnv,
  writeEnvConfig,
  writeJsonPreset,
  writeSettings
} from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';
import { queuePortlessSetupIfNeeded } from '../../../../../lib/portlessSetup';

const accessPasswordKeys = [
  'TRANSMISSION_PASSWORD',
  'QBITTORRENT_PASSWORD',
  'PROWLARR_PASSWORD',
  'RADARR_PASSWORD',
  'RADARR4K_PASSWORD',
  'SONARR_PASSWORD',
  'SONARR4K_PASSWORD',
  'LIDARR_PASSWORD',
  'BAZARR_PASSWORD',
  'PULSARR_PASSWORD',
  'BOOKORBIT_PASSWORD',
  'TINYMEDIAMANAGER_PASSWORD'
] as const;

export async function GET() {
  const env = readEnv();

  return json({
    config: redactEnv(env),
    settings: readSettings(),
    presets: {
      naming: readJsonPreset('naming'),
      downloads: readJsonPreset('downloads'),
      requests: readJsonPreset('requests')
    }
  });
}

export async function PUT(request: NextRequest) {
  const currentEnv = readEnv();
  const existingApiKey = currentEnv.STACKARR_API_KEY?.trim() ?? '';
  if (existingApiKey) {
    const auth = requireApiKey(request);

    if (auth) {
      return auth;
    }
  }

  const beforeSettings = readSettings();
  const body = await request.json().catch(() => ({}));
  let afterSettings = beforeSettings;
  let nextEnv: StackarrEnv | null = null;

  const config = typeof body.config === 'object' && body.config ? body.config : null;
  if (config && typeof config === 'object') {
    const passwordError = validatePortableConfigPasswords(config as StackarrEnv, currentEnv);
    if (passwordError) {
      return json({ accepted: false, error: passwordError }, { status: 400 });
    }

    const currentPasswordError = validateCurrentPasswordForProtectedConfigChange(
      config as StackarrEnv,
      currentEnv,
      body.currentPassword
    );
    if (currentPasswordError) {
      return json({ accepted: false, error: currentPasswordError }, { status: 403 });
    }

    nextEnv = writeEnvConfig(withGeneratedOptionalSecrets(config as StackarrEnv));
  }

  if (!nextEnv && !existingApiKey) {
    nextEnv = writeEnvConfig({ STACKARR_API_KEY: nodeCrypto.randomBytes(24).toString('hex') });
  }

  if (body.settings && typeof body.settings === 'object') {
    afterSettings = writeSettings(body.settings);
  }

  if (body.presets?.naming) {
    writeJsonPreset('naming', body.presets.naming);
  }

  if (body.presets?.downloads) {
    writeJsonPreset('downloads', body.presets.downloads);
  }

  if (body.presets?.requests) {
    writeJsonPreset('requests', body.presets.requests);
  }

  const task = queuePortlessSetupIfNeeded(beforeSettings, afterSettings);

  return json({
    accepted: true,
    apiKey: !existingApiKey && nextEnv?.STACKARR_API_KEY ? nextEnv.STACKARR_API_KEY : undefined,
    portlessTask: task ?? undefined
  });
}

function withGeneratedOptionalSecrets(config: StackarrEnv): StackarrEnv {
  const current = readEnv();
  const safeCurrent = redactEnv(current);
  const stackPassword =
    unredactedConfigValue('PASSWORD') || current.PASSWORD || nodeCrypto.randomBytes(24).toString('hex');
  const databasePassword =
    unredactedConfigValue('DATABASE_SUPERUSER_PASSWORD') ||
    current.DATABASE_SUPERUSER_PASSWORD ||
    nodeCrypto.randomBytes(24).toString('hex');
  const databaseMode = normalizeDatabaseMode(config.STACKARR_DATABASE_MODE || current.STACKARR_DATABASE_MODE);
  const postgresMode = databaseMode === 'postgres';
  const tracearrEnabled = String(config.ENABLE_TRACEARR ?? current.ENABLE_TRACEARR ?? '').toLowerCase() === 'true';
  const immichEnabled = String(config.ENABLE_IMMICH ?? current.ENABLE_IMMICH ?? '').toLowerCase() === 'true';
  const rommEnabled = String(config.ENABLE_ROMM ?? current.ENABLE_ROMM ?? '').toLowerCase() === 'true';
  const requestedDatabaseImage =
    config.DATABASE_IMAGE || current.DATABASE_IMAGE || 'timescale/timescaledb-ha:pg18.1-ts2.25.0';
  const databaseImage =
    tracearrEnabled && requestedDatabaseImage === 'pgvector/pgvector:pg18-trixie'
      ? 'timescale/timescaledb-ha:pg18.1-ts2.25.0'
      : requestedDatabaseImage;
  const databasePgdata = config.DATABASE_PGDATA || current.DATABASE_PGDATA || '/var/lib/postgresql/data';
  const requestedStackarrDatabaseUrl = isLegacyStackarrPostgresUrl(unredactedConfigValue('STACKARR_DATABASE_URL'))
    ? ''
    : unredactedConfigValue('STACKARR_DATABASE_URL');
  const currentStackarrDatabaseUrl = isLegacyStackarrPostgresUrl(current.STACKARR_DATABASE_URL)
    ? ''
    : current.STACKARR_DATABASE_URL;
  const requestedStackarrLogDatabaseUrl = isLegacyStackarrPostgresUrl(
    unredactedConfigValue('STACKARR_LOG_DATABASE_URL')
  )
    ? ''
    : unredactedConfigValue('STACKARR_LOG_DATABASE_URL');
  const currentStackarrLogDatabaseUrl = isLegacyStackarrPostgresUrl(current.STACKARR_LOG_DATABASE_URL)
    ? ''
    : current.STACKARR_LOG_DATABASE_URL;
  const requestedRommDbDriver =
    !config.ROMM_DB_DRIVER || ['mysql', 'mariadb'].includes(config.ROMM_DB_DRIVER)
      ? 'postgresql'
      : config.ROMM_DB_DRIVER;
  const currentRommDbDriver =
    !current.ROMM_DB_DRIVER || ['mysql', 'mariadb'].includes(current.ROMM_DB_DRIVER)
      ? 'postgresql'
      : current.ROMM_DB_DRIVER;
  const requestedRommDbHost =
    !config.ROMM_DB_HOST || ['romm-db', 'mysql', 'mariadb'].includes(config.ROMM_DB_HOST)
      ? 'database'
      : config.ROMM_DB_HOST;
  const currentRommDbHost =
    !current.ROMM_DB_HOST || ['romm-db', 'mysql', 'mariadb'].includes(current.ROMM_DB_HOST)
      ? 'database'
      : current.ROMM_DB_HOST;
  const requestedRommDbImage =
    config.ROMM_DB_IMAGE === 'mysql:8' ||
    config.ROMM_DB_IMAGE === 'mysql:latest' ||
    config.ROMM_DB_IMAGE?.startsWith('mariadb:')
      ? ''
      : config.ROMM_DB_IMAGE;
  const currentRommDbImage =
    current.ROMM_DB_IMAGE === 'mysql:8' ||
    current.ROMM_DB_IMAGE === 'mysql:latest' ||
    current.ROMM_DB_IMAGE?.startsWith('mariadb:')
      ? ''
      : current.ROMM_DB_IMAGE;
  const requestedImmichDbUser = config.IMMICH_DB_USERNAME || current.IMMICH_DB_USERNAME || 'immich';
  const next: StackarrEnv = {
    ...config,
    STACKARR_API_KEY:
      unredactedConfigValue('STACKARR_API_KEY') ||
      current.STACKARR_API_KEY?.trim() ||
      nodeCrypto.randomBytes(24).toString('hex'),
    STACKARR_DATABASE_MODE: databaseMode,
    PASSWORD: unredactedConfigValue('PASSWORD') || current.PASSWORD || stackPassword,
    DATABASE_IMAGE: databaseImage,
    DATABASE_PGDATA: databasePgdata,
    DATABASE_SUPERUSER_PASSWORD: databasePassword,
    STACKARR_POSTGRES_MAIN_DATABASE:
      config.STACKARR_POSTGRES_MAIN_DATABASE ||
      config.STACKARR_POSTGRES_DATABASE ||
      current.STACKARR_POSTGRES_MAIN_DATABASE ||
      current.STACKARR_POSTGRES_DATABASE ||
      'stackarr-main',
    STACKARR_POSTGRES_LOG_DATABASE:
      config.STACKARR_POSTGRES_LOG_DATABASE || current.STACKARR_POSTGRES_LOG_DATABASE || 'stackarr-log',
    STACKARR_POSTGRES_USER: config.STACKARR_POSTGRES_USER || current.STACKARR_POSTGRES_USER || 'stackarr',
    STACKARR_POSTGRES_PASSWORD:
      unredactedConfigValue('STACKARR_POSTGRES_PASSWORD') || current.STACKARR_POSTGRES_PASSWORD || databasePassword,
    BOOKORBIT_POSTGRES_DATABASE:
      config.BOOKORBIT_POSTGRES_DATABASE || current.BOOKORBIT_POSTGRES_DATABASE || 'bookorbit',
    BOOKORBIT_POSTGRES_USER: config.BOOKORBIT_POSTGRES_USER || current.BOOKORBIT_POSTGRES_USER || 'bookorbit',
    BOOKORBIT_POSTGRES_PASSWORD:
      unredactedConfigValue('BOOKORBIT_POSTGRES_PASSWORD') || current.BOOKORBIT_POSTGRES_PASSWORD || databasePassword,
    IMMICH_DB_USERNAME: requestedImmichDbUser === 'postgres' ? 'immich' : requestedImmichDbUser,
    IMMICH_DB_DATABASE_NAME: config.IMMICH_DB_DATABASE_NAME || current.IMMICH_DB_DATABASE_NAME || 'immich',
    IMMICH_DB_PASSWORD:
      unredactedConfigValue('IMMICH_DB_PASSWORD') ||
      current.IMMICH_DB_PASSWORD ||
      (immichEnabled ? nodeCrypto.randomBytes(24).toString('hex') : ''),
    IMMICH_DB_VECTOR_EXTENSION: config.IMMICH_DB_VECTOR_EXTENSION || current.IMMICH_DB_VECTOR_EXTENSION || 'pgvector',
    GAMES_ROOT: config.GAMES_ROOT || current.GAMES_ROOT || `${config.MEDIA_ROOT || current.MEDIA_ROOT || ''}/Games`,
    ROMM_URL: config.ROMM_URL || current.ROMM_URL || 'http://127.0.0.1:7583',
    ROMM_BIND_IP: config.ROMM_BIND_IP || current.ROMM_BIND_IP || '127.0.0.1',
    ROMM_WEB_PORT: config.ROMM_WEB_PORT || current.ROMM_WEB_PORT || '7583',
    ROMM_CONTAINER_PORT: config.ROMM_CONTAINER_PORT || current.ROMM_CONTAINER_PORT || '8080',
    ROMM_LIBRARY_ROOT:
      config.ROMM_LIBRARY_ROOT || current.ROMM_LIBRARY_ROOT || config.GAMES_ROOT || current.GAMES_ROOT || '',
    ROMM_ASSETS_ROOT: config.ROMM_ASSETS_ROOT || current.ROMM_ASSETS_ROOT || '',
    ROMM_CONFIG_ROOT: config.ROMM_CONFIG_ROOT || current.ROMM_CONFIG_ROOT || '',
    ROMM_RESOURCES_ROOT: config.ROMM_RESOURCES_ROOT || current.ROMM_RESOURCES_ROOT || '',
    ROMM_REDIS_DATA_ROOT: config.ROMM_REDIS_DATA_ROOT || current.ROMM_REDIS_DATA_ROOT || '',
    ROMM_REDIS_HOST: config.ROMM_REDIS_HOST || current.ROMM_REDIS_HOST || 'redis',
    ROMM_REDIS_PORT: config.ROMM_REDIS_PORT || current.ROMM_REDIS_PORT || '6379',
    ROMM_DB_DATA_LOCATION: config.ROMM_DB_DATA_LOCATION || current.ROMM_DB_DATA_LOCATION || '',
    ROMM_DB_DRIVER: requestedRommDbDriver || currentRommDbDriver || 'postgresql',
    ROMM_DB_HOST: requestedRommDbHost || currentRommDbHost || 'database',
    ROMM_DB_PORT: config.ROMM_DB_PORT || current.ROMM_DB_PORT || '5432',
    ROMM_DB_IMAGE: requestedRommDbImage || currentRommDbImage || '',
    ROMM_DB_NAME: config.ROMM_DB_NAME || current.ROMM_DB_NAME || 'romm',
    ROMM_DB_USER: config.ROMM_DB_USER || current.ROMM_DB_USER || 'romm',
    ROMM_DB_PASSWORD:
      unredactedConfigValue('ROMM_DB_PASSWORD') ||
      current.ROMM_DB_PASSWORD ||
      (rommEnabled ? nodeCrypto.randomBytes(24).toString('hex') : ''),
    ROMM_DB_ROOT_PASSWORD: '',
    ROMM_DB_QUERY_JSON: config.ROMM_DB_QUERY_JSON || current.ROMM_DB_QUERY_JSON || '',
    ROMM_AUTH_SECRET_KEY:
      unredactedConfigValue('ROMM_AUTH_SECRET_KEY') ||
      current.ROMM_AUTH_SECRET_KEY ||
      (rommEnabled ? nodeCrypto.randomBytes(32).toString('hex') : ''),
    ROMM_AUTO_CONFIGURE: 'false',
    ROMM_ADMIN_USERNAME: '',
    ROMM_ADMIN_EMAIL: '',
    ROMM_ADMIN_PASSWORD: '',
    ROMM_IGDB_CLIENT_ID: config.ROMM_IGDB_CLIENT_ID || current.ROMM_IGDB_CLIENT_ID || '',
    ROMM_IGDB_CLIENT_SECRET: unredactedConfigValue('ROMM_IGDB_CLIENT_SECRET') || current.ROMM_IGDB_CLIENT_SECRET || '',
    ROMM_MOBYGAMES_API_KEY: unredactedConfigValue('ROMM_MOBYGAMES_API_KEY') || current.ROMM_MOBYGAMES_API_KEY || '',
    ROMM_SCREENSCRAPER_USER: config.ROMM_SCREENSCRAPER_USER || current.ROMM_SCREENSCRAPER_USER || '',
    ROMM_SCREENSCRAPER_PASSWORD:
      unredactedConfigValue('ROMM_SCREENSCRAPER_PASSWORD') || current.ROMM_SCREENSCRAPER_PASSWORD || '',
    ROMM_RETROACHIEVEMENTS_API_KEY:
      unredactedConfigValue('ROMM_RETROACHIEVEMENTS_API_KEY') || current.ROMM_RETROACHIEVEMENTS_API_KEY || '',
    ROMM_STEAMGRIDDB_API_KEY:
      unredactedConfigValue('ROMM_STEAMGRIDDB_API_KEY') || current.ROMM_STEAMGRIDDB_API_KEY || '',
    ROMM_HASHEOUS_API_ENABLED: config.ROMM_HASHEOUS_API_ENABLED || current.ROMM_HASHEOUS_API_ENABLED || 'true',
    ROMM_PLAYMATCH_API_ENABLED: config.ROMM_PLAYMATCH_API_ENABLED || current.ROMM_PLAYMATCH_API_ENABLED || 'false',
    ROMM_LAUNCHBOX_API_ENABLED: config.ROMM_LAUNCHBOX_API_ENABLED || current.ROMM_LAUNCHBOX_API_ENABLED || 'false',
    ROMM_FLASHPOINT_API_ENABLED: config.ROMM_FLASHPOINT_API_ENABLED || current.ROMM_FLASHPOINT_API_ENABLED || 'false',
    ROMM_HLTB_API_ENABLED: config.ROMM_HLTB_API_ENABLED || current.ROMM_HLTB_API_ENABLED || 'false',
    SEERR_DB_TYPE: config.SEERR_DB_TYPE || current.SEERR_DB_TYPE || 'postgres',
    SEERR_POSTGRES_DATABASE: config.SEERR_POSTGRES_DATABASE || current.SEERR_POSTGRES_DATABASE || 'seerr',
    SEERR_POSTGRES_USER: config.SEERR_POSTGRES_USER || current.SEERR_POSTGRES_USER || 'seerr',
    SEERR_POSTGRES_PASSWORD:
      unredactedConfigValue('SEERR_POSTGRES_PASSWORD') || current.SEERR_POSTGRES_PASSWORD || databasePassword,
    PULSARR_POSTGRES_DATABASE: config.PULSARR_POSTGRES_DATABASE || current.PULSARR_POSTGRES_DATABASE || 'pulsarr',
    PULSARR_POSTGRES_USER: config.PULSARR_POSTGRES_USER || current.PULSARR_POSTGRES_USER || 'pulsarr',
    PULSARR_POSTGRES_PASSWORD:
      unredactedConfigValue('PULSARR_POSTGRES_PASSWORD') || current.PULSARR_POSTGRES_PASSWORD || databasePassword,
    TRACEARR_POSTGRES_DATABASE: config.TRACEARR_POSTGRES_DATABASE || current.TRACEARR_POSTGRES_DATABASE || 'tracearr',
    TRACEARR_POSTGRES_USER: config.TRACEARR_POSTGRES_USER || current.TRACEARR_POSTGRES_USER || 'tracearr',
    TRACEARR_POSTGRES_PASSWORD:
      unredactedConfigValue('TRACEARR_POSTGRES_PASSWORD') ||
      current.TRACEARR_POSTGRES_PASSWORD ||
      unredactedConfigValue('TRACEARR_DB_PASSWORD') ||
      current.TRACEARR_DB_PASSWORD ||
      databasePassword,
    PULSARR_DB_TYPE: postgresMode ? 'postgres' : config.PULSARR_DB_TYPE || current.PULSARR_DB_TYPE || 'sqlite',
    PULSARR_DB_PATH: config.PULSARR_DB_PATH || current.PULSARR_DB_PATH || '/app/data/db/pulsarr.db',
    PULSARR_DB_HOST: postgresMode ? 'database' : '',
    PULSARR_DB_PORT: '5432',
    PULSARR_DB_NAME: postgresMode ? 'pulsarr' : '',
    PULSARR_DB_USER: postgresMode ? 'pulsarr' : '',
    PULSARR_DB_PASSWORD: postgresMode
      ? unredactedConfigValue('PULSARR_POSTGRES_PASSWORD') || current.PULSARR_POSTGRES_PASSWORD || databasePassword
      : '',
    BAZARR_POSTGRES_ENABLED: postgresMode ? 'true' : 'false',
    BAZARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    BAZARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    BAZARR_POSTGRES_DATABASE: config.BAZARR_POSTGRES_DATABASE || current.BAZARR_POSTGRES_DATABASE || 'bazarr',
    BAZARR_POSTGRES_USER: config.BAZARR_POSTGRES_USER || current.BAZARR_POSTGRES_USER || 'bazarr',
    BAZARR_POSTGRES_PASSWORD:
      unredactedConfigValue('BAZARR_POSTGRES_PASSWORD') || current.BAZARR_POSTGRES_PASSWORD || databasePassword,
    PROWLARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    PROWLARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    PROWLARR_POSTGRES_MAIN_DATABASE:
      config.PROWLARR_POSTGRES_MAIN_DATABASE || current.PROWLARR_POSTGRES_MAIN_DATABASE || 'prowlarr-main',
    PROWLARR_POSTGRES_LOG_DATABASE:
      config.PROWLARR_POSTGRES_LOG_DATABASE || current.PROWLARR_POSTGRES_LOG_DATABASE || 'prowlarr-log',
    PROWLARR_POSTGRES_USER: config.PROWLARR_POSTGRES_USER || current.PROWLARR_POSTGRES_USER || 'prowlarr',
    PROWLARR_POSTGRES_PASSWORD:
      unredactedConfigValue('PROWLARR_POSTGRES_PASSWORD') || current.PROWLARR_POSTGRES_PASSWORD || databasePassword,
    RADARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    RADARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    RADARR_POSTGRES_MAIN_DATABASE:
      config.RADARR_POSTGRES_MAIN_DATABASE || current.RADARR_POSTGRES_MAIN_DATABASE || 'radarr-main',
    RADARR_POSTGRES_LOG_DATABASE:
      config.RADARR_POSTGRES_LOG_DATABASE || current.RADARR_POSTGRES_LOG_DATABASE || 'radarr-log',
    RADARR_POSTGRES_USER: config.RADARR_POSTGRES_USER || current.RADARR_POSTGRES_USER || 'radarr',
    RADARR_POSTGRES_PASSWORD:
      unredactedConfigValue('RADARR_POSTGRES_PASSWORD') || current.RADARR_POSTGRES_PASSWORD || databasePassword,
    RADARR4K_POSTGRES_HOST: postgresMode ? 'database' : '',
    RADARR4K_POSTGRES_PORT: postgresMode ? '5432' : '',
    RADARR4K_POSTGRES_MAIN_DATABASE:
      config.RADARR4K_POSTGRES_MAIN_DATABASE || current.RADARR4K_POSTGRES_MAIN_DATABASE || 'radarr4k-main',
    RADARR4K_POSTGRES_LOG_DATABASE:
      config.RADARR4K_POSTGRES_LOG_DATABASE || current.RADARR4K_POSTGRES_LOG_DATABASE || 'radarr4k-log',
    RADARR4K_POSTGRES_USER: config.RADARR4K_POSTGRES_USER || current.RADARR4K_POSTGRES_USER || 'radarr4k',
    RADARR4K_POSTGRES_PASSWORD:
      unredactedConfigValue('RADARR4K_POSTGRES_PASSWORD') || current.RADARR4K_POSTGRES_PASSWORD || databasePassword,
    SONARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    SONARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    SONARR_POSTGRES_MAIN_DATABASE:
      config.SONARR_POSTGRES_MAIN_DATABASE || current.SONARR_POSTGRES_MAIN_DATABASE || 'sonarr-main',
    SONARR_POSTGRES_LOG_DATABASE:
      config.SONARR_POSTGRES_LOG_DATABASE || current.SONARR_POSTGRES_LOG_DATABASE || 'sonarr-log',
    SONARR_POSTGRES_USER: config.SONARR_POSTGRES_USER || current.SONARR_POSTGRES_USER || 'sonarr',
    SONARR_POSTGRES_PASSWORD:
      unredactedConfigValue('SONARR_POSTGRES_PASSWORD') || current.SONARR_POSTGRES_PASSWORD || databasePassword,
    SONARR4K_POSTGRES_HOST: postgresMode ? 'database' : '',
    SONARR4K_POSTGRES_PORT: postgresMode ? '5432' : '',
    SONARR4K_POSTGRES_MAIN_DATABASE:
      config.SONARR4K_POSTGRES_MAIN_DATABASE || current.SONARR4K_POSTGRES_MAIN_DATABASE || 'sonarr4k-main',
    SONARR4K_POSTGRES_LOG_DATABASE:
      config.SONARR4K_POSTGRES_LOG_DATABASE || current.SONARR4K_POSTGRES_LOG_DATABASE || 'sonarr4k-log',
    SONARR4K_POSTGRES_USER: config.SONARR4K_POSTGRES_USER || current.SONARR4K_POSTGRES_USER || 'sonarr4k',
    SONARR4K_POSTGRES_PASSWORD:
      unredactedConfigValue('SONARR4K_POSTGRES_PASSWORD') || current.SONARR4K_POSTGRES_PASSWORD || databasePassword,
    LIDARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    LIDARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    LIDARR_POSTGRES_MAIN_DATABASE:
      config.LIDARR_POSTGRES_MAIN_DATABASE || current.LIDARR_POSTGRES_MAIN_DATABASE || 'lidarr-main',
    LIDARR_POSTGRES_LOG_DATABASE:
      config.LIDARR_POSTGRES_LOG_DATABASE || current.LIDARR_POSTGRES_LOG_DATABASE || 'lidarr-log',
    LIDARR_POSTGRES_USER: config.LIDARR_POSTGRES_USER || current.LIDARR_POSTGRES_USER || 'lidarr',
    LIDARR_POSTGRES_PASSWORD:
      unredactedConfigValue('LIDARR_POSTGRES_PASSWORD') || current.LIDARR_POSTGRES_PASSWORD || databasePassword
  };

  for (const key of accessPasswordKeys) {
    next[key] = unredactedConfigValue(key) || current[key] || stackPassword;
  }

  next.TRACEARR_AUTO_CONFIGURE = config.TRACEARR_AUTO_CONFIGURE || current.TRACEARR_AUTO_CONFIGURE || 'true';
  next.TRACEARR_ADMIN_USERNAME =
    config.TRACEARR_ADMIN_USERNAME || current.TRACEARR_ADMIN_USERNAME || next.USERNAME || 'stackarr';
  next.TRACEARR_ADMIN_EMAIL = config.TRACEARR_ADMIN_EMAIL || current.TRACEARR_ADMIN_EMAIL || next.USER_EMAIL || '';
  next.TRACEARR_ADMIN_PASSWORD =
    unredactedConfigValue('TRACEARR_ADMIN_PASSWORD') || current.TRACEARR_ADMIN_PASSWORD || next.PASSWORD || '';
  next.TRACEARR_CLAIM_CODE = unredactedConfigValue('TRACEARR_CLAIM_CODE') || current.TRACEARR_CLAIM_CODE || '';

  next.STACKARR_POSTGRES_DATABASE = next.STACKARR_POSTGRES_MAIN_DATABASE;

  const generatedStackarrDatabaseUrl = buildPostgresUrl(
    next.STACKARR_POSTGRES_USER ?? 'stackarr',
    next.STACKARR_POSTGRES_PASSWORD ?? databasePassword,
    next.STACKARR_POSTGRES_DATABASE ?? 'stackarr-main'
  );
  const generatedStackarrLogDatabaseUrl = buildPostgresUrl(
    next.STACKARR_POSTGRES_USER ?? 'stackarr',
    next.STACKARR_POSTGRES_PASSWORD ?? databasePassword,
    next.STACKARR_POSTGRES_LOG_DATABASE ?? 'stackarr-log'
  );

  next.STACKARR_DATABASE_URL = postgresMode
    ? preserveCustomStackarrDatabaseUrl(
        requestedStackarrDatabaseUrl || currentStackarrDatabaseUrl,
        current,
        next,
        'main'
      )
      ? requestedStackarrDatabaseUrl || currentStackarrDatabaseUrl
      : generatedStackarrDatabaseUrl
    : '';
  next.STACKARR_LOG_DATABASE_URL = postgresMode
    ? preserveCustomStackarrDatabaseUrl(
        requestedStackarrLogDatabaseUrl || currentStackarrLogDatabaseUrl,
        current,
        next,
        'log'
      )
      ? requestedStackarrLogDatabaseUrl || currentStackarrLogDatabaseUrl
      : generatedStackarrLogDatabaseUrl
    : '';
  next.BOOKORBIT_DATABASE_URL = `postgres://${encodeURIComponent(next.BOOKORBIT_POSTGRES_USER ?? 'bookorbit')}:${encodeURIComponent(next.BOOKORBIT_POSTGRES_PASSWORD ?? databasePassword)}@database:5432/${encodeURIComponent(next.BOOKORBIT_POSTGRES_DATABASE ?? 'bookorbit')}`;

  if (tracearrEnabled) {
    next.TRACEARR_DB_PASSWORD =
      unredactedConfigValue('TRACEARR_DB_PASSWORD') || current.TRACEARR_DB_PASSWORD || databasePassword;
    next.TRACEARR_POSTGRES_PASSWORD =
      unredactedConfigValue('TRACEARR_POSTGRES_PASSWORD') ||
      current.TRACEARR_POSTGRES_PASSWORD ||
      next.TRACEARR_DB_PASSWORD;
    next.TRACEARR_JWT_SECRET =
      unredactedConfigValue('TRACEARR_JWT_SECRET') ||
      current.TRACEARR_JWT_SECRET ||
      nodeCrypto.randomBytes(32).toString('hex');
    next.TRACEARR_COOKIE_SECRET =
      unredactedConfigValue('TRACEARR_COOKIE_SECRET') ||
      current.TRACEARR_COOKIE_SECRET ||
      nodeCrypto.randomBytes(32).toString('hex');
  }

  if (rommEnabled) {
    next.ROMM_DB_PASSWORD =
      unredactedConfigValue('ROMM_DB_PASSWORD') ||
      current.ROMM_DB_PASSWORD ||
      nodeCrypto.randomBytes(24).toString('hex');
    next.ROMM_AUTH_SECRET_KEY =
      unredactedConfigValue('ROMM_AUTH_SECRET_KEY') ||
      current.ROMM_AUTH_SECRET_KEY ||
      nodeCrypto.randomBytes(32).toString('hex');
    next.ROMM_ADMIN_USERNAME = '';
    next.ROMM_ADMIN_EMAIL = '';
    next.ROMM_ADMIN_PASSWORD = '';
  }

  if (String(config.ENABLE_BOOKORBIT ?? '').toLowerCase() !== 'true') {
    return next;
  }

  return {
    ...next,
    BOOKORBIT_JWT_SECRET:
      unredactedConfigValue('BOOKORBIT_JWT_SECRET') ||
      current.BOOKORBIT_JWT_SECRET ||
      nodeCrypto.randomBytes(32).toString('hex'),
    BOOKORBIT_SETUP_TOKEN:
      unredactedConfigValue('BOOKORBIT_SETUP_TOKEN') ||
      current.BOOKORBIT_SETUP_TOKEN ||
      unredactedConfigValue('PASSWORD') ||
      current.PASSWORD ||
      nodeCrypto.randomBytes(32).toString('hex'),
    BOOKORBIT_CONTAINER_PORT:
      config.BOOKORBIT_CONTAINER_PORT ||
      current.BOOKORBIT_CONTAINER_PORT ||
      config.BOOKORBIT_WEB_PORT ||
      current.BOOKORBIT_WEB_PORT ||
      '7582'
  };

  function unredactedConfigValue(key: keyof StackarrEnv) {
    const value = config[key];

    if (!value || value === safeCurrent[key]) {
      return '';
    }

    return value;
  }
}

function normalizeDatabaseMode(value: string | undefined) {
  return ['postgres', 'postgresql', 'pg'].includes(String(value ?? '').toLowerCase()) ? 'postgres' : 'app-default';
}

function isLegacyStackarrPostgresUrl(value: string | undefined) {
  if (!value) {
    return false;
  }

  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\//, '')) === 'stackarr';
  } catch {
    return false;
  }
}

function buildPostgresUrl(user: string, password: string, database: string) {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@database:5432/${encodeURIComponent(database)}`;
}

function preserveCustomStackarrDatabaseUrl(
  value: string | undefined,
  current: StackarrEnv,
  next: StackarrEnv,
  target: 'main' | 'log'
) {
  if (!value || isLegacyStackarrPostgresUrl(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const managedUsers = new Set([
      current.STACKARR_POSTGRES_USER || 'stackarr',
      next.STACKARR_POSTGRES_USER || 'stackarr'
    ]);
    const managedDatabases = new Set(
      target === 'main'
        ? [
            current.STACKARR_POSTGRES_DATABASE || current.STACKARR_POSTGRES_MAIN_DATABASE || 'stackarr-main',
            current.STACKARR_POSTGRES_MAIN_DATABASE || current.STACKARR_POSTGRES_DATABASE || 'stackarr-main',
            next.STACKARR_POSTGRES_DATABASE || next.STACKARR_POSTGRES_MAIN_DATABASE || 'stackarr-main',
            next.STACKARR_POSTGRES_MAIN_DATABASE || next.STACKARR_POSTGRES_DATABASE || 'stackarr-main'
          ]
        : [
            current.STACKARR_POSTGRES_LOG_DATABASE || 'stackarr-log',
            next.STACKARR_POSTGRES_LOG_DATABASE || 'stackarr-log'
          ]
    );

    return !(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname === 'database' &&
      (!url.port || url.port === '5432') &&
      managedUsers.has(decodeURIComponent(url.username)) &&
      managedDatabases.has(database)
    );
  } catch {
    return true;
  }
}

function validateCurrentPasswordForProtectedConfigChange(
  config: StackarrEnv,
  current: StackarrEnv,
  currentPassword: unknown
) {
  if (!protectedConfigChanged(config, current)) {
    return undefined;
  }

  if (!current.PASSWORD) {
    return undefined;
  }

  if (typeof currentPassword !== 'string' || !currentPassword) {
    return 'Current admin password is required to change protected account or secret fields.';
  }

  if (!constantTimeStringEqual(currentPassword, current.PASSWORD)) {
    return 'Current admin password is incorrect.';
  }

  return undefined;
}

function protectedConfigChanged(config: StackarrEnv, current: StackarrEnv) {
  const redactedCurrent = redactEnv(current);

  for (const [key, value] of Object.entries(config)) {
    if (!isCurrentPasswordProtectedConfigKey(key)) {
      continue;
    }

    const nextValue = value == null ? '' : String(value);
    const currentValue = current[key] ?? '';
    const redactedValue = redactedCurrent[key] ?? '';

    if (nextValue === currentValue || nextValue === redactedValue) {
      continue;
    }

    return true;
  }

  return false;
}

function isCurrentPasswordProtectedConfigKey(key: string) {
  const normalized = key.toUpperCase();

  return (
    normalized === 'USERNAME' ||
    normalized === 'USER_EMAIL' ||
    normalized === 'PASSWORD' ||
    normalized.endsWith('_PASSWORD') ||
    normalized.includes('CLAIM_CODE') ||
    normalized === 'DATABASE_URL' ||
    normalized.endsWith('_DATABASE_URL') ||
    normalized.endsWith('_DB_URL')
  );
}

function constantTimeStringEqual(left: string, right: string) {
  const leftHash = nodeCrypto.createHash('sha256').update(left).digest();
  const rightHash = nodeCrypto.createHash('sha256').update(right).digest();

  return nodeCrypto.timingSafeEqual(leftHash, rightHash);
}

function validatePortableConfigPasswords(config: StackarrEnv, current: StackarrEnv) {
  const redactedCurrent = redactEnv(current);

  for (const [key, value] of Object.entries(config)) {
    if (!isPortablePasswordConfigKey(key) || !value || value === redactedCurrent[key]) {
      continue;
    }

    const error = portablePasswordValidationError(String(value), humanizePasswordKey(key));
    if (error) {
      return error;
    }
  }

  return undefined;
}

function isPortablePasswordConfigKey(key: string) {
  return key === 'PASSWORD' || key.endsWith('_PASSWORD');
}

function humanizePasswordKey(key: string) {
  if (key === 'PASSWORD') {
    return 'Global password';
  }

  return key
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
