import { databaseExists, readJsonSetting, writeJsonSetting } from './database';

export type InstallMode = 'disabled' | 'native' | 'docker';
export type TorrentClient = 'transmission' | 'qbittorrent';

export type StackarrEnv = Record<string, string> & {
  STACKARR_API_KEY?: string;
  PREFERRED_TORRENT_CLIENT?: TorrentClient | string;
  PLEX_INSTALL_MODE?: InstallMode | string;
  JELLYFIN_INSTALL_MODE?: InstallMode | string;
};

const home = process.env.HOME ?? '';
const defaultAppRoot = defaultStackarrAppRoot();
const defaultConfigRoot = `${defaultAppRoot}/config`;
const defaultStateRoot = `${defaultAppRoot}/state`;
const defaultLogRoot = `${defaultAppRoot}/logs`;
const defaultMediaRoot = `${defaultAppRoot}/media`;
const defaultMusicRoot = `${defaultMediaRoot}/Music`;
const defaultDownloadsRoot = `${defaultAppRoot}/downloads`;

export const managedEnvDefaults: StackarrEnv = {
  TIMEZONE: 'Etc/UTC',
  PUID: defaultUid(),
  PGID: defaultGid(),

  MEDIA_ROOT: defaultMediaRoot,
  MUSIC_ROOT: defaultMusicRoot,
  DOWNLOADS_ROOT: defaultDownloadsRoot,
  BACKUP_ROOT: `${defaultAppRoot}/backups`,
  BACKUP_STAGING_ROOT: '',
  APP_ROOT: defaultAppRoot,
  CONFIG_ROOT: defaultConfigRoot,
  STATE_ROOT: defaultStateRoot,
  LOG_ROOT: defaultLogRoot,

  PLEX_CONFIG_PATH: `${home}/Library/Application Support/Plex Media Server`,
  PLEX_PREFS_PATH: `${home}/Library/Preferences/com.plexapp.plexmediaserver.plist`,
  PLEX_INSTALL_MODE: 'native',
  JELLYFIN_INSTALL_MODE: 'disabled',
  JELLYFIN_CONFIG_PATH: `${home}/.local/share/jellyfin`,

  ENABLE_MOVIES: 'true',
  ENABLE_TV_SHOWS: 'true',
  ENABLE_4K_SERVARR: 'false',
  ENABLE_BAZARR: 'true',
  ENABLE_LIDARR: 'true',
  ENABLE_BOOKORBIT: 'false',
  ENABLE_TINYMEDIAMANAGER: 'true',
  ENABLE_RECYCLARR: 'true',
  ENABLE_FLARESOLVERR: 'true',
  ENABLE_TIDARR: 'true',
  ENABLE_SEERR: 'false',
  STACKARR_CONFIGURE_SEERR: 'false',
  ENABLE_PULSARR: 'true',
  ENABLE_BACKUP: 'true',
  STACKARR_MOVIE_PROFILE_PRESET: 'lite',
  STACKARR_MOVIE_4K_PROFILE_PRESET: 'lite',
  STACKARR_TV_PROFILE_PRESET: 'lite',
  STACKARR_TV_4K_PROFILE_PRESET: 'lite',
  STACKARR_MUSIC_PROFILE_PRESET: 'lossless',
  STACKARR_MOVIE_DEFAULT_PROFILE: 'HD Lite',
  STACKARR_MOVIE_4K_DEFAULT_PROFILE: '4K Lite',
  STACKARR_TV_DEFAULT_PROFILE: 'HD Lite',
  STACKARR_TV_4K_DEFAULT_PROFILE: '4K Lite',
  STACKARR_MUSIC_DEFAULT_PROFILE: 'Lossless',

  USERNAME: 'admin',
  PASSWORD: '',
  USER_EMAIL: '',
  PREFERRED_TORRENT_CLIENT: 'transmission',

  DOWNLOAD_INCOMPLETE_NAME: 'incomplete',
  DOWNLOAD_COMPLETE_NAME: 'complete',
  RADARR_CATEGORY: 'radarr',
  RADARR_4K_CATEGORY: 'radarr-uhd',
  SONARR_CATEGORY: 'tv-sonarr',
  SONARR_4K_CATEGORY: 'tv-sonarr-uhd',
  LIDARR_CATEGORY: 'lidarr',
  STREAMRIP_COMMAND: 'rip',

  SEERR_BIND_IP: '0.0.0.0',
  PULSARR_BIND_IP: '127.0.0.1',
  PULSARR_PORT: '3003',
  PULSARR_AUTHENTICATION_METHOD: 'requiredExceptLocal',
  PULSARR_COOKIE_SECURED: 'false',
  TRANSMISSION_BIND_IP: '127.0.0.1',
  TRANSMISSION_URL: 'http://127.0.0.1:9091',
  TRANSMISSION_TORRENT_PORT: '51413',
  QBITTORRENT_BIND_IP: '127.0.0.1',
  QBITTORRENT_URL: 'http://127.0.0.1:8081',
  QBITTORRENT_WEBUI_PORT: '8081',
  QBITTORRENT_TORRENT_PORT: '6881',
  PROWLARR_URL: 'http://127.0.0.1:9696',
  RADARR_URL: 'http://127.0.0.1:7878',
  RADARR_4K_URL: 'http://127.0.0.1:7879',
  RADARR4K_URL: 'http://127.0.0.1:7879',
  SONARR_URL: 'http://127.0.0.1:8989',
  SONARR_4K_URL: 'http://127.0.0.1:8990',
  SONARR4K_URL: 'http://127.0.0.1:8990',
  LIDARR_URL: 'http://127.0.0.1:8686',
  BOOKORBIT_URL: 'http://127.0.0.1:7582',
  BOOKORBIT_APP_URL: 'http://127.0.0.1:7582',
  BOOKORBIT_CLIENT_URL: 'http://127.0.0.1:7582',
  BOOKORBIT_BIND_IP: '127.0.0.1',
  BOOKORBIT_WEB_PORT: '7582',
  BOOKORBIT_CONTAINER_PORT: '7582',
  BOOKORBIT_DATABASE_URL: '',
  BOOKS_ROOT: `${defaultMediaRoot}/Books`,
  BAZARR_URL: 'http://127.0.0.1:6767',
  SEERR_URL: 'http://127.0.0.1:5055',
  PULSARR_URL: 'http://127.0.0.1:3003',
  PLEX_URL: 'http://127.0.0.1:32400',
  JELLYFIN_URL: 'http://127.0.0.1:8096',
  TINYMEDIAMANAGER_URL: 'http://127.0.0.1:4000',
  FLARESOLVERR_URL: 'http://127.0.0.1:8191',

  PROWLARR_API_KEY: '',
  RADARR_API_KEY: '',
  RADARR4K_API_KEY: '',
  SONARR_API_KEY: '',
  SONARR4K_API_KEY: '',
  LIDARR_API_KEY: '',
  SEERR_API_KEY: '',
  PLEX_TOKEN: '',
  JELLYFIN_API_KEY: '',

  BACKUP_TIME: '02:00',
  BACKUP_SCHEDULE: 'weekly',
  BACKUP_WEEKDAY: 'Sun',
  BACKUP_RETENTION_COUNT: '52',
  UPDATE_TIME: '04:30',
  UPDATE_WEEKDAY: 'Sun',
  PLEX_BACKUP_MODE: 'lite',
  STACKARR_STORAGE_WAIT_SECONDS: '600',

  STACKARR_API_KEY: '',
  STACKARR_WEB_ENABLED: 'true',
  STACKARR_IMAGE: 'polyphonic/stackarr:alpha',
  STACKARR_BIND_IP: '127.0.0.1',
  STACKARR_WEB_PORT: '7777',
  STACKARR_TELEMETRY_FEATURE_ENABLED: 'false',
  STACKARR_TELEMETRY_ENABLED: 'false',
  STACKARR_TELEMETRY_ENDPOINT: '',
  STACKARR_TELEMETRY_CHANNEL: 'stable',
  STACKARR_TELEMETRY_INGEST_KEY: '',

  TRANSMISSION_IMAGE: 'lscr.io/linuxserver/transmission:latest',
  QBITTORRENT_IMAGE: 'lscr.io/linuxserver/qbittorrent:latest',
  RADARR_IMAGE: 'lscr.io/linuxserver/radarr:latest',
  SONARR_IMAGE: 'lscr.io/linuxserver/sonarr:latest',
  PROWLARR_IMAGE: 'lscr.io/linuxserver/prowlarr:latest',
  BAZARR_IMAGE: 'lscr.io/linuxserver/bazarr:latest',
  SEERR_IMAGE: 'ghcr.io/seerr-team/seerr:latest',
  PULSARR_IMAGE: 'lakker/pulsarr:latest',
  RECYCLARR_IMAGE: 'ghcr.io/recyclarr/recyclarr:latest',
  FLARESOLVERR_IMAGE: 'ghcr.io/flaresolverr/flaresolverr:latest',
  LIDARR_IMAGE: 'lscr.io/linuxserver/lidarr:latest',
  BOOKORBIT_IMAGE: 'ghcr.io/bookorbit/bookorbit:latest',
  STACKARR_DATABASE_MODE: 'app-default',
  DATABASE_IMAGE: 'pgvector/pgvector:pg18-trixie',
  DATABASE_BIND_IP: '127.0.0.1',
  DATABASE_HOST_PORT: '5433',
  DATABASE_NAME: 'postgres',
  DATABASE_SUPERUSER: 'postgres',
  DATABASE_SUPERUSER_PASSWORD: '',
  STACKARR_POSTGRES_DATABASE: 'stackarr-main',
  STACKARR_POSTGRES_MAIN_DATABASE: 'stackarr-main',
  STACKARR_POSTGRES_LOG_DATABASE: 'stackarr-log',
  STACKARR_POSTGRES_USER: 'stackarr',
  STACKARR_POSTGRES_PASSWORD: '',
  STACKARR_DATABASE_URL: '',
  STACKARR_LOG_DATABASE_URL: '',
  BOOKORBIT_POSTGRES_DATABASE: 'bookorbit',
  BOOKORBIT_POSTGRES_USER: 'bookorbit',
  BOOKORBIT_POSTGRES_PASSWORD: '',
  SEERR_POSTGRES_DATABASE: 'seerr',
  SEERR_POSTGRES_USER: 'seerr',
  SEERR_POSTGRES_PASSWORD: '',
  SEERR_DB_TYPE: 'postgres',
  PULSARR_DB_TYPE: 'sqlite',
  PULSARR_DB_PATH: '/app/data/db/pulsarr.db',
  PULSARR_DB_HOST: '',
  PULSARR_DB_PORT: '',
  PULSARR_DB_NAME: '',
  PULSARR_DB_USER: '',
  PULSARR_DB_PASSWORD: '',
  PULSARR_POSTGRES_DATABASE: 'pulsarr',
  PULSARR_POSTGRES_USER: 'pulsarr',
  PULSARR_POSTGRES_PASSWORD: '',
  BAZARR_POSTGRES_ENABLED: 'false',
  BAZARR_POSTGRES_HOST: '',
  BAZARR_POSTGRES_PORT: '',
  BAZARR_POSTGRES_DATABASE: 'bazarr',
  BAZARR_POSTGRES_USER: 'bazarr',
  BAZARR_POSTGRES_PASSWORD: '',
  PROWLARR_POSTGRES_HOST: '',
  PROWLARR_POSTGRES_PORT: '',
  PROWLARR_POSTGRES_MAIN_DATABASE: 'prowlarr-main',
  PROWLARR_POSTGRES_LOG_DATABASE: 'prowlarr-log',
  PROWLARR_POSTGRES_USER: 'prowlarr',
  PROWLARR_POSTGRES_PASSWORD: '',
  RADARR_POSTGRES_HOST: '',
  RADARR_POSTGRES_PORT: '',
  RADARR_POSTGRES_MAIN_DATABASE: 'radarr-main',
  RADARR_POSTGRES_LOG_DATABASE: 'radarr-log',
  RADARR_POSTGRES_USER: 'radarr',
  RADARR_POSTGRES_PASSWORD: '',
  RADARR4K_POSTGRES_HOST: '',
  RADARR4K_POSTGRES_PORT: '',
  RADARR4K_POSTGRES_MAIN_DATABASE: 'radarr4k-main',
  RADARR4K_POSTGRES_LOG_DATABASE: 'radarr4k-log',
  RADARR4K_POSTGRES_USER: 'radarr4k',
  RADARR4K_POSTGRES_PASSWORD: '',
  SONARR_POSTGRES_HOST: '',
  SONARR_POSTGRES_PORT: '',
  SONARR_POSTGRES_MAIN_DATABASE: 'sonarr-main',
  SONARR_POSTGRES_LOG_DATABASE: 'sonarr-log',
  SONARR_POSTGRES_USER: 'sonarr',
  SONARR_POSTGRES_PASSWORD: '',
  SONARR4K_POSTGRES_HOST: '',
  SONARR4K_POSTGRES_PORT: '',
  SONARR4K_POSTGRES_MAIN_DATABASE: 'sonarr4k-main',
  SONARR4K_POSTGRES_LOG_DATABASE: 'sonarr4k-log',
  SONARR4K_POSTGRES_USER: 'sonarr4k',
  SONARR4K_POSTGRES_PASSWORD: '',
  LIDARR_POSTGRES_HOST: '',
  LIDARR_POSTGRES_PORT: '',
  LIDARR_POSTGRES_MAIN_DATABASE: 'lidarr-main',
  LIDARR_POSTGRES_LOG_DATABASE: 'lidarr-log',
  LIDARR_POSTGRES_USER: 'lidarr',
  LIDARR_POSTGRES_PASSWORD: '',
  BOOKORBIT_JWT_SECRET: '',
  BOOKORBIT_SETUP_TOKEN: '',
  TIDARR_IMAGE: 'cstaelen/tidarr:latest',
  TINYMEDIAMANAGER_IMAGE: 'tinymediamanager/tinymediamanager:latest',
  PLEX_IMAGE: 'lscr.io/linuxserver/plex:latest',
  PLEX_DOCKER_PORT: '32400',
  JELLYFIN_IMAGE: 'lscr.io/linuxserver/jellyfin:latest',
  JELLYFIN_DOCKER_PORT: '8096',

  CLOUDFLARE_TUNNEL_TOKEN: '',
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  CLOUDFLARE_ZONE_ID: '',
  CLOUDFLARED_TUNNEL_NAME: 'stackarr',
  CLOUDFLARED_TUNNEL_ID: '',
  CLOUDFLARED_METRICS_PORT: '42183',
  CLOUDFLARED_BIN: '',
  CLOUDFLARED_TOKEN_FILE: '',
  CLOUDFLARED_KEEP_LAN: 'true',
  CLOUDFLARE_ROUTE_MANAGED: 'false',
  CLOUDFLARE_TUNNEL_ROUTES: '',
  SEERR_ORIGIN_URL: 'http://127.0.0.1:5055'
};

