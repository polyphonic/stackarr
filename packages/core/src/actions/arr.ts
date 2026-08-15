import { servarrGet, servarrPost, servarrPut } from '../clients/servarr';
import type { ArrInstance } from '../clients/serviceConfig';

export type SeriesInstance = 'sonarr' | 'sonarr4k';
export type MovieInstance = 'radarr' | 'radarr4k';

export const searchSeriesAction = (input: { instance: SeriesInstance; term: string }) =>
  servarrGet(input.instance, 'series/lookup', { term: input.term });
export const searchMovieAction = (input: { instance: MovieInstance; term: string }) =>
  servarrGet(input.instance, 'movie/lookup', { term: input.term });
export const addSeriesAction = (input: { instance: SeriesInstance; series: unknown }) =>
  servarrPost(input.instance, 'series', input.series);
export const addMovieAction = (input: { instance: MovieInstance; movie: unknown }) =>
  servarrPost(input.instance, 'movie', input.movie);

export async function monitorSeriesAction(input: { instance: SeriesInstance; seriesId: number; monitored: boolean }) {
  const series = await servarrGet<Record<string, unknown>>(input.instance, `series/${input.seriesId}`);
  return servarrPut(input.instance, `series/${input.seriesId}`, { ...series, monitored: input.monitored });
}
export const unmonitorSeriesAction = (input: { instance: SeriesInstance; seriesId: number }) =>
  monitorSeriesAction({ ...input, monitored: false });

export async function monitorMovieAction(input: { instance: MovieInstance; movieId: number; monitored: boolean }) {
  const movie = await servarrGet<Record<string, unknown>>(input.instance, `movie/${input.movieId}`);
  return servarrPut(input.instance, `movie/${input.movieId}`, { ...movie, monitored: input.monitored });
}
export const unmonitorMovieAction = (input: { instance: MovieInstance; movieId: number }) =>
  monitorMovieAction({ ...input, monitored: false });

export const getSeriesStatusAction = (input: { instance: SeriesInstance; seriesId?: number }) =>
  input.seriesId ? servarrGet(input.instance, `series/${input.seriesId}`) : servarrGet(input.instance, 'series');
export const getMovieStatusAction = (input: { instance: MovieInstance; movieId?: number }) =>
  input.movieId ? servarrGet(input.instance, `movie/${input.movieId}`) : servarrGet(input.instance, 'movie');
export const getMissingEpisodesAction = (input: { instance: SeriesInstance; page?: number; pageSize?: number }) =>
  servarrGet(input.instance, 'wanted/missing', { page: input.page ?? 1, pageSize: input.pageSize ?? 50 });
export const getWantedMoviesAction = (input: { instance: MovieInstance; page?: number; pageSize?: number }) =>
  servarrGet(input.instance, 'wanted/missing', { page: input.page ?? 1, pageSize: input.pageSize ?? 50 });
export const getArrQueueAction = (input: { instance: ArrInstance; page?: number; pageSize?: number }) =>
  servarrGet(input.instance, 'queue', { page: input.page ?? 1, pageSize: input.pageSize ?? 50 });

type ArrHistoryRecord = {
  id?: number;
  eventType?: string;
  sourceTitle?: string;
  date?: string;
  downloadId?: string;
  quality?: { quality?: { name?: string } };
  customFormats?: Array<{ name?: string }>;
  data?: Record<string, unknown>;
};

type ArrHistoryPage = { records?: ArrHistoryRecord[] };

type DownloadProvenance = {
  downloadId: string;
  sourceTitle?: string;
  quality?: string;
  customFormats: string[];
  indexer?: string;
  downloadClient?: string;
  protocol?: string;
  releaseSource?: string;
  torrentInfoHash?: string;
  size?: number;
  grabbedAt?: string;
  importedAt?: string;
  importedPath?: string;
  sourcePath?: string;
  historyRecordIds: number[];
};

export async function getMovieDownloadProvenanceAction(input: {
  instance: MovieInstance;
  movieId: number;
  limit?: number;
}) {
  const records = await servarrGet<ArrHistoryRecord[]>(input.instance, 'history/movie', { movieId: input.movieId });
  return {
    instance: input.instance,
    mediaType: 'movie',
    movieId: input.movieId,
    downloads: normalizeDownloadProvenance(records).slice(0, boundedHistoryLimit(input.limit))
  };
}

