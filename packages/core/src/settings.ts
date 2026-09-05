import { databaseExists, readJsonSetting, writeJsonSetting } from './database';
import { readEnv, type StackarrEnv } from './env';
import {
  type MediaProfilePreset,
  type MusicProfilePreset,
  mediaProfileNameFromPreset,
  musicProfileNameFromPreset,
  normalizeMediaProfilePreset,
  normalizeMusicProfilePreset
} from './profilePresets';
import { stackarrChannel } from './version';

export type StackarrTheme = 'light' | 'dark' | 'system';

export type StackarrSettings = {
  setup: {
    onboardingComplete: boolean;
    installMode: 'unknown' | 'fresh' | 'restore' | 'migrate';
  };
  ui: {
    theme: StackarrTheme;
    showAdvanced: boolean;
    refreshIntervalSeconds: number;
    diskWarningThresholdPercent: number;
    serviceUrlMode: 'localhost' | 'loopback' | 'portless';
    serviceUrlScheme: 'http' | 'https';
    serviceUrlHostSuffix: string;
    unifyServiceUrls: boolean;
    serviceFavorites: string[];
  };
  host: {
    authenticationMethod: 'none' | 'forms';
    enableSsl: boolean;
    urlBase: string;
    bindAddress: string;
    port: number;
  };
  connect: {
    exposeSeerrOnly: boolean;
    warnBeforePublicExposure: boolean;
  };
  profiles: {
    movieProfilePreset: MediaProfilePreset;
    movie4kProfilePreset: MediaProfilePreset;
    tvProfilePreset: MediaProfilePreset;
    tv4kProfilePreset: MediaProfilePreset;
    musicProfilePreset: MusicProfilePreset;
    movieDefault: string;
    movie4kDefault: string;
    tvDefault: string;
    tv4kDefault: string;
    musicDefault: string;
    preferSeparateHd4kInstances: boolean;
  };
  services: {
    enableMovies: boolean;
    enableTvShows: boolean;
    enable4kServarr: boolean;
    enableBazarr: boolean;
    enableLidarr: boolean;
    enableBookOrbit: boolean;
    enableImmich: boolean;
    enableRomm: boolean;
    enableQuestarr: boolean;
    enableYoutarr: boolean;
    enableTinyMediaManager: boolean;
    enableRecyclarr: boolean;
    enableFlaresolverr: boolean;
    enableTidarr: boolean;
    enableSeerr: boolean;
    enablePulsarr: boolean;
    enableMaintainerr: boolean;
    enableCleanuparr: boolean;
    enableAgregarr: boolean;
    enableTracearr: boolean;
  };
  metadata: {
    tinyMediaManagerEnabled: boolean;
    plexMetadataMonitoring: boolean;
    jellyfinMetadataMonitoring: boolean;
  };
  backups: {
    recoveryKeyExportedAt: string;
    recoveryKeyExportedKeyId: string;
  };
  telemetry: {
    enabled: boolean;
    endpoint: string;
    installId: string;
    channel: string;
    lastSentAt: string;
  };
};

export type StackarrSettingsPatch = {
  setup?: Partial<StackarrSettings['setup']>;
  ui?: Partial<StackarrSettings['ui']>;
  host?: Partial<StackarrSettings['host']>;
  connect?: Partial<StackarrSettings['connect']>;
  profiles?: Partial<StackarrSettings['profiles']>;
  services?: Partial<StackarrSettings['services']>;
  metadata?: Partial<StackarrSettings['metadata']>;
  backups?: Partial<StackarrSettings['backups']>;
  telemetry?: Partial<StackarrSettings['telemetry']>;
};

