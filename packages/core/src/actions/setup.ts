import { execFile } from 'node:child_process';
import * as nodeCrypto from 'node:crypto';
import { promisify } from 'node:util';
import { defaultStackarrAppRoot, type InstallMode, type StackarrEnv, type TorrentClient, writeEnvConfig } from '../env';
import { accountUsernameValidationError, portablePasswordValidationError } from '../passwordPolicy';
import { repoRoot, stackarrBin } from '../paths';
import {
  type MediaProfilePreset,
  type MusicProfilePreset,
  mediaProfileNameFromPreset,
  mediaProfilePresetOptions,
  musicProfileNameFromPreset,
  musicProfilePresetOptions,
  normalizeMediaProfilePreset,
  normalizeMusicProfilePreset
} from '../profilePresets';
import { redactSecrets } from '../safety/redaction';
import { writeSettings } from '../settings';

const execFileAsync = promisify(execFile);
const maintainerrCleanupPresetOptions = ['watched-movies', 'abandoned-shows', 'stale-requests'] as const;
type MaintainerrCleanupPreset = (typeof maintainerrCleanupPresetOptions)[number];
const rommMetadataPresetOptions = ['chef', 'french', 'twitch', 'quick', 'custom'] as const;
type RommMetadataPreset = (typeof rommMetadataPresetOptions)[number];

export type MediaServerSetupInput = {
  databaseMode?: 'app-default' | 'postgres';
  torrentClient?: TorrentClient;
  mediaRoot?: string;
  musicRoot?: string;
  downloadsRoot?: string;
  backupRoot?: string;
  backupRetentionCount?: number;
  plexInstallMode?: InstallMode;
  plexToken?: string;
  jellyfinInstallMode?: InstallMode;
  enabledMediaTypes?: Array<'movies' | 'tv' | 'music' | 'books' | 'photos' | 'games'>;
  requestManagers?: Array<'seerr' | 'pulsarr'>;
  enabledServices?: Array<
    | 'bazarr'
    | 'tinymediamanager'
    | 'lidarr'
    | 'bookorbit'
    | 'immich'
    | 'romm'
    | 'questarr'
    | 'recyclarr'
    | 'flaresolverr'
    | 'tidarr'
    | 'maintainerr'
    | 'cleanuparr'
    | 'agregarr'
    | 'tracearr'
  >;
  enableMovies?: boolean;
  enableTvShows?: boolean;
  enable4kServarr?: boolean;
  enableBazarr?: boolean;
  enableLidarr?: boolean;
  enableBookOrbit?: boolean;
  enableImmich?: boolean;
  enableRomm?: boolean;
  enableQuestarr?: boolean;
  enableTinyMediaManager?: boolean;
  enableRecyclarr?: boolean;
  enableFlaresolverr?: boolean;
  enableTidarr?: boolean;
  enableMaintainerr?: boolean;
  enableCleanuparr?: boolean;
  enableAgregarr?: boolean;
  enableTracearr?: boolean;
  maintainerrCleanupPresets?: MaintainerrCleanupPreset[];
  rommLibraryRoot?: string;
  rommMetadataPreset?: RommMetadataPreset;
  rommIgdbClientId?: string;
  rommIgdbClientSecret?: string;
  rommSteamGridDbApiKey?: string;
  rommRetroAchievementsApiKey?: string;
  rommScreenscraperUser?: string;
  rommScreenscraperPassword?: string;
  rommHasheousApiEnabled?: boolean;
  rommPlaymatchApiEnabled?: boolean;
  movieProfilePreset?: MediaProfilePreset;
  movie4kProfilePreset?: MediaProfilePreset;
  tvProfilePreset?: MediaProfilePreset;
  tv4kProfilePreset?: MediaProfilePreset;
  musicProfilePreset?: MusicProfilePreset;
  movieDefaultProfile?: string;
  movie4kDefaultProfile?: string;
  tvDefaultProfile?: string;
  tv4kDefaultProfile?: string;
  musicDefaultProfile?: string;
  enableRequestManagement?: boolean;
  enableSeerr?: boolean;
  configureSeerr?: boolean;
  enablePulsarr?: boolean;
  globalUsername?: string;
  globalPassword?: string;
  globalEmail?: string;
  seerrBindIp?: string;
  transmissionBindIp?: string;
  qbittorrentBindIp?: string;
  webPort?: number;
  installBackup?: boolean;
  installUpdates?: boolean;
  startStack?: boolean;
  configureServices?: boolean;
  applyPresets?: boolean;
  openBrowser?: boolean;
  dryRun?: boolean;
  confirmSetup?: boolean;
};

type ResolvedMediaServerSetupInput = Required<
  Omit<MediaServerSetupInput, 'confirmSetup' | 'dryRun' | 'enabledMediaTypes' | 'requestManagers' | 'enabledServices'>
> & {
  namingScheme: string;
  enabledMediaTypes?: Array<'movies' | 'tv' | 'music' | 'books' | 'photos' | 'games'>;
  requestManagers?: Array<'seerr' | 'pulsarr'>;
  enabledServices?: Array<
    | 'bazarr'
    | 'tinymediamanager'
    | 'lidarr'
    | 'bookorbit'
    | 'immich'
    | 'romm'
    | 'questarr'
    | 'recyclarr'
    | 'flaresolverr'
    | 'tidarr'
    | 'maintainerr'
    | 'cleanuparr'
    | 'agregarr'
    | 'tracearr'
  >;
};

export const stackarrDefaultWebPort = 7777;
const setupDefaultAppRoot = defaultStackarrAppRoot();

