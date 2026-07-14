import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requestJson, withQuery } from '../clients/http';
import { maybeServiceBaseUrl, serviceApiKey } from '../clients/serviceConfig';
import { readEnv } from '../env';
import { type DangerousConfirmation, requireDangerousConfirmation } from '../safety/dangerous';
import { redactSecrets } from '../safety/redaction';
import { getServices } from '../services';

export const nativeAppNames = [
  'jellyfin',
  'immich',
  'pulsarr',
  'maintainerr',
  'tracearr',
  'romm',
  'bookorbit',
  'bazarr',
  'lidarr',
  'tinymediamanager',
  'recyclarr',
  'flaresolverr',
  'tidarr'
] as const;

export type NativeAppName = (typeof nativeAppNames)[number];

type InputKey = 'libraryId' | 'itemId' | 'taskId' | 'sessionId' | 'limit' | 'days' | 'scope';
type Credential = 'none' | 'optional-bearer' | 'bearer' | 'api-key' | 'tmm-api-key' | 'jellyfin' | 'immich';
type Operation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string | ((input: NativeAppOperationInput) => string);
  description: string;
  credential: Credential;
  required?: InputKey[];
  query?: (input: NativeAppOperationInput) => Record<string, string | number | boolean | undefined>;
  body?: unknown | ((input: NativeAppOperationInput) => unknown);
  transport?: 'http' | 'recyclarr';
};

type NativeAppDefinition = {
  notice?: string;
  reads: Record<string, Operation>;
  manages: Record<string, Operation>;
  dangerous: Record<string, Operation>;
};

export type NativeAppOperationInput = {
  app: NativeAppName;
  operation: string;
  libraryId?: string;
  itemId?: string;
  taskId?: string;
  sessionId?: string;
  limit?: number;
  days?: number;
  scope?: 'all' | 'radarr' | 'sonarr';
};

const execFileAsync = promisify(execFile);

