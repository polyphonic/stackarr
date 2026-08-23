import { readEnv } from '../env';

const metadataProviderDocsUrl = 'https://docs.romm.app/latest/Getting-Started/Metadata-Providers/';

function configured(...values: Array<string | undefined>) {
  return values.every((value) => Boolean(value?.trim()));
}

function enabled(value: string | undefined, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function getRommMetadataProvidersAction() {
  const env = readEnv();

  return {
    service: 'romm',
    docsUrl: metadataProviderDocsUrl,
    credentialChanges: 'Save provider credentials through the authenticated Stackarr dashboard.',
    providers: [
      {
        id: 'igdb',
        name: 'IGDB',
        enabled: configured(env.ROMM_IGDB_CLIENT_ID, env.ROMM_IGDB_CLIENT_SECRET),
        settings: ['rommIgdbClientId', 'rommIgdbClientSecret']
      },
      {
        id: 'screenscraper',
        name: 'ScreenScraper.fr',
        enabled: configured(env.ROMM_SCREENSCRAPER_USER, env.ROMM_SCREENSCRAPER_PASSWORD),
        settings: ['rommScreenscraperUser', 'rommScreenscraperPassword'],
        note: 'Uses the account username and password; the official RomM image supplies its application credentials.'
      },
      {
        id: 'mobygames',
        name: 'MobyGames',
        enabled: configured(env.ROMM_MOBYGAMES_API_KEY),
        settings: ['rommMobyGamesApiKey']
      },
      {
        id: 'retroachievements',
        name: 'RetroAchievements',
        enabled: configured(env.ROMM_RETROACHIEVEMENTS_API_KEY),
        settings: ['rommRetroachievementsApiKey', 'rommRefreshRetroAchievementsCacheDays'],
        cacheDays: Number(env.ROMM_REFRESH_RETROACHIEVEMENTS_CACHE_DAYS || 30)
      },
      {
        id: 'steamgriddb',
        name: 'SteamGridDB',
        enabled: configured(env.ROMM_STEAMGRIDDB_API_KEY),
        settings: ['rommSteamGridDbApiKey'],
        note: 'Used by RomM cover search rather than the library scanner.'
      },
      {
        id: 'hasheous',
        name: 'Hasheous',
        enabled: enabled(env.ROMM_HASHEOUS_API_ENABLED, true),
        settings: ['rommHasheousApiEnabled']
      },
      {
        id: 'playmatch',
        name: 'Playmatch',
        enabled: enabled(env.ROMM_PLAYMATCH_API_ENABLED),
        settings: ['rommPlaymatchApiEnabled']
      },
      {
        id: 'launchbox',
        name: 'LaunchBox',
        enabled: enabled(env.ROMM_LAUNCHBOX_API_ENABLED),
        settings: [
          'rommLaunchboxApiEnabled',
          'rommScheduledLaunchboxUpdateEnabled',
          'rommScheduledLaunchboxUpdateCron'
        ],
        scheduledUpdate: enabled(env.ROMM_ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA),
        schedule: env.ROMM_SCHEDULED_UPDATE_LAUNCHBOX_METADATA_CRON || '0 4 * * *'
      },
      {
        id: 'flashpoint',
        name: 'Flashpoint',
        enabled: enabled(env.ROMM_FLASHPOINT_API_ENABLED),
        settings: ['rommFlashpointApiEnabled']
      },
      {
        id: 'howlongtobeat',
        name: 'HowLongToBeat',
        enabled: enabled(env.ROMM_HLTB_API_ENABLED),
        settings: ['rommHltbApiEnabled']
      },
      {
        id: 'thegamesdb',
        name: 'TheGamesDB',
        enabled: enabled(env.ROMM_TGDB_API_ENABLED),
        settings: ['rommTgdbApiEnabled']
      }
    ],
    filesystemProviders: [
      {
        id: 'es-de',
        name: 'ES-DE gamelist.xml',
        note: 'Discovered from files beside ROMs; it has no Stackarr credential or enable toggle.'
      }
    ]
  };
}
