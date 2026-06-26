import { managedEnvDefaults, readEnv, redactEnv, type StackarrEnv, writeEnvConfig } from './env';
import { presetFiles, readJsonPreset, writeJsonPreset } from './presets';
import {
  mediaProfileNameFromPreset,
  mediaProfilePresetOptions,
  musicProfileNameFromPreset,
  musicProfilePresetOptions
} from './profilePresets';
import { getServices, type ServiceSummary } from './services';
import { readSettings, type StackarrSettings, type StackarrSettingsPatch, writeSettings } from './settings';
import { getStreamripServiceConfigGroups } from './streamrip/config';

type PresetName = keyof typeof presetFiles;
type FieldType = 'text' | 'password' | 'number' | 'checkbox' | 'select' | 'json' | 'path';

type EnvSource = { source: 'env'; key: string };
type SettingsSource = { source: 'settings'; path: string[] };
type PresetSource = { source: 'preset'; preset: PresetName; path: string[] };
type StreamripSource = { source: 'streamrip'; id: string };

export type ServiceConfigField = {
  id: string;
  label: string;
  type: FieldType;
  source: EnvSource | SettingsSource | PresetSource | StreamripSource;
  value: unknown;
  options?: string[];
  description?: string;
  secret?: boolean;
};

export type ServiceConfigGroup = {
  title: string;
  description?: string;
  fields: ServiceConfigField[];
};

export type ServiceConfigModel = {
  service: ServiceSummary;
  groups: ServiceConfigGroup[];
};

type FieldDefinition = Omit<ServiceConfigField, 'value'>;
type GroupDefinition = Omit<ServiceConfigGroup, 'fields'> & { fields: FieldDefinition[] };