export async function getEpisodeDownloadProvenanceAction(input: {
  instance: SeriesInstance;
  episodeId: number;
  limit?: number;
}) {
  const limit = boundedHistoryLimit(input.limit);
  const page = await servarrGet<ArrHistoryPage>(input.instance, 'history', {
    episodeId: input.episodeId,
    page: 1,
    pageSize: Math.min(100, limit * 2),
    sortKey: 'date',
    sortDirection: 'descending'
  });
  return {
    instance: input.instance,
    mediaType: 'episode',
    episodeId: input.episodeId,
    downloads: normalizeDownloadProvenance(page.records ?? []).slice(0, limit)
  };
}

function normalizeDownloadProvenance(records: ArrHistoryRecord[]): DownloadProvenance[] {
  const downloads = new Map<string, DownloadProvenance & { latestAt?: string }>();

  for (const record of records) {
    if (record.eventType !== 'grabbed' && record.eventType !== 'downloadFolderImported') continue;
    const data = record.data ?? {};
    const downloadId = text(record.downloadId) || text(data.torrentInfoHash);
    if (!downloadId) continue;

    const existing = downloads.get(downloadId) ?? {
      downloadId,
      customFormats: [],
      historyRecordIds: []
    };
    existing.sourceTitle ||= text(record.sourceTitle);
    existing.quality ||= text(record.quality?.quality?.name);
    existing.customFormats = Array.from(
      new Set([
        ...existing.customFormats,
        ...(record.customFormats ?? []).map((item) => text(item.name)).filter((name): name is string => Boolean(name))
      ])
    );
    existing.indexer ||= text(data.indexer);
    existing.downloadClient ||= text(data.downloadClientName) || text(data.downloadClient);
    existing.protocol ||= protocolName(data.protocol);
    existing.releaseSource ||= text(data.releaseSource);
    existing.torrentInfoHash ||= text(data.torrentInfoHash);
    existing.size ||= numberValue(data.size);
    if (record.eventType === 'grabbed') existing.grabbedAt ||= text(record.date);
    if (record.eventType === 'downloadFolderImported') {
      existing.importedAt ||= text(record.date);
      existing.importedPath ||= text(data.importedPath);
      existing.sourcePath ||= text(data.droppedPath);
    }
    if (record.id !== undefined && !existing.historyRecordIds.includes(record.id))
      existing.historyRecordIds.push(record.id);
    if (!existing.latestAt || (record.date && record.date > existing.latestAt)) existing.latestAt = record.date;
    downloads.set(downloadId, existing);
  }

  return Array.from(downloads.values())
    .sort((left, right) => (right.latestAt ?? '').localeCompare(left.latestAt ?? ''))
    .map(({ latestAt: _latestAt, ...download }) => download);
}

function boundedHistoryLimit(value: number | undefined) {
  return Math.max(1, Math.min(100, Math.trunc(value ?? 25)));
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function protocolName(value: unknown) {
  if (value === 2 || value === '2') return 'torrent';
  if (value === 1 || value === '1') return 'usenet';
  return text(value);
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function triggerArrSearchAction(input: {
  instance: ArrInstance;
  command:
    | 'SeriesSearch'
    | 'EpisodeSearch'
    | 'MissingEpisodeSearch'
    | 'MoviesSearch'
    | 'RefreshSeries'
    | 'RefreshMovie';
  ids?: number[];
}) {
  const body: Record<string, unknown> = { name: input.command };
  if (input.ids?.length) {
    if (input.command.includes('Movie')) body.movieIds = input.ids;
    else body.seriesIds = input.ids;
  }
  return servarrPost(input.instance, 'command', body);
}
export const refreshArrItemAction = (input: { instance: ArrInstance; id: number }) =>
  triggerArrSearchAction({
    instance: input.instance,
    command: input.instance.startsWith('radarr') ? 'RefreshMovie' : 'RefreshSeries',
    ids: [input.id]
  });
