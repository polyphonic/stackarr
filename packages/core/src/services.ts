import fs from 'node:fs';
import os from 'node:os';
import { databaseExists } from './database';
import { readEnv, type StackarrEnv } from './env';
import { appDatabasePath, composePath, stackarrBin } from './paths';
import { readSettings, type StackarrSettings } from './settings';
import { stackarrChannel, stackarrVersion } from './version';

export type ServiceSummary = {
  name: string;
  displayName: string;
  description: string;
  category: 'stack' | 'download' | 'servarr' | 'media' | 'support';
  kind: 'container' | 'service' | 'app';
  mode: 'docker' | 'native' | 'disabled';
  port?: number;
  localUrl?: string;
  browserUrl?: string;
  status: 'configured' | 'missing' | 'unknown' | 'disabled';
  detected?: boolean;
  configPath?: string;
  notes?: string[];
  dockerService?: string;
  experience: 'app' | 'helper' | 'infrastructure';
  requirement?: {
    satisfied: boolean;
    message: string;
  };
};

type ServiceMetadata = {
  displayName: string;
  description: string;
};

const serviceMetadata: Record<string, ServiceMetadata> = {
  stackarr: {
    displayName: 'Stackarr',
    description: 'Homelab manager, dashboard, API, and agent connection for your self-hosted apps.'
  },
  database: {
    displayName: 'Database',
    description: 'Shared PostgreSQL and TimescaleDB service for Stackarr and supported app configuration.'
  },
  redis: {
    displayName: 'Redis',
    description: 'Shared Redis cache and background queue service for supported apps.'
  },
  transmission: {
    displayName: 'Transmission',
    description: 'Lean torrent client used by Radarr, Sonarr, and Lidarr for completed imports.'
  },
  qbittorrent: {
    displayName: 'qBittorrent',
    description: 'Feature-rich torrent client alternative with category-aware imports.'
  },
  streamrip: {
    displayName: 'Streamrip',
    description: 'CLI music downloader for Qobuz, Tidal, Deezer, SoundCloud, and playlist workflows.'
  },
  prowlarr: {
    displayName: 'Prowlarr',
    description: 'Indexer manager that syncs torrent indexers into the Arr applications.'
  },
  radarr: {
    displayName: 'Radarr',
    description: 'Movie automation for the HD library and request routing.'
  },
  radarr4k: {
    displayName: 'Radarr 4K',
    description: 'Separate movie automation for 4K requests and UHD quality profiles.'
  },
  sonarr: {
    displayName: 'Sonarr',
    description: 'TV automation for the HD library and request routing.'
  },
  sonarr4k: {
    displayName: 'Sonarr 4K',
    description: 'Separate TV automation for 4K requests and UHD quality profiles.'
  },
  lidarr: {
    displayName: 'Lidarr',
    description: 'Music library automation with the configured download client.'
  },
  bookorbit: {
    displayName: 'BookOrbit',
    description: 'Book library management and reader sync for the local Books folder.'
  },
  immich: {
    displayName: 'Immich',
    description: 'Self-hosted photo and video backup, browsing, and mobile sync for the photo library.'
  },
  romm: {
    displayName: 'RomM',
    description: 'Self-hosted ROM manager and browser-playable game library for emulator collections.'
  },
  questarr: {
    displayName: 'Questarr',
    description: 'Game discovery and download automation that can hand completed files to a RomM-managed library.'
  },
  youtarr: {
    displayName: 'Youtarr',
    description: 'Private YouTube channel tracking, downloads, and Plex library integration.'
  },
  bazarr: {
    displayName: 'Bazarr',
    description: 'Subtitle management for Radarr and Sonarr libraries.'
  },
  tinymediamanager: {
    displayName: 'TinyMediaManager',
    description: 'Metadata and renaming companion for movies and TV folders.'
  },
  recyclarr: {
    displayName: 'Recyclarr',
    description: 'TRaSH-style quality profile synchronization for Arr applications.'
  },
  flaresolverr: {
    displayName: 'FlareSolverr',
    description: 'Proxy helper for indexers that require browser-style challenge solving.'
  },
  tidarr: {
    displayName: 'Tidarr',
    description: 'Tidal download helper for music workflows.'
  },
  seerr: {
    displayName: 'Seerr',
    description: 'Request portal that routes HD and optional 4K requests into the matching Arr apps.'
  },
  pulsarr: {
    displayName: 'Pulsarr',
    description: 'Plex watchlist monitor that sends movies and shows to the Arr stack.'
  },
  maintainerr: {
    displayName: 'Maintainerr',
    description: 'Plex/Jellyfin library cleanup planner and collection manager.'
  },
  cleanuparr: {
    displayName: 'Cleanuparr',
    description: 'Download queue cleaner and malware-like file blocker for Arr-managed media.'
  },
  agregarr: {
    displayName: 'Agregarr',
    description:
      'Plex collection and home-screen curator with source lists, scheduling, and existing-collection controls.'
  },
  tracearr: {
    displayName: 'Tracearr',
    description: 'Real-time Plex, Jellyfin, and Emby monitoring with analytics and account-sharing detection.'
  },
  plex: {
    displayName: 'Plex',
    description: 'Media server for playback, metadata, watch history, and library scans.'
  },
  jellyfin: {
    displayName: 'Jellyfin',
    description: 'Open media server option managed natively or through Docker.'
  },
  backup: {
    displayName: 'Backups',
    description: 'Stackarr-managed backups for app configuration, databases, and supported media-server state.'
  }
};