export const defaultSettings: StackarrSettings = {
  setup: {
    onboardingComplete: false,
    installMode: 'unknown'
  },
  ui: {
    theme: 'dark',
    showAdvanced: false,
    refreshIntervalSeconds: 30,
    diskWarningThresholdPercent: 90,
    serviceUrlMode: 'portless',
    serviceUrlScheme: 'https',
    serviceUrlHostSuffix: 'stack',
    unifyServiceUrls: false,
    serviceFavorites: []
  },
  host: {
    authenticationMethod: 'forms',
    enableSsl: false,
    urlBase: '',
    bindAddress: '127.0.0.1',
    port: 7777
  },
  connect: {
    exposeSeerrOnly: true,
    warnBeforePublicExposure: true
  },
  profiles: {
    movieProfilePreset: 'lite',
    movie4kProfilePreset: 'lite',
    tvProfilePreset: 'lite',
    tv4kProfilePreset: 'lite',
    musicProfilePreset: 'lossless',
    movieDefault: 'HD Lite',
    movie4kDefault: '4K Lite',
    tvDefault: 'HD Lite',
    tv4kDefault: '4K Lite',
    musicDefault: 'Lossless',
    preferSeparateHd4kInstances: false
  },
  services: {
    enableMovies: true,
    enableTvShows: true,
    enable4kServarr: false,
    enableBazarr: true,
    enableLidarr: true,
    enableBookOrbit: false,
    enableImmich: false,
    enableRomm: false,
    enableQuestarr: false,
    enableYoutarr: false,
    enableTinyMediaManager: true,
    enableRecyclarr: true,
    enableFlaresolverr: true,
    enableTidarr: true,
    enableSeerr: true,
    enablePulsarr: true,
    enableMaintainerr: false,
    enableCleanuparr: false,
    enableAgregarr: false,
    enableTracearr: false
  },
  metadata: {
    tinyMediaManagerEnabled: true,
    plexMetadataMonitoring: true,
    jellyfinMetadataMonitoring: false
  },
  backups: {
    recoveryKeyExportedAt: '',
    recoveryKeyExportedKeyId: ''
  },
  telemetry: {
    enabled: false,
    endpoint: '',
    installId: '',
    channel: stackarrChannel,
    lastSentAt: ''
  }
};

export function readSettings(): StackarrSettings {
  const envSettings = settingsFromEnv(readEnv());

  if (databaseExists()) {
    const stored = readJsonSetting<StackarrSettingsPatch | null>('stackarr.settings', null);
    const migratedStored = stored ? migrateSettingsPatch(stored) : stored;
    const current = migratedStored
      ? mergeSettings(defaultSettings, migratedStored)
      : mergeSettings(defaultSettings, envSettings);
    const migrated = syncEnvBackedSettings(current, envSettings);

    if (
      !stored ||
      JSON.stringify(migratedStored) !== JSON.stringify(stored) ||
      JSON.stringify(migrated) !== JSON.stringify(current)
    ) {
      writeJsonSetting('stackarr.settings', migrated);
    }

    return migrated;
  }

  const seeded = mergeSettings(defaultSettings, envSettings);

  writeJsonSetting('stackarr.settings', seeded);
  return seeded;
}

export function writeSettings(settings: StackarrSettingsPatch): StackarrSettings {
  const next = mergeSettings(readSettings(), settings);
  writeJsonSetting('stackarr.settings', next);
  return next;
}

