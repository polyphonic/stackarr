import { requestJson } from '../clients/http';
import { serviceApiKey, serviceBaseUrl } from '../clients/serviceConfig';
import { redactSecrets } from '../safety/redaction';

export const agregarrJobNames = {
  'quick-sync': 'plex-collections-quick-sync',
  'full-sync': 'plex-collections-sync',
  'randomize-home-order': 'plex-randomize-home-order'
} as const;

export type AgregarrJob = keyof typeof agregarrJobNames;

type JsonRecord = Record<string, unknown>;
type AgregarrRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  timeoutMs?: number;
};

export const agregarrPresetNames = ['coming-soon', 'tmdb-trending', 'imdb-popular'] as const;
export type AgregarrPreset = (typeof agregarrPresetNames)[number];
export type AgregarrMediaScope = 'movie' | 'tv' | 'both';

export type AgregarrCollectionGroup = {
  key: string;
  ids: string[];
  name?: string;
  type?: string;
  subtype?: string;
  libraries: Array<{ id?: string; name?: string; mediaType?: string }>;
  active: boolean;
  needsSync: boolean;
  lastSyncedAt?: string;
  lastSyncError?: string;
  sortOrder?: string;
  randomizeHomeOrder: boolean;
  visibility: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
};

export type AgregarrManager = {
  ready: boolean;
  initialized: boolean;
  plexConnected: boolean;
  plexServerName?: string;
  version?: string;
  libraries: Array<{ id?: string; name?: string; mediaType?: string }>;
  groups: AgregarrCollectionGroup[];
  syncStatus: ReturnType<typeof summarizeSyncStatus>;
};

const presetDefinitions: Record<
  AgregarrPreset,
  { name: string; type: string; subtype: string; sortOrder: string; randomizeHomeOrder: boolean }
> = {
  'coming-soon': {
    name: 'Coming Soon',
    type: 'comingsoon',
    subtype: 'monitored',
    sortOrder: 'release_date_asc',
    randomizeHomeOrder: false
  },
  'tmdb-trending': {
    name: 'Trending This Week',
    type: 'tmdb',
    subtype: 'trending_week',
    sortOrder: 'default',
    randomizeHomeOrder: true
  },
  'imdb-popular': {
    name: 'IMDb Popular',
    type: 'imdb',
    subtype: 'popular',
    sortOrder: 'default',
    randomizeHomeOrder: true
  }
};

/** Return the bounded state used by Stackarr's focused Agregarr collection controls. */
export async function getAgregarrManagerAction(): Promise<AgregarrManager> {
  const [statusValue, publicValue, plexValue, librariesValue, collectionsValue, syncValue] = await Promise.all([
    agregarrRequest('/status', { authenticated: false }),
    agregarrRequest('/settings/public', { authenticated: false }),
    agregarrRequest('/settings/plex'),
    agregarrRequest('/settings/plex/libraries'),
    agregarrRequest('/collections'),
    agregarrRequest('/collections/sync/status')
  ]);
  const status = jsonRecord(statusValue);
  const publicSettings = jsonRecord(publicValue);
  const plex = jsonRecord(plexValue);
  const libraries = recordArray(librariesValue).map(summarizeLibrary);
  const groups = groupCollections(collectionConfigs(collectionsValue));
  const plexServerName = stringValue(plex.name) ?? stringValue(plex.serverName);
  const initialized = publicSettings.initialized === true;

  return redactSecrets({
    ready: initialized && Boolean(plexServerName) && libraries.length > 0,
    initialized,
    plexConnected: Boolean(plexServerName) && libraries.length > 0,
    plexServerName,
    version: stringValue(status.version),
    libraries,
    groups,
    syncStatus: summarizeSyncStatus(syncValue)
  });
}