export function getSystemStatus() {
  const env = readEnv();

  return {
    appName: 'Stackarr',
    version: stackarrVersion,
    branch: stackarrChannel,
    runtime: 'Next.js',
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname()
    },
    paths: {
      databasePath:
        env.STACKARR_DATABASE_MODE === 'postgres'
          ? postgresConnectionLabel(env.STACKARR_DATABASE_URL) || appDatabasePath
          : appDatabasePath,
      databaseLogPath:
        env.STACKARR_DATABASE_MODE === 'postgres' ? postgresConnectionLabel(env.STACKARR_LOG_DATABASE_URL) : undefined,
      composePath,
      stackarrBin
    },
    configured: databaseExists(),
    composeFilePresent: fs.existsSync(composePath),
    cliPresent: fs.existsSync(stackarrBin),
    torrentClient: env.PREFERRED_TORRENT_CLIENT ?? 'transmission',
    plexInstallMode: resolvedMediaMode('plex', env.PLEX_INSTALL_MODE, env.PLEX_CONFIG_PATH, env),
    jellyfinInstallMode: resolvedMediaMode('jellyfin', env.JELLYFIN_INSTALL_MODE, env.JELLYFIN_CONFIG_PATH, env),
    nativeMediaServers: {
      plex: nativeMediaDiscovery('plex', env.PLEX_CONFIG_PATH, {
        assumeHostNative: isDockerRuntime(env) && mode(env.PLEX_INSTALL_MODE, 'docker') === 'native',
        env
      }),
      jellyfin: nativeMediaDiscovery('jellyfin', env.JELLYFIN_CONFIG_PATH, {
        assumeHostNative: isDockerRuntime(env) && mode(env.JELLYFIN_INSTALL_MODE, 'disabled') === 'native',
        env
      })
    },
    startup: {
      note: 'Runtime service checks are intentionally command-backed and are not executed by static status reads.'
    }
  };
}

function postgresConnectionLabel(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }

  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString().replace('://@', '://');
  } catch {
    return undefined;
  }
}