const definitions: Record<NativeAppName, NativeAppDefinition> = {
  jellyfin: {
    reads: {
      public_info: operation('GET', '/System/Info/Public', 'Read public server identity.', 'none'),
      system_info: operation('GET', '/System/Info', 'Read authenticated server information.', 'jellyfin'),
      libraries: operation('GET', '/Library/VirtualFolders', 'List configured media libraries.', 'jellyfin'),
      sessions: operation('GET', '/Sessions', 'List active Jellyfin sessions.', 'jellyfin'),
      scheduled_tasks: operation('GET', '/ScheduledTasks', 'List scheduled tasks and their status.', 'jellyfin')
    },
    manages: {
      refresh_library: operation('POST', '/Library/Refresh', 'Start a Jellyfin library scan.', 'jellyfin')
    },
    dangerous: {
      refresh_item_metadata: {
        ...operation(
          'POST',
          (input) => `/Items/${identifier(input.itemId, 'itemId')}/Refresh`,
          'Refresh metadata and images for one Jellyfin item.',
          'jellyfin'
        ),
        required: ['itemId'],
        query: () => ({ Recursive: true, MetadataRefreshMode: 'Default', ImageRefreshMode: 'Default' })
      }
    }
  },
  immich: {
    reads: {
      about: operation('GET', '/api/server/about', 'Read Immich server information.', 'immich'),
      statistics: operation('GET', '/api/server/statistics', 'Read library asset statistics.', 'immich'),
      storage: operation('GET', '/api/server/storage', 'Read Immich storage usage.', 'immich'),
      libraries: operation('GET', '/api/libraries', 'List external libraries.', 'immich'),
      jobs: operation('GET', '/api/jobs', 'Read background job status.', 'immich')
    },
    manages: {
      scan_library: {
        ...operation(
          'POST',
          (input) => `/api/libraries/${identifier(input.libraryId, 'libraryId')}/scan`,
          'Start an external-library scan.',
          'immich'
        ),
        required: ['libraryId']
      }
    },
    dangerous: {}
  },
  pulsarr: {
    reads: {
      health: operation('GET', '/health', 'Read Pulsarr process and database health.', 'none'),
      dashboard_stats: {
        ...operation('GET', '/v1/stats/all', 'Read bounded dashboard statistics.', 'api-key'),
        query: (input) => ({
          limit: boundedInteger(input.limit, 'limit', 1, 50, 10),
          days: boundedInteger(input.days, 'days', 1, 365, 30)
        })
      },
      recent_activity: {
        ...operation('GET', '/v1/stats/activity', 'Read recent watchlist activity totals.', 'api-key'),
        query: (input) => ({ days: boundedInteger(input.days, 'days', 1, 365, 30) })
      }
    },
    manages: {
      sync_all_instances: operation(
        'POST',
        '/v1/sync/all',
        'Synchronize watchlist items to configured Radarr and Sonarr instances.',
        'api-key'
      )
    },
    dangerous: {}
  },
  maintainerr: {
    notice:
      'Maintainerr actions are available only on your trusted private network because Maintainerr has no API authentication.',
    reads: {
      live: operation('GET', '/api/health/live', 'Read the process liveness result.', 'none'),
      ready: operation('GET', '/api/health/ready', 'Read dependency readiness.', 'none'),
      health: operation('GET', '/api/health', 'Read the combined health result.', 'none'),
      storage_metrics: operation('GET', '/api/storage-metrics', 'Read cached storage metrics.', 'none'),
      rules: operation('GET', '/api/rules', 'List cleanup rule groups without executing them.', 'none'),
      collections: operation('GET', '/api/collections', 'List managed collections.', 'none'),
      execution_status: operation('GET', '/api/rules/execute/status', 'Read rule execution status.', 'none')
    },
    manages: {},
    dangerous: {
      execute_rule: {
        ...operation(
          'POST',
          (input) => `/api/rules/${numericIdentifier(input.itemId, 'itemId')}/execute`,
          'Execute one cleanup rule. The rule may remove media through connected applications.',
          'none'
        ),
        required: ['itemId']
      },
      stop_rule: {
        ...operation(
          'POST',
          (input) => `/api/rules/${numericIdentifier(input.itemId, 'itemId')}/execute/stop`,
          'Stop one running cleanup rule.',
          'none'
        ),
        required: ['itemId']
      }
    }
  },
  tracearr: {
    notice:
      'Stackarr uses Tracearr’s read-only public API, so agent actions can inspect activity but cannot change Tracearr data.',
    reads: {
      health: operation('GET', '/api/v1/public/health', 'Read server connectivity health.', 'bearer'),
      statistics: operation('GET', '/api/v1/public/stats', 'Read dashboard overview statistics.', 'bearer'),
      active_streams: {
        ...operation('GET', '/api/v1/public/streams', 'Read active stream summary.', 'bearer'),
        query: () => ({ summary: true })
      },
      users: {
        ...operation('GET', '/api/v1/public/users', 'Read a bounded page of user activity.', 'bearer'),
        query: (input) => ({ page: 1, pageSize: boundedInteger(input.limit, 'limit', 1, 100, 25) })
      },
      violations: {
        ...operation('GET', '/api/v1/public/violations', 'Read a bounded page of recent violations.', 'bearer'),
        query: (input) => ({ page: 1, pageSize: boundedInteger(input.limit, 'limit', 1, 100, 25) })
      },
      history: {
        ...operation('GET', '/api/v1/public/history', 'Read a bounded page of playback history.', 'bearer'),
        query: (input) => ({ page: 1, pageSize: boundedInteger(input.limit, 'limit', 1, 100, 25), timezone: 'UTC' })
      }
    },
    manages: {},
    dangerous: {}
  },
  romm: {
    reads: {
      heartbeat: operation('GET', '/api/heartbeat', 'Read RomM availability and feature flags.', 'optional-bearer'),
      statistics: operation('GET', '/api/stats', 'Read RomM library statistics.', 'optional-bearer'),
      platforms: operation('GET', '/api/platforms', 'List scanned game platforms.', 'bearer'),
      tasks: operation('GET', '/api/tasks', 'List available library tasks.', 'bearer'),
      task_status: operation('GET', '/api/tasks/status', 'Read queued and recent task status.', 'bearer')
    },
    manages: {
      scan_library: operation('POST', '/api/tasks/run/scan_library', 'Queue a RomM library scan.', 'bearer')
    },
    dangerous: {
      cleanup_missing_roms: operation(
        'POST',
        '/api/tasks/run/cleanup_missing_roms',
        'Remove database entries and resources for ROM files that are no longer present.',
        'bearer'
      ),
      cleanup_orphaned_resources: operation(
        'POST',
        '/api/tasks/run/cleanup_orphaned_resources',
        'Delete resource files that are no longer associated with ROM records.',
        'bearer'
      )
    }
  },
  bookorbit: {
    reads: {
      health: operation('GET', '/api/v1/health', 'Read BookOrbit service health.', 'none'),
      library_overview: operation(
        'GET',
        '/api/v1/dashboard/widgets/library-overview',
        'Read the current user library overview.',
        'bearer'
      ),
      metadata_status: operation(
        'GET',
        '/api/v1/book-metadata-fetch/status',
        'Read metadata fetch queue status.',
        'bearer'
      ),
      failed_metadata: {
        ...operation('GET', '/api/v1/book-metadata-fetch/failed', 'Read failed metadata fetch items.', 'bearer'),
        query: (input) => ({ page: 1, limit: boundedInteger(input.limit, 'limit', 1, 100, 25) })
      }
    },
    manages: {
      pause_metadata: operation('POST', '/api/v1/book-metadata-fetch/pause', 'Pause metadata fetching.', 'bearer'),
      resume_metadata: operation('POST', '/api/v1/book-metadata-fetch/resume', 'Resume metadata fetching.', 'bearer'),
      retry_failed_metadata: operation(
        'POST',
        '/api/v1/book-metadata-fetch/retry-failed',
        'Retry failed metadata fetches.',
        'bearer'
      )
    },
    dangerous: {
      fetch_library_metadata: {
        ...operation(
          'POST',
          (input) => `/api/v1/book-metadata-fetch/run/${numericIdentifier(input.libraryId, 'libraryId')}`,
          'Fetch and apply metadata for all eligible books in one library.',
          'bearer'
        ),
        required: ['libraryId']
      }
    }
  },
  bazarr: {
    reads: {
      system_status: operation('GET', '/api/system/status', 'Read Bazarr and connected Arr versions.', 'api-key'),
      tasks: operation('GET', '/api/system/tasks', 'List scheduler tasks.', 'api-key'),
      wanted_movies: operation('GET', '/api/movies/wanted', 'List movies missing requested subtitles.', 'api-key'),
      wanted_episodes: operation('GET', '/api/episodes/wanted', 'List episodes missing requested subtitles.', 'api-key')
    },
    manages: {},
    dangerous: {
      run_task: {
        ...operation('POST', '/api/system/tasks', 'Run one configured Bazarr scheduler task.', 'api-key'),
        required: ['taskId'],
        query: (input) => ({ taskid: taskIdentifier(input.taskId, 'taskId') })
      }
    }
  },
  lidarr: {
    reads: {
      system_status: operation('GET', '/api/v1/system/status', 'Read Lidarr version and runtime status.', 'api-key'),
      artists: operation('GET', '/api/v1/artist', 'List monitored music artists.', 'api-key'),
      queue: {
        ...operation('GET', '/api/v1/queue', 'Read a bounded download queue page.', 'api-key'),
        query: (input) => ({ page: 1, pageSize: boundedInteger(input.limit, 'limit', 1, 100, 25) })
      },
      wanted_missing: {
        ...operation('GET', '/api/v1/wanted/missing', 'Read a bounded page of missing albums.', 'api-key'),
        query: (input) => ({ page: 1, pageSize: boundedInteger(input.limit, 'limit', 1, 100, 25) })
      }
    },
    manages: {
      refresh_artist: {
        ...operation('POST', '/api/v1/command', 'Refresh one artist from metadata sources.', 'api-key'),
        required: ['itemId'],
        body: (input: NativeAppOperationInput) => ({
          name: 'RefreshArtist',
          artistId: numericInput(input.itemId, 'itemId')
        })
      },
      search_missing_albums: operation(
        'POST',
        '/api/v1/command',
        'Search indexers for monitored missing albums.',
        'api-key',
        { name: 'MissingAlbumSearch' }
      )
    },
    dangerous: {
      rescan_folders: operation(
        'POST',
        '/api/v1/command',
        'Rescan music folders, which can import, move, or rename discovered files.',
        'api-key',
        { name: 'RescanFolders' }
      )
    }
  },
  tinymediamanager: {
    notice:
      'Radarr and Sonarr own media moves and naming. tinyMediaManager can scan their destinations and scrape metadata, NFO files, and artwork, but it is not allowed to rename media.',
    reads: {},
    manages: {
      scan_movies: operation('POST', '/api/movie', 'Scan configured movie data sources for changes.', 'tmm-api-key', [
        { action: 'update', scope: { name: 'all' } }
      ]),
      scan_tvshows: operation('POST', '/api/tvshow', 'Scan configured TV data sources for changes.', 'tmm-api-key', [
        { action: 'update', scope: { name: 'all' } }
      ])
    },
    dangerous: {
      scrape_new_movies: operation(
        'POST',
        '/api/movie',
        'Scan sources, then scrape metadata and artwork for new movies.',
        'tmm-api-key',
        [
          { action: 'update', scope: { name: 'all' } },
          { action: 'scrape', scope: { name: 'new' } }
        ]
      ),
      scrape_new_tvshows: operation(
        'POST',
        '/api/tvshow',
        'Scan sources, then scrape metadata and artwork for new TV shows.',
        'tmm-api-key',
        [
          { action: 'update', scope: { name: 'all' } },
          { action: 'scrape', scope: { name: 'new' } }
        ]
      )
    }
  },
  recyclarr: {
    notice:
      'Stackarr provides a safe Recyclarr preview and sync flow with fixed app choices; free-form command arguments are never accepted.',
    reads: {
      preview_sync: {
        ...operation('POST', '', 'Preview profile changes without writing them to Radarr or Sonarr.', 'none'),
        transport: 'recyclarr'
      }
    },
    manages: {},
    dangerous: {
      sync: {
        ...operation('POST', '', 'Apply configured Recyclarr profiles to Radarr, Sonarr, or both.', 'none'),
        transport: 'recyclarr'
      }
    }
  },
  flaresolverr: {
    notice:
      'Stackarr manages FlareSolverr browser sessions. Website requests stay private to the indexers you configured in Prowlarr.',
    reads: {
      sessions: operation('POST', '/v1', 'List active browser sessions.', 'none', { cmd: 'sessions.list' })
    },
    manages: {
      create_session: {
        ...operation('POST', '/v1', 'Create a named browser session.', 'none'),
        required: ['sessionId'],
        body: (input: NativeAppOperationInput) => ({
          cmd: 'sessions.create',
          session: sessionIdentifier(input.sessionId)
        })
      },
      destroy_session: {
        ...operation('POST', '/v1', 'Destroy a named browser session and release its resources.', 'none'),
        required: ['sessionId'],
        body: (input: NativeAppOperationInput) => ({
          cmd: 'sessions.destroy',
          session: sessionIdentifier(input.sessionId)
        })
      }
    },
    dangerous: {}
  },
  tidarr: {
    reads: {
      queue: {
        ...operation('GET', '/api/queue/list', 'Read a bounded page of queued downloads.', 'api-key'),
        query: (input) => ({ offset: 0, limit: boundedInteger(input.limit, 'limit', 1, 100, 25) })
      },
      queue_status: operation('GET', '/api/queue/status', 'Read queue pause status.', 'api-key'),
      history: operation('GET', '/api/history/list', 'Read download history.', 'api-key'),
      sync_list: operation('GET', '/api/sync/list', 'Read synchronized playlists and mixes.', 'api-key')
    },
    manages: {
      pause_queue: operation('POST', '/api/queue/pause', 'Pause the download queue.', 'api-key'),
      resume_queue: operation('POST', '/api/queue/resume', 'Resume the download queue.', 'api-key'),
      trigger_sync: operation('POST', '/api/sync/trigger', 'Synchronize configured playlists and mixes.', 'api-key')
    },
    dangerous: {
      download_queue_item: {
        ...operation(
          'POST',
          '/api/single-download',
          'Download one queued item even when no-download mode is enabled.',
          'api-key'
        ),
        required: ['itemId'],
        body: (input: NativeAppOperationInput) => ({ id: identifier(input.itemId, 'itemId') })
      },
      remove_queue_item: {
        ...operation('DELETE', '/api/remove', 'Remove one item from the download queue.', 'api-key'),
        required: ['itemId'],
        body: (input: NativeAppOperationInput) => ({ id: identifier(input.itemId, 'itemId') })
      },
      clear_history: operation('DELETE', '/api/history/list', 'Clear the Tidarr download history.', 'api-key')
    }
  }
};