const secretKeys = ['PASSWORD', 'TOKEN', 'API_KEY', 'SECRET', 'KEY'];

export const editableEnvKeys = Object.keys(managedEnvDefaults);

const runtimeConfigKey = 'stackarr.runtimeConfig';

export function readEnv(): StackarrEnv {
  if (!databaseExists()) {
    const seeded = withRuntimeDefaults({});
    writeJsonSetting(runtimeConfigKey, seeded);
    return seeded;
  }

  const stored = readJsonSetting<StackarrEnv | null>(runtimeConfigKey, null);
  if (stored) {
    const normalized = withRuntimeDefaults(stored);
    if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
      writeJsonSetting(runtimeConfigKey, normalized);
    }
    return normalized;
  }

  const seeded = withRuntimeDefaults({});
  writeJsonSetting(runtimeConfigKey, seeded);

  return seeded;
}

export function writeEnvConfig(next: StackarrEnv): StackarrEnv {
  const merged = mergeEditableEnv(readEnv(), next);
  writeJsonSetting(runtimeConfigKey, merged);
  return merged;
}

export function redactEnv(env: StackarrEnv): StackarrEnv {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, isSecretKey(key) && value ? redactSecretValue(value) : value])
  ) as StackarrEnv;
}

export function mergeEditableEnv(current: StackarrEnv, next: StackarrEnv): StackarrEnv {
  const merged = { ...current };

  for (const key of editableEnvKeys) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      if (isSecretKey(key) && isRedactedSecretValue(next[key], current[key])) {
        continue;
      }

      if (isHostPathKey(key) && shouldPreserveHostPath(current[key], next[key])) {
        continue;
      }

      merged[key] = String(next[key] ?? '');
    }
  }

  if (next.STACKARR_API_KEY && !isRedactedSecretValue(next.STACKARR_API_KEY, current.STACKARR_API_KEY)) {
    merged.STACKARR_API_KEY = next.STACKARR_API_KEY;
  }

  dropDeprecatedCloudflareHostnameKeys(merged);
  return merged;
}

