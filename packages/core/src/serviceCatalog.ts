import * as nodeCrypto from 'node:crypto';
import {
  credentialEnvConfigChanged,
  isCurrentPasswordProtectedConfigKey,
  isSecretKey,
  managedEnvDefaults,
  protectedEnvConfigChanged,
  readEnv,
  redactEnv,
  redactSecretValue,
  type StackarrEnv,
  writeEnvConfig
} from './env';
import { accountUsernameValidationError, portablePasswordValidationError } from './passwordPolicy';
import { presetFiles, readJsonPreset, writeJsonPreset } from './presets';
import {
  mediaProfileNameFromPreset,
  mediaProfilePresetOptions,
  musicProfileNameFromPreset,
  musicProfilePresetOptions
} from './profilePresets';
import { getServices, type ServiceSummary } from './services';
import { readSettings, type StackarrSettings, type StackarrSettingsPatch, writeSettings } from './settings';
import { getStreamripServiceConfigGroups, readStreamripConfig, updateStreamripConfig } from './streamrip/config';
import { findStreamripField } from './streamrip/schema';

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
  enabledWhen?: { fieldId: string; value: unknown };
  infoHover?: boolean;
  secret?: boolean;
  protected?: boolean;
};

export type ServiceConfigGroup = {
  title: string;
  description?: string;
  fields: ServiceConfigField[];
};

export type ServiceConfigModel = {
  service: ServiceSummary;
  groups: ServiceConfigGroup[];
  currentPasswordRequiredForProtectedChanges?: boolean;
};

type FieldDefinition = Omit<ServiceConfigField, 'value'>;
type GroupDefinition = Omit<ServiceConfigGroup, 'fields'> & { fields: FieldDefinition[] };