export function getNativeAppCapabilitiesAction() {
  const enabledServices = new Set(
    getServices()
      .filter((service) => service.mode !== 'disabled')
      .map((service) => service.name)
  );

  return {
    apps: nativeAppNames.map((app) => {
      const definition = definitions[app];
      return {
        app,
        enabled: enabledServices.has(app),
        configured: app === 'recyclarr' ? enabledServices.has(app) : Boolean(maybeServiceBaseUrl(app)),
        credentialConfigured: Boolean(serviceApiKey(app)),
        readOperations: summarizeOperations(definition.reads),
        manageOperations: summarizeOperations(definition.manages),
        dangerousOperations: summarizeOperations(definition.dangerous),
        ...(definition.notice ? { notice: definition.notice } : {})
      };
    }),
    design: {
      routing: 'allowlisted-native-api',
      arbitraryRequestsAllowed: false,
      note: 'Only listed operations for enabled apps can be called. Credentials are never returned; dangerous operations require control-plane approval.'
    }
  };
}

export async function readNativeAppAction(input: NativeAppOperationInput) {
  return runOperation('read', input);
}

export async function manageNativeAppAction(input: NativeAppOperationInput) {
  return runOperation('manage', input);
}

export async function administerNativeAppAction(input: NativeAppOperationInput & DangerousConfirmation) {
  requireDangerousConfirmation(input);
  return runOperation('dangerous', input);
}