function withRuntimeDefaults(env: StackarrEnv): StackarrEnv {
  const merged = { ...managedEnvDefaults, ...env };
  const appRoot = merged.APP_ROOT || managedEnvDefaults.APP_ROOT || defaultAppRoot;

  merged.APP_ROOT = appRoot;
  merged.CONFIG_ROOT = merged.CONFIG_ROOT || `${appRoot}/config`;
  merged.STATE_ROOT = merged.STATE_ROOT || `${appRoot}/state`;
  merged.LOG_ROOT = merged.LOG_ROOT || `${appRoot}/logs`;
  if (!env.MEDIA_ROOT) merged.MEDIA_ROOT = `${appRoot}/media`;
  if (!env.MUSIC_ROOT) merged.MUSIC_ROOT = `${merged.MEDIA_ROOT}/Music`;
  if (!env.DOWNLOADS_ROOT) merged.DOWNLOADS_ROOT = `${appRoot}/downloads`;
  if (!env.BACKUP_ROOT) merged.BACKUP_ROOT = `${appRoot}/backups`;
  merged.PUID = merged.PUID || defaultUid();
  merged.PGID = merged.PGID || defaultGid();
  dropDeprecatedCloudflareHostnameKeys(merged);
  applyHostNativePathDefaults(merged, env);
  if (!env.STACKARR_DATABASE_MODE && env.STACKARR_DATABASE_URL) {
    merged.STACKARR_DATABASE_MODE = 'postgres';
  }
  merged.STACKARR_DATABASE_MODE = normalizeDatabaseMode(merged.STACKARR_DATABASE_MODE);
  const databasePassword = merged.DATABASE_SUPERUSER_PASSWORD || merged.PASSWORD || '';
  merged.STACKARR_POSTGRES_MAIN_DATABASE =
    merged.STACKARR_POSTGRES_MAIN_DATABASE || merged.STACKARR_POSTGRES_DATABASE || 'stackarr-main';
  merged.STACKARR_POSTGRES_DATABASE = merged.STACKARR_POSTGRES_MAIN_DATABASE;
  merged.STACKARR_POSTGRES_LOG_DATABASE = merged.STACKARR_POSTGRES_LOG_DATABASE || 'stackarr-log';
  merged.STACKARR_POSTGRES_USER = merged.STACKARR_POSTGRES_USER || 'stackarr';
  merged.STACKARR_POSTGRES_PASSWORD = merged.STACKARR_POSTGRES_PASSWORD || databasePassword;
  if (merged.STACKARR_DATABASE_MODE === 'postgres' && isLegacyStackarrPostgresUrl(merged.STACKARR_DATABASE_URL)) {
    merged.STACKARR_DATABASE_URL = '';
  }
  if (
    merged.STACKARR_DATABASE_MODE === 'postgres' &&
    !merged.STACKARR_DATABASE_URL &&
    merged.STACKARR_POSTGRES_PASSWORD
  ) {
    merged.STACKARR_DATABASE_URL = `postgres://${encodeURIComponent(merged.STACKARR_POSTGRES_USER)}:${encodeURIComponent(merged.STACKARR_POSTGRES_PASSWORD)}@database:5432/${encodeURIComponent(merged.STACKARR_POSTGRES_DATABASE)}`;
  }
  if (
    merged.STACKARR_DATABASE_MODE === 'postgres' &&
    !merged.STACKARR_LOG_DATABASE_URL &&
    merged.STACKARR_POSTGRES_PASSWORD
  ) {
    merged.STACKARR_LOG_DATABASE_URL = `postgres://${encodeURIComponent(merged.STACKARR_POSTGRES_USER)}:${encodeURIComponent(merged.STACKARR_POSTGRES_PASSWORD)}@database:5432/${encodeURIComponent(merged.STACKARR_POSTGRES_LOG_DATABASE)}`;
  }
  if (merged.STACKARR_DATABASE_MODE !== 'postgres' && !env.STACKARR_DATABASE_URL) {
    merged.STACKARR_DATABASE_URL = '';
  }
  if (merged.STACKARR_DATABASE_MODE !== 'postgres' && !env.STACKARR_LOG_DATABASE_URL) {
    merged.STACKARR_LOG_DATABASE_URL = '';
  }

  applyDatabaseModeDefaults(merged, databasePassword);

  return merged;
}