const serviceGroups: Record<string, GroupDefinition[]> = {
  stackarr: [
    group('Dashboard Runtime', [
      envText('stackarrBindIp', 'Bind IP', 'STACKARR_BIND_IP'),
      envNumber('stackarrWebPort', 'Web Port', 'STACKARR_WEB_PORT'),
      envCheckbox('stackarrMcpHttpEnabled', 'Enable Authenticated Remote MCP', 'STACKARR_MCP_HTTP_ENABLED'),
      envText(
        'stackarrMcpHttpAllowedOrigins',
        'Allowed Browser Origins',
        'STACKARR_MCP_HTTP_ALLOWED_ORIGINS',
        'Optional comma-separated origins. Server-to-server MCP clients do not send an Origin header.'
      ),
      envPassword('stackarrApiKey', 'API Key', 'STACKARR_API_KEY'),
      envText('stackarrImage', 'Docker Image', 'STACKARR_IMAGE')
    ]),
    group('Storage', [
      envPath('mediaRoot', 'Media Root', 'MEDIA_ROOT'),
      envPath('musicRoot', 'Music Root', 'MUSIC_ROOT'),
      envPath('downloadsRoot', 'Downloads Root', 'DOWNLOADS_ROOT'),
      envPath('backupRoot', 'Backup Root', 'BACKUP_ROOT'),
      envPath('booksRoot', 'Books Root', 'BOOKS_ROOT'),
      envPath('immichUploadLocation', 'Pictures Root', 'IMMICH_UPLOAD_LOCATION'),
      envPath('gamesRoot', 'Games Root', 'GAMES_ROOT')
    ]),
    group('Database', [
      envSelect('stackarrDatabaseMode', 'Mode', 'STACKARR_DATABASE_MODE', ['app-default', 'postgres']),
      envText('databaseImage', 'Postgres Image', 'DATABASE_IMAGE'),
      envText('redisImage', 'Redis Image', 'REDIS_IMAGE'),
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
      envPassword('bookorbitAgentToken', 'Agent Access Token', 'BOOKORBIT_TOKEN'),
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
  immich: [
    group('Photos (Immich)', [
      envCheckbox('enableImmich', 'Enable Immich', 'ENABLE_IMMICH'),
      envText('immichUrl', 'Public/App URL', 'IMMICH_URL'),
      envText('immichBindIp', 'Bind IP', 'IMMICH_BIND_IP'),
      envNumber('immichWebPort', 'Web Port', 'IMMICH_WEB_PORT'),
      envNumber('immichContainerPort', 'Container Port', 'IMMICH_CONTAINER_PORT'),
      envPath('immichUploadLocation', 'Upload/Library Location', 'IMMICH_UPLOAD_LOCATION'),
      envText('immichVersion', 'Immich Version Tag', 'IMMICH_VERSION'),
      envText('immichServerImage', 'Server Image', 'IMMICH_SERVER_IMAGE'),
      envText('immichMachineLearningImage', 'Machine Learning Image', 'IMMICH_MACHINE_LEARNING_IMAGE'),
      envPassword('immichApiKey', 'API Key for Agent Access', 'IMMICH_API_KEY')
    ]),
    group('Immich Database', [
      envText('immichDbUsername', 'Database User', 'IMMICH_DB_USERNAME'),
      envText('immichDbDatabaseName', 'Database Name', 'IMMICH_DB_DATABASE_NAME'),
      envText('immichDbVectorExtension', 'Vector Extension', 'IMMICH_DB_VECTOR_EXTENSION'),
      envPassword('immichDbPassword', 'Database Password', 'IMMICH_DB_PASSWORD')
    ])
  ],
  romm: [
    group('Games (RomM)', [
      envCheckbox('enableRomm', 'Enable RomM', 'ENABLE_ROMM'),
      envText('rommUrl', 'Local URL', 'ROMM_URL'),
      envText('rommBindIp', 'Bind IP', 'ROMM_BIND_IP'),
      envNumber('rommWebPort', 'Web Port', 'ROMM_WEB_PORT'),
      envNumber('rommContainerPort', 'Container Port', 'ROMM_CONTAINER_PORT'),
      envPath('gamesRoot', 'Games Root', 'GAMES_ROOT'),
      envPath('rommLibraryRoot', 'RomM Library Root', 'ROMM_LIBRARY_ROOT'),
      envCheckbox(
        'rommSteamLibraryEnabled',
        'Enable Steam desktop libraries',
        'ROMM_STEAM_LIBRARY_ENABLED',
        'Off by default. Enable only when this Stackarr host can access Steam library folders, either from a local Steam installation or a mounted share. A NAS with no accessible Steam library should leave this disabled.',
        { infoHover: true }
      ),
      envPath(
        'rommSteamMacLibraryRoot',
        'Steam Mac Library Root',
        'ROMM_STEAM_MAC_LIBRARY_ROOT',
        'Steam library folder containing steamapps for macOS games. Mounted at /romm/Steam for the canonical mac platform.',
        { enabledWhen: { fieldId: 'rommSteamLibraryEnabled', value: true } }
      ),
      envPath(
        'rommSteamWindowsLibraryRoot',
        'Steam Windows Library Root',
        'ROMM_STEAM_WINDOWS_LIBRARY_ROOT',
        'Steam library folder containing steamapps for Windows games. Mounted at /romm/SteamWindows for the canonical win platform.',
        { enabledWhen: { fieldId: 'rommSteamLibraryEnabled', value: true } }
      ),
      envPath(
        'rommSteamLinuxLibraryRoot',
        'Steam Linux Library Root',
        'ROMM_STEAM_LINUX_LIBRARY_ROOT',
        'Steam library folder containing steamapps for Linux games. Mounted at /romm/SteamLinux for the canonical linux platform.',
        { enabledWhen: { fieldId: 'rommSteamLibraryEnabled', value: true } }
      ),
      envPath('rommAssetsRoot', 'Assets Root', 'ROMM_ASSETS_ROOT'),
      envPath('rommConfigRoot', 'Config Root', 'ROMM_CONFIG_ROOT'),
      envPath('rommResourcesRoot', 'Resources Root', 'ROMM_RESOURCES_ROOT'),
      envText('rommRedisHost', 'Redis Host', 'ROMM_REDIS_HOST'),
      envNumber('rommRedisPort', 'Redis Port', 'ROMM_REDIS_PORT'),
      envCheckbox('rommFilesystemWatcher', 'Filesystem Watcher', 'ROMM_ENABLE_RESCAN_ON_FILESYSTEM_CHANGE'),
      envNumber('rommFilesystemWatcherDelay', 'Watcher Delay (minutes)', 'ROMM_RESCAN_ON_FILESYSTEM_CHANGE_DELAY'),
      envText('rommImage', 'RomM Image', 'ROMM_IMAGE')
    ]),
    group('Agent Access', [
      envPassword(
        'rommAgentToken',
        'Client Token',
        'ROMM_API_KEY',
        'A RomM client token with only the scopes needed for the enabled agent operations.'
      )
    ]),
    group('RomM Database', [
      envSelect('rommDbDriver', 'Database Driver', 'ROMM_DB_DRIVER', ['postgresql']),
      envText('rommDbHost', 'Database Host', 'ROMM_DB_HOST'),
      envNumber('rommDbPort', 'Database Port', 'ROMM_DB_PORT'),
      envText('rommDbName', 'Database Name', 'ROMM_DB_NAME'),
      envText('rommDbUser', 'Database User', 'ROMM_DB_USER'),
      envPassword('rommDbPassword', 'Database Password', 'ROMM_DB_PASSWORD'),
      envText('rommDbQueryJson', 'Extra Connection Params JSON', 'ROMM_DB_QUERY_JSON'),
      envPassword('rommAuthSecretKey', 'Auth Secret Key', 'ROMM_AUTH_SECRET_KEY')
    ]),
    group('RomM First-Run Admin', [
      envCheckbox('rommAutoConfigure', 'Auto Configure Admin', 'ROMM_AUTO_CONFIGURE'),
      envText('rommAdminUsername', 'Admin Username', 'ROMM_ADMIN_USERNAME'),
      envText('rommAdminEmail', 'Admin Email', 'ROMM_ADMIN_EMAIL'),
      envPassword('rommAdminPassword', 'Admin Password', 'ROMM_ADMIN_PASSWORD')
    ]),
    group('Metadata Providers', [
      envText(
        'rommIgdbClientId',
        'IGDB Client ID',
        'ROMM_IGDB_CLIENT_ID',
        'Twitch application client ID. See https://docs.romm.app/latest/getting-started/metadata-providers/#igdb'
      ),
      envPassword(
        'rommIgdbClientSecret',
        'IGDB Client Secret',
        'ROMM_IGDB_CLIENT_SECRET',
        'Twitch application client secret paired with the IGDB client ID.'
      ),
      envPassword(
        'rommMobyGamesApiKey',
        'MobyGames API Key',
        'ROMM_MOBYGAMES_API_KEY',
        'MobyGames API access is a paid feature; RomM recommends ScreenScraper as the free alternative.'
      ),
      envText(
        'rommScreenscraperUser',
        'ScreenScraper User',
        'ROMM_SCREENSCRAPER_USER',
        'ScreenScraper account username.'
      ),
      envPassword(
        'rommScreenscraperPassword',
        'ScreenScraper Password',
        'ROMM_SCREENSCRAPER_PASSWORD',
        'ScreenScraper account password.'
      ),
      envPassword(
        'rommRetroachievementsApiKey',
        'RetroAchievements API Key',
        'ROMM_RETROACHIEVEMENTS_API_KEY',
        'Web API key from the RetroAchievements account settings page.'
      ),
      envNumber(
        'rommRefreshRetroAchievementsCacheDays',
        'RetroAchievements Cache Days',
        'ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS',
        'How often RomM refreshes its cached RetroAchievements database.'
      ),
      envPassword(
        'rommSteamGridDbApiKey',
        'SteamGridDB API Key',
        'ROMM_STEAMGRIDDB_API_KEY',
        'Used by the manual Search cover action rather than the library scanner.'
      ),
      envCheckbox('rommHasheousApiEnabled', 'Use Hasheous Metadata', 'ROMM_HASHEOUS_API_ENABLED'),
      envCheckbox('rommPlaymatchApiEnabled', 'Use Playmatch Metadata', 'ROMM_PLAYMATCH_API_ENABLED'),
      envCheckbox('rommLaunchboxApiEnabled', 'Use LaunchBox Metadata', 'ROMM_LAUNCHBOX_API_ENABLED'),
      envCheckbox(
        'rommScheduledLaunchboxUpdateEnabled',
        'Schedule LaunchBox Metadata Updates',
        'ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA'
      ),
      envText(
        'rommScheduledLaunchboxUpdateCron',
        'LaunchBox Update Cron',
        'ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON',
        'Cron expression used when scheduled LaunchBox metadata updates are enabled.'
      ),
      envCheckbox('rommFlashpointApiEnabled', 'Use Flashpoint Metadata', 'ROMM_FLASHPOINT_API_ENABLED'),
      envCheckbox('rommHltbApiEnabled', 'Use HowLongToBeat Metadata', 'ROMM_HLTB_API_ENABLED'),
      envCheckbox('rommTgdbApiEnabled', 'Use TheGamesDB Metadata', 'ROMM_TGDB_API_ENABLED')
    ])
  ],
  questarr: [
    group(
      'Game Downloads (Questarr)',
      [
        envCheckbox('enableQuestarr', 'Enable Questarr', 'ENABLE_QUESTARR'),
        envText('questarrUrl', 'Local URL', 'QUESTARR_URL'),
        envText('questarrAppUrl', 'App URL', 'QUESTARR_APP_URL'),
        envText('questarrAllowedOrigins', 'Allowed Origins', 'QUESTARR_ALLOWED_ORIGINS'),
        envText('questarrBindIp', 'Bind IP', 'QUESTARR_BIND_IP'),
        envNumber('questarrWebPort', 'Web Port', 'QUESTARR_WEB_PORT'),
        envNumber('questarrContainerPort', 'Container Port', 'QUESTARR_CONTAINER_PORT'),
        envPath('questarrDataRoot', 'App Data Root', 'QUESTARR_DATA_ROOT'),
        envPath(
          'questarrLibraryRoot',
          'Optional Game Destination',
          'QUESTARR_LIBRARY_ROOT',
          'Mounted at /games for opt-in post-processing. Questarr does not synchronize RomM inventory.'
        ),
        envText('questarrImage', 'Docker Image', 'QUESTARR_IMAGE')
      ],
      'Questarr shares the stack download path and can hand files to the Games folder, while RomM remains the library source of truth.'
    ),
    group('Questarr Credentials', [
      envText(
        'questarrIgdbClientId',
        'IGDB Client ID',
        'QUESTARR_IGDB_CLIENT_ID',
        'Defaults to RomM’s IGDB client ID when left blank.'
      ),
      envPassword(
        'questarrIgdbClientSecret',
        'IGDB Client Secret',
        'QUESTARR_IGDB_CLIENT_SECRET',
        'Defaults to RomM’s IGDB client secret when left blank.'
      ),
      envPassword('questarrJwtSecret', 'JWT Secret', 'QUESTARR_JWT_SECRET')
    ]),
    group(
      'Questarr Database',
      [envText('questarrSqliteDbPath', 'SQLite Path', 'QUESTARR_SQLITE_DB_PATH')],
      'Current maintained Questarr releases support SQLite only; Stackarr’s PostgreSQL install route still applies to Stackarr and supported services.'
    )
  ],
  bazarr: [
    group('Subtitles', [
      envCheckbox('enableBazarr', 'Enable Bazarr', 'ENABLE_BAZARR'),
      envText('bazarrUrl', 'Local URL', 'BAZARR_URL'),
      envPassword('bazarrApiKey', 'API Key', 'BAZARR_API_KEY'),
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
      envPassword('tinyMediaManagerApiKey', 'HTTP API Key', 'TINYMEDIAMANAGER_API_KEY'),
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
      envText('tidarrUrl', 'Local URL', 'TIDARR_URL'),
      envPassword('tidarrApiKey', 'API Key', 'TIDARR_API_KEY'),
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
        envPassword(
          'cloudflareApiToken',
          'API Token',
          'CLOUDFLARE_API_TOKEN',
          'Custom Cloudflare token with Account Cloudflare Tunnel/Edit, Access Policies/Edit, Zero Trust/Edit, Zone/Read, and DNS/Edit.'
        ),
        envText('cloudflareAccountId', 'Account ID', 'CLOUDFLARE_ACCOUNT_ID'),
        envText('cloudflareZoneId', 'Zone ID', 'CLOUDFLARE_ZONE_ID'),
        envText('cloudflaredTunnelName', 'Tunnel Name', 'CLOUDFLARED_TUNNEL_NAME'),
        envText('cloudflaredTunnelId', 'Tunnel ID', 'CLOUDFLARED_TUNNEL_ID'),
        envCheckbox('cloudflareAccessEnabled', 'Protect Routes with Access', 'CLOUDFLARE_ACCESS_ENABLED'),
        envText('cloudflareAccessEmails', 'Access Allowed Emails', 'CLOUDFLARE_ACCESS_ALLOWED_EMAILS'),
        envText('cloudflareAccessSession', 'Access Session Duration', 'CLOUDFLARE_ACCESS_SESSION_DURATION')
      ],
      'Public app exposure is managed by the Connect route list. Stackarr creates the tunnel, DNS records, and optional reusable Cloudflare Access allowlist from an account API token.'
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
      envPassword('pulsarrApiKey', 'Agent API Key', 'PULSARR_API_KEY'),
      envText('pulsarrImage', 'Docker Image', 'PULSARR_IMAGE')
    ]),
    group('Database', [
      envSelect('pulsarrDatabaseType', 'Database Type', 'PULSARR_DB_TYPE', ['sqlite', 'postgres']),
      envText('pulsarrPostgresDatabase', 'Database Name', 'PULSARR_POSTGRES_DATABASE'),
      envText('pulsarrPostgresUser', 'Database User', 'PULSARR_POSTGRES_USER'),
      envPassword('pulsarrPostgresPassword', 'Database Password', 'PULSARR_POSTGRES_PASSWORD')
    ])
  ],
  maintainerr: [
    group('Cleanup Planner', [
      envCheckbox('enableMaintainerr', 'Enable Maintainerr', 'ENABLE_MAINTAINERR'),
      envText('maintainerrUrl', 'Local URL', 'MAINTAINERR_URL'),
      envText('maintainerrBindIp', 'Bind IP', 'MAINTAINERR_BIND_IP'),
      envNumber('maintainerrPort', 'Port', 'MAINTAINERR_PORT'),
      envText('maintainerrBasePath', 'Base Path', 'MAINTAINERR_BASE_PATH'),
      envText(
        'maintainerrCleanupPresets',
        'Cleanup Preset Ideas',
        'MAINTAINERR_CLEANUP_PRESETS',
        'Comma-separated common cleanup ideas for the Maintainerr workspace. Stackarr wires the app, but cleanup rules remain user-controlled.'
      ),
      envText(
        'maintainerrPlexServerUrl',
        'Plex URL Override',
        'MAINTAINERR_PLEX_SERVER_URL',
        'Optional container-facing Plex URL for Maintainerr. Blank lets Stackarr choose plex:32400 or host.docker.internal:32400.'
      ),
      envText(
        'maintainerrJellyfinServerUrl',
        'Jellyfin URL Override',
        'MAINTAINERR_JELLYFIN_SERVER_URL',
        'Optional container-facing Jellyfin URL for Maintainerr. Blank lets Stackarr choose jellyfin:8096 or host.docker.internal:8096.'
      ),
      envText(
        'maintainerrQbittorrentUrl',
        'qBittorrent URL Override',
        'MAINTAINERR_QBITTORRENT_URL',
        'Optional container-facing qBittorrent URL for Maintainerr download cleanup.'
      ),
      envText('maintainerrImage', 'Docker Image', 'MAINTAINERR_IMAGE'),
      envPassword('maintainerrGithubToken', 'GitHub Token', 'MAINTAINERR_GITHUB_TOKEN')
    ])
  ],
  cleanuparr: [
    group(
      'Download Security',
      [
        envCheckbox('enableCleanuparr', 'Enable Cleanuparr', 'ENABLE_CLEANUPARR'),
        envText('cleanuparrUrl', 'Local URL', 'CLEANUPARR_URL'),
        envText('cleanuparrBindIp', 'Bind IP', 'CLEANUPARR_BIND_IP'),
        envNumber('cleanuparrPort', 'Port', 'CLEANUPARR_PORT'),
        envCheckbox(
          'cleanuparrAutoConfigure',
          'Auto-configure Malware Blocking',
          'CLEANUPARR_AUTO_CONFIGURE',
          'Connect the active torrent client and enabled Arr services, then enable Stackarr’s media-safe executable and script blocklist.'
        ),
        envText(
          'cleanuparrMalwareCron',
          'Malware Scan Schedule',
          'CLEANUPARR_MALWARE_CRON',
          'Quartz cron expression. The secure default scans every five seconds.'
        ),
        envText('cleanuparrImage', 'Docker Image', 'CLEANUPARR_IMAGE')
      ],
      'Cleanuparr runs loopback-only and removes an entire Arr-managed download when any file matches the official malware blacklist.'
    )
  ],
  agregarr: [
    group(
      'Plex Collections',
      [
        envCheckbox('enableAgregarr', 'Enable Agregarr', 'ENABLE_AGREGARR'),
        envText('agregarrUrl', 'Local URL', 'AGREGARR_URL'),
        envText('agregarrBindIp', 'Bind IP', 'AGREGARR_BIND_IP'),
        envNumber('agregarrPort', 'Port', 'AGREGARR_PORT'),
        envText(
          'agregarrPlaceholderFolder',
          'Placeholder Folder',
          'AGREGARR_PLACEHOLDER_FOLDER',
          'Folder name created at the top of each Plex movie and TV library. Defaults to _Trailers; Stackarr also excludes the same folder from tinyMediaManager scans.'
        ),
        envPassword(
          'agregarrApiKey',
          'Stackarr API Key',
          'AGREGARR_API_KEY',
          'Generated and saved automatically during Stackarr onboarding for native collection controls, targeted syncs, and agent actions.'
        ),
        envText('agregarrImage', 'Docker Image', 'AGREGARR_IMAGE')
      ],
      'Stackarr initializes Agregarr with the signed-in Plex owner token, connects Radarr and Sonarr, and creates Coming Soon as the default release-date-sorted source. Existing Plex collections remain pre-existing unless explicitly managed.'
    )
  ],
  tracearr: [
    group('Media Server Monitoring', [
      envCheckbox('enableTracearr', 'Enable Tracearr', 'ENABLE_TRACEARR'),
      envText('tracearrUrl', 'Local URL', 'TRACEARR_URL'),
      envText('tracearrBindIp', 'Bind IP', 'TRACEARR_BIND_IP'),
      envNumber('tracearrPort', 'Port', 'TRACEARR_PORT'),
      envCheckbox(
        'tracearrAutoConfigure',
        'Auto-configure Tracearr',
        'TRACEARR_AUTO_CONFIGURE',
        'During stackarr configure, create or log in to the Tracearr owner account and add the selected media server when credentials are available.'
      ),
      envText('tracearrAdminUsername', 'Owner Username', 'TRACEARR_ADMIN_USERNAME'),
      envText('tracearrAdminEmail', 'Owner Email', 'TRACEARR_ADMIN_EMAIL'),
      envText(
        'tracearrPlexServerUrl',
        'Plex URL Override',
        'TRACEARR_PLEX_SERVER_URL',
        'Optional container-facing Plex URL for Tracearr. Blank lets Stackarr choose plex:32400 or host.docker.internal:32400.'
      ),
      envText(
        'tracearrJellyfinServerUrl',
        'Jellyfin URL Override',
        'TRACEARR_JELLYFIN_SERVER_URL',
        'Optional container-facing Jellyfin URL for Tracearr. Blank lets Stackarr choose jellyfin:8096 or host.docker.internal:8096.'
      ),
      envText(
        'tracearrEmbyServerUrl',
        'Emby URL Override',
        'TRACEARR_EMBY_SERVER_URL',
        'Optional container-facing Emby URL for Tracearr when EMBY_API_KEY is supplied.'
      ),
      envText('tracearrLogLevel', 'Log Level', 'TRACEARR_LOG_LEVEL'),
      envText('tracearrCorsOrigin', 'CORS Origin', 'TRACEARR_CORS_ORIGIN'),
      envText('tracearrImage', 'Docker Image', 'TRACEARR_IMAGE'),
      envPassword('tracearrApiKey', 'Public API Token', 'TRACEARR_API_KEY'),
      envText('tracearrPostgresDatabase', 'Database Name', 'TRACEARR_POSTGRES_DATABASE'),
      envText('tracearrPostgresUser', 'Database User', 'TRACEARR_POSTGRES_USER')
    ]),
    group('Secrets', [
      envPassword('tracearrDbPassword', 'Database Password', 'TRACEARR_DB_PASSWORD'),
      envPassword('tracearrPostgresPassword', 'Postgres Password', 'TRACEARR_POSTGRES_PASSWORD'),
      envPassword('tracearrJwtSecret', 'JWT Secret', 'TRACEARR_JWT_SECRET'),
      envPassword('tracearrCookieSecret', 'Cookie Secret', 'TRACEARR_COOKIE_SECRET'),
      envPassword('tracearrAdminPassword', 'Owner Password', 'TRACEARR_ADMIN_PASSWORD'),
      envPassword('tracearrClaimCode', 'Claim Code', 'TRACEARR_CLAIM_CODE')
    ])
  ],
  plex: [
    group('Media Server', [
      envSelect('plexInstallMode', 'Connection Mode', 'PLEX_INSTALL_MODE', ['docker', 'native', 'disabled']),
      envText('plexUrl', 'Local URL', 'PLEX_URL'),
      envPath('plexConfigPath', 'Existing Server Config Path', 'PLEX_CONFIG_PATH'),
      envPath('plexPrefsPath', 'Existing Server Preferences Path', 'PLEX_PREFS_PATH'),
      envPassword('plexToken', 'Plex Token', 'PLEX_TOKEN'),
      envText('plexImage', 'Docker Image', 'PLEX_IMAGE'),
      envNumber('plexDockerPort', 'Docker Port', 'PLEX_DOCKER_PORT')
    ])
  ],
  jellyfin: [
    group('Media Server', [
      envSelect('jellyfinInstallMode', 'Connection Mode', 'JELLYFIN_INSTALL_MODE', ['disabled', 'docker', 'native']),
      envText('jellyfinUrl', 'Local URL', 'JELLYFIN_URL'),
      envPath('jellyfinConfigPath', 'Existing Server Config Path', 'JELLYFIN_CONFIG_PATH'),
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
      envText('backupTime', 'Backup Time', 'BACKUP_TIME', 'Local time in HH:MM used by Stackarr automation.'),
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
        'Number of latest backup archives Stackarr keeps after each run.'
      ),
      envSelect(
        'plexBackupMode',
        'Backup Mode',
        'PLEX_BACKUP_MODE',
        ['lite', 'full'],
        'lite keeps restore-critical databases and config while excluding rebuildable Plex data, logs, caches, internal backups, runtime files, and Arr cover art; full also keeps regenerated assets.'
      ),
      envCheckbox(
        'enableScheduledUpdates',
        'Enable Scheduled Updates',
        'ENABLE_SCHEDULED_UPDATES',
        'When on, Stackarr runs the scheduled update workflow at the configured update window.'
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

export function updateServiceConfigAction(input: {
  service: string;
  values: Record<string, unknown>;
  currentPassword?: unknown;
  trustedControlPlaneApproval?: boolean;
}) {
  const summary = findService(input.service);

  if (!summary) {
    return {
      service: input.service,
      accepted: false,
      error: 'Service is not configurable from the Stackarr service catalog.'
    };
  }

  if (summary.name === 'streamrip') {
    return updateStreamripServiceConfig(summary, input);
  }

  const definitions = definitionsForService(summary.name);
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

  const currentEnv = readEnv();
  if (
    summary.name === 'romm' &&
    !envFlag(envPatch.ROMM_STEAM_LIBRARY_ENABLED ?? currentEnv.ROMM_STEAM_LIBRARY_ENABLED, false)
  ) {
    envPatch.ROMM_STEAM_MAC_LIBRARY_ROOT = '';
    envPatch.ROMM_STEAM_WINDOWS_LIBRARY_ROOT = '';
    envPatch.ROMM_STEAM_LINUX_LIBRARY_ROOT = '';
  }

  if (Object.keys(envPatch).length > 0) {
    const credentialValidationError = validateCredentialPatch(envPatch, currentEnv);
    if (credentialValidationError) {
      return {
        service: input.service,
        accepted: false,
        error: credentialValidationError,
        config: buildModel(findService(summary.name) ?? summary)
      };
    }

    if (input.trustedControlPlaneApproval && credentialEnvConfigChanged(envPatch, currentEnv)) {
      return {
        service: input.service,
        accepted: false,
        error: 'Credentials and secrets must be changed through an authenticated settings surface, not MCP.',
        config: buildModel(findService(summary.name) ?? summary)
      };
    }
    const currentPasswordError = validateCurrentPasswordForProtectedConfigChange(
      protectedEnvConfigChanged(envPatch, currentEnv) && !input.trustedControlPlaneApproval,
      currentEnv,
      input.currentPassword
    );
    if (currentPasswordError) {
      return {
        service: input.service,
        accepted: false,
        error: currentPasswordError,
        config: buildModel(findService(summary.name) ?? summary)
      };
    }

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

function validateCredentialPatch(patch: StackarrEnv, current: StackarrEnv) {
  for (const [key, value] of Object.entries(patch)) {
    if (
      value === current[key] ||
      (isSecretKey(key) && Boolean(current[key]) && value === redactSecretValue(String(current[key])))
    ) {
      continue;
    }

    if (key === 'USERNAME' || key.endsWith('_USERNAME') || key.endsWith('_USER')) {
      if (key !== 'USERNAME' && !String(value ?? '')) continue;
      const error = accountUsernameValidationError(String(value ?? ''), key === 'USERNAME' ? 'Global username' : key);
      if (error) return error;
    }

    if ((key === 'PASSWORD' || key.endsWith('_PASSWORD')) && value) {
      const error = portablePasswordValidationError(String(value), key === 'PASSWORD' ? 'Global password' : key);
      if (error) return error;
    }
  }

  return undefined;
}

function buildModel(service: ServiceSummary): ServiceConfigModel {
  const env = readEnv();

  if (service.name === 'streamrip') {
    return {
      service,
      currentPasswordRequiredForProtectedChanges: Boolean(env.PASSWORD),
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
          secret: field.secret,
          protected: Boolean(field.secret)
        }))
      }))
    };
  }

  const safeEnv = redactEnv(env);
  const settings = readSettings();
  const presets: Partial<Record<PresetName, unknown>> = {
    naming: readJsonPreset('naming'),
    downloads: readJsonPreset('downloads'),
    requests: readJsonPreset('requests')
  };

  return {
    service,
    currentPasswordRequiredForProtectedChanges: Boolean(env.PASSWORD),
    groups: definitionsForService(service.name)
      .map((groupDefinition) => ({
        ...groupDefinition,
        fields: groupDefinition.fields
          .filter((field) => visibleField(service.name, field, safeEnv))
          .map((field) => ({
            ...field,
            value: fieldValue(field, safeEnv, settings, presets),
            protected: isProtectedServiceField(field)
          }))
      }))
      .filter((groupDefinition) => groupDefinition.fields.length > 0)
  };
}

function definitionsForService(serviceName: string) {
  return serviceGroups[serviceName] ?? [];
}

function updateStreamripServiceConfig(
  summary: ServiceSummary,
  input: {
    service: string;
    values: Record<string, unknown>;
    currentPassword?: unknown;
    trustedControlPlaneApproval?: boolean;
  }
) {
  const values: Record<string, unknown> = {};

  for (const group of getStreamripServiceConfigGroups()) {
    for (const field of group.fields) {
      if (!Object.prototype.hasOwnProperty.call(input.values, field.id)) {
        continue;
      }
      values[field.id] = input.values[field.id];
    }
  }

  const currentEnv = readEnv();
  if (input.trustedControlPlaneApproval && streamripSecretConfigChanged(values)) {
    return {
      service: input.service,
      accepted: false,
      error: 'Streamrip credentials must be changed through an authenticated settings surface, not MCP.',
      config: buildModel(summary)
    };
  }
  const currentPasswordError = validateCurrentPasswordForProtectedConfigChange(
    streamripSecretConfigChanged(values),
    currentEnv,
    input.currentPassword
  );
  if (currentPasswordError) {
    return {
      service: input.service,
      accepted: false,
      error: currentPasswordError,
      config: buildModel(summary)
    };
  }

  try {
    updateStreamripConfig(values);
  } catch (error) {
    return {
      service: input.service,
      accepted: false,
      error: error instanceof Error ? error.message : String(error),
      config: buildModel(summary)
    };
  }

  return {
    accepted: true,
    config: buildModel(findService(summary.name) ?? summary)
  };
}

function streamripSecretConfigChanged(values: Record<string, unknown>) {
  const current = readStreamripConfig({ redactSecrets: false });

  for (const [fieldId, value] of Object.entries(values)) {
    const field = findStreamripField(fieldId);
    const currentValue = field ? current[field.section]?.[field.name] : undefined;
    const currentPreview = redactSecretValue(
      typeof currentValue === 'string' ? currentValue : (JSON.stringify(currentValue) ?? String(currentValue ?? ''))
    );
    if (
      !field?.secret ||
      isRedactedSecretValue(value) ||
      value === currentPreview ||
      String(value ?? '').trim() === ''
    ) {
      continue;
    }
    return true;
  }

  return false;
}

function validateCurrentPasswordForProtectedConfigChange(
  protectedChange: boolean,
  current: StackarrEnv,
  currentPassword: unknown
) {
  if (!protectedChange || !current.PASSWORD) {
    return undefined;
  }

  if (typeof currentPassword !== 'string' || !currentPassword) {
    return 'Current admin password is required to change protected credentials, endpoints, bind addresses, or images.';
  }

  if (!constantTimeStringEqual(currentPassword, current.PASSWORD)) {
    return 'Current admin password is incorrect.';
  }

  return undefined;
}

function isProtectedServiceField(field: FieldDefinition) {
  const source = field.source;
  return source.source === 'env' && isCurrentPasswordProtectedConfigKey(source.key);
}

function isRedactedSecretValue(value: unknown) {
  return typeof value === 'string' && /^\*+$/.test(value);
}

function constantTimeStringEqual(left: string, right: string) {
  const leftHash = nodeCrypto.createHash('sha256').update(left).digest();
  const rightHash = nodeCrypto.createHash('sha256').update(right).digest();
  return nodeCrypto.timingSafeEqual(leftHash, rightHash);
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
    ['enableImmich', 'ENABLE_IMMICH'],
    ['enableRomm', 'ENABLE_ROMM'],
    ['enableQuestarr', 'ENABLE_QUESTARR'],
    ['enableTinyMediaManager', 'ENABLE_TINYMEDIAMANAGER'],
    ['enableRecyclarr', 'ENABLE_RECYCLARR'],
    ['enableFlaresolverr', 'ENABLE_FLARESOLVERR'],
    ['enableTidarr', 'ENABLE_TIDARR'],
    ['enableSeerr', 'ENABLE_SEERR'],
    ['enablePulsarr', 'ENABLE_PULSARR'],
    ['enableMaintainerr', 'ENABLE_MAINTAINERR'],
    ['enableTracearr', 'ENABLE_TRACEARR']
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

function envPath(
  id: string,
  label: string,
  key: string,
  description?: string,
  behavior?: Pick<FieldDefinition, 'enabledWhen' | 'infoHover'>
): FieldDefinition {
  return { id, label, type: 'path', source: { source: 'env', key }, description, ...behavior };
}

function envPassword(id: string, label: string, key: string, description?: string): FieldDefinition {
  return { id, label, type: 'password', source: { source: 'env', key }, description, secret: true };
}

function envNumber(id: string, label: string, key: string, description?: string): FieldDefinition {
  return { id, label, type: 'number', source: { source: 'env', key }, description };
}

function envCheckbox(
  id: string,
  label: string,
  key: string,
  description?: string,
  behavior?: Pick<FieldDefinition, 'enabledWhen' | 'infoHover'>
): FieldDefinition {
  return { id, label, type: 'checkbox', source: { source: 'env', key }, description, ...behavior };
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
