import { plexGet, plexPut, type WatchAnalyticsProvider } from '../clients/plex';
import { serviceBaseUrl } from '../clients/serviceConfig';

export const getPlexServerStatusAction = () => plexGet('identity');
export const getPlexLibrariesAction = () => plexGet('library/sections');
export const getPlexSessionsAction = () => plexGet('status/sessions');
export const getRecentlyAddedAction = (input: { limit?: number } = {}) =>
  plexGet('library/recentlyAdded', { 'X-Plex-Container-Size': input.limit ?? 25 });
export const getRecentlyWatchedAction = (input: { limit?: number } = {}) =>
  plexGet('status/sessions/history/all', { 'X-Plex-Container-Size': input.limit ?? 25 });
export const getPlexWatchSummaryAction = async (input: { provider?: WatchAnalyticsProvider } = {}) => {
  if (input.provider === 'tracearr') {
    return {
      provider: 'tracearr',
      implemented: false,
      tracearrUrl: serviceBaseUrl('tracearr'),
      message: 'Tracearr is managed as a Stackarr service; direct Tracearr MCP analytics are not implemented yet.'
    };
  }

  return {
    provider: 'plex',
    sessions: await getPlexSessionsAction(),
    recentlyWatched: await getRecentlyWatchedAction({ limit: 10 })
  };
};
export const scanPlexLibraryAction = (input: { sectionId: string | number }) =>
  plexGet(`library/sections/${input.sectionId}/refresh`);
export const refreshPlexMetadataAction = (input: { ratingKey: string | number }) =>
  plexPut(`library/metadata/${input.ratingKey}/refresh`);