export const opinionatedSetupDefaults = {
  torrentClient: 'transmission' as TorrentClient,
  mediaRoot: `${setupDefaultAppRoot}/media`,
  musicRoot: `${setupDefaultAppRoot}/media/Music`,
  downloadsRoot: `${setupDefaultAppRoot}/downloads`,
  backupRoot: `${setupDefaultAppRoot}/backups`,
  backupRetentionCount: 52,
  databaseMode: 'app-default' as const,
  plexInstallMode: 'docker' as InstallMode,
  plexToken: '',
  jellyfinInstallMode: 'disabled' as InstallMode,
  enabledMediaTypes: ['movies', 'tv', 'music'] as Array<'movies' | 'tv' | 'music' | 'books' | 'photos' | 'games'>,
  enableMovies: true,
  enableTvShows: true,
  enable4kServarr: false,
  enableBazarr: true,
  enableLidarr: true,
  enableBookOrbit: false,
  enableImmich: false,
  enableRomm: false,
  enableQuestarr: false,
  enableTinyMediaManager: true,
  enableRecyclarr: true,
  enableFlaresolverr: true,
  enableTidarr: true,
  enableMaintainerr: false,
  enableCleanuparr: false,
  enableAgregarr: false,
  enableTracearr: false,
  maintainerrCleanupPresets: [] as MaintainerrCleanupPreset[],
  rommLibraryRoot: '',
  rommMetadataPreset: 'chef' as RommMetadataPreset,
  rommIgdbClientId: '',
  rommIgdbClientSecret: '',
  rommSteamGridDbApiKey: '',
  rommRetroAchievementsApiKey: '',
  rommScreenscraperUser: '',
  rommScreenscraperPassword: '',
  rommHasheousApiEnabled: true,
  rommPlaymatchApiEnabled: false,
  movieProfilePreset: 'lite' as MediaProfilePreset,
  movie4kProfilePreset: 'lite' as MediaProfilePreset,
  tvProfilePreset: 'lite' as MediaProfilePreset,
  tv4kProfilePreset: 'lite' as MediaProfilePreset,
  musicProfilePreset: 'lossless' as MusicProfilePreset,
  movieDefaultProfile: 'HD Lite',
  movie4kDefaultProfile: '4K Lite',
  tvDefaultProfile: 'HD Lite',
  tv4kDefaultProfile: '4K Lite',
  musicDefaultProfile: 'Lossless',
  enableRequestManagement: true,
  enableSeerr: false,
  configureSeerr: false,
  enablePulsarr: true,
  globalUsername: 'admin',
  globalPassword: '',
  globalEmail: '',
  seerrBindIp: '127.0.0.1',
  transmissionBindIp: '127.0.0.1',
  qbittorrentBindIp: '127.0.0.1',
  webPort: stackarrDefaultWebPort,
  installBackup: true,
  installUpdates: false,
  startStack: true,
  configureServices: true,
  applyPresets: true,
  openBrowser: true,
  namingScheme: 'Plex recommended naming preset managed by stackarr/config/naming.json'
};