function dropDeprecatedCloudflareHostnameKeys(env: StackarrEnv) {
  delete env.CLOUDFLARE_HOSTNAME;
  delete env.CLOUDFLARED_TUNNEL_HOSTNAME;
}

function normalizeDatabaseMode(value: string | undefined) {
  switch (String(value ?? '').toLowerCase()) {
    case 'postgres':
    case 'postgresql':
    case 'pg':
      return 'postgres';
    default:
      return 'app-default';
  }
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

function applyDatabaseModeDefaults(env: StackarrEnv, databasePassword: string) {
  const postgresMode = env.STACKARR_DATABASE_MODE === 'postgres';
  const postgresHost = postgresMode ? 'database' : '';
  const postgresPort = postgresMode ? '5432' : '';

  env.DATABASE_SUPERUSER_PASSWORD = env.DATABASE_SUPERUSER_PASSWORD || databasePassword;
  env.BOOKORBIT_POSTGRES_PASSWORD = env.BOOKORBIT_POSTGRES_PASSWORD || databasePassword;
  if (env.BOOKORBIT_POSTGRES_PASSWORD && isManagedBookOrbitPostgresUrl(env.BOOKORBIT_DATABASE_URL, env)) {
    env.BOOKORBIT_DATABASE_URL = buildBookOrbitPostgresUrl(env, databasePassword);
  }
  env.SEERR_POSTGRES_PASSWORD = env.SEERR_POSTGRES_PASSWORD || databasePassword;
  env.PULSARR_POSTGRES_PASSWORD = env.PULSARR_POSTGRES_PASSWORD || databasePassword;
  env.BAZARR_POSTGRES_PASSWORD = env.BAZARR_POSTGRES_PASSWORD || databasePassword;
  env.PROWLARR_POSTGRES_PASSWORD = env.PROWLARR_POSTGRES_PASSWORD || databasePassword;
  env.RADARR_POSTGRES_PASSWORD = env.RADARR_POSTGRES_PASSWORD || databasePassword;
  env.RADARR4K_POSTGRES_PASSWORD = env.RADARR4K_POSTGRES_PASSWORD || databasePassword;
  env.SONARR_POSTGRES_PASSWORD = env.SONARR_POSTGRES_PASSWORD || databasePassword;
  env.SONARR4K_POSTGRES_PASSWORD = env.SONARR4K_POSTGRES_PASSWORD || databasePassword;
  env.LIDARR_POSTGRES_PASSWORD = env.LIDARR_POSTGRES_PASSWORD || databasePassword;

  env.PULSARR_DB_TYPE = postgresMode ? 'postgres' : env.PULSARR_DB_TYPE || 'sqlite';
  if (postgresMode && env.PULSARR_DB_TYPE === 'postgres') {
    env.PULSARR_DB_HOST = env.PULSARR_DB_HOST || 'database';
    env.PULSARR_DB_PORT = env.PULSARR_DB_PORT || '5432';
    env.PULSARR_DB_NAME = env.PULSARR_DB_NAME || env.PULSARR_POSTGRES_DATABASE || 'pulsarr';
    env.PULSARR_DB_USER = env.PULSARR_DB_USER || env.PULSARR_POSTGRES_USER || 'pulsarr';
    env.PULSARR_DB_PASSWORD = env.PULSARR_DB_PASSWORD || env.PULSARR_POSTGRES_PASSWORD || databasePassword;
  }

  env.BAZARR_POSTGRES_ENABLED = postgresMode ? 'true' : 'false';
  env.BAZARR_POSTGRES_HOST = env.BAZARR_POSTGRES_HOST || postgresHost;
  env.BAZARR_POSTGRES_PORT = env.BAZARR_POSTGRES_PORT || postgresPort;
  env.PROWLARR_POSTGRES_HOST = env.PROWLARR_POSTGRES_HOST || postgresHost;
  env.PROWLARR_POSTGRES_PORT = env.PROWLARR_POSTGRES_PORT || postgresPort;
  env.RADARR_POSTGRES_HOST = env.RADARR_POSTGRES_HOST || postgresHost;
  env.RADARR_POSTGRES_PORT = env.RADARR_POSTGRES_PORT || postgresPort;
  env.RADARR4K_POSTGRES_HOST = env.RADARR4K_POSTGRES_HOST || postgresHost;
  env.RADARR4K_POSTGRES_PORT = env.RADARR4K_POSTGRES_PORT || postgresPort;
  env.SONARR_POSTGRES_HOST = env.SONARR_POSTGRES_HOST || postgresHost;
  env.SONARR_POSTGRES_PORT = env.SONARR_POSTGRES_PORT || postgresPort;
  env.SONARR4K_POSTGRES_HOST = env.SONARR4K_POSTGRES_HOST || postgresHost;
  env.SONARR4K_POSTGRES_PORT = env.SONARR4K_POSTGRES_PORT || postgresPort;
  env.LIDARR_POSTGRES_HOST = env.LIDARR_POSTGRES_HOST || postgresHost;
  env.LIDARR_POSTGRES_PORT = env.LIDARR_POSTGRES_PORT || postgresPort;
}

function buildBookOrbitPostgresUrl(env: StackarrEnv, databasePassword: string) {
  const user = env.BOOKORBIT_POSTGRES_USER || 'bookorbit';
  const password = env.BOOKORBIT_POSTGRES_PASSWORD || databasePassword;
  const database = env.BOOKORBIT_POSTGRES_DATABASE || 'bookorbit';

  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@database:5432/${encodeURIComponent(database)}`;
}

function isManagedBookOrbitPostgresUrl(value: string | undefined, env: StackarrEnv) {
  if (!value) {
    return true;
  }

  try {
    const url = new URL(value);
    const expectedUser = env.BOOKORBIT_POSTGRES_USER || 'bookorbit';
    const expectedDatabase = env.BOOKORBIT_POSTGRES_DATABASE || 'bookorbit';
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname === 'database' &&
      (!url.port || url.port === '5432') &&
      decodeURIComponent(url.username) === expectedUser &&
      database === expectedDatabase
    );
  } catch {
    return false;
  }
}

function applyHostNativePathDefaults(merged: StackarrEnv, original: StackarrEnv) {
  const hostHome = inferredHostHome(merged);

  if (!hostHome) {
    return;
  }

  if (!original.PLEX_CONFIG_PATH || isContainerHomeNativePath(original.PLEX_CONFIG_PATH)) {
    merged.PLEX_CONFIG_PATH = `${hostHome}/Library/Application Support/Plex Media Server`;
  }

  if (!original.PLEX_PREFS_PATH || isContainerHomeNativePath(original.PLEX_PREFS_PATH)) {
    merged.PLEX_PREFS_PATH = `${hostHome}/Library/Preferences/com.plexapp.plexmediaserver.plist`;
  }

  if (!original.JELLYFIN_CONFIG_PATH || isContainerHomeNativePath(original.JELLYFIN_CONFIG_PATH)) {
    merged.JELLYFIN_CONFIG_PATH = `${hostHome}/.local/share/jellyfin`;
  }
}

function inferredHostHome(env: StackarrEnv) {
  const roots = [
    env.APP_ROOT,
    env.CONFIG_ROOT,
    env.BACKUP_ROOT,
    env.MEDIA_ROOT,
    env.MUSIC_ROOT,
    env.DOWNLOADS_ROOT
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const match = root.match(/^(\/Users\/[^/]+)/);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function isContainerHomeNativePath(value: string | undefined) {
  return Boolean(value && /^(\/root|\/home\/node)\//.test(value));
}

function isHostPathKey(key: string) {
  return [
    'APP_ROOT',
    'CONFIG_ROOT',
    'STATE_ROOT',
    'LOG_ROOT',
    'MEDIA_ROOT',
    'MUSIC_ROOT',
    'DOWNLOADS_ROOT',
    'BACKUP_ROOT',
    'BACKUP_STAGING_ROOT',
    'BOOKS_ROOT',
    'PLEX_CONFIG_PATH',
    'PLEX_PREFS_PATH',
    'JELLYFIN_CONFIG_PATH'
  ].includes(key);
}

function shouldPreserveHostPath(currentValue: string | undefined, nextValue: unknown) {
  const currentText = String(currentValue ?? '');
  const nextText = String(nextValue ?? '');

  return Boolean(currentText && !isContainerFallbackPath(currentText) && isContainerFallbackPath(nextText));
}

function isContainerFallbackPath(value: string) {
  return value.startsWith('/stackarr-workspace/') || value.startsWith('/stackarr-state/');
}

export function isSecretKey(key: string): boolean {
  return secretKeys.some((fragment) => key.toUpperCase().includes(fragment));
}

function redactSecretValue(value: string) {
  const text = String(value);

  if (text.length <= 4) {
    return '...';
  }

  if (text.length <= 10) {
    return `${text.slice(0, 2)}...${text.slice(-2)}`;
  }

  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function isRedactedSecretValue(value: unknown, currentValue: unknown) {
  const text = String(value ?? '');

  if (text === '********') {
    return true;
  }

  return Boolean(currentValue) && text === redactSecretValue(String(currentValue));
}

export function defaultStackarrAppRoot() {
  if (process.env.APP_ROOT_DEFAULT_OVERRIDE) {
    return process.env.APP_ROOT_DEFAULT_OVERRIDE;
  }

  if (process.env.STACKARR_RUNTIME === 'docker' && process.env.STACKARR_REPO_ROOT) {
    return `${process.env.STACKARR_REPO_ROOT}/stackarr/.stackarr`;
  }

  if (process.platform === 'darwin') {
    return `${home}/Library/Application Support/Stackarr`;
  }

  if (process.platform === 'win32') {
    return `${process.env.LOCALAPPDATA ?? process.env.APPDATA ?? home}/Stackarr`;
  }

  return `${process.env.XDG_DATA_HOME ?? `${home}/.local/share`}/stackarr`;
}

function defaultUid() {
  return typeof process.getuid === 'function' ? String(process.getuid()) : '501';
}

function defaultGid() {
  return typeof process.getgid === 'function' ? String(process.getgid()) : '20';
}