/** Create or normalize one common Agregarr source across the selected Plex libraries. */
export async function ensureAgregarrCollectionPresetAction(input: {
  preset: AgregarrPreset;
  mediaScope?: AgregarrMediaScope;
  maxItems?: number;
  daysAhead?: number;
}) {
  if (!agregarrPresetNames.includes(input.preset)) throw new Error('Choose a supported Agregarr preset.');
  const mediaScope = validMediaScope(input.mediaScope ?? 'both');
  const maxItems = boundedInteger(input.maxItems ?? 100, 10, 200, 'maxItems');
  const daysAhead = boundedInteger(input.daysAhead ?? 730, 30, 1_825, 'daysAhead');
  const definition = presetDefinitions[input.preset];
  const [librariesValue, collectionsValue] = await Promise.all([
    agregarrRequest('/settings/plex/libraries'),
    agregarrRequest('/collections')
  ]);
  const libraries = recordArray(librariesValue).filter((library) => libraryMatchesScope(library, mediaScope));
  if (!libraries.length) throw new Error(`Agregarr has no Plex libraries matching ${mediaScope}.`);

  const desiredLibraryIds = new Set(libraries.map(libraryId).filter(Boolean));
  const matching = collectionConfigs(collectionsValue).filter(
    (item) =>
      stringValue(item.type) === definition.type &&
      stringValue(item.subtype) === definition.subtype &&
      desiredLibraryIds.has(stringValue(item.libraryId) ?? '')
  );
  const existingLibraryIds = new Set(matching.map((item) => stringValue(item.libraryId)).filter(Boolean));
  const missingLibraries = libraries.filter((library) => !existingLibraryIds.has(libraryId(library)));

  if (missingLibraries.length) {
    await agregarrRequest('/collections/create', {
      method: 'POST',
      body: presetPayload(definition, missingLibraries, maxItems, daysAhead)
    });
  }

  const refreshed = collectionConfigs(await agregarrRequest('/collections')).filter(
    (item) =>
      stringValue(item.type) === definition.type &&
      stringValue(item.subtype) === definition.subtype &&
      desiredLibraryIds.has(stringValue(item.libraryId) ?? '')
  );
  for (const item of refreshed) {
    await agregarrRequest(`/collections/${validCollectionId(String(item.id))}/settings`, {
      method: 'PUT',
      body: normalizedPresetSettings(item, definition, maxItems, daysAhead)
    });
  }

  return getAgregarrManagerAction();
}

/** Update the everyday visibility and ordering controls for one Stackarr collection group. */
export async function updateAgregarrCollectionGroupAction(input: {
  collectionIds: string[];
  active?: boolean;
  showOnHome?: boolean;
  recommended?: boolean;
  randomizeHomeOrder?: boolean;
}) {
  const ids = validCollectionIds(input.collectionIds);
  const collections = collectionConfigs(await agregarrRequest('/collections'));

  for (const id of ids) {
    const item = collections.find((candidate) => stringValue(candidate.id) === id);
    if (!item) throw new Error(`Agregarr collection ${id} was not found.`);
    const visibility = jsonRecord(item.visibilityConfig);
    await agregarrRequest(`/collections/${id}/settings`, {
      method: 'PUT',
      body: {
        ...item,
        ...(typeof input.active === 'boolean' ? { isActive: input.active } : {}),
        ...(typeof input.randomizeHomeOrder === 'boolean' ? { randomizeHomeOrder: input.randomizeHomeOrder } : {}),
        visibilityConfig: {
          ...visibility,
          ...(typeof input.showOnHome === 'boolean'
            ? { usersHome: input.showOnHome, serverOwnerHome: input.showOnHome }
            : {}),
          ...(typeof input.recommended === 'boolean' ? { libraryRecommended: input.recommended } : {})
        }
      }
    });
  }

  return getAgregarrManagerAction();
}

/** Start targeted syncs for all movie/TV rows represented by one collection group. */
export async function syncAgregarrCollectionGroupAction(input: { collectionIds: string[] }) {
  const ids = validCollectionIds(input.collectionIds);
  for (const collectionId of ids) {
    await agregarrRequest(`/collections/${collectionId}/sync`, { method: 'POST', timeoutMs: 30_000 });
  }
  return getAgregarrManagerAction();
}