export function assertNativeAppOperationSupported(
  kind: 'read' | 'manage' | 'dangerous',
  input: NativeAppOperationInput
) {
  const operations = operationSet(definitions[input.app], kind);
  const selected = operations[input.operation];
  if (!selected) {
    throw new Error(
      `Unsupported ${kind} operation "${input.operation}" for ${input.app}. Available: ${Object.keys(operations).join(', ') || 'none'}.`
    );
  }
  validateRequiredInputs(selected, input);
}

async function runOperation(kind: 'read' | 'manage' | 'dangerous', input: NativeAppOperationInput) {
  assertEnabled(input.app);
  const definition = definitions[input.app];
  const operations = operationSet(definition, kind);
  assertNativeAppOperationSupported(kind, input);
  const selected = operations[input.operation];
  if (selected.transport === 'recyclarr') return runRecyclarr(input, kind === 'read');
  const key = serviceApiKey(input.app);
  const headers = authHeaders(selected.credential, key, input.app);
  const rawPath = typeof selected.path === 'function' ? selected.path(input) : selected.path;
  const rawUrl = `${requiredBaseUrl(input.app)}${rawPath}`;
  const url = selected.query ? withQuery(rawUrl, selected.query(input)) : rawUrl;
  const body = typeof selected.body === 'function' ? selected.body(input) : selected.body;
  const result = await requestJson<unknown>(url, {
    method: selected.method,
    headers,
    body,
    timeoutMs: kind === 'read' ? 10_000 : 30_000
  });

  return { app: input.app, operation: input.operation, kind, result: boundedResult(redactSecrets(result)) };
}