export function getMediaServerSetupProfileAction() {
  return {
    summary:
      'Opinionated full Stackarr media-server setup. The onboarding entry point supports fresh setup, restore from backup, or migration from a current stack.',
    onboardingModes: [
      {
        id: 'fresh',
        label: 'Set up from scratch',
        runTool: 'stackarr_setup_media_server'
      },
      {
        id: 'restore',
        label: 'Restore from backup',
        runTool: 'stackarr_restore_backup'
      },
      {
        id: 'migrate',
        label: 'Migrate current stack',
        runTool: 'stackarr_migrate_current_stack'
      }
    ],
    browser: {
      defaultPort: stackarrDefaultWebPort,
      localUrl: `http://127.0.0.1:${stackarrDefaultWebPort}`
    },
    questions: [
      {
        id: 'torrentClient',
        prompt: 'Which torrent client should Stackarr use?',
        type: 'choice',
        choices: ['transmission', 'qbittorrent'],
        default: opinionatedSetupDefaults.torrentClient
      },
      {
        id: 'mediaRoot',
        prompt: 'Where should the media library live?',
        type: 'path',
        default: opinionatedSetupDefaults.mediaRoot
      },
      {
        id: 'musicRoot',
        prompt: 'Where should the Lidarr music library live?',
        type: 'path',
        default: opinionatedSetupDefaults.musicRoot
      },
      {
        id: 'downloadsRoot',
        prompt: 'Where should downloads live?',
        type: 'path',
        default: opinionatedSetupDefaults.downloadsRoot
      },
      {
        id: 'backupRetentionCount',
        prompt: 'How many latest backup archives should the installed Plex backup service retain?',
        type: 'number',
        default: opinionatedSetupDefaults.backupRetentionCount
      },
      {
        id: 'installBackup',
        prompt:
          'Should Stackarr install and run the scheduled backup service? Turn this off if backups should be disabled.',
        type: 'boolean',
        default: opinionatedSetupDefaults.installBackup
      },
      {
        id: 'databaseMode',
        prompt:
          'Advanced: which database mode should supported apps use? App-default keeps each app on its native/SQLite default unless an enabled service requires Postgres; postgres switches supported apps to the shared Postgres container.',
        type: 'choice',
        choices: ['app-default', 'postgres'],
        default: opinionatedSetupDefaults.databaseMode
      },
      {
        id: 'plexInstallMode',
        prompt:
          'How should Plex be handled? Use docker for a fully managed container; existing connects to a Plex server already running outside Stackarr.',
        type: 'choice',
        choices: ['docker', 'native', 'disabled'],
        default: opinionatedSetupDefaults.plexInstallMode
      },
      {
        id: 'plexToken',
        prompt:
          'Optional Plex token for automatic Plex API wiring. Add credentials only through a trusted setup surface.',
        type: 'password',
        default: ''
      },
      {
        id: 'jellyfinInstallMode',
        prompt: 'How should Jellyfin be handled?',
        type: 'choice',
        choices: ['disabled', 'docker', 'native'],
        default: opinionatedSetupDefaults.jellyfinInstallMode
      },
      {
        id: 'enabledMediaTypes',
        prompt: 'Which libraries should Stackarr set up?',
        type: 'multi-choice',
        choices: ['movies', 'tv', 'music', 'books', 'photos', 'games'],
        default: ['movies', 'tv', 'music']
      },
      {
        id: 'enable4kServarr',
        prompt: 'Run separate Radarr and Sonarr 4K instances for UHD requests?',
        type: 'boolean',
        default: opinionatedSetupDefaults.enable4kServarr
      },
      {
        id: 'enableRequestManagement',
        prompt: 'Do you want media request management?',
        type: 'boolean',
        default: opinionatedSetupDefaults.enableRequestManagement
      },
      {
        id: 'requestManagers',
        prompt:
          'Which request managers should Stackarr enable? Pulsarr is the default for Plex watchlists; Seerr is optional and useful for Jellyfin or portal-style requests.',
        type: 'multi-choice',
        choices: ['seerr', 'pulsarr'],
        default: ['pulsarr']
      },
      {
        id: 'configureSeerr',
        prompt: 'Wire Seerr to Radarr/Sonarr automatically?',
        type: 'boolean',
        default: opinionatedSetupDefaults.configureSeerr
      },
      {
        id: 'enabledServices',
        prompt:
          'Which companion services should Stackarr manage? Bazarr handles subtitles, TinyMediaManager handles metadata/naming, Lidarr handles music, BookOrbit handles books, Immich handles photo-library backup and browsing, RomM handles game libraries, Questarr handles game discovery/downloads, Recyclarr manages profiles, FlareSolverr helps indexers, Tidarr helps Tidal workflows, Maintainerr stages cleanup planning, Cleanuparr blocks malware-like downloads and cleans queues, Agregarr curates Plex collections, and Tracearr monitors media-server activity.',
        type: 'multi-choice',
        choices: [
          'bazarr',
          'tinymediamanager',
          'lidarr',
          'recyclarr',
          'flaresolverr',
          'tidarr',
          'bookorbit',
          'immich',
          'romm',
          'questarr',
          'maintainerr',
          'cleanuparr',
          'agregarr',
          'tracearr'
        ],
        default: ['bazarr', 'tinymediamanager', 'lidarr', 'recyclarr', 'flaresolverr', 'tidarr']
      },
      {
        id: 'maintainerrCleanupPresets',
        prompt:
          'Optional Maintainerr cleanup ideas to keep handy after Stackarr wires the media server, Arr services, Seerr, and supported download client.',
        type: 'multi-choice',
        choices: [...maintainerrCleanupPresetOptions],
        default: opinionatedSetupDefaults.maintainerrCleanupPresets
      },
      {
        id: 'rommLibraryRoot',
        prompt: 'Where should RomM mount the game library?',
        type: 'path',
        default: `${opinionatedSetupDefaults.mediaRoot}/Games`
      },
      {
        id: 'rommMetadataPreset',
        prompt:
          'Which RomM metadata provider combo should onboarding configure? chef = Hasheous + IGDB + SteamGridDB + RetroAchievements; french = ScreenScraper + RetroAchievements; twitch = IGDB + Playmatch; quick = Hasheous only.',
        type: 'choice',
        choices: [...rommMetadataPresetOptions],
        default: opinionatedSetupDefaults.rommMetadataPreset
      },
      {
        id: 'rommIgdbClientId',
        prompt: 'RomM IGDB client ID, if using the chef or twitch provider combo.',
        type: 'text',
        default: ''
      },
      {
        id: 'rommIgdbClientSecret',
        prompt: 'RomM IGDB client secret, if using the chef or twitch provider combo.',
        type: 'password',
        default: ''
      },
      {
        id: 'rommSteamGridDbApiKey',
        prompt: 'RomM SteamGridDB API key, if using the chef provider combo.',
        type: 'password',
        default: ''
      },
      {
        id: 'rommRetroAchievementsApiKey',
        prompt: 'RomM RetroAchievements API key, if using the chef or french provider combo.',
        type: 'password',
        default: ''
      },
      {
        id: 'rommScreenscraperUser',
        prompt: 'RomM ScreenScraper username, if using the french provider combo.',
        type: 'text',
        default: ''
      },
      {
        id: 'rommScreenscraperPassword',
        prompt: 'RomM ScreenScraper password, if using the french provider combo.',
        type: 'password',
        default: ''
      },
      {
        id: 'movieProfilePreset',
        prompt: 'Which movie profile preset should Radarr use by default?',
        type: 'choice',
        choices: [...mediaProfilePresetOptions],
        default: opinionatedSetupDefaults.movieProfilePreset
      },
      {
        id: 'tvProfilePreset',
        prompt: 'Which TV profile preset should Sonarr use by default?',
        type: 'choice',
        choices: [...mediaProfilePresetOptions],
        default: opinionatedSetupDefaults.tvProfilePreset
      },
      {
        id: 'musicProfilePreset',
        prompt: 'Which music profile preset should Lidarr use by default?',
        type: 'choice',
        choices: [...musicProfilePresetOptions],
        default: opinionatedSetupDefaults.musicProfilePreset
      },
      {
        id: 'globalUsername',
        prompt: 'What shared admin username should Stackarr use for service first-run setup?',
        type: 'text',
        default: opinionatedSetupDefaults.globalUsername
      },
      {
        id: 'globalPassword',
        prompt: 'What shared admin password should Stackarr use for service first-run setup?',
        type: 'password',
        default: ''
      },
      {
        id: 'globalEmail',
        prompt:
          'Admin email for services that require email. Leave blank if Plex is installed and signed in so Stackarr can discover the Plex account email.',
        type: 'email',
        default: ''
      }
    ],
    defaults: opinionatedSetupDefaults,
    runTool: 'stackarr_setup_media_server'
  };
}

