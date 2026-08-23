import { servarrGet, servarrPost } from '../clients/servarr';
import type { ArrInstance } from '../clients/serviceConfig';
import { readJsonSetting, writeJsonSetting } from '../database';
import { readEnv } from '../env';
import { redactSecrets } from '../safety/redaction';

const stateKey = 'stackarr.mediaSearchReconciliation';
const retryDelaysMs = [
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  3 * 24 * 60 * 60_000,
  7 * 24 * 60 * 60_000
];
const candidateMaxAgeMs = 14 * 24 * 60 * 60_000;
const stateRetentionMs = 30 * 24 * 60 * 60_000;
const maxQueuedPerRun = 5;
const maxQueuedPerInstance = 2;
const maxTrackedEntries = 500;

type RetryEntry = {
  firstSeenAt: string;
  lastSeenAt: string;
  attempts: number;
  lastAttemptAt?: string;
  active?: boolean;
};

type ReconciliationState = {
  lastRunAt?: string;
  entries: Record<string, RetryEntry>;
};

type WantedPage<T> = { records?: T[] };
type QueuePage = {
  totalRecords?: number;
  records?: Array<{ movieId?: number; seriesId?: number; episodeId?: number }>;
};

type WantedMovie = {
  id?: number;
  monitored?: boolean;
  hasFile?: boolean;
  isAvailable?: boolean;
  added?: string;
};

type WantedEpisode = {
  id?: number;
  seriesId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  airDateUtc?: string;
  series?: { id?: number; added?: string; monitored?: boolean };
};

type SeriesSummary = { id?: number; added?: string; monitored?: boolean };

type Candidate = {
  key: string;
  instance: ArrInstance;
  mediaType: 'movie' | 'episode';
  id: number;
  firstSeenAt: string;
  entry: RetryEntry;
};

export type MediaSearchReconciliationResult = {
  checkedAt: string;
  candidates: number;
  queued: number;
  deferred: number;
  exhausted: number;
  errors: Array<{ instance: ArrInstance; message: string }>;
};

export async function reconcileMediaSearchesAction(
  input: { now?: string } = {}
): Promise<MediaSearchReconciliationResult> {
  const now = parseNow(input.now);
  const env = readEnv();
  const state = readState();
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const errors: MediaSearchReconciliationResult['errors'] = [];

  if (!enabled(env.ENABLE_PULSARR, false)) {
    return {
      checkedAt: now.toISOString(),
      candidates: 0,
      queued: 0,
      deferred: 0,
      exhausted: 0,
      errors
    };
  }

  if (enabled(env.ENABLE_MOVIES, true)) {
    await collectCandidates(candidates, errors, 'radarr', () => movieCandidates('radarr', now, state, seen));
    if (enabled(env.ENABLE_4K_SERVARR, false))
      await collectCandidates(candidates, errors, 'radarr4k', () => movieCandidates('radarr4k', now, state, seen));
  }
  if (enabled(env.ENABLE_TV_SHOWS, true)) {
    await collectCandidates(candidates, errors, 'sonarr', () => seriesCandidates('sonarr', now, state, seen));
    if (enabled(env.ENABLE_4K_SERVARR, false))
      await collectCandidates(candidates, errors, 'sonarr4k', () => seriesCandidates('sonarr4k', now, state, seen));
  }

  pruneState(state, seen, now);
  const due = candidates
    .filter((candidate) => isDue(candidate.entry, now))
    .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt));
  const selected = selectBoundedCandidates(due);
  let queued = 0;

  for (const group of groupCandidates(selected)) {
    try {
      await servarrPost(group.instance, 'command', {
        name: group.mediaType === 'movie' ? 'MoviesSearch' : 'EpisodeSearch',
        ...(group.mediaType === 'movie' ? { movieIds: group.ids } : { episodeIds: group.ids })
      });
      for (const candidate of group.candidates) {
        candidate.entry.attempts += 1;
        candidate.entry.lastAttemptAt = now.toISOString();
        queued += 1;
      }
    } catch (error) {
      for (const candidate of group.candidates) {
        candidate.entry.attempts += 1;
        candidate.entry.lastAttemptAt = now.toISOString();
      }
      errors.push({
        instance: group.instance,
        message: redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 240)
      });
    }
  }

  state.lastRunAt = now.toISOString();
  writeJsonSetting(stateKey, state);
  return {
    checkedAt: now.toISOString(),
    candidates: candidates.length,
    queued,
    deferred: Math.max(0, candidates.length - due.length) + Math.max(0, due.length - selected.length),
    exhausted: candidates.filter((candidate) => candidate.entry.attempts >= retryDelaysMs.length).length,
    errors
  };
}