/** Return bounded collection, pre-existing collection, hub, job, and sync summaries. */
export async function getAgregarrOverviewAction() {
  const [status, collectionsResponse, preExistingResponse, hubResponse, syncStatus, jobsResponse] = await Promise.all([
    agregarrRequest('/status', { authenticated: false }),
    agregarrRequest('/collections'),
    agregarrRequest('/preexisting'),
    agregarrRequest('/defaulthubs'),
    agregarrRequest('/collections/sync/status'),
    agregarrRequest('/settings/jobs')
  ]);

  const collections = collectionConfigs(collectionsResponse);
  const preExisting = recordArray(preExistingResponse);
  const hubs = recordArray(hubResponse);

  return redactSecrets({
    status,
    counts: {
      managedCollections: collections.length,
      preExistingCollections: preExisting.length,
      defaultHubs: hubs.length
    },
    collections: collections.map((item) => summarizeCollection(item, 'collection')),
    preExistingCollections: preExisting.map((item) => summarizeCollection(item, 'preExisting')),
    defaultHubs: hubs.map((item) => summarizeCollection(item, 'hub')),
    syncStatus: summarizeSyncStatus(syncStatus),
    jobs: jobRecords(jobsResponse).map(summarizeJob)
  });
}

/** Read one managed collection and its targeted sync state without returning source credentials. */
export async function getAgregarrCollectionAction(input: { collectionId: string }) {
  const collectionId = validCollectionId(input.collectionId);
  const [collectionsResponse, globalSyncStatus] = await Promise.all([
    agregarrRequest('/collections'),
    agregarrRequest('/collections/sync/status')
  ]);
  const collection = collectionConfigs(collectionsResponse).find((item) => stringValue(item.id) === collectionId);
  if (!collection) throw new Error(`Agregarr collection ${collectionId} was not found.`);

  return redactSecrets({
    collection: summarizeCollection(collection, 'collection'),
    syncStatus: {
      ...summarizeSyncStatus(globalSyncStatus),
      collectionNeedsSync: collection.needsSync === true,
      collectionLastSyncedAt: stringValue(collection.lastSyncedAt),
      collectionLastSyncError: stringValue(collection.lastSyncError)
    }
  });
}

/** Return the configured Plex home order, including fixed versus randomized rows. */
export async function getAgregarrHomeOrderAction() {
  const [collectionsResponse, preExistingResponse, hubResponse] = await Promise.all([
    agregarrRequest('/collections'),
    agregarrRequest('/preexisting'),
    agregarrRequest('/defaulthubs')
  ]);

  const allMixed: JsonRecord[] = [
    ...collectionConfigs(collectionsResponse).map((item): JsonRecord => ({ ...item, configType: 'collection' })),
    ...recordArray(preExistingResponse).map((item): JsonRecord => ({ ...item, configType: 'preExisting' })),
    ...recordArray(hubResponse).map((item): JsonRecord => ({ ...item, configType: 'hub' }))
  ];
  const mixed = allMixed.filter(isVisibleOnHome);

  const libraries = new Map<string, JsonRecord[]>();
  for (const item of mixed) {
    const libraryId = stringValue(item.libraryId) ?? 'unknown';
    const current = libraries.get(libraryId) ?? [];
    current.push(item);
    libraries.set(libraryId, current);
  }

  return redactSecrets({
    libraries: [...libraries.entries()].map(([libraryId, items]) => ({
      libraryId,
      rows: items
        .sort((left, right) => numberValue(left.sortOrderHome) - numberValue(right.sortOrderHome))
        .map((item) => ({
          id: stringValue(item.id),
          name: stringValue(item.name),
          configType: stringValue(item.configType),
          sortOrderHome: numberValue(item.sortOrderHome),
          randomizeHomeOrder: item.randomizeHomeOrder === true,
          fixed: item.randomizeHomeOrder !== true
        }))
    }))
  });
}

/** Start one targeted Agregarr collection sync. */
export async function syncAgregarrCollectionAction(input: { collectionId: string }) {
  const collectionId = validCollectionId(input.collectionId);
  const result = await agregarrRequest(`/collections/${collectionId}/sync`, {
    method: 'POST',
    timeoutMs: 30_000
  });
  return redactSecrets({ collectionId, result });
}

/** Run an allowlisted Agregarr maintenance job. */
export async function runAgregarrJobAction(input: { job: AgregarrJob }) {
  const jobId = agregarrJobNames[input.job];
  if (!jobId) throw new Error('job must be full-sync, quick-sync, or randomize-home-order.');
  const result = await agregarrRequest(`/settings/jobs/${jobId}/run`, { method: 'POST' });
  return redactSecrets({ job: input.job, jobId, result });
}

