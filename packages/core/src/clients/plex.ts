import { requestJson, withQuery } from './http';
import { serviceApiKey, serviceBaseUrl } from './serviceConfig';

export type WatchAnalyticsProvider = 'plex' | 'tracearr';
function token() {
  const apiKey = serviceApiKey('plex');
  if (!apiKey) throw new Error('Missing Plex token in Stackarr configuration.');
  return apiKey;
}
export const plexGet = <T = unknown>(path: string, query: Record<string, string | number | boolean | undefined> = {}) =>
  requestJson<T>(
    withQuery(`${serviceBaseUrl('plex')}/${path.replace(/^\//, '')}`, { ...query, 'X-Plex-Token': token() }),
    { headers: { accept: 'application/json' } }
  );
export const plexPut = <T = unknown>(path: string, query: Record<string, string | number | boolean | undefined> = {}) =>
  requestJson<T>(
    withQuery(`${serviceBaseUrl('plex')}/${path.replace(/^\//, '')}`, { ...query, 'X-Plex-Token': token() }),
    { method: 'PUT', headers: { accept: 'application/json' } }
  );