const serviceGroups: Record<string, GroupDefinition[]> = {
  stackarr: [
    group('Dashboard Runtime', [
      envText('stackarrBindIp', 'Bind IP', 'STACKARR_BIND_IP'),
      envNumber('stackarrWebPort', 'Web Port', 'STACKARR_WEB_PORT'),
      envPassword('stackarrApiKey', 'API Key', 'STACKARR_API_KEY'),
      envText('stackarrImage', 'Docker Image', 'STACKARR_IMAGE')
    ]),
    group('Storage', [
      envPath('mediaRoot', 'Media Root', 'MEDIA_ROOT'),
      envPath('musicRoot', 'Music Root', 'MUSIC_ROOT'),
      envPath('downloadsRoot', 'Downloads Root', 'DOWNLOADS_ROOT'),
      envPath('backupRoot', 'Backup Root', 'BACKUP_ROOT'),
      envPath('booksRoot', 'Books Root', 'BOOKS_ROOT')
    ]),
    group('Database', [
      envSelect('stackarrDatabaseMode', 'Mode', 'STACKARR_DATABASE_MODE', ['app-default', 'postgres']),
      envPassword('databaseSuperuserPassword', 'Postgres Superuser Password', 'DATABASE_SUPERUSER_PASSWORD'),
      envText('stackarrPostgresDatabase', 'Database Name', 'STACKARR_POSTGRES_DATABASE'),
      envText('stackarrPostgresUser', 'Database User', 'STACKARR_POSTGRES_USER'),
      envPassword('stackarrPostgresPassword', 'Database Password', 'STACKARR_POSTGRES_PASSWORD'),
      envPassword('stackarrDatabaseUrl', 'Database URL', 'STACKARR_DATABASE_URL')
    ]),
    group('Browser Links', [
      settingsSelect(
        'serviceUrlMode',
        'Service Link Mode',
        ['ui', 'serviceUrlMode'],
        ['localhost', 'portless', 'loopback']
      ),
      settingsSelect('serviceUrlScheme', 'Portless Scheme', ['ui', 'serviceUrlScheme'], ['https', 'http']),
      settingsText('serviceUrlHostSuffix', 'Portless Host Suffix', ['ui', 'serviceUrlHostSuffix'])
    ])
  ],
  transmission: [
    group('Service', [
      envSelect(
        'preferredTorrentClient',
        'Preferred Client',
        'PREFERRED_TORRENT_CLIENT',
        ['transmission', 'qbittorrent'],
        'Set Transmission as the downloader Stackarr wires into Arr apps.'
      ),
      envText('transmissionUrl', 'Local URL', 'TRANSMISSION_URL'),
      envText('transmissionBindIp', 'Bind IP', 'TRANSMISSION_BIND_IP'),
      envNumber('transmissionTorrentPort', 'Torrent Port', 'TRANSMISSION_TORRENT_PORT'),
      envText('transmissionImage', 'Docker Image', 'TRANSMISSION_IMAGE'),
      envText('downloadCompleteName', 'Completed Folder Name', 'DOWNLOAD_COMPLETE_NAME'),
      envText('downloadIncompleteName', 'Incomplete Folder Name', 'DOWNLOAD_INCOMPLETE_NAME'),
      envText('globalUsername', 'Shared Username', 'USERNAME'),
      envPassword('globalPassword', 'Shared Password', 'PASSWORD')
    ]),
    group('Download Preset', [
      presetJson('transmissionPreset', 'Transmission Preset', 'downloads', ['transmission']),
      presetJson('servarrTransmissionPreset', 'Arr Import Behavior', 'downloads', ['servarr', 'transmission'])
    ])
  ],
  qbittorrent: [
    group('Service', [
      envSelect(
        'preferredTorrentClient',
        'Preferred Client',
        'PREFERRED_TORRENT_CLIENT',
        ['transmission', 'qbittorrent'],
        'Set qBittorrent as the downloader Stackarr wires into Arr apps.'
      ),
      envText('qbittorrentUrl', 'Local URL', 'QBITTORRENT_URL'),
      envText('qbittorrentBindIp', 'Bind IP', 'QBITTORRENT_BIND_IP'),
      envNumber('qbittorrentWebPort', 'Web UI Port', 'QBITTORRENT_WEBUI_PORT'),
      envNumber('qbittorrentTorrentPort', 'Torrent Port', 'QBITTORRENT_TORRENT_PORT'),
      envText('qbittorrentImage', 'Docker Image', 'QBITTORRENT_IMAGE'),
      envText('downloadCompleteName', 'Completed Folder Name', 'DOWNLOAD_COMPLETE_NAME'),
      envText('downloadIncompleteName', 'Incomplete Folder Name', 'DOWNLOAD_INCOMPLETE_NAME'),
      envText('globalUsername', 'Shared Username', 'USERNAME'),
      envPassword('globalPassword', 'Shared Password', 'PASSWORD')
    ]),
    group('Download Preset', [
      presetJson('qbittorrentPreset', 'qBittorrent Preset', 'downloads', ['qbittorrent']),
      presetJson('servarrQbittorrentPreset', 'Arr Import Behavior', 'downloads', ['servarr', 'qbittorrent'])
    ])
  ],
  prowlarr: [
    group('API and Sync', [
      envText('prowlarrUrl', 'Local URL', 'PROWLARR_URL'),
      envPassword('prowlarrApiKey', 'API Key', 'PROWLARR_API_KEY'),
      envCheckbox('enableFlaresolverr', 'Use FlareSolverr Helper', 'ENABLE_FLARESOLVERR'),
      envText('prowlarrImage', 'Docker Image', 'PROWLARR_IMAGE')
    ])
  ],
  radarr: [
    group('Movie Profiles', [
      envCheckbox('enableMovies', 'Enable Movies (Radarr)', 'ENABLE_MOVIES'),
      envSelect(
        'movieProfilePreset',
        'Movie Profile Preset',
        'STACKARR_MOVIE_PROFILE_PRESET',
        [...mediaProfilePresetOptions],
        'Controls generated Recyclarr size/profile defaults for HD Radarr.'
      ),
      envText('movieDefault', 'Default Movie Profile', 'STACKARR_MOVIE_DEFAULT_PROFILE'),
      envSelect(
        'movie4kProfilePreset',
        '4K Movie Profile Preset',
        'STACKARR_MOVIE_4K_PROFILE_PRESET',
        [...mediaProfilePresetOptions],
        'Controls generated Recyclarr size/profile defaults for 4K Radarr.'
      ),
      envText('movie4kDefault', 'Default 4K Movie Profile', 'STACKARR_MOVIE_4K_DEFAULT_PROFILE'),
      envCheckbox('enable4kServarr', 'Run Separate 4K Arr Instances', 'ENABLE_4K_SERVARR')
    ]),
    group('API', [
      envText('radarrUrl', 'Local URL', 'RADARR_URL'),
      envPassword('radarrApiKey', 'API Key', 'RADARR_API_KEY'),
      envText('radarrCategory', 'Download Category', 'RADARR_CATEGORY'),
      envText('radarrImage', 'Docker Image', 'RADARR_IMAGE')
    ]),
    group('Naming', [presetJson('radarrNaming', 'Radarr Naming Scheme', 'naming', ['radarr'])])
  ],
  radarr4k: [
    group('4K Movie Service', [
      envCheckbox('enable4kServarr', 'Run Separate 4K Arr Instances', 'ENABLE_4K_SERVARR'),
      envSelect('movie4kProfilePreset', '4K Movie Profile Preset', 'STACKARR_MOVIE_4K_PROFILE_PRESET', [
        ...mediaProfilePresetOptions
      ]),
      envText('movie4kDefault', 'Default 4K Movie Profile', 'STACKARR_MOVIE_4K_DEFAULT_PROFILE')
    ]),
    group('API', [
      envText('radarr4kUrl', 'Local URL', 'RADARR4K_URL'),
      envPassword('radarr4kApiKey', 'API Key', 'RADARR4K_API_KEY'),
      envText('radarr4kCategory', 'Download Category', 'RADARR_4K_CATEGORY'),
      envText('radarrImage', 'Docker Image', 'RADARR_IMAGE')
    ]),
    group('Naming', [presetJson('radarrNaming', 'Radarr Naming Scheme', 'naming', ['radarr'])])
  ],
  sonarr: [
    group('TV Profiles', [
      envCheckbox('enableTvShows', 'Enable TV Shows (Sonarr)', 'ENABLE_TV_SHOWS'),
      envSelect(
        'tvProfilePreset',
        'TV Profile Preset',
        'STACKARR_TV_PROFILE_PRESET',
        [...mediaProfilePresetOptions],
        'Controls generated Recyclarr size/profile defaults for HD Sonarr.'
      ),
      envText('tvDefault', 'Default TV Profile', 'STACKARR_TV_DEFAULT_PROFILE'),
      envSelect(
        'tv4kProfilePreset',
        '4K TV Profile Preset',
        'STACKARR_TV_4K_PROFILE_PRESET',
        [...mediaProfilePresetOptions],
        'Controls generated Recyclarr size/profile defaults for 4K Sonarr.'
      ),
      envText('tv4kDefault', 'Default 4K TV Profile', 'STACKARR_TV_4K_DEFAULT_PROFILE'),
      envCheckbox('enable4kServarr', 'Run Separate 4K Arr Instances', 'ENABLE_4K_SERVARR')
    ]),
    group('API', [
      envText('sonarrUrl', 'Local URL', 'SONARR_URL'),
      envPassword('sonarrApiKey', 'API Key', 'SONARR_API_KEY'),
      envText('sonarrCategory', 'Download Category', 'SONARR_CATEGORY'),
      envText('sonarrImage', 'Docker Image', 'SONARR_IMAGE')
    ]),
    group('Naming', [presetJson('sonarrNaming', 'Sonarr Naming Scheme', 'naming', ['sonarr'])])
  ],
  sonarr4k: [
    group('4K TV Service', [
      envCheckbox('enable4kServarr', 'Run Separate 4K Arr Instances', 'ENABLE_4K_SERVARR'),
      envSelect('tv4kProfilePreset', '4K TV Profile Preset', 'STACKARR_TV_4K_PROFILE_PRESET', [
        ...mediaProfilePresetOptions
      ]),
      envText('tv4kDefault', 'Default 4K TV Profile', 'STACKARR_TV_4K_DEFAULT_PROFILE')
    ]),
    group('API', [
      envText('sonarr4kUrl', 'Local URL', 'SONARR4K_URL'),
      envPassword('sonarr4kApiKey', 'API Key', 'SONARR4K_API_KEY'),
      envText('sonarr4kCategory', 'Download Category', 'SONARR_4K_CATEGORY'),
      envText('sonarrImage', 'Docker Image', 'SONARR_IMAGE')
    ]),
    group('Naming', [presetJson('sonarrNaming', 'Sonarr Naming Scheme', 'naming', ['sonarr'])])
  ],
  lidarr: [
    group('Music Automation', [
      envCheckbox('enableLidarr', 'Enable Lidarr', 'ENABLE_LIDARR'),
      envSelect('musicProfilePreset', 'Music Profile Preset', 'STACKARR_MUSIC_PROFILE_PRESET', [
        ...musicProfilePresetOptions
      ]),
      envText('musicDefault', 'Default Music Profile', 'STACKARR_MUSIC_DEFAULT_PROFILE'),
      envText('lidarrUrl', 'Local URL', 'LIDARR_URL'),
      envPassword('lidarrApiKey', 'API Key', 'LIDARR_API_KEY'),
      envText('lidarrCategory', 'Download Category', 'LIDARR_CATEGORY'),
      envText('lidarrImage', 'Docker Image', 'LIDARR_IMAGE')
    ])
  ],
  bookorbit: [
    group('Books (BookOrbit)', [
      envCheckbox('enableBookOrbit', 'Enable BookOrbit', 'ENABLE_BOOKORBIT'),
      envText('bookorbitUrl', 'Local URL', 'BOOKORBIT_URL'),
      envText('bookorbitBindIp', 'Bind IP', 'BOOKORBIT_BIND_IP'),
      envNumber('bookorbitWebPort', 'Web Port', 'BOOKORBIT_WEB_PORT'),
      envNumber('bookorbitContainerPort', 'Container Port', 'BOOKORBIT_CONTAINER_PORT'),
      envPath('booksRoot', 'Books Root', 'BOOKS_ROOT'),
      envText('bookorbitAppUrl', 'App URL', 'BOOKORBIT_APP_URL'),
      envText('bookorbitClientUrl', 'Client URL', 'BOOKORBIT_CLIENT_URL'),
      envText('bookorbitImage', 'Docker Image', 'BOOKORBIT_IMAGE'),
      envText('databaseImage', 'Database Image', 'DATABASE_IMAGE'),
      envPassword('bookorbitDatabaseUrl', 'Database URL', 'BOOKORBIT_DATABASE_URL'),
      envText('bookorbitPostgresDatabase', 'Database Name', 'BOOKORBIT_POSTGRES_DATABASE'),
      envText('bookorbitPostgresUser', 'Database User', 'BOOKORBIT_POSTGRES_USER'),
      envPassword('bookorbitPostgresPassword', 'Postgres Password', 'BOOKORBIT_POSTGRES_PASSWORD'),
      envPassword('bookorbitJwtSecret', 'JWT Secret', 'BOOKORBIT_JWT_SECRET'),
      envPassword('bookorbitSetupToken', 'Setup Token', 'BOOKORBIT_SETUP_TOKEN')
    ])
  ],
  bazarr: [
    group('Subtitles', [
      envCheckbox('enableBazarr', 'Enable Bazarr', 'ENABLE_BAZARR'),
      envText('bazarrUrl', 'Local URL', 'BAZARR_URL'),
      envText('bazarrImage', 'Docker Image', 'BAZARR_IMAGE')
    ]),
    group('Database', [
      envCheckbox('bazarrPostgresEnabled', 'Use Postgres', 'BAZARR_POSTGRES_ENABLED'),
      envText('bazarrPostgresDatabase', 'Database Name', 'BAZARR_POSTGRES_DATABASE'),
      envText('bazarrPostgresUser', 'Database User', 'BAZARR_POSTGRES_USER'),
      envPassword('bazarrPostgresPassword', 'Database Password', 'BAZARR_POSTGRES_PASSWORD')
    ])
  ],
  tinymediamanager: [
    group('Metadata and Renaming', [
      envCheckbox('enableTinyMediaManager', 'Enable TinyMediaManager', 'ENABLE_TINYMEDIAMANAGER'),
      envText('tinyMediaManagerUrl', 'Local URL', 'TINYMEDIAMANAGER_URL'),
      envText('tinyMediaManagerImage', 'Docker Image', 'TINYMEDIAMANAGER_IMAGE'),
      presetJson('tinyMediaManagerNaming', 'TinyMediaManager Naming Scheme', 'naming', ['tinymediamanager'])
    ])
  ],
  recyclarr: [
    group('Profile Sync', [
      envCheckbox('enableRecyclarr', 'Enable Recyclarr', 'ENABLE_RECYCLARR'),
      envSelect('movieProfilePreset', 'Movie Profile Preset', 'STACKARR_MOVIE_PROFILE_PRESET', [
        ...mediaProfilePresetOptions
      ]),
      envSelect('tvProfilePreset', 'TV Profile Preset', 'STACKARR_TV_PROFILE_PRESET', [...mediaProfilePresetOptions]),
      envText('recyclarrImage', 'Docker Image', 'RECYCLARR_IMAGE')
    ])
  ],
  flaresolverr: [
    group('Indexer Proxy', [
      envCheckbox('enableFlaresolverr', 'Enable FlareSolverr', 'ENABLE_FLARESOLVERR'),
      envText('flaresolverrUrl', 'Local URL', 'FLARESOLVERR_URL'),
      envText('flaresolverrImage', 'Docker Image', 'FLARESOLVERR_IMAGE')
    ])
  ],
  tidarr: [
    group('Music Downloads', [
      envCheckbox('enableTidarr', 'Enable Tidarr', 'ENABLE_TIDARR'),
      envText('tidarrImage', 'Docker Image', 'TIDARR_IMAGE')
    ])
  ],
  seerr: [
    group('Request Portal', [
      envCheckbox('enableSeerr', 'Enable Seerr', 'ENABLE_SEERR'),
      envCheckbox('configureSeerr', 'Wire Arr Services', 'STACKARR_CONFIGURE_SEERR'),
      envText('seerrUrl', 'Local URL', 'SEERR_URL'),
      envText('seerrBindIp', 'Bind IP', 'SEERR_BIND_IP'),
      envPassword('seerrApiKey', 'API Key', 'SEERR_API_KEY'),
      envText('seerrImage', 'Docker Image', 'SEERR_IMAGE')
    ]),
    group('Database', [
      envText('seerrPostgresDatabase', 'Database Name', 'SEERR_POSTGRES_DATABASE'),
      envText('seerrPostgresUser', 'Database User', 'SEERR_POSTGRES_USER'),
      envPassword('seerrPostgresPassword', 'Database Password', 'SEERR_POSTGRES_PASSWORD')
    ]),
    group(
      'Cloudflare Tunnel',
      [
        envPassword('cloudflareTunnelToken', 'Tunnel Token', 'CLOUDFLARE_TUNNEL_TOKEN'),
        envPassword('cloudflareApiToken', 'API Token', 'CLOUDFLARE_API_TOKEN'),
        envText('cloudflareAccountId', 'Account ID', 'CLOUDFLARE_ACCOUNT_ID'),
        envText('cloudflareZoneId', 'Zone ID', 'CLOUDFLARE_ZONE_ID'),
        envText('cloudflaredTunnelName', 'Tunnel Name', 'CLOUDFLARED_TUNNEL_NAME'),
        envText('cloudflaredTunnelId', 'Tunnel ID', 'CLOUDFLARED_TUNNEL_ID')
      ],
      'Public app exposure is managed by the Connect route list.'
    ),
    group('Request Defaults', [presetJson('seerrRequests', 'Seerr Request Preset', 'requests', ['seerr'])])
  ],
  pulsarr: [
    group('Watchlist Automation', [
      envCheckbox('enablePulsarr', 'Enable Pulsarr', 'ENABLE_PULSARR'),
      envText('pulsarrUrl', 'Local URL', 'PULSARR_URL'),
      envText('pulsarrBindIp', 'Bind IP', 'PULSARR_BIND_IP'),
      envNumber('pulsarrPort', 'Port', 'PULSARR_PORT'),
      envSelect('pulsarrAuth', 'Authentication', 'PULSARR_AUTHENTICATION_METHOD', [
        'requiredExceptLocal',
        'required',
        'disabled'
      ]),
      envCheckbox('pulsarrCookieSecure', 'Secure Cookies', 'PULSARR_COOKIE_SECURED'),
      envText('pulsarrImage', 'Docker Image', 'PULSARR_IMAGE')
    ]),
    group('Database', [
      envSelect('pulsarrDatabaseType', 'Database Type', 'PULSARR_DB_TYPE', ['sqlite', 'postgres']),
      envText('pulsarrPostgresDatabase', 'Database Name', 'PULSARR_POSTGRES_DATABASE'),
      envText('pulsarrPostgresUser', 'Database User', 'PULSARR_POSTGRES_USER'),
      envPassword('pulsarrPostgresPassword', 'Database Password', 'PULSARR_POSTGRES_PASSWORD')
    ])
  ],
  plex: [
    group('Media Server', [
      envSelect('plexInstallMode', 'Install Mode', 'PLEX_INSTALL_MODE', ['native', 'docker', 'disabled']),
      envText('plexUrl', 'Local URL', 'PLEX_URL'),
      envPath('plexConfigPath', 'Native Config Path', 'PLEX_CONFIG_PATH'),
      envPath('plexPrefsPath', 'Native Preferences Path', 'PLEX_PREFS_PATH'),
      envPassword('plexToken', 'Plex Token', 'PLEX_TOKEN'),
      envText('plexImage', 'Docker Image', 'PLEX_IMAGE'),
      envNumber('plexDockerPort', 'Docker Port', 'PLEX_DOCKER_PORT')
    ])
  ],
  jellyfin: [
    group('Media Server', [
      envSelect('jellyfinInstallMode', 'Install Mode', 'JELLYFIN_INSTALL_MODE', ['disabled', 'native', 'docker']),
      envText('jellyfinUrl', 'Local URL', 'JELLYFIN_URL'),
      envPath('jellyfinConfigPath', 'Native Config Path', 'JELLYFIN_CONFIG_PATH'),
      envPassword('jellyfinApiKey', 'API Key', 'JELLYFIN_API_KEY'),
      envText('jellyfinImage', 'Docker Image', 'JELLYFIN_IMAGE'),
      envNumber('jellyfinDockerPort', 'Docker Port', 'JELLYFIN_DOCKER_PORT')
    ])
  ],
  backup: [
    group('Schedule and Retention', [
      envPath('backupRoot', 'Backup Root', 'BACKUP_ROOT', 'Destination folder for Stackarr/Plex backup archives.'),
      envPath(
        'backupStagingRoot',
        'Backup Staging Root',
        'BACKUP_STAGING_ROOT',
        'Optional scratch folder for building archives. Blank uses Backup Root/.stackarr-staging.'
      ),
      envText('backupTime', 'Backup Time', 'BACKUP_TIME', 'Local time in HH:MM used by the installed LaunchAgent.'),
      envSelect(
        'backupSchedule',
        'Backup Schedule',
        'BACKUP_SCHEDULE',
        ['weekly', 'daily'],
        'weekly runs on the selected weekday; daily runs every day.'
      ),
      envSelect(
        'backupWeekday',
        'Backup Weekday',
        'BACKUP_WEEKDAY',
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        'Used when Backup Schedule is weekly.'
      ),
      envCheckbox(
        'enableBackup',
        'Enable Scheduled Backup',
        'ENABLE_BACKUP',
        'When off, Stackarr does not install/run the scheduled backup service.'
      ),
      envNumber(
        'backupRetentionCount',
        'Backup Archives to Keep',
        'BACKUP_RETENTION_COUNT',
        'Number of latest backup archives the installed backup service keeps after each run.'
      ),
      envSelect(
        'plexBackupMode',
        'Backup Mode',
        'PLEX_BACKUP_MODE',
        ['lite', 'full'],
        'lite keeps restore-critical databases and config while excluding rebuildable Plex data, logs, caches, internal backups, runtime files, and Arr cover art; full also keeps regenerated assets.'
      ),
      envText('updateTime', 'Update Time', 'UPDATE_TIME'),
      envText('updateWeekday', 'Update Weekday', 'UPDATE_WEEKDAY')
    ])
  ]
};