async function agregarrRequest<T = unknown>(
  path: string,
  options: AgregarrRequestOptions & { authenticated?: boolean } = {}
) {
  const headers: Record<string, string> = {};
  if (options.authenticated !== false) {
    const key = serviceApiKey('agregarr');
    if (!key) {
      throw new Error(
        'Agregarr requires its generated API key. Save it as AGREGARR_API_KEY in Stackarr before using collection tools.'
      );
    }
    headers['X-API-Key'] = key;
  }

  return requestJson<T>(`${serviceBaseUrl('agregarr')}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: Object.keys(headers).length ? headers : undefined,
    body: options.body,
    timeoutMs: options.timeoutMs ?? 10_000
  });
}

function collectionConfigs(value: unknown) {
  const record = jsonRecord(value);
  return recordArray(record.collectionConfigs);
}

function jobRecords(value: unknown) {
  const direct = recordArray(value);
  if (direct.length) return direct;
  const record = jsonRecord(value);
  return recordArray(record.jobs);
}

function summarizeCollection(item: JsonRecord, configType: 'collection' | 'preExisting' | 'hub') {
  return {
    id: stringValue(item.id),
    name: stringValue(item.name),
    configType,
    type: stringValue(item.type),
    subtype: stringValue(item.subtype),
    libraryId: stringValue(item.libraryId),
    libraryName: stringValue(item.libraryName),
    collectionRatingKey: stringValue(item.collectionRatingKey),
    isActive: item.isActive !== false,
    needsSync: item.needsSync === true,
    lastSyncedAt: stringValue(item.lastSyncedAt),
    lastSyncError: stringValue(item.lastSyncError),
    sortOrderHome: numberValue(item.sortOrderHome),
    randomizeHomeOrder: item.randomizeHomeOrder === true,
    visibilityConfig: jsonRecord(item.visibilityConfig)
  };
}

function summarizeLibrary(item: JsonRecord) {
  return {
    id: libraryId(item) || undefined,
    name: stringValue(item.name),
    mediaType: stringValue(item.type) === 'show' ? 'tv' : stringValue(item.type)
  };
}

function groupCollections(collections: JsonRecord[]): AgregarrCollectionGroup[] {
  const grouped = new Map<string, JsonRecord[]>();
  for (const item of collections) {
    const key = `${stringValue(item.type) ?? 'unknown'}:${stringValue(item.subtype) ?? 'unknown'}:${(
      stringValue(item.name) ?? 'Untitled'
    ).toLowerCase()}`;
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, items]): AgregarrCollectionGroup => {
      const first = items[0] ?? {};
      const visibility = jsonRecord(first.visibilityConfig);
      return {
        key,
        ids: items.map((item) => stringValue(item.id)).filter((value): value is string => Boolean(value)),
        name: stringValue(first.name),
        type: stringValue(first.type),
        subtype: stringValue(first.subtype),
        libraries: items.map((item) => ({
          id: stringValue(item.libraryId),
          name: stringValue(item.libraryName),
          mediaType: stringValue(item.mediaType)
        })),
        active: items.every((item) => item.isActive !== false),
        needsSync: items.some((item) => item.needsSync === true),
        lastSyncedAt: items
          .map((item) => stringValue(item.lastSyncedAt))
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1),
        lastSyncError: items.map((item) => stringValue(item.lastSyncError)).find(Boolean),
        sortOrder: stringValue(first.sortOrder),
        randomizeHomeOrder: first.randomizeHomeOrder === true,
        visibility: {
          usersHome: visibility.usersHome === true,
          serverOwnerHome: visibility.serverOwnerHome === true,
          libraryRecommended: visibility.libraryRecommended === true
        }
      };
    })
    .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));
}

function presetPayload(
  definition: (typeof presetDefinitions)[AgregarrPreset],
  libraries: JsonRecord[],
  maxItems: number,
  daysAhead: number
) {
  const libraryIds = libraries.map(libraryId).filter(Boolean);
  const libraryNames = libraries.map((library) => stringValue(library.name) ?? 'Plex Library');
  const shared = {
    name: definition.name,
    template: definition.name,
    type: definition.type,
    subtype: definition.subtype,
    mediaType: libraries.length > 1 ? 'both' : stringValue(libraries[0]?.type) === 'show' ? 'tv' : 'movie',
    maxItems,
    sortOrder: definition.sortOrder,
    sortOrderHome: 2,
    sortOrderLibrary: 1,
    isLibraryPromoted: true,
    randomizeHomeOrder: definition.randomizeHomeOrder,
    visibilityConfig: { usersHome: true, serverOwnerHome: true, libraryRecommended: true },
    ...(definition.type === 'comingsoon'
      ? {
          createPlaceholdersForMissing: true,
          placeholderDaysAhead: daysAhead,
          placeholderReleasedDays: 14,
          applyOverlaysDuringSync: true
        }
      : {})
  };

  return libraries.length > 1
    ? {
        ...shared,
        libraryIds,
        libraryNames,
        customMovieTemplate: definition.name,
        customTVTemplate: definition.name
      }
    : { ...shared, libraryId: libraryIds[0], libraryName: libraryNames[0] };
}

function normalizedPresetSettings(
  item: JsonRecord,
  definition: (typeof presetDefinitions)[AgregarrPreset],
  maxItems: number,
  daysAhead: number
) {
  const visibility = jsonRecord(item.visibilityConfig);
  return {
    ...item,
    maxItems,
    sortOrder: definition.sortOrder,
    randomizeHomeOrder: definition.randomizeHomeOrder,
    visibilityConfig: {
      ...visibility,
      usersHome: true,
      serverOwnerHome: true,
      libraryRecommended: true
    },
    ...(definition.type === 'comingsoon'
      ? {
          createPlaceholdersForMissing: true,
          placeholderDaysAhead: daysAhead,
          placeholderReleasedDays: numberValue(item.placeholderReleasedDays) || 14,
          applyOverlaysDuringSync: true
        }
      : {})
  };
}

function libraryId(item: JsonRecord) {
  return stringValue(item.key) ?? stringValue(item.id) ?? '';
}

function libraryMatchesScope(item: JsonRecord, scope: AgregarrMediaScope) {
  if (scope === 'both') return stringValue(item.type) === 'movie' || stringValue(item.type) === 'show';
  return scope === 'movie' ? stringValue(item.type) === 'movie' : stringValue(item.type) === 'show';
}

function validMediaScope(value: string): AgregarrMediaScope {
  if (value === 'movie' || value === 'tv' || value === 'both') return value;
  throw new Error('mediaScope must be movie, tv, or both.');
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validCollectionIds(values: string[]) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 16) {
    throw new Error('Choose between 1 and 16 Agregarr collection rows.');
  }
  return [...new Set(values.map(validCollectionId))];
}

function summarizeSyncStatus(value: unknown) {
  const item = jsonRecord(value);
  return {
    running: item.running === true,
    completed: item.completed === true,
    currentStage: stringValue(item.currentStage),
    progress: numberValue(item.progress),
    totalCollections: numberValue(item.totalCollections),
    processedCollections: numberValue(item.processedCollections),
    collectionsNeedingSync: numberValue(item.collectionsNeedingSync),
    lastSyncAt: stringValue(item.lastGlobalSyncAt) ?? stringValue(item.lastSyncAt),
    nextSyncAt: stringValue(item.nextSyncAt),
    error: stringValue(item.globalSyncError) ?? stringValue(item.error) ?? stringValue(item.lastSyncError),
    message: stringValue(item.message)
  };
}

function summarizeJob(item: JsonRecord) {
  return {
    id: stringValue(item.id),
    name: stringValue(item.name),
    type: stringValue(item.type),
    interval: stringValue(item.interval),
    cronSchedule: stringValue(item.cronSchedule),
    running: item.running === true,
    nextExecutionTime: stringValue(item.nextExecutionTime),
    lastExecutionTime: stringValue(item.lastExecutionTime)
  };
}

function isVisibleOnHome(item: JsonRecord) {
  const visibility = jsonRecord(item.visibilityConfig);
  return numberValue(item.sortOrderHome) > 0 && (visibility.serverOwnerHome === true || visibility.usersHome === true);
}

function validCollectionId(value: string) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{1,10}$/.test(normalized)) throw new Error('collectionId must be a numeric Agregarr collection id.');
  return normalized;
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