function operation(
  method: Operation['method'],
  path: Operation['path'],
  description: string,
  credential: Credential,
  body?: unknown
): Operation {
  return { method, path, description, credential, ...(body === undefined ? {} : { body }) };
}

function operationSet(definition: NativeAppDefinition, kind: 'read' | 'manage' | 'dangerous') {
  if (kind === 'read') return definition.reads;
  if (kind === 'manage') return definition.manages;
  return definition.dangerous;
}

function summarizeOperations(operations: Record<string, Operation>) {
  return Object.entries(operations).map(([name, value]) => ({
    name,
    description: value.description,
    requiresCredential: value.credential !== 'none' && value.credential !== 'optional-bearer',
    ...(value.required?.length ? { requiredInput: value.required } : {})
  }));
}

function validateRequiredInputs(operation: Operation, input: NativeAppOperationInput) {
  for (const field of operation.required ?? []) {
    if (field === 'limit') boundedInteger(input.limit, field, 1, 100);
    else if (field === 'days') boundedInteger(input.days, field, 1, 365);
    else if (field === 'taskId') taskIdentifier(input.taskId, field);
    else if (field === 'sessionId') sessionIdentifier(input.sessionId);
    else if (field === 'scope') recyclarrScope(input.scope);
    else identifier(input[field], field);
  }
}