export function listServiceConfigsAction() {
  return getServices().map((service) => buildModel(service));
}

export function getServiceConfigAction({ service }: { service: string }) {
  const summary = findService(service);

  if (!summary) {
    return { service, error: 'Service is not configurable from the Stackarr service catalog.' };
  }

  return buildModel(summary);
}

export function updateServiceConfigAction(input: { service: string; values: Record<string, unknown> }) {
  const summary = findService(input.service);

  if (!summary) {
    return {
      service: input.service,
      accepted: false,
      error: 'Service is not configurable from the Stackarr service catalog.'
    };
  }

  const definitions = serviceGroups[summary.name] ?? [];
  const fields = definitions.flatMap((groupDefinition) => groupDefinition.fields);
  const envPatch: StackarrEnv = {};
  let settingsPatch: StackarrSettingsPatch = {};
  const presetPatches = new Map<PresetName, unknown>();

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(input.values, field.id)) {
      continue;
    }

    const value = normalizeValue(field, input.values[field.id]);
    const source = field.source;

    if (source.source === 'env') {
      envPatch[source.key] = envValue(value);
    } else if (source.source === 'settings') {
      settingsPatch = setPath(settingsPatch, source.path, value) as StackarrSettingsPatch;
    } else if (source.source === 'preset') {
      const currentPreset = structuredClone(presetPatches.get(source.preset) ?? readJsonPreset(source.preset) ?? {});
      presetPatches.set(source.preset, setPath(currentPreset, source.path, value));
    }
  }

  if (Object.keys(envPatch).length > 0) {
    writeEnvConfig(envPatch);
    settingsPatch = mergeSettingsPatch(settingsPatch, settingsPatchFromEnv(envPatch));
  }

  if (Object.keys(settingsPatch).length > 0) {
    writeSettings(settingsPatch);
  }

  for (const [preset, value] of presetPatches) {
    writeJsonPreset(preset, value);
  }

  return {
    accepted: true,
    config: buildModel(findService(summary.name) ?? summary)
  };
}