export function getMediaSearchReconciliationStatusAction() {
  const state = readState();
  const entries = Object.entries(state.entries);
  const exhaustedEntries = entries.filter(
    ([, entry]) =>
      entry.attempts >= retryDelaysMs.length && entry.active !== true && entry.lastSeenAt === state.lastRunAt
  );
  const exhaustedByInstance = exhaustedEntries.reduce<Record<string, number>>((counts, [key]) => {
    const instance = key.split(':', 1)[0];
    counts[instance] = (counts[instance] ?? 0) + 1;
    return counts;
  }, {});
  return {
    lastRunAt: state.lastRunAt,
    tracked: entries.length,
    exhausted: exhaustedEntries.length,
    exhaustedByInstance,
    retryScheduleMinutes: retryDelaysMs.map((delay) => Math.round(delay / 60_000)),
    maxQueuedPerRun,
    maxQueuedPerInstance
  };
}

async function movieCandidates(
  instance: ArrInstance,
  now: Date,
  state: ReconciliationState,
  seen: Set<string>
): Promise<Candidate[]> {
  const [wanted, queueRecords] = await Promise.all([
    servarrGet<WantedPage<WantedMovie>>(instance, 'wanted/missing', {
      page: 1,
      pageSize: 50,
      sortKey: 'added',
      sortDirection: 'descending'
    }),
    readBoundedQueue(instance)
  ]);
  const active = new Set(queueRecords.map((item) => item.movieId).filter(isPositiveInteger));
  const result: Candidate[] = [];

  for (const movie of wanted.records ?? []) {
    if (
      !isPositiveInteger(movie.id) ||
      movie.monitored === false ||
      movie.hasFile === true ||
      movie.isAvailable === false
    )
      continue;
    const key = `${instance}:movie:${movie.id}`;
    seen.add(key);
    if (active.has(movie.id)) {
      if (state.entries[key]) {
        state.entries[key].lastSeenAt = now.toISOString();
        state.entries[key].active = true;
      }
      continue;
    }
    const candidate = trackCandidate(state, key, instance, 'movie', movie.id, movie.added, now);
    if (candidate) result.push(candidate);
  }
  return result;
}

async function seriesCandidates(
  instance: ArrInstance,
  now: Date,
  state: ReconciliationState,
  seen: Set<string>
): Promise<Candidate[]> {
  const [wanted, queueRecords, seriesList] = await Promise.all([
    servarrGet<WantedPage<WantedEpisode>>(instance, 'wanted/missing', {
      page: 1,
      pageSize: 100,
      sortKey: 'airDateUtc',
      sortDirection: 'descending'
    }),
    readBoundedQueue(instance),
    servarrGet<SeriesSummary[]>(instance, 'series')
  ]);
  const activeEpisodes = new Set(queueRecords.map((item) => item.episodeId).filter(isPositiveInteger));
  const seriesById = new Map(
    seriesList.filter((series) => isPositiveInteger(series.id)).map((series) => [series.id as number, series])
  );
  const result: Candidate[] = [];
  for (const episode of wanted.records ?? []) {
    const seriesId = episode.seriesId ?? episode.series?.id;
    const series = seriesById.get(seriesId as number);
    const airedAt = validDate(episode.airDateUtc);
    if (
      !isPositiveInteger(seriesId) ||
      episode.monitored === false ||
      (series?.monitored ?? episode.series?.monitored) === false ||
      episode.hasFile === true ||
      !airedAt ||
      airedAt.getTime() > now.getTime()
    )
      continue;
    if (!isPositiveInteger(episode.id)) continue;
    const key = `${instance}:episode:${episode.id}`;
    seen.add(key);
    if (activeEpisodes.has(episode.id)) {
      if (state.entries[key]) {
        state.entries[key].lastSeenAt = now.toISOString();
        state.entries[key].active = true;
      }
      continue;
    }
    const candidate = trackCandidate(
      state,
      key,
      instance,
      'episode',
      episode.id,
      seriesById.get(seriesId)?.added ?? episode.series?.added,
      now
    );
    if (candidate) result.push(candidate);
  }
  return result;
}