function settingsFromEnv(env: StackarrEnv): StackarrSettingsPatch {
  return {
    host: {
      ...defaultSettings.host,
      bindAddress: env.STACKARR_BIND_IP ?? defaultSettings.host.bindAddress,
      port: Number(env.STACKARR_WEB_PORT ?? defaultSettings.host.port)
    },
    connect: {
      ...defaultSettings.connect
    },
    profiles: {
      ...defaultSettings.profiles,
      movieProfilePreset: normalizeMediaProfilePreset(env.STACKARR_MOVIE_PROFILE_PRESET),
      movie4kProfilePreset: normalizeMediaProfilePreset(env.STACKARR_MOVIE_4K_PROFILE_PRESET),
      tvProfilePreset: normalizeMediaProfilePreset(env.STACKARR_TV_PROFILE_PRESET),
      tv4kProfilePreset: normalizeMediaProfilePreset(env.STACKARR_TV_4K_PROFILE_PRESET),
      musicProfilePreset: normalizeMusicProfilePreset(env.STACKARR_MUSIC_PROFILE_PRESET),
      movieDefault:
        env.STACKARR_MOVIE_DEFAULT_PROFILE || mediaProfileNameFromPreset(env.STACKARR_MOVIE_PROFILE_PRESET, 'hd'),
      movie4kDefault:
        env.STACKARR_MOVIE_4K_DEFAULT_PROFILE || mediaProfileNameFromPreset(env.STACKARR_MOVIE_4K_PROFILE_PRESET, '4k'),
      tvDefault: env.STACKARR_TV_DEFAULT_PROFILE || mediaProfileNameFromPreset(env.STACKARR_TV_PROFILE_PRESET, 'hd'),
      tv4kDefault:
        env.STACKARR_TV_4K_DEFAULT_PROFILE || mediaProfileNameFromPreset(env.STACKARR_TV_4K_PROFILE_PRESET, '4k'),
      musicDefault: env.STACKARR_MUSIC_DEFAULT_PROFILE || musicProfileNameFromPreset(env.STACKARR_MUSIC_PROFILE_PRESET),
      preferSeparateHd4kInstances: envFlag(env.ENABLE_4K_SERVARR, defaultSettings.profiles.preferSeparateHd4kInstances)
    },
    services: {
      enableMovies: envFlag(env.ENABLE_MOVIES, defaultSettings.services.enableMovies),
      enableTvShows: envFlag(env.ENABLE_TV_SHOWS, defaultSettings.services.enableTvShows),
      enable4kServarr: envFlag(env.ENABLE_4K_SERVARR, defaultSettings.services.enable4kServarr),
      enableBazarr: envFlag(env.ENABLE_BAZARR, defaultSettings.services.enableBazarr),
      enableLidarr: envFlag(env.ENABLE_LIDARR, defaultSettings.services.enableLidarr),
      enableBookOrbit: envFlag(env.ENABLE_BOOKORBIT, defaultSettings.services.enableBookOrbit),
      enableImmich: envFlag(env.ENABLE_IMMICH, defaultSettings.services.enableImmich),
      enableRomm: envFlag(env.ENABLE_ROMM, defaultSettings.services.enableRomm),
      enableQuestarr: envFlag(env.ENABLE_QUESTARR, defaultSettings.services.enableQuestarr),
      enableYoutarr: envFlag(env.ENABLE_YOUTARR, defaultSettings.services.enableYoutarr),
      enableTinyMediaManager: envFlag(env.ENABLE_TINYMEDIAMANAGER, defaultSettings.services.enableTinyMediaManager),
      enableRecyclarr: envFlag(env.ENABLE_RECYCLARR, defaultSettings.services.enableRecyclarr),
      enableFlaresolverr: envFlag(env.ENABLE_FLARESOLVERR, defaultSettings.services.enableFlaresolverr),
      enableTidarr: envFlag(env.ENABLE_TIDARR, defaultSettings.services.enableTidarr),
      enableSeerr: envFlag(env.ENABLE_SEERR, defaultSettings.services.enableSeerr),
      enablePulsarr: envFlag(env.ENABLE_PULSARR, defaultSettings.services.enablePulsarr),
      enableMaintainerr: envFlag(env.ENABLE_MAINTAINERR, defaultSettings.services.enableMaintainerr),
      enableCleanuparr: envFlag(env.ENABLE_CLEANUPARR, defaultSettings.services.enableCleanuparr),
      enableAgregarr: envFlag(env.ENABLE_AGREGARR, defaultSettings.services.enableAgregarr),
      enableTracearr: envFlag(env.ENABLE_TRACEARR, defaultSettings.services.enableTracearr)
    },
    metadata: {
      ...defaultSettings.metadata,
      plexMetadataMonitoring: env.PLEX_INSTALL_MODE !== 'disabled',
      jellyfinMetadataMonitoring: env.JELLYFIN_INSTALL_MODE === 'native' || env.JELLYFIN_INSTALL_MODE === 'docker'
    },
    telemetry: {
      ...defaultSettings.telemetry,
      enabled: envFlag(env.STACKARR_TELEMETRY_ENABLED, defaultSettings.telemetry.enabled),
      endpoint: env.STACKARR_TELEMETRY_ENDPOINT || 'https://stackarr.app/api/telemetry/events',
      channel: effectiveTelemetryChannel(env.STACKARR_TELEMETRY_CHANNEL)
    }
  };
}

function syncEnvBackedSettings(current: StackarrSettings, envSettings: StackarrSettingsPatch): StackarrSettings {
  const next = mergeSettings(current, {});

  if (envSettings.host?.bindAddress !== undefined) {
    next.host.bindAddress = envSettings.host.bindAddress;
  }

  if (envSettings.host?.port !== undefined) {
    next.host.port = envSettings.host.port;
  }

  if (envSettings.metadata?.plexMetadataMonitoring !== undefined) {
    next.metadata.plexMetadataMonitoring = envSettings.metadata.plexMetadataMonitoring;
  }

  if (envSettings.metadata?.jellyfinMetadataMonitoring !== undefined) {
    next.metadata.jellyfinMetadataMonitoring = envSettings.metadata.jellyfinMetadataMonitoring;
  }

  if (envSettings.profiles?.preferSeparateHd4kInstances !== undefined) {
    next.profiles.preferSeparateHd4kInstances = envSettings.profiles.preferSeparateHd4kInstances;
  }

  for (const key of [
    'movieProfilePreset',
    'movie4kProfilePreset',
    'tvProfilePreset',
    'tv4kProfilePreset',
    'musicProfilePreset',
    'movieDefault',
    'movie4kDefault',
    'tvDefault',
    'tv4kDefault',
    'musicDefault'
  ] as Array<keyof StackarrSettings['profiles']>) {
    if (envSettings.profiles?.[key] !== undefined) {
      next.profiles[key] = envSettings.profiles[key] as never;
    }
  }

  for (const [key, value] of Object.entries(envSettings.services ?? {}) as Array<
    [keyof StackarrSettings['services'], boolean]
  >) {
    next.services[key] = value;
  }

  if (envSettings.telemetry?.endpoint && !current.telemetry.endpoint) {
    next.telemetry.endpoint = envSettings.telemetry.endpoint;
  }

  if (envSettings.telemetry?.channel && isAutomaticTelemetryChannel(current.telemetry.channel)) {
    next.telemetry.channel = envSettings.telemetry.channel;
  }

  if (envSettings.telemetry?.enabled !== undefined && current.telemetry.enabled === defaultSettings.telemetry.enabled) {
    next.telemetry.enabled = envSettings.telemetry.enabled;
  }

  return next;
}