export function getServices(): ServiceSummary[] {
  const env = readEnv();
  const settings = readSettings();
  const moviesMode = flag(env.ENABLE_MOVIES, true) ? 'docker' : 'disabled';
  const tvMode = flag(env.ENABLE_TV_SHOWS, true) ? 'docker' : 'disabled';
  const musicMode = flag(env.ENABLE_LIDARR, true) ? 'docker' : 'disabled';
  const servarrSupportMode =
    moviesMode === 'docker' || tvMode === 'docker' || musicMode === 'docker' ? 'docker' : 'disabled';
  const fourKMode = flag(env.ENABLE_4K_SERVARR, false) ? 'docker' : 'disabled';
  const plexMode = mode(env.PLEX_INSTALL_MODE, 'docker');
  const jellyfinMode = mode(env.JELLYFIN_INSTALL_MODE, 'disabled');
  const mediaServerEnabled = plexMode !== 'disabled' || jellyfinMode !== 'disabled';
  const videoAutomationEnabled = moviesMode === 'docker' || tvMode === 'docker';
  const arrEnabled = videoAutomationEnabled || musicMode === 'docker';
  const sharedRedisMode =
    flag(env.ENABLE_IMMICH, false) || flag(env.ENABLE_ROMM, false) || flag(env.ENABLE_TRACEARR, false)
      ? 'docker'
      : 'disabled';

  return [
    service('stackarr', 'stack', 'docker', Number(env.STACKARR_WEB_PORT ?? 7777), settings, {
      experience: 'infrastructure',
      notes: ['Primary dashboard/API overseeing this homelab and its configured apps.']
    }),
    service('database', 'support', 'docker', Number(env.DATABASE_HOST_PORT ?? 5433), settings, {
      localUrl: undefined,
      browserUrl: undefined,
      experience: 'infrastructure',
      notes: [
        'PostgreSQL 18 with TimescaleDB and pgvector; Stackarr creates separate databases for itself and supported apps.'
      ]
    }),
    service(
      'transmission',
      'download',
      selected(env.PREFERRED_TORRENT_CLIENT, 'transmission') ? 'docker' : 'disabled',
      9091,
      settings
    ),
    service(
      'qbittorrent',
      'download',
      selected(env.PREFERRED_TORRENT_CLIENT, 'qbittorrent') ? 'docker' : 'disabled',
      Number(env.QBITTORRENT_WEBUI_PORT ?? 8081),
      settings
    ),
    service('streamrip', 'download', musicMode === 'docker' ? 'native' : 'disabled', undefined, settings, {
      kind: 'service',
      experience: 'helper',
      dockerService: undefined,
      notes: [
        'Managed by Stackarr as a CLI worker; Lidarr metadata/import workflows can target it without requiring a Lidarr plugin.'
      ]
    }),
    service('prowlarr', 'servarr', servarrSupportMode, 9696, settings, { experience: 'helper' }),
    service('radarr', 'servarr', moviesMode, 7878, settings),
    service('radarr4k', 'servarr', moviesMode === 'docker' ? fourKMode : 'disabled', 7879, settings, {
      experience: 'helper'
    }),
    service('sonarr', 'servarr', tvMode, 8989, settings),
    service('sonarr4k', 'servarr', tvMode === 'docker' ? fourKMode : 'disabled', 8990, settings, {
      experience: 'helper'
    }),
    service('lidarr', 'servarr', musicMode, 8686, settings),
    service(
      'bookorbit',
      'support',
      optionalMode(env.ENABLE_BOOKORBIT),
      Number(env.BOOKORBIT_WEB_PORT ?? 7582),
      settings
    ),
    service('immich', 'media', optionalMode(env.ENABLE_IMMICH), Number(env.IMMICH_WEB_PORT ?? 2283), settings, {
      configPath: env.IMMICH_UPLOAD_LOCATION,
      notes: [
        'Photo-library backup and browsing using the shared Postgres and Redis services. First-run owner setup happens in Immich or the iOS app after the container is reachable.'
      ]
    }),
    service('romm', 'media', optionalMode(env.ENABLE_ROMM), Number(env.ROMM_WEB_PORT ?? 7583), settings, {
      configPath: env.ROMM_LIBRARY_ROOT ?? env.GAMES_ROOT,
      notes: [
        'Private game-library browsing and browser play through RomM using the shared Postgres and Redis services. Public exposure is opt-in only; Stackarr binds it to loopback by default.'
      ]
    }),
    service(
      'questarr',
      'download',
      optionalMode(env.ENABLE_QUESTARR),
      Number(env.QUESTARR_WEB_PORT ?? 7584),
      settings,
      {
        configPath: env.QUESTARR_DATA_ROOT,
        notes: [
          'Shares RomM IGDB credentials by default and mounts the same Games folder as an optional post-processing destination.',
          'Questarr does not currently synchronize RomM inventory. Keep RomM as the game-library source of truth and configure Prowlarr plus the selected downloader during Questarr first run.',
          'The maintained Questarr release uses its own SQLite database even when Stackarr and supported services use PostgreSQL.'
        ]
      }
    ),
    service('youtarr', 'download', optionalMode(env.ENABLE_YOUTARR), Number(env.YOUTARR_WEB_PORT ?? 3087), settings, {
      configPath: env.YOUTARR_OUTPUT_ROOT,
      notes: [
        'Downloads videos into the Stackarr YouTube folder and keeps its MariaDB data in a Compose-managed named volume.',
        'Authentication stays enabled and reuses the Stackarr login by default. Plex integration is optional and remains private.'
      ]
    }),
    service('bazarr', 'support', dependentMode(env.ENABLE_BAZARR, videoAutomationEnabled), 6767, settings, {
      requirement: requirement(videoAutomationEnabled, 'Bazarr needs Radarr or Sonarr first.')
    }),
    service(
      'tinymediamanager',
      'support',
      dependentMode(env.ENABLE_TINYMEDIAMANAGER, videoAutomationEnabled),
      4000,
      settings,
      {
        requirement: requirement(videoAutomationEnabled, 'TinyMediaManager needs a movie or TV library first.')
      }
    ),
    service('recyclarr', 'support', dependentMode(env.ENABLE_RECYCLARR, videoAutomationEnabled), undefined, settings, {
      kind: 'service',
      experience: 'helper',
      requirement: requirement(videoAutomationEnabled, 'Recyclarr needs Radarr or Sonarr first.')
    }),
    service('flaresolverr', 'support', dependentMode(env.ENABLE_FLARESOLVERR, arrEnabled), 8191, settings, {
      experience: 'helper',
      requirement: requirement(arrEnabled, 'FlareSolverr needs an Arr app and Prowlarr first.')
    }),
    service('tidarr', 'support', optionalMode(env.ENABLE_TIDARR), 8484, settings),
    service(
      'seerr',
      'support',
      dependentMode(env.ENABLE_SEERR, mediaServerEnabled && videoAutomationEnabled),
      5055,
      settings,
      {
        requirement: requirement(
          mediaServerEnabled && videoAutomationEnabled,
          'Seerr needs Plex or Jellyfin plus Radarr or Sonarr.'
        )
      }
    ),
    service(
      'pulsarr',
      'support',
      dependentMode(env.ENABLE_PULSARR, plexMode !== 'disabled' && videoAutomationEnabled),
      Number(env.PULSARR_PORT ?? 3003),
      settings,
      {
        requirement: requirement(
          plexMode !== 'disabled' && videoAutomationEnabled,
          'Pulsarr needs Plex plus Radarr or Sonarr.'
        ),
        notes: ['Plex watchlist automation and Arr routing managed by Pulsarr.']
      }
    ),
    service(
      'maintainerr',
      'support',
      dependentMode(env.ENABLE_MAINTAINERR, mediaServerEnabled),
      Number(env.MAINTAINERR_PORT ?? 6246),
      settings,
      {
        requirement: requirement(mediaServerEnabled, 'Maintainerr needs Plex or Jellyfin first.'),
        notes: ['Cleanup rules are created inside Maintainerr; Stackarr only starts and links the app.']
      }
    ),
    service(
      'cleanuparr',
      'support',
      dependentMode(env.ENABLE_CLEANUPARR, arrEnabled),
      Number(env.CLEANUPARR_PORT ?? 11011),
      settings,
      {
        requirement: requirement(arrEnabled, 'Cleanuparr needs Radarr, Sonarr, or Lidarr first.'),
        notes: [
          'Stackarr connects the active torrent client and Arr instances, then enables a media-safe executable/script blocklist on a five-second schedule.',
          'Cleanuparr is loopback-only by default and stores only its own configuration under the Stackarr app root.'
        ]
      }
    ),
    service(
      'agregarr',
      'support',
      dependentMode(env.ENABLE_AGREGARR, plexMode !== 'disabled'),
      Number(env.AGREGARR_PORT ?? 7171),
      settings,
      {
        requirement: requirement(plexMode !== 'disabled', 'Agregarr requires Plex first.'),
        notes: [
          'Stackarr signs Agregarr into the Plex owner account, connects Radarr and Sonarr, and creates a release-date-sorted Coming Soon source.',
          'Agregarr uses Plex authentication upstream; it does not expose a supported local-password setup flow.',
          'Existing Plex collections are detected as pre-existing and stay user-controlled unless you explicitly choose to manage one.'
        ]
      }
    ),
    service(
      'tracearr',
      'support',
      dependentMode(env.ENABLE_TRACEARR, mediaServerEnabled || Boolean(env.TRACEARR_EMBY_SERVER_URL?.trim())),
      Number(env.TRACEARR_PORT ?? 3000),
      settings,
      {
        requirement: requirement(
          mediaServerEnabled || Boolean(env.TRACEARR_EMBY_SERVER_URL?.trim()),
          'Tracearr needs Plex, Jellyfin, or an Emby server URL first.'
        ),
        notes: [
          'Tracearr monitors Plex/Jellyfin/Emby activity using the shared Postgres/TimescaleDB and Redis services.'
        ]
      }
    ),
    service('redis', 'support', sharedRedisMode, undefined, settings, {
      browserUrl: undefined,
      localUrl: undefined,
      experience: 'infrastructure',
      notes: ['Shared Redis container used by Immich, RomM, Tracearr, and other supported services.']
    }),
    mediaServer('plex', plexMode, 32400, env.PLEX_CONFIG_PATH, env, settings),
    mediaServer('jellyfin', jellyfinMode, 8096, env.JELLYFIN_CONFIG_PATH, env, settings),
    service('backup', 'support', flag(env.ENABLE_BACKUP, true) ? 'native' : 'disabled', undefined, settings, {
      kind: 'service',
      experience: 'infrastructure',
      dockerService: undefined,
      configPath: env.BACKUP_ROOT,
      notes: [
        flag(env.ENABLE_BACKUP, true)
          ? `Runs ${backupScheduleLabel(env)} at ${env.BACKUP_TIME ?? '02:00'} and keeps ${env.BACKUP_RETENTION_COUNT ?? '52'} latest backup archive(s).`
          : 'Scheduled backups are disabled in Stackarr config.',
        'Install or refresh with stackarr backup install; each scheduled run includes Stackarr state plus shared Postgres database dumps when the database container is running.'
      ]
    })
  ].sort(compareServiceSummaries);
}