function buildModel(service: ServiceSummary): ServiceConfigModel {
  if (service.name === 'streamrip') {
    return {
      service,
      groups: getStreamripServiceConfigGroups().map((groupDefinition) => ({
        title: groupDefinition.title,
        description: groupDefinition.description,
        fields: groupDefinition.fields.map((field) => ({
          id: field.id,
          label: field.label,
          type: field.type,
          source: { source: 'streamrip', id: field.id },
          value: field.defaultValue,
          options: field.options,
          description: field.description,
          secret: field.secret
        }))
      }))
    };
  }

  const env = readEnv();
  const safeEnv = redactEnv(env);
  const settings = readSettings();
  const presets: Partial<Record<PresetName, unknown>> = {
    naming: readJsonPreset('naming'),
    downloads: readJsonPreset('downloads'),
    requests: readJsonPreset('requests')
  };

  return {
    service,
    groups: (serviceGroups[service.name] ?? [])
      .map((groupDefinition) => ({
        ...groupDefinition,
        fields: groupDefinition.fields
          .filter((field) => visibleField(service.name, field, safeEnv))
          .map((field) => ({
            ...field,
            value: fieldValue(field, safeEnv, settings, presets)
          }))
      }))
      .filter((groupDefinition) => groupDefinition.fields.length > 0)
  };
}