async function runRecyclarr(input: NativeAppOperationInput, preview: boolean) {
  const scope = recyclarrScope(input.scope);
  const args = ['exec', 'recyclarr', 'recyclarr', 'sync'];
  if (scope !== 'all') args.push(scope);
  if (preview) args.push('--preview');
  const { stdout, stderr } = await execFileAsync('docker', args, {
    timeout: 5 * 60 * 1000,
    maxBuffer: 250_000,
    encoding: 'utf8'
  });
  return {
    app: 'recyclarr' as const,
    operation: input.operation,
    kind: preview ? ('read' as const) : ('dangerous' as const),
    scope,
    preview,
    result: boundedResult(redactSecrets({ stdout, stderr }))
  };
}

function assertEnabled(app: NativeAppName) {
  const service = getServices().find((item) => item.name === app);
  if (!service || service.mode === 'disabled') throw new Error(`${app} is not enabled in this Stackarr installation.`);
}

function requiredBaseUrl(app: NativeAppName) {
  const baseUrl = maybeServiceBaseUrl(app);
  if (!baseUrl) throw new Error(`${app} does not have a configured HTTP endpoint.`);
  if (app === 'maintainerr') {
    const basePath = readEnv().MAINTAINERR_BASE_PATH?.trim() ?? '';
    if (basePath && !/^\/[a-zA-Z0-9/_-]*$/.test(basePath)) throw new Error('Maintainerr base path is invalid.');
    return `${baseUrl}${basePath.replace(/\/$/, '')}`;
  }
  return baseUrl;
}

function authHeaders(
  credential: Credential,
  key: string | undefined,
  app: NativeAppName
): Record<string, string> | undefined {
  if (credential === 'none') return undefined;
  if (!key && credential !== 'optional-bearer')
    throw new Error(`${app} requires an API key or token for this operation.`);
  if (!key) return undefined;
  if (credential === 'jellyfin') return { 'X-Emby-Token': key };
  if (credential === 'immich') return { 'x-api-key': key };
  if (credential === 'api-key') return { 'X-Api-Key': key };
  if (credential === 'tmm-api-key') return { 'api-key': key };
  return { authorization: `Bearer ${key}` };
}

function identifier(value: string | undefined, name: string) {
  if (!value || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) {
    throw new Error(`${name} must contain only letters, numbers, dots, colons, underscores, or hyphens.`);
  }
  return encodeURIComponent(value);
}

function numericIdentifier(value: string | undefined, name: string) {
  if (!value || !/^\d{1,12}$/.test(value)) throw new Error(`${name} must be a positive numeric identifier.`);
  return value;
}

function numericInput(value: string | undefined, name: string) {
  return Number(numericIdentifier(value, name));
}

function taskIdentifier(value: string | undefined, name: string) {
  if (!value || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function sessionIdentifier(value: string | undefined) {
  if (!value || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error('sessionId is invalid.');
  return value;
}

function recyclarrScope(value: NativeAppOperationInput['scope']) {
  if (value === undefined || value === 'all') return 'all' as const;
  if (value === 'radarr' || value === 'sonarr') return value;
  throw new Error('scope must be all, radarr, or sonarr.');
}

function boundedInteger(value: number | undefined, name: string, min: number, max: number, fallback?: number) {
  const resolved = value ?? fallback;
  if (resolved === undefined || !Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return resolved;
}

function boundedResult(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized.length > 250_000) {
    throw new Error('The native app response exceeded the 250 KB safety limit. Narrow the operation in the app first.');
  }
  return value;
}
