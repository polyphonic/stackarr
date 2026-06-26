import { requestJson, withQuery } from './http';
import { serviceApiKey, serviceBaseUrl } from './serviceConfig';

function key() {
  const apiKey = serviceApiKey('prowlarr');
  if (!apiKey) throw new Error('Missing Prowlarr API key in Stackarr configuration.');
  return apiKey;
}
export const prowlarrGet = <T = unknown>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
) =>
  requestJson<T>(
    withQuery(`${serviceBaseUrl('prowlarr')}/api/v1/${path.replace(/^\//, '')}`, { ...query, apikey: key() })
  );
export const prowlarrPost = <T = unknown>(path: string, body: unknown) =>
  requestJson<T>(withQuery(`${serviceBaseUrl('prowlarr')}/api/v1/${path.replace(/^\//, '')}`, { apikey: key() }), {
    method: 'POST',
    body
  });