function visibleField(serviceName: string, field: FieldDefinition, env: StackarrEnv) {
  if (envFlag(env.ENABLE_4K_SERVARR, false)) {
    return true;
  }

  if (serviceName === 'radarr' && (field.id === 'movie4kProfilePreset' || field.id === 'movie4kDefault')) {
    return false;
  }

  if (serviceName === 'sonarr' && (field.id === 'tv4kProfilePreset' || field.id === 'tv4kDefault')) {
    return false;
  }

  return true;
}

function envFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function findService(service: string) {
  return getServices().find((item) => item.name === service);
}

function fieldValue(
  field: FieldDefinition,
  env: StackarrEnv,
  settings: StackarrSettings,
  presets: Partial<Record<PresetName, unknown>>
) {
  const source = field.source;

  if (source.source === 'env') {
    return env[source.key] ?? defaultEnvValue(source.key);
  }

  if (source.source === 'settings') {
    return getPath(settings, source.path);
  }

  if (source.source === 'preset') {
    return getPath(presets[source.preset] ?? {}, source.path);
  }

  return undefined;
}

function defaultEnvValue(key: string) {
  return managedEnvDefaults[key] ?? '';
}

function normalizeValue(field: FieldDefinition, value: unknown) {
  if (field.type === 'checkbox') {
    return Boolean(value);
  }

  if (field.type === 'number') {
    return Number(value) || 0;
  }

  return value;
}

function envValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value ?? '');
}

function getPath(source: unknown, path: string[]) {
  let current = source;

  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function setPath(source: unknown, path: string[], value: unknown): unknown {
  const [head, ...rest] = path;

  if (!head) {
    return value;
  }

  const base = source && typeof source === 'object' ? { ...(source as Record<string, unknown>) } : {};
  base[head] = setPath(base[head], rest, value);
  return base;
}

function mergeSettingsPatch(base: StackarrSettingsPatch, patch: StackarrSettingsPatch): StackarrSettingsPatch {
  return {
    ...base,
    ...patch,
    profiles: {
      ...base.profiles,
      ...patch.profiles
    },
    ui: {
      ...base.ui,
      ...patch.ui
    },
    services: {
      ...base.services,
      ...patch.services
    }
  } as StackarrSettingsPatch;
}

function settingsPatchFromEnv(env: StackarrEnv): StackarrSettingsPatch {
  const services: Partial<StackarrSettings['services']> = {};
  const profiles: Partial<StackarrSettings['profiles']> = {};
  const connect: Partial<StackarrSettings['connect']> = {};
  const host: Partial<StackarrSettings['host']> = {};

  if (Object.prototype.hasOwnProperty.call(env, 'ENABLE_4K_SERVARR')) {
    const enabled = env.ENABLE_4K_SERVARR === 'true';
    services.enable4kServarr = enabled;
    profiles.preferSeparateHd4kInstances = enabled;
  }

  const profileEnvMappings: Array<
    [keyof StackarrSettings['profiles'], string, (value: string | undefined) => unknown]
  > = [
    ['movieProfilePreset', 'STACKARR_MOVIE_PROFILE_PRESET', (value) => (value === 'balanced' ? 'balanced' : 'lite')],
    [
      'movie4kProfilePreset',
      'STACKARR_MOVIE_4K_PROFILE_PRESET',
      (value) => (value === 'balanced' ? 'balanced' : 'lite')
    ],
    ['tvProfilePreset', 'STACKARR_TV_PROFILE_PRESET', (value) => (value === 'balanced' ? 'balanced' : 'lite')],
    ['tv4kProfilePreset', 'STACKARR_TV_4K_PROFILE_PRESET', (value) => (value === 'balanced' ? 'balanced' : 'lite')],
    ['musicProfilePreset', 'STACKARR_MUSIC_PROFILE_PRESET', (value) => (value === 'lossy' ? 'lossy' : 'lossless')],
    [
      'movieDefault',
      'STACKARR_MOVIE_DEFAULT_PROFILE',
      (value) => value || mediaProfileNameFromPreset(env.STACKARR_MOVIE_PROFILE_PRESET, 'hd')
    ],
    [
      'movie4kDefault',
      'STACKARR_MOVIE_4K_DEFAULT_PROFILE',
      (value) => value || mediaProfileNameFromPreset(env.STACKARR_MOVIE_4K_PROFILE_PRESET, '4k')
    ],
    [
      'tvDefault',
      'STACKARR_TV_DEFAULT_PROFILE',
      (value) => value || mediaProfileNameFromPreset(env.STACKARR_TV_PROFILE_PRESET, 'hd')
    ],
    [
      'tv4kDefault',
      'STACKARR_TV_4K_DEFAULT_PROFILE',
      (value) => value || mediaProfileNameFromPreset(env.STACKARR_TV_4K_PROFILE_PRESET, '4k')
    ],
    [
      'musicDefault',
      'STACKARR_MUSIC_DEFAULT_PROFILE',
      (value) => value || musicProfileNameFromPreset(env.STACKARR_MUSIC_PROFILE_PRESET)
    ]
  ];

  for (const [settingsKey, envKey, normalize] of profileEnvMappings) {
    if (Object.prototype.hasOwnProperty.call(env, envKey)) {
      profiles[settingsKey] = normalize(env[envKey]) as never;
    }
  }

  const mappings: Array<[keyof StackarrSettings['services'], string]> = [
    ['enableMovies', 'ENABLE_MOVIES'],
    ['enableTvShows', 'ENABLE_TV_SHOWS'],
    ['enableBazarr', 'ENABLE_BAZARR'],
    ['enableLidarr', 'ENABLE_LIDARR'],
    ['enableBookOrbit', 'ENABLE_BOOKORBIT'],
    ['enableTinyMediaManager', 'ENABLE_TINYMEDIAMANAGER'],
    ['enableRecyclarr', 'ENABLE_RECYCLARR'],
    ['enableFlaresolverr', 'ENABLE_FLARESOLVERR'],
    ['enableTidarr', 'ENABLE_TIDARR'],
    ['enableSeerr', 'ENABLE_SEERR'],
    ['enablePulsarr', 'ENABLE_PULSARR']
  ];

  for (const [settingsKey, envKey] of mappings) {
    if (Object.prototype.hasOwnProperty.call(env, envKey)) {
      services[settingsKey] = env[envKey] === 'true';
    }
  }

  if (Object.prototype.hasOwnProperty.call(env, 'STACKARR_BIND_IP')) {
    host.bindAddress = env.STACKARR_BIND_IP ?? managedEnvDefaults.STACKARR_BIND_IP;
  }

  if (Object.prototype.hasOwnProperty.call(env, 'STACKARR_WEB_PORT')) {
    host.port =
      Number(env.STACKARR_WEB_PORT ?? managedEnvDefaults.STACKARR_WEB_PORT) ||
      Number(managedEnvDefaults.STACKARR_WEB_PORT);
  }

  return {
    ...(Object.keys(host).length > 0 ? { host } : {}),
    ...(Object.keys(connect).length > 0 ? { connect } : {}),
    ...(Object.keys(profiles).length > 0 ? { profiles } : {}),
    ...(Object.keys(services).length > 0 ? { services } : {})
  } as StackarrSettingsPatch;
}

function group(title: string, fields: FieldDefinition[], description?: string): GroupDefinition {
  return { title, description, fields };
}

function envText(id: string, label: string, key: string, description?: string): FieldDefinition {
  return { id, label, type: 'text', source: { source: 'env', key }, description };
}

function envPath(id: string, label: string, key: string, description?: string): FieldDefinition {
  return { id, label, type: 'path', source: { source: 'env', key }, description };
}

function envPassword(id: string, label: string, key: string, description?: string): FieldDefinition {
  return { id, label, type: 'password', source: { source: 'env', key }, description, secret: true };
}

function envNumber(id: string, label: string, key: string, description?: string): FieldDefinition {
  return { id, label, type: 'number', source: { source: 'env', key }, description };
}

function envCheckbox(id: string, label: string, key: string, description?: string): FieldDefinition {
  return { id, label, type: 'checkbox', source: { source: 'env', key }, description };
}

function envSelect(id: string, label: string, key: string, options: string[], description?: string): FieldDefinition {
  return { id, label, type: 'select', source: { source: 'env', key }, options, description };
}

function settingsText(id: string, label: string, path: string[], description?: string): FieldDefinition {
  return { id, label, type: 'text', source: { source: 'settings', path }, description };
}

function settingsSelect(
  id: string,
  label: string,
  path: string[],
  options: string[],
  description?: string
): FieldDefinition {
  return { id, label, type: 'select', source: { source: 'settings', path }, options, description };
}

function presetJson(
  id: string,
  label: string,
  preset: PresetName,
  path: string[],
  description?: string
): FieldDefinition {
  return { id, label, type: 'json', source: { source: 'preset', preset, path }, description };
}