export async function setupMediaServerAction(input: MediaServerSetupInput = {}) {
  const mediaTypePatch = input.enabledMediaTypes
    ? {
        enableMovies: input.enabledMediaTypes.includes('movies'),
        enableTvShows: input.enabledMediaTypes.includes('tv'),
        enableLidarr: input.enabledMediaTypes.includes('music'),
        enableBookOrbit: input.enabledMediaTypes.includes('books'),
        enableImmich: input.enabledMediaTypes.includes('photos'),
        enableRomm: input.enabledMediaTypes.includes('games')
      }
    : {};
  const requestManagerPatch = input.requestManagers
    ? {
        enableSeerr: input.requestManagers.includes('seerr'),
        enablePulsarr: input.requestManagers.includes('pulsarr')
      }
    : {};
  const servicesPatch = input.enabledServices
    ? {
        enableBazarr: input.enabledServices.includes('bazarr'),
        enableTinyMediaManager: input.enabledServices.includes('tinymediamanager'),
        enableLidarr: input.enabledServices.includes('lidarr'),
        enableBookOrbit: input.enabledServices.includes('bookorbit'),
        enableImmich: input.enabledServices.includes('immich'),
        enableRomm: input.enabledServices.includes('romm'),
        enableQuestarr: input.enabledServices.includes('questarr'),
        enableRecyclarr: input.enabledServices.includes('recyclarr'),
        enableFlaresolverr: input.enabledServices.includes('flaresolverr'),
        enableTidarr: input.enabledServices.includes('tidarr'),
        enableMaintainerr: input.enabledServices.includes('maintainerr'),
        enableCleanuparr: input.enabledServices.includes('cleanuparr'),
        enableAgregarr: input.enabledServices.includes('agregarr'),
        enableTracearr: input.enabledServices.includes('tracearr')
      }
    : {};
  const merged = {
    ...opinionatedSetupDefaults,
    ...mediaTypePatch,
    ...requestManagerPatch,
    ...servicesPatch,
    ...input
  };
  merged.movieProfilePreset = normalizeMediaProfilePreset(merged.movieProfilePreset);
  merged.movie4kProfilePreset = normalizeMediaProfilePreset(merged.movie4kProfilePreset);
  merged.tvProfilePreset = normalizeMediaProfilePreset(merged.tvProfilePreset);
  merged.tv4kProfilePreset = normalizeMediaProfilePreset(merged.tv4kProfilePreset);
  merged.musicProfilePreset = normalizeMusicProfilePreset(merged.musicProfilePreset);
  if (input.movieDefaultProfile === undefined)
    merged.movieDefaultProfile = mediaProfileNameFromPreset(merged.movieProfilePreset, 'hd');
  if (input.movie4kDefaultProfile === undefined)
    merged.movie4kDefaultProfile = mediaProfileNameFromPreset(merged.movie4kProfilePreset, '4k');
  if (input.tvDefaultProfile === undefined)
    merged.tvDefaultProfile = mediaProfileNameFromPreset(merged.tvProfilePreset, 'hd');
  if (input.tv4kDefaultProfile === undefined)
    merged.tv4kDefaultProfile = mediaProfileNameFromPreset(merged.tv4kProfilePreset, '4k');
  if (input.musicDefaultProfile === undefined)
    merged.musicDefaultProfile = musicProfileNameFromPreset(merged.musicProfilePreset);
  if (input.musicRoot === undefined) merged.musicRoot = `${merged.mediaRoot}/Music`;
  const plexEnabled = merged.plexInstallMode !== 'disabled';
  const jellyfinEnabled = merged.jellyfinInstallMode !== 'disabled';
  const mediaServerEnabled = plexEnabled || jellyfinEnabled;
  const videoAutomationEnabled = merged.enableMovies || merged.enableTvShows;
  if (!merged.enableRequestManagement) {
    merged.enableSeerr = false;
    merged.enablePulsarr = false;
  } else {
    if (!mediaServerEnabled || !videoAutomationEnabled) merged.enableSeerr = false;
    if (!plexEnabled || !videoAutomationEnabled) merged.enablePulsarr = false;
  }
  if (merged.enableRequestManagement && jellyfinEnabled && videoAutomationEnabled && input.enableSeerr === undefined) {
    merged.enableSeerr = true;
  }
  if (!mediaServerEnabled) {
    merged.enableMaintainerr = false;
    merged.enableTracearr = false;
  }
  if (!plexEnabled) {
    merged.enableAgregarr = false;
  }
  if (!videoAutomationEnabled) {
    merged.enable4kServarr = false;
    merged.enableBazarr = false;
    merged.enableTinyMediaManager = false;
    merged.enableRecyclarr = false;
  }
  if (!videoAutomationEnabled && !merged.enableLidarr) {
    merged.enableCleanuparr = false;
  }
  if (!videoAutomationEnabled && !merged.enableLidarr) {
    merged.enableFlaresolverr = false;
  }
  const dryRun = input.dryRun !== false;
  const commands = buildSetupCommands(merged);
  const envPatch = buildSetupEnv(merged);
  const plan = {
    dryRun,
    requiresConfirmation: !dryRun,
    config: redactSecrets(envPatch),
    commands,
    browser: {
      defaultPort: merged.webPort,
      localUrl: `http://127.0.0.1:${merged.webPort}`,
      openBrowser: merged.openBrowser
    },
    notes: [
      'Asks which libraries to set up: Movies (Radarr), TV shows (Sonarr), Music (Lidarr), Books (BookOrbit), Photos (Immich), and Games (RomM).',
      'Uses repo-managed naming, download, and request presets.',
      'Radarr and Sonarr size/profile presets are written into the generated Recyclarr configs; Lidarr profiles are applied through Lidarr because Recyclarr does not manage Lidarr.',
      'Naming preset follows Plex-friendly naming conventions via stackarr/config/naming.json.',
      merged.plexInstallMode === 'docker'
        ? 'Plex Docker mode starts Plex with the stack; complete Plex claim/sign-in before Plex-dependent automations need a Plex account.'
        : 'Existing Plex mode connects to a Plex Media Server that is already installed, reachable, and signed in outside Stackarr.',
      'Pulsarr first-run admin uses the shared Stackarr username/password and the configured email, falling back to the signed-in Plex account email when available.',
      'Maintainerr is wired to the selected media server, Arr services, Seerr, and qBittorrent when available; cleanup rules stay user-controlled.',
      'Cleanuparr blocks malware-like executable and script files with a media-safe Stackarr blocklist, scans every five seconds, and deletes a download when any blocked file is present.',
      'Agregarr is optional Plex collection curation. Stackarr uses the signed-in Plex owner token to initialize it, connects Radarr and Sonarr, and creates Coming Soon as the default release-date-sorted source while leaving handmade collections user-controlled.',
      'Tracearr uses the shared Postgres/TimescaleDB service plus shared Redis; onboarding attempts first-owner setup and media-server wiring when credentials are available.',
      'Immich is optional photo-library functionality; Stackarr starts the web app and machine-learning worker against shared Postgres and shared Redis, then the user completes first-run setup in Immich or the iOS app.',
      'RomM is optional private game-library functionality; Stackarr starts RomM on the shared Postgres and Redis services, and no public Cloudflare route is added unless the user explicitly creates one later.'
    ]
  };
  const usernameValidationError = accountUsernameValidationError(merged.globalUsername, 'Global username');
  if (usernameValidationError) {
    return {
      accepted: false,
      plan,
      error: usernameValidationError
    };
  }

  const passwordValidationError = portablePasswordValidationError(merged.globalPassword, 'Global password');
  if (passwordValidationError) {
    return {
      accepted: false,
      plan,
      error: passwordValidationError
    };
  }

  if (dryRun) {
    return {
      accepted: false,
      plan,
      nextStep:
        'Call stackarr_setup_media_server with dryRun: false. The MCP client will request approval before writing config or running setup.'
    };
  }

  if (input.confirmSetup !== true) {
    return {
      accepted: false,
      plan,
      error:
        'Full setup requires confirmSetup: true because it writes Stackarr runtime config and can download/start/configure services.'
    };
  }

  writeEnvConfig(envPatch);
  writeSettings({
    setup: { onboardingComplete: false, installMode: 'fresh' },
    services: {
      enableMovies: merged.enableMovies,
      enableTvShows: merged.enableTvShows,
      enable4kServarr: merged.enable4kServarr,
      enableBazarr: merged.enableBazarr,
      enableLidarr: merged.enableLidarr,
      enableBookOrbit: merged.enableBookOrbit,
      enableImmich: merged.enableImmich,
      enableRomm: merged.enableRomm,
      enableQuestarr: merged.enableQuestarr,
      enableTinyMediaManager: merged.enableTinyMediaManager,
      enableRecyclarr: merged.enableRecyclarr,
      enableFlaresolverr: merged.enableFlaresolverr,
      enableTidarr: merged.enableTidarr,
      enableSeerr: merged.enableSeerr,
      enablePulsarr: merged.enablePulsarr,
      enableMaintainerr: merged.enableMaintainerr,
      enableCleanuparr: merged.enableCleanuparr,
      enableAgregarr: merged.enableAgregarr,
      enableTracearr: merged.enableTracearr
    },
    profiles: {
      movieProfilePreset: merged.movieProfilePreset,
      movie4kProfilePreset: merged.movie4kProfilePreset,
      tvProfilePreset: merged.tvProfilePreset,
      tv4kProfilePreset: merged.tv4kProfilePreset,
      musicProfilePreset: merged.musicProfilePreset,
      movieDefault: merged.movieDefaultProfile,
      movie4kDefault: merged.movie4kDefaultProfile,
      tvDefault: merged.tvDefaultProfile,
      tv4kDefault: merged.tv4kDefaultProfile,
      musicDefault: merged.musicDefaultProfile,
      preferSeparateHd4kInstances: merged.enable4kServarr
    }
  });

  const results = [];
  for (const command of commands) {
    const startedAt = new Date().toISOString();
    try {
      const executable = command.executable === 'open' ? '/usr/bin/open' : stackarrBin;
      const { stdout, stderr } = await execFileAsync(executable, command.args, {
        cwd: repoRoot,
        timeout: command.timeoutMs,
        env: { ...process.env, STACKARR_RUN_SOURCE: 'mcp-setup' }
      });
      results.push({ ...command, startedAt, endedAt: new Date().toISOString(), status: 'completed', stdout, stderr });
    } catch (error) {
      results.push({
        ...command,
        startedAt,
        endedAt: new Date().toISOString(),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      return { accepted: true, completed: false, plan, results };
    }
  }

  writeSettings({
    setup: { onboardingComplete: true, installMode: 'fresh' }
  });

  return { accepted: true, completed: true, plan, results };
}

function buildSetupEnv(input: ResolvedMediaServerSetupInput) {
  const accountPassword = input.globalPassword || nodeCrypto.randomBytes(20).toString('hex');
  const databasePassword = nodeCrypto.randomBytes(24).toString('hex');
  const postgresMode = input.databaseMode === 'postgres';
  const rommLibraryRoot = input.rommLibraryRoot || `${input.mediaRoot}/Games`;
  const rommPreset = rommMetadataPresetOptions.includes(input.rommMetadataPreset) ? input.rommMetadataPreset : 'chef';
  const rommUsesIgdb = rommPreset === 'chef' || rommPreset === 'twitch' || rommPreset === 'custom';
  const rommUsesSteamGridDb = rommPreset === 'chef' || rommPreset === 'custom';
  const rommUsesRetroAchievements = rommPreset === 'chef' || rommPreset === 'french' || rommPreset === 'custom';
  const rommUsesScreenscraper = rommPreset === 'french' || rommPreset === 'custom';
  const rommHasheousEnabled =
    rommPreset === 'quick' || rommPreset === 'chef' || (rommPreset === 'custom' && input.rommHasheousApiEnabled);
  const rommPlaymatchEnabled = rommPreset === 'twitch' || (rommPreset === 'custom' && input.rommPlaymatchApiEnabled);
  const env: StackarrEnv = {
    MEDIA_ROOT: input.mediaRoot,
    MUSIC_ROOT: input.musicRoot,
    DOWNLOADS_ROOT: input.downloadsRoot,
    BACKUP_ROOT: input.backupRoot,
    ENABLE_BACKUP: String(input.installBackup),
    BACKUP_SCHEDULE: 'weekly',
    BACKUP_WEEKDAY: 'Sun',
    BACKUP_RETENTION_COUNT: String(input.backupRetentionCount),
    BACKUP_ENCRYPTION: 'keyfile',
    STACKARR_DATABASE_MODE: input.databaseMode,
    ENABLE_SCHEDULED_UPDATES: String(input.installUpdates),
    UPDATE_TIME: '04:30',
    UPDATE_WEEKDAY: 'Sun',
    PLEX_INSTALL_MODE: input.plexInstallMode,
    PLEX_TOKEN: input.plexToken,
    JELLYFIN_INSTALL_MODE: input.jellyfinInstallMode,
    ENABLE_MOVIES: String(input.enableMovies),
    ENABLE_TV_SHOWS: String(input.enableTvShows),
    ENABLE_4K_SERVARR: String(input.enable4kServarr),
    ENABLE_BAZARR: String(input.enableBazarr),
    ENABLE_LIDARR: String(input.enableLidarr),
    ENABLE_BOOKORBIT: String(input.enableBookOrbit),
    ENABLE_IMMICH: String(input.enableImmich),
    ENABLE_ROMM: String(input.enableRomm),
    ENABLE_QUESTARR: String(input.enableQuestarr),
    ENABLE_TINYMEDIAMANAGER: String(input.enableTinyMediaManager),
    ENABLE_RECYCLARR: String(input.enableRecyclarr),
    ENABLE_FLARESOLVERR: String(input.enableFlaresolverr),
    ENABLE_TIDARR: String(input.enableTidarr),
    ENABLE_MAINTAINERR: String(input.enableMaintainerr),
    ENABLE_CLEANUPARR: String(input.enableCleanuparr),
    ENABLE_AGREGARR: String(input.enableAgregarr),
    ENABLE_TRACEARR: String(input.enableTracearr),
    MAINTAINERR_BIND_IP: '127.0.0.1',
    MAINTAINERR_PORT: '6246',
    MAINTAINERR_URL: 'http://127.0.0.1:6246',
    MAINTAINERR_BASE_PATH: '',
    MAINTAINERR_GITHUB_TOKEN: '',
    MAINTAINERR_CLEANUP_PRESETS: input.maintainerrCleanupPresets.join(','),
    CLEANUPARR_BIND_IP: '127.0.0.1',
    CLEANUPARR_PORT: '11011',
    CLEANUPARR_URL: 'http://127.0.0.1:11011',
    CLEANUPARR_AUTO_CONFIGURE: 'true',
    CLEANUPARR_MALWARE_CRON: '0/5 * * * * ?',
    CLEANUPARR_IMAGE: 'ghcr.io/cleanuparr/cleanuparr:latest',
    AGREGARR_BIND_IP: '127.0.0.1',
    AGREGARR_PORT: '7171',
    AGREGARR_URL: 'http://127.0.0.1:7171',
    AGREGARR_API_KEY: '',
    AGREGARR_PLACEHOLDER_FOLDER: '_Trailers',
    AGREGARR_IMAGE: 'agregarr/agregarr:latest',
    TRACEARR_BIND_IP: '127.0.0.1',
    TRACEARR_PORT: '3000',
    TRACEARR_URL: 'http://127.0.0.1:3000',
    TRACEARR_AUTO_CONFIGURE: 'true',
    TRACEARR_ADMIN_USERNAME: input.globalUsername,
    TRACEARR_ADMIN_EMAIL: input.globalEmail,
    TRACEARR_ADMIN_PASSWORD: input.enableTracearr ? accountPassword : '',
    TRACEARR_CLAIM_CODE: '',
    TRACEARR_PLEX_SERVER_URL: '',
    TRACEARR_JELLYFIN_SERVER_URL: '',
    TRACEARR_EMBY_SERVER_URL: '',
    TRACEARR_DB_PASSWORD: databasePassword,
    TRACEARR_POSTGRES_DATABASE: 'tracearr',
    TRACEARR_POSTGRES_USER: 'tracearr',
    TRACEARR_POSTGRES_PASSWORD: databasePassword,
    TRACEARR_DATABASE_URL: `postgres://tracearr:${encodeURIComponent(databasePassword)}@database:5432/tracearr`,
    TRACEARR_JWT_SECRET: input.enableTracearr ? nodeCrypto.randomBytes(32).toString('hex') : '',
    TRACEARR_COOKIE_SECRET: input.enableTracearr ? nodeCrypto.randomBytes(32).toString('hex') : '',
    TRACEARR_LOG_LEVEL: 'info',
    TRACEARR_CORS_ORIGIN: '*',
    STACKARR_MOVIE_PROFILE_PRESET: input.movieProfilePreset,
    STACKARR_TV_PROFILE_PRESET: input.tvProfilePreset,
    STACKARR_MUSIC_PROFILE_PRESET: input.musicProfilePreset,
    STACKARR_MOVIE_DEFAULT_PROFILE: input.movieDefaultProfile,
    STACKARR_TV_DEFAULT_PROFILE: input.tvDefaultProfile,
    STACKARR_MUSIC_DEFAULT_PROFILE: input.musicDefaultProfile,
    ENABLE_SEERR: String(input.enableSeerr),
    STACKARR_CONFIGURE_SEERR: String(input.configureSeerr),
    ENABLE_PULSARR: String(input.enablePulsarr),
    USERNAME: input.globalUsername,
    PASSWORD: accountPassword,
    USER_EMAIL: input.globalEmail,
    PREFERRED_TORRENT_CLIENT: input.torrentClient,
    SEERR_BIND_IP: input.seerrBindIp,
    TRANSMISSION_BIND_IP: input.transmissionBindIp,
    QBITTORRENT_BIND_IP: input.qbittorrentBindIp,
    STACKARR_WEB_ENABLED: 'true',
    STACKARR_IMAGE: 'polyphonic/stackarr:alpha',
    STACKARR_BIND_IP: '127.0.0.1',
    STACKARR_WEB_PORT: String(input.webPort),
    BOOKORBIT_BIND_IP: '127.0.0.1',
    BOOKORBIT_WEB_PORT: '7582',
    BOOKORBIT_CONTAINER_PORT: '7582',
    BOOKORBIT_URL: 'http://127.0.0.1:7582',
    BOOKORBIT_APP_URL: 'http://127.0.0.1:7582',
    BOOKORBIT_CLIENT_URL: 'http://127.0.0.1:7582',
    BOOKS_ROOT: `${input.mediaRoot}/Books`,
    IMMICH_BIND_IP: '127.0.0.1',
    IMMICH_WEB_PORT: '2283',
    IMMICH_CONTAINER_PORT: '2283',
    IMMICH_URL: 'http://127.0.0.1:2283',
    IMMICH_UPLOAD_LOCATION: `${input.mediaRoot}/Pictures`,
    IMMICH_VERSION: 'release',
    IMMICH_DB_USERNAME: 'immich',
    IMMICH_DB_DATABASE_NAME: 'immich',
    IMMICH_DB_PASSWORD: input.enableImmich ? nodeCrypto.randomBytes(24).toString('hex') : '',
    IMMICH_DB_VECTOR_EXTENSION: 'pgvector',
    IMMICH_SERVER_IMAGE: 'ghcr.io/immich-app/immich-server',
    IMMICH_MACHINE_LEARNING_IMAGE: 'ghcr.io/immich-app/immich-machine-learning',
    GAMES_ROOT: rommLibraryRoot,
    ROMM_URL: 'http://127.0.0.1:7583',
    ROMM_BIND_IP: '127.0.0.1',
    ROMM_WEB_PORT: '7583',
    ROMM_CONTAINER_PORT: '8080',
    ROMM_LIBRARY_ROOT: rommLibraryRoot,
    ROMM_ASSETS_ROOT: `${setupDefaultAppRoot}/config/romm/assets`,
    ROMM_CONFIG_ROOT: `${setupDefaultAppRoot}/config/romm/config`,
    ROMM_RESOURCES_ROOT: `${setupDefaultAppRoot}/config/romm/resources`,
    ROMM_REDIS_DATA_ROOT: '',
    ROMM_REDIS_HOST: 'redis',
    ROMM_REDIS_PORT: '6379',
    ROMM_DB_DATA_LOCATION: '',
    ROMM_DB_DRIVER: 'postgresql',
    ROMM_DB_HOST: 'database',
    ROMM_DB_PORT: '5432',
    ROMM_DB_NAME: 'romm',
    ROMM_DB_USER: 'romm',
    ROMM_DB_PASSWORD: input.enableRomm ? nodeCrypto.randomBytes(24).toString('hex') : '',
    ROMM_DB_ROOT_PASSWORD: '',
    ROMM_DB_QUERY_JSON: '',
    ROMM_AUTH_SECRET_KEY: input.enableRomm ? nodeCrypto.randomBytes(32).toString('hex') : '',
    ROMM_AUTO_CONFIGURE: 'false',
    ROMM_ADMIN_USERNAME: '',
    ROMM_ADMIN_EMAIL: '',
    ROMM_ADMIN_PASSWORD: '',
    ROMM_IGDB_CLIENT_ID: rommUsesIgdb ? input.rommIgdbClientId : '',
    ROMM_IGDB_CLIENT_SECRET: rommUsesIgdb ? input.rommIgdbClientSecret : '',
    ROMM_MOBYGAMES_API_KEY: '',
    ROMM_SCREENSCRAPER_USER: rommUsesScreenscraper ? input.rommScreenscraperUser : '',
    ROMM_SCREENSCRAPER_PASSWORD: rommUsesScreenscraper ? input.rommScreenscraperPassword : '',
    ROMM_RETROACHIEVEMENTS_API_KEY: rommUsesRetroAchievements ? input.rommRetroAchievementsApiKey : '',
    ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS: '30',
    ROMM_STEAMGRIDDB_API_KEY: rommUsesSteamGridDb ? input.rommSteamGridDbApiKey : '',
    ROMM_HASHEOUS_API_ENABLED: String(rommHasheousEnabled),
    ROMM_PLAYMATCH_API_ENABLED: String(rommPlaymatchEnabled),
    ROMM_LAUNCHBOX_API_ENABLED: 'false',
    ROMM_FLASHPOINT_API_ENABLED: 'false',
    ROMM_HLTB_API_ENABLED: 'false',
    ROMM_TGDB_API_ENABLED: 'false',
    ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA: 'false',
    ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON: '0 4 * * *',
    ROMM_IMAGE: 'rommapp/romm:latest',
    ROMM_DB_IMAGE: '',
    QUESTARR_URL: 'http://127.0.0.1:7584',
    QUESTARR_APP_URL: 'http://127.0.0.1:7584',
    QUESTARR_ALLOWED_ORIGINS: 'http://127.0.0.1:7584,http://localhost:7584',
    QUESTARR_BIND_IP: '127.0.0.1',
    QUESTARR_WEB_PORT: '7584',
    QUESTARR_CONTAINER_PORT: '5000',
    QUESTARR_DATA_ROOT: `${setupDefaultAppRoot}/config/questarr`,
    QUESTARR_LIBRARY_ROOT: rommLibraryRoot,
    QUESTARR_SQLITE_DB_PATH: '/app/data/sqlite.db',
    QUESTARR_JWT_SECRET: input.enableQuestarr ? nodeCrypto.randomBytes(32).toString('hex') : '',
    QUESTARR_IGDB_CLIENT_ID: input.enableQuestarr ? input.rommIgdbClientId : '',
    QUESTARR_IGDB_CLIENT_SECRET: input.enableQuestarr ? input.rommIgdbClientSecret : '',
    QUESTARR_IMAGE: 'ghcr.io/doezer/questarr:latest',
    DATABASE_IMAGE: 'timescale/timescaledb-ha:pg18.1-ts2.25.0',
    DATABASE_PGDATA: '/var/lib/postgresql/data',
    DATABASE_BIND_IP: '127.0.0.1',
    DATABASE_HOST_PORT: '5433',
    DATABASE_NAME: 'postgres',
    DATABASE_SUPERUSER: 'postgres',
    DATABASE_SUPERUSER_PASSWORD: databasePassword,
    REDIS_IMAGE: 'redis:8.8.0-alpine',
    STACKARR_POSTGRES_DATABASE: 'stackarr-main',
    STACKARR_POSTGRES_MAIN_DATABASE: 'stackarr-main',
    STACKARR_POSTGRES_LOG_DATABASE: 'stackarr-log',
    STACKARR_POSTGRES_USER: 'stackarr',
    STACKARR_POSTGRES_PASSWORD: databasePassword,
    STACKARR_DATABASE_URL: postgresMode
      ? `postgres://stackarr:${encodeURIComponent(databasePassword)}@database:5432/stackarr-main`
      : '',
    STACKARR_LOG_DATABASE_URL: postgresMode
      ? `postgres://stackarr:${encodeURIComponent(databasePassword)}@database:5432/stackarr-log`
      : '',
    BOOKORBIT_POSTGRES_DATABASE: 'bookorbit',
    BOOKORBIT_POSTGRES_USER: 'bookorbit',
    BOOKORBIT_POSTGRES_PASSWORD: databasePassword,
    BOOKORBIT_DATABASE_URL: `postgres://bookorbit:${encodeURIComponent(databasePassword)}@database:5432/bookorbit`,
    SEERR_DB_TYPE: 'postgres',
    SEERR_POSTGRES_DATABASE: 'seerr',
    SEERR_POSTGRES_USER: 'seerr',
    SEERR_POSTGRES_PASSWORD: databasePassword,
    PULSARR_DB_TYPE: postgresMode ? 'postgres' : 'sqlite',
    PULSARR_DB_PATH: '/app/data/db/pulsarr.db',
    PULSARR_DB_HOST: postgresMode ? 'database' : '',
    PULSARR_DB_PORT: '5432',
    PULSARR_DB_NAME: postgresMode ? 'pulsarr' : '',
    PULSARR_DB_USER: postgresMode ? 'pulsarr' : '',
    PULSARR_DB_PASSWORD: postgresMode ? databasePassword : '',
    PULSARR_POSTGRES_DATABASE: 'pulsarr',
    PULSARR_POSTGRES_USER: 'pulsarr',
    PULSARR_POSTGRES_PASSWORD: databasePassword,
    BAZARR_POSTGRES_ENABLED: String(postgresMode),
    BAZARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    BAZARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    BAZARR_POSTGRES_DATABASE: 'bazarr',
    BAZARR_POSTGRES_USER: 'bazarr',
    BAZARR_POSTGRES_PASSWORD: databasePassword,
    PROWLARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    PROWLARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    PROWLARR_POSTGRES_MAIN_DATABASE: 'prowlarr-main',
    PROWLARR_POSTGRES_LOG_DATABASE: 'prowlarr-log',
    PROWLARR_POSTGRES_USER: 'prowlarr',
    PROWLARR_POSTGRES_PASSWORD: databasePassword,
    RADARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    RADARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    RADARR_POSTGRES_MAIN_DATABASE: 'radarr-main',
    RADARR_POSTGRES_LOG_DATABASE: 'radarr-log',
    RADARR_POSTGRES_USER: 'radarr',
    RADARR_POSTGRES_PASSWORD: databasePassword,
    RADARR4K_POSTGRES_HOST: postgresMode ? 'database' : '',
    RADARR4K_POSTGRES_PORT: postgresMode ? '5432' : '',
    RADARR4K_POSTGRES_MAIN_DATABASE: 'radarr4k-main',
    RADARR4K_POSTGRES_LOG_DATABASE: 'radarr4k-log',
    RADARR4K_POSTGRES_USER: 'radarr4k',
    RADARR4K_POSTGRES_PASSWORD: databasePassword,
    SONARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    SONARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    SONARR_POSTGRES_MAIN_DATABASE: 'sonarr-main',
    SONARR_POSTGRES_LOG_DATABASE: 'sonarr-log',
    SONARR_POSTGRES_USER: 'sonarr',
    SONARR_POSTGRES_PASSWORD: databasePassword,
    SONARR4K_POSTGRES_HOST: postgresMode ? 'database' : '',
    SONARR4K_POSTGRES_PORT: postgresMode ? '5432' : '',
    SONARR4K_POSTGRES_MAIN_DATABASE: 'sonarr4k-main',
    SONARR4K_POSTGRES_LOG_DATABASE: 'sonarr4k-log',
    SONARR4K_POSTGRES_USER: 'sonarr4k',
    SONARR4K_POSTGRES_PASSWORD: databasePassword,
    LIDARR_POSTGRES_HOST: postgresMode ? 'database' : '',
    LIDARR_POSTGRES_PORT: postgresMode ? '5432' : '',
    LIDARR_POSTGRES_MAIN_DATABASE: 'lidarr-main',
    LIDARR_POSTGRES_LOG_DATABASE: 'lidarr-log',
    LIDARR_POSTGRES_USER: 'lidarr',
    LIDARR_POSTGRES_PASSWORD: databasePassword
  };

  if (input.enable4kServarr) {
    env.STACKARR_MOVIE_4K_PROFILE_PRESET = input.movie4kProfilePreset;
    env.STACKARR_TV_4K_PROFILE_PRESET = input.tv4kProfilePreset;
    env.STACKARR_MOVIE_4K_DEFAULT_PROFILE = input.movie4kDefaultProfile;
    env.STACKARR_TV_4K_DEFAULT_PROFILE = input.tv4kDefaultProfile;
  } else {
    env.STACKARR_MOVIE_4K_PROFILE_PRESET = '';
    env.STACKARR_TV_4K_PROFILE_PRESET = '';
    env.STACKARR_MOVIE_4K_DEFAULT_PROFILE = '';
    env.STACKARR_TV_4K_DEFAULT_PROFILE = '';
    env.RADARR4K_API_KEY = '';
    env.SONARR4K_API_KEY = '';
  }

  if (input.enableBookOrbit) {
    if (!env.BOOKORBIT_JWT_SECRET) env.BOOKORBIT_JWT_SECRET = nodeCrypto.randomBytes(32).toString('hex');
    if (!env.BOOKORBIT_SETUP_TOKEN) env.BOOKORBIT_SETUP_TOKEN = accountPassword;
  }

  return env;
}

function buildSetupCommands(input: ResolvedMediaServerSetupInput) {
  const commands: Array<{
    name: string;
    args: string[];
    timeoutMs: number;
    description: string;
    executable?: 'stackarr' | 'open';
  }> = [];
  if (input.startStack)
    commands.push({
      name: 'stackarr up',
      args: ['up'],
      timeoutMs: 30 * 60 * 1000,
      description: 'Download images if needed and start Docker-managed services.'
    });
  if (input.configureServices)
    commands.push({
      name: 'stackarr configure',
      args: ['configure'],
      timeoutMs: 30 * 60 * 1000,
      description: 'Wire Arr apps, download client, Prowlarr, request managers, and presets.'
    });
  if (input.applyPresets) {
    commands.push({
      name: 'stackarr naming apply',
      args: ['naming', 'apply', '--wait'],
      timeoutMs: 10 * 60 * 1000,
      description: 'Apply Plex-friendly naming scheme.'
    });
    commands.push({
      name: 'stackarr downloads apply',
      args: ['downloads', 'apply'],
      timeoutMs: 10 * 60 * 1000,
      description: 'Apply opinionated download categories/paths.'
    });
    if (input.enableSeerr && input.configureSeerr) {
      commands.push({
        name: 'stackarr requests apply',
        args: ['requests', 'apply'],
        timeoutMs: 10 * 60 * 1000,
        description: 'Apply request-manager defaults.'
      });
    }
  }
  if (input.installBackup)
    commands.push({
      name: 'stackarr backup install',
      args: ['backup', 'install'],
      timeoutMs: 5 * 60 * 1000,
      description: 'Enable scheduled backup automation.'
    });
  if (input.installUpdates)
    commands.push({
      name: 'stackarr update install',
      args: ['update', 'install'],
      timeoutMs: 5 * 60 * 1000,
      description: 'Enable scheduled update automation.'
    });
  if (input.openBrowser)
    commands.push({
      name: 'open browser',
      executable: 'open',
      args: [`http://127.0.0.1:${input.webPort}`],
      timeoutMs: 60 * 1000,
      description: 'Open Stackarr in the browser at the default port.'
    });
  return commands;
}
