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