function backupScheduleLabel(env: StackarrEnv) {
  if ((env.BACKUP_SCHEDULE ?? 'weekly').toLowerCase() === 'weekly') {
    return `weekly on ${env.BACKUP_WEEKDAY ?? 'Sun'}`;
  }

  return 'daily';
}

export function compareServiceSummaries(a: ServiceSummary, b: ServiceSummary) {
  const disabledDifference = disabledSortRank(a) - disabledSortRank(b);

  if (disabledDifference !== 0) {
    return disabledDifference;
  }

  const rankDifference = serviceSortRank(a) - serviceSortRank(b);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  const categoryDifference = a.category.localeCompare(b.category);

  if (categoryDifference !== 0) {
    return categoryDifference;
  }

  if (a.category === 'media') {
    const mediaDifference = mediaServerRank(a.name) - mediaServerRank(b.name);

    if (mediaDifference !== 0) {
      return mediaDifference;
    }
  }

  const kindDifference = kindSortRank(a.kind) - kindSortRank(b.kind);

  if (kindDifference !== 0) {
    return kindDifference;
  }

  return a.displayName.localeCompare(b.displayName, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function service(
  name: string,
  category: ServiceSummary['category'],
  mode: ServiceSummary['mode'],
  port?: number,
  settings?: StackarrSettings,
  extras: Partial<ServiceSummary> = {}
): ServiceSummary {
  const metadata = serviceMetadata[name] ?? {
    displayName: name,
    description: `${name} service`
  };

  return {
    name,
    displayName: metadata.displayName,
    description: metadata.description,
    category,
    experience: extras.experience ?? 'app',
    kind: extras.kind ?? (mode === 'docker' ? 'container' : 'service'),
    mode,
    port,
    localUrl: port ? `http://127.0.0.1:${port}` : undefined,
    browserUrl: mode !== 'disabled' && port ? browserUrl(name, port, settings) : undefined,
    status: mode === 'disabled' ? 'disabled' : 'configured',
    dockerService: name === 'stackarr' ? undefined : name,
    ...extras
  };
}

function requirement(satisfied: boolean, message: string): ServiceSummary['requirement'] {
  return { satisfied, message };
}

function dependentMode(value: string | undefined, prerequisite: boolean): ServiceSummary['mode'] {
  return prerequisite ? optionalMode(value) : 'disabled';
}

function mediaServer(
  name: 'plex' | 'jellyfin',
  configuredMode: ServiceSummary['mode'],
  port: number,
  configuredPath?: string,
  env?: StackarrEnv,
  settings?: StackarrSettings
): ServiceSummary {
  const discovery = nativeMediaDiscovery(name, configuredPath, {
    assumeHostNative: isDockerRuntime(env) && configuredMode === 'native',
    env
  });
  const effectiveMode = configuredMode === 'disabled' && discovery.detected ? 'native' : configuredMode;
  const notes = [];

  if (configuredMode === 'disabled' && discovery.detected) {
    notes.push('An existing server was detected even though Stackarr management is disabled.');
  }

  if (effectiveMode === 'native') {
    notes.push('Stackarr will connect to the existing server without owning its process.');
  }

  return service(name, 'media', effectiveMode, port, settings, {
    kind: effectiveMode === 'docker' ? 'container' : 'app',
    detected: discovery.detected,
    configPath: discovery.path,
    status:
      effectiveMode === 'disabled'
        ? 'disabled'
        : discovery.detected || effectiveMode === 'docker'
          ? 'configured'
          : 'missing',
    notes
  });
}

function browserUrl(name: string, port: number, settings?: StackarrSettings) {
  const mode = settings?.ui.serviceUrlMode ?? 'portless';

  if (mode === 'portless') {
    const scheme = settings?.ui.serviceUrlScheme === 'http' ? 'http' : 'https';
    const suffix = normalizeHostSuffix(settings?.ui.serviceUrlHostSuffix ?? 'stack');
    const path = name === 'plex' ? browserPath(name) : '';

    return `${scheme}://${hostnameLabel(name)}.${suffix}${path}`;
  }

  const path = browserPath(name);

  if (mode === 'loopback') {
    return `http://127.0.0.1:${port}${path}`;
  }

  return `http://localhost:${port}${path}`;
}

export function directPortlessBrowserUrl(name: string, settings?: StackarrSettings, pathOverride?: string) {
  const scheme = settings?.ui.serviceUrlScheme === 'http' ? 'http' : 'https';
  const suffix = normalizeHostSuffix(settings?.ui.serviceUrlHostSuffix ?? 'stack');
  const path = pathOverride ?? browserPath(name);

  return `${scheme}://${hostnameLabel(name)}.${suffix}${path}`;
}

export function serviceRouteSlug(name: string) {
  return hostnameLabel(name);
}

export function serviceNameFromRouteSlug(slug: string) {
  const normalized = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const aliases: Record<string, string> = {
    app: 'stackarr',
    tinymm: 'tinymediamanager',
    radarr4k: 'radarr4k',
    sonarr4k: 'sonarr4k',
    'radarr-4k': 'radarr4k',
    'sonarr-4k': 'sonarr4k',
    qb: 'qbittorrent',
    qbit: 'qbittorrent'
  };

  return aliases[normalized] ?? normalized;
}

export function serviceBrowserPath(name: string) {
  return browserPath(name);
}

function browserPath(name: string) {
  if (name === 'plex') {
    return '/web/index.html';
  }

  if (name === 'transmission') {
    return '/transmission/web/';
  }

  return '';
}

function hostnameLabel(name: string) {
  if (name === 'stackarr') {
    return 'app';
  }

  if (name === 'tinymediamanager') {
    return 'tinymm';
  }

  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'service'
  );
}

function serviceSortRank(service: ServiceSummary) {
  if (service.name === 'stackarr') {
    return 0;
  }

  if (service.category === 'media') {
    return 1;
  }

  return 2;
}

function disabledSortRank(service: ServiceSummary) {
  return service.mode === 'disabled' ? 1 : 0;
}

function kindSortRank(kind: ServiceSummary['kind']) {
  if (kind === 'container') {
    return 0;
  }

  if (kind === 'app') {
    return 1;
  }

  return 2;
}

function mediaServerRank(name: string) {
  if (name === 'plex') {
    return 0;
  }

  if (name === 'jellyfin') {
    return 1;
  }

  return 2;
}

function normalizeHostSuffix(suffix: string) {
  return (
    suffix
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .replace(/^\.+|\.+$/g, '') || 'stack'
  );
}

function selected(value: string | undefined, candidate: string) {
  return normalizeTorrentClient(value) === candidate;
}

function normalizeTorrentClient(value: string | undefined): 'transmission' | 'qbittorrent' {
  const candidate = (value ?? 'transmission').toLowerCase().trim();

  if (candidate === 'qb' || candidate === 'qbit' || candidate === 'qbittorrent') {
    return 'qbittorrent';
  }

  return 'transmission';
}

function optionalMode(value: string | undefined): ServiceSummary['mode'] {
  return flag(value, true) ? 'docker' : 'disabled';
}

function flag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function mode(value: string | undefined, fallback: ServiceSummary['mode']): ServiceSummary['mode'] {
  if (value === 'docker' || value === 'native' || value === 'disabled') {
    return value;
  }

  return fallback;
}

function resolvedMediaMode(name: 'plex' | 'jellyfin', value?: string, configuredPath?: string, env?: StackarrEnv) {
  const configuredMode = mode(value, name === 'plex' ? 'docker' : 'disabled');

  if (configuredMode === 'disabled' && nativeMediaDiscovery(name, configuredPath, { env }).detected) {
    return 'native-detected';
  }

  return configuredMode;
}

function nativeMediaDiscovery(
  name: 'plex' | 'jellyfin',
  configuredPath?: string,
  options: { assumeHostNative?: boolean; env?: StackarrEnv } = {}
) {
  const candidates = [configuredPath, ...defaultNativeMediaPaths(name, options.env)].filter(Boolean) as string[];

  const found = candidates.find((candidate) => fs.existsSync(expandHome(candidate)));
  const hostConfigured = options.assumeHostNative
    ? candidates.find((candidate) => isLikelyHostPath(expandHome(candidate)))
    : undefined;

  return {
    detected: Boolean(found ?? hostConfigured),
    path: expandHome(found ?? hostConfigured ?? candidates[0] ?? '')
  };
}

function defaultNativeMediaPaths(name: 'plex' | 'jellyfin', env?: StackarrEnv) {
  const hostHome = inferredHostHome(env);

  if (name === 'plex') {
    return [
      hostHome ? `${hostHome}/Library/Application Support/Plex Media Server` : undefined,
      hostHome ? `${hostHome}/Library/Preferences/com.plexapp.plexmediaserver.plist` : undefined,
      '~/Library/Application Support/Plex Media Server',
      '~/Library/Preferences/com.plexapp.plexmediaserver.plist'
    ].filter(Boolean) as string[];
  }

  return [
    hostHome ? `${hostHome}/.local/share/jellyfin` : undefined,
    hostHome ? `${hostHome}/.config/jellyfin` : undefined,
    hostHome ? `${hostHome}/Library/Application Support/jellyfin` : undefined,
    '~/.local/share/jellyfin',
    '~/.config/jellyfin',
    '~/Library/Application Support/jellyfin'
  ].filter(Boolean) as string[];
}

function expandHome(value: string) {
  if (value.startsWith('~/')) {
    return `${os.homedir()}${value.slice(1)}`;
  }

  if (value.startsWith('$HOME/')) {
    return `${os.homedir()}${value.slice(5)}`;
  }

  return value;
}

function inferredHostHome(env?: StackarrEnv) {
  const roots = [
    env?.PLEX_CONFIG_PATH,
    env?.JELLYFIN_CONFIG_PATH,
    env?.APP_ROOT,
    env?.BACKUP_ROOT,
    env?.CONFIG_ROOT,
    env?.LOG_ROOT
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const match = expandHome(root).match(/^(\/Users\/[^/]+)/);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function isLikelyHostPath(value: string) {
  return value.startsWith('/Users/') || value.startsWith('/Volumes/');
}

function isDockerRuntime(env?: StackarrEnv) {
  return env?.STACKARR_RUNTIME === 'docker' || process.env.STACKARR_RUNTIME === 'docker';
}