function mergeSettings(base: StackarrSettings, partial: StackarrSettingsPatch): StackarrSettings {
  return {
    setup: { ...base.setup, ...partial.setup },
    ui: {
      ...base.ui,
      ...partial.ui,
      theme: normalizeTheme(partial.ui?.theme ?? base.ui.theme),
      diskWarningThresholdPercent: normalizeDiskWarningThreshold(
        partial.ui?.diskWarningThresholdPercent ?? base.ui.diskWarningThresholdPercent
      )
    },
    host: {
      ...base.host,
      ...partial.host,
      authenticationMethod: normalizeAuthenticationMethod(
        partial.host?.authenticationMethod ?? base.host.authenticationMethod
      )
    },
    connect: {
      exposeSeerrOnly: partial.connect?.exposeSeerrOnly ?? base.connect.exposeSeerrOnly,
      warnBeforePublicExposure: partial.connect?.warnBeforePublicExposure ?? base.connect.warnBeforePublicExposure
    },
    profiles: { ...base.profiles, ...partial.profiles },
    services: { ...base.services, ...partial.services },
    metadata: { ...base.metadata, ...partial.metadata },
    backups: { ...base.backups, ...partial.backups },
    telemetry: {
      ...base.telemetry,
      ...partial.telemetry,
      channel: normalizeTelemetryChannel(partial.telemetry?.channel ?? base.telemetry.channel),
      endpoint: normalizeTelemetryEndpoint(partial.telemetry?.endpoint ?? base.telemetry.endpoint)
    }
  };
}

function migrateSettingsPatch(settings: StackarrSettingsPatch): StackarrSettingsPatch {
  let next = settings.setup ? settings : mergeSettingsPatch(settings, { setup: { onboardingComplete: true } });

  if ((next.ui as { theme?: unknown } | undefined)?.theme === 'purple') {
    next = mergeSettingsPatch(next, { ui: { theme: 'dark' } });
  }

  if ((next.host as { authenticationMethod?: unknown } | undefined)?.authenticationMethod === 'apikey') {
    next = mergeSettingsPatch(next, { host: { authenticationMethod: 'forms' } });
  }

  return next;
}

function normalizeAuthenticationMethod(value: unknown): StackarrSettings['host']['authenticationMethod'] {
  return value === 'none' ? 'none' : 'forms';
}

function mergeSettingsPatch(base: StackarrSettingsPatch, patch: StackarrSettingsPatch): StackarrSettingsPatch {
  return {
    ...base,
    ...patch,
    setup: { ...base.setup, ...patch.setup },
    ui: { ...base.ui, ...patch.ui },
    host: { ...base.host, ...patch.host },
    connect: { ...base.connect, ...patch.connect },
    profiles: { ...base.profiles, ...patch.profiles },
    services: { ...base.services, ...patch.services },
    metadata: { ...base.metadata, ...patch.metadata },
    backups: { ...base.backups, ...patch.backups },
    telemetry: { ...base.telemetry, ...patch.telemetry }
  };
}

function normalizeDiskWarningThreshold(value: unknown) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : defaultSettings.ui.diskWarningThresholdPercent;
}

function normalizeTheme(value: unknown): StackarrTheme {
  return value === 'light' || value === 'system' ? value : 'dark';
}

function normalizeTelemetryChannel(value: unknown) {
  const channel = String(value ?? '').trim();
  return channel || stackarrChannel;
}

function effectiveTelemetryChannel(override: unknown) {
  const channel = String(override ?? '').trim();
  return channel && !isAutomaticTelemetryChannel(channel) ? channel : stackarrChannel;
}

function isAutomaticTelemetryChannel(channel: string) {
  return ['stable', 'alpha', 'beta', 'preview'].includes(channel);
}

function normalizeTelemetryEndpoint(value: unknown) {
  return String(value ?? '').trim();
}

function envFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}