function trackCandidate(
  state: ReconciliationState,
  key: string,
  instance: ArrInstance,
  mediaType: Candidate['mediaType'],
  id: number,
  addedAt: string | undefined,
  now: Date
): Candidate | undefined {
  const added = validDate(addedAt);
  const existing = state.entries[key];
  if (!existing && Object.keys(state.entries).length >= maxTrackedEntries) return undefined;
  const firstSeen = existing ? validDate(existing.firstSeenAt) : added;
  if (!firstSeen || now.getTime() - firstSeen.getTime() > candidateMaxAgeMs) {
    delete state.entries[key];
    return undefined;
  }
  const entry: RetryEntry = existing ?? {
    firstSeenAt: firstSeen.toISOString(),
    lastSeenAt: now.toISOString(),
    attempts: 0
  };
  entry.lastSeenAt = now.toISOString();
  entry.active = false;
  state.entries[key] = entry;
  return { key, instance, mediaType, id, firstSeenAt: entry.firstSeenAt, entry };
}

function isDue(entry: RetryEntry, now: Date) {
  if (entry.attempts >= retryDelaysMs.length) return false;
  const anchor = validDate(entry.lastAttemptAt ?? entry.firstSeenAt);
  return Boolean(anchor && now.getTime() - anchor.getTime() >= retryDelaysMs[entry.attempts]);
}

function groupCandidates(candidates: Candidate[]) {
  const groups = new Map<
    string,
    { instance: ArrInstance; mediaType: Candidate['mediaType']; ids: number[]; candidates: Candidate[] }
  >();
  for (const candidate of candidates) {
    const key = `${candidate.instance}:${candidate.mediaType}`;
    const group = groups.get(key) ?? {
      instance: candidate.instance,
      mediaType: candidate.mediaType,
      ids: [],
      candidates: []
    };
    group.ids.push(candidate.id);
    group.candidates.push(candidate);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function selectBoundedCandidates(candidates: Candidate[]) {
  const selected: Candidate[] = [];
  const perInstance = new Map<ArrInstance, number>();
  for (const candidate of candidates) {
    if (selected.length >= maxQueuedPerRun) break;
    const count = perInstance.get(candidate.instance) ?? 0;
    if (count >= maxQueuedPerInstance) continue;
    selected.push(candidate);
    perInstance.set(candidate.instance, count + 1);
  }
  return selected;
}

async function readBoundedQueue(instance: ArrInstance) {
  const queue = await servarrGet<QueuePage>(instance, 'queue', { page: 1, pageSize: 200 });
  const records = queue.records ?? [];
  if ((queue.totalRecords ?? records.length) > records.length)
    throw new Error(`Queue for ${instance} exceeds the safe reconciliation limit.`);
  return records;
}

async function collectCandidates(
  candidates: Candidate[],
  errors: MediaSearchReconciliationResult['errors'],
  instance: ArrInstance,
  read: () => Promise<Candidate[]>
) {
  try {
    candidates.push(...(await read()));
  } catch (error) {
    errors.push({
      instance,
      message: redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 240)
    });
  }
}

function pruneState(state: ReconciliationState, seen: Set<string>, now: Date) {
  for (const [key, entry] of Object.entries(state.entries)) {
    const lastSeen = validDate(entry.lastSeenAt);
    if (!seen.has(key) && (!lastSeen || now.getTime() - lastSeen.getTime() > stateRetentionMs))
      delete state.entries[key];
  }
}

function readState(): ReconciliationState {
  const value = readJsonSetting<ReconciliationState>(stateKey, { entries: {} });
  return value && typeof value === 'object' && value.entries && typeof value.entries === 'object'
    ? value
    : { entries: {} };
}

function parseNow(value: string | undefined) {
  if (!value) return new Date();
  const parsed = validDate(value);
  if (!parsed) throw new Error('now must be a valid ISO date.');
  return parsed;
}

function validDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function enabled(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function isPositiveInteger(value: number | undefined): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}
